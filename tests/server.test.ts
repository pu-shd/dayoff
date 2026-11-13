import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { historyFixture } from "./history-fixture.js";
import type { HistoryArchive } from "../src/history.js";
import type { Config, RecordEntry } from "../src/domain.js";
type Handlers = typeof import("../src/server.js").handlers;
const cfg = JSON.parse(readFileSync("config/example.json", "utf8")) as Config;
function harness(
  delivery: Config["delivery"] = "google",
  seed: RecordEntry[] = [],
  history: HistoryArchive = {
    schemaVersion: 1,
    anchorFiscalYear: 2027,
    years: [],
  },
) {
  const rows: unknown[][] = [],
    properties = new Map<string, string>(),
    cache = new Map<string, string>(),
    events = new Map<string, GoogleAppsScript.Calendar.Schema.Event>(),
    mails: { to: string; subject: string; body: string }[] = [];
  const triggers: {
    getHandlerFunction: () => string;
    getUniqueId: () => string;
    hour: number;
    zone: string;
  }[] = [];
  const calendarWrites: string[] = [];
  const calendarLists: {
    calendarId: string;
    options: Record<string, unknown>;
  }[] = [];
  const scriptCache = new Map<string, string>();
  let beforeWrite: (() => void) | undefined;
  let etagVersion = 0;
  let failRead = false;
  let today = "2026-11-13",
    failMail = false;
  let identity = cfg.ownerEmail,
    created = 0;
  const makeSheet = (data: unknown[][]) => ({
    setName: () => {},
    appendRow: (row: unknown[]) => data.push(row),
    setFrozenRows: () => {},
    getLastRow: () => data.length,
    getRange: (first: number, _column: number, count: number) => ({
      getValues: () => data.slice(first - 1, first - 1 + count),
    }),
  });
  const sheet = makeSheet(rows),
    historyRows: unknown[][] = [];
  const sheets = new Map([["Journal", sheet]]);
  const book = {
    getId: () => "private-ledger",
    getSheets: () => [sheet],
    getSheetByName: (name: string) => sheets.get(name) ?? null,
    insertSheet: (name: string) => {
      const s = makeSheet(historyRows);
      sheets.set(name, s);
      return s;
    },
  };
  const props = {
    getProperty: (k: string) => properties.get(k) || null,
    setProperty: (k: string, v: string) => properties.set(k, v),
    setProperties: (values: Record<string, string>) =>
      Object.entries(values).forEach(([k, v]) => properties.set(k, v)),
  };
  const code = buildSync({
    entryPoints: ["src/server.ts"],
    bundle: true,
    format: "iife",
    globalName: "Dayoff",
    write: false,
    define: {
      DAYOFF_CONFIG: JSON.stringify({ ...cfg, delivery }),
      DAYOFF_SEED: JSON.stringify({ records: seed }),
      DAYOFF_HISTORY: JSON.stringify(history),
    },
  }).outputFiles[0].text;
  const context: Record<string, unknown> = {
    Session: { getEffectiveUser: () => ({ getEmail: () => identity }) },
    PropertiesService: { getScriptProperties: () => props },
    SpreadsheetApp: {
      create: () => {
        created++;
        return book;
      },
      openById: () => book,
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key: string) => scriptCache.get(key) || null,
        put: (key: string, value: string) => scriptCache.set(key, value),
      }),
      getUserCache: () => ({
        put: (k: string, v: string) => cache.set(k, v),
        get: (k: string) => cache.get(k) || null,
        remove: (k: string) => cache.delete(k),
      }),
    },
    Utilities: {
      getUuid: randomUUID,
      formatDate: () => today,
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (_algo: string, value: string) => [
        ...createHash("sha256").update(value).digest(),
      ],
    },
    Calendar: {
      Events: {
        list: (calendarId: string, options: Record<string, unknown>) => {
          calendarLists.push({ calendarId, options });
          if (failRead) throw Error("503 private provider details");
          return { items: [...events.values()] };
        },
        get: (_calendar: string, id: string) => {
          if (failRead) throw Error("503 service unavailable");
          const e = events.get(id);
          if (!e) throw Error("404 Not Found");
          return structuredClone(e);
        },
        insert: (e: GoogleAppsScript.Calendar.Schema.Event) => {
          const hook = beforeWrite;
          beforeWrite = undefined;
          hook?.();
          if (events.has(e.id!)) throw Error("409 duplicate");
          calendarWrites.push("insert");
          events.set(e.id!, {
            ...structuredClone(e),
            etag: `version-${++etagVersion}`,
          });
        },
        patch: (
          e: GoogleAppsScript.Calendar.Schema.Event,
          _calendar: string,
          id: string,
          _options?: object,
          headers?: Record<string, string>,
        ) => {
          const hook = beforeWrite;
          beforeWrite = undefined;
          hook?.();
          const current = events.get(id);
          if (headers?.["If-Match"] !== current?.etag)
            throw Error("412 Precondition Failed");
          calendarWrites.push("patch");
          events.set(id, {
            ...current,
            ...structuredClone(e),
            etag: `version-${++etagVersion}`,
          });
        },
        remove: (
          _calendar: string,
          id: string,
          _options?: object,
          headers?: Record<string, string>,
        ) => {
          const hook = beforeWrite;
          beforeWrite = undefined;
          hook?.();
          if (headers?.["If-Match"] !== events.get(id)?.etag)
            throw Error("412 Precondition Failed");
          calendarWrites.push("remove");
          events.delete(id);
        },
      },
    },
    MailApp: {
      sendEmail: (m: { to: string; subject: string; body: string }) => {
        if (failMail) throw Error("private-provider-details");
        mails.push(m);
      },
    },
    ScriptApp: {
      getScriptId: () => "instance-test",
      getProjectTriggers: () => [...triggers],
      deleteTrigger: (t: (typeof triggers)[number]) => {
        triggers.splice(triggers.indexOf(t), 1);
      },
      newTrigger: (name: string) => {
        let hour = 0,
          zone = "";
        const builder = {
          timeBased: () => builder,
          everyDays: () => builder,
          atHour: (n: number) => {
            hour = n;
            return builder;
          },
          inTimezone: (s: string) => {
            zone = s;
            return builder;
          },
          create: () => {
            const t = {
              getHandlerFunction: () => name,
              getUniqueId: () => randomUUID(),
              hour,
              zone,
            };
            triggers.push(t);
            return t;
          },
        };
        return builder;
      },
      getService: () => ({
        getUrl: () => "https://script.google.com/macros/s/example/exec",
      }),
    },
    HtmlService: {
      createTemplateFromFile: () => {
        const output = { setTitle: () => output, addMetaTag: () => output };
        return { focus: "", evaluate: () => output };
      },
    },
  };
  runInNewContext(code, context);
  const api = (context.Dayoff as { handlers: Handlers }).handlers;
  function init() {
    const s = api.getDashboard();
    return api.initialize(s.nonce);
  }
  return {
    api,
    init,
    rows,
    historyRows,
    sheets,
    properties,
    events,
    calendarWrites,
    calendarLists,
    failCalendarRead: () => {
      failRead = true;
    },
    beforeCalendarWrite: (fn: () => void) => {
      beforeWrite = fn;
    },
    mails,
    created: () => created,
    triggers,
    setToday: (s: string) => {
      today = s;
    },
    failMail: () => {
      failMail = true;
    },
    setIdentity: (email: string) => {
      identity = email;
    },
  };
}
test("GET renders only; initialization is explicit and idempotent", () => {
  const h = harness("disabled");
  h.api.doGet({
    parameter: { request: "request-1234" },
  } as unknown as GoogleAppsScript.Events.DoGet);
  assert.equal(h.rows.length, 0);
  assert.equal(h.created(), 0);
  h.init();
  h.init();
  assert.equal(h.created(), 1);
  assert.equal(h.rows.length, 1);
});
test("nonce replay and another account cannot mutate a private installation", () => {
  const h = harness();
  const s = h.init();
  const input = {
    id: "request-1234",
    category: "vacation" as const,
    mode: "full" as const,
    first: "2026-11-16",
    last: "2026-11-16",
  };
  h.api.createRequest(s.nonce, input);
  assert.throws(
    () => h.api.createRequest(s.nonce, { ...input, id: "request-5678" }),
    /Confirmation/,
  );
  h.setIdentity("someone@example.edu");
  assert.throws(() => h.api.getDashboard(), /different account/);
});
test("Calendar uses exclusive all-day ends; CALM confirmation updates notes without another email", () => {
  const h = harness();
  let s = h.init();
  s = h.api.createRequest(s.nonce, {
    id: "request-1234",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
  });
  assert.equal(h.events.size, 1);
  assert.equal([...h.events.values()][0].end?.date, "2026-11-17");
  assert.equal(h.mails.length, 1);
  s = h.api.confirmCalm(s.nonce, "request-1234", 1);
  assert.equal(s.records[0].calm, "entered");
  assert.equal(h.events.size, 1);
  assert.match([...h.events.values()][0].description!, /CALM: Entered/);
  assert.equal(h.mails.length, 1);
});
test("reminder GET cannot confirm CALM; explicit confirmation stops reminders", () => {
  const h = harness();
  let s = h.init();
  s = h.api.createRequest(s.nonce, {
    id: "request-1234",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
  });
  s = h.api.installReminders(s.nonce);
  h.api.sendCalmReminders();
  assert.equal(h.mails.length, 2);
  assert.equal(h.mails[1].to, cfg.ownerEmail);
  assert.match(h.mails[1].body, /request=request-1234&version=1/);
  h.api.doGet({
    parameter: { request: "request-1234", version: "1" },
  } as unknown as GoogleAppsScript.Events.DoGet);
  assert.equal(h.api.getDashboard().records[0].calm, "pending");
  h.api.confirmCalm(s.nonce, "request-1234", 1);
  h.properties.delete("LAST_REMINDER");
  h.api.sendCalmReminders();
  assert.equal(h.mails.length, 2);
});
test("a populated ledger rejects a changed fiscal year", () => {
  const h = harness();
  h.init();
  h.properties.set("FISCAL_YEAR", "2025");
  assert.throws(() => h.api.getDashboard(), /fiscal year/i);
});
test("HTML script parses and uses text nodes for user content", () => {
  const html = readFileSync("src/Index.html", "utf8");
  const script = html
    .match(/<script>([\s\S]*?)<\/script>/)![1]
    .replace("<?!= focus ?>", "{}");
  assert.doesNotThrow(() => new Function(script));
  assert.doesNotMatch(script, /innerHTML/);
});

test("MailApp diagnostic targets only the owner while normal delivery is disabled", () => {
  const h = harness("disabled");
  const s = h.init(),
    before = h.rows.length;
  const result = h.api.testMail(s.nonce);
  assert.equal(result.accepted, true);
  assert.equal(h.mails.length, 1);
  assert.equal(h.mails[0].to, cfg.ownerEmail);
  assert.match(h.mails[0].subject, /Dayoff.*test/i);
  assert.equal(h.rows.length, before);
  assert.equal(h.events.size, 0);
  assert.throws(
    () => h.api.testMail(h.api.getDashboard().nonce),
    /one delivery test/,
  );
  assert.equal(h.mails.length, 1);
});
test("GET never sends a diagnostic; identity and nonce checks apply to diagnostics", () => {
  const h = harness("disabled");
  h.api.doGet({
    parameter: { mailTest: "1" },
  } as unknown as GoogleAppsScript.Events.DoGet);
  assert.equal(h.mails.length, 0);
  assert.throws(() => h.api.testMail("invalid"), /Invalid confirmation/);
  const s = h.init();
  h.setIdentity("another@example.edu");
  assert.throws(() => h.api.testMail(s.nonce), /different account/);
  assert.equal(h.mails.length, 0);
});

test("reminder schedule is configurable, idempotent, pausable, and sends nothing on setup", () => {
  const h = harness();
  let s = h.init();
  s = h.api.saveReminders(s.nonce, 10, true);
  s = h.api.saveReminders(s.nonce, 11, true);
  assert.equal(h.triggers.length, 1);
  assert.equal(h.triggers[0].hour, 11);
  assert.equal(h.triggers[0].zone, cfg.timeZone);
  assert.equal(h.mails.length, 0);
  assert.equal(s.reminders.enabled, true);
  assert.equal(s.reminders.hour, 11);
  assert.throws(() => h.api.saveReminders(s.nonce, 24, true), /hour/);
  s = h.api.getDashboard();
  s = h.api.stopReminders(s.nonce);
  assert.equal(h.triggers.length, 0);
  assert.equal(s.reminders.enabled, false);
});
test("silent requests still have CALM reminders; daily digest includes every day and is deduplicated", () => {
  const h = harness();
  let s = h.init();
  s = h.api.createRequest(s.nonce, {
    id: "request-1234",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-17",
    emailTo: "none",
  });
  assert.equal(h.mails.length, 0);
  assert.equal(s.reminders.pendingCount, 1);
  s = h.api.sendReminderNow(s.nonce);
  assert.equal(h.mails.length, 1);
  assert.match(h.mails[0].body, /2026-11-16/);
  assert.match(h.mails[0].body, /2026-11-17/);
  h.api.sendReminderNow(s.nonce);
  assert.equal(h.mails.length, 1);
  s = h.api.getDashboard();
  h.api.confirmCalm(s.nonce, "request-1234", 1);
  assert.equal(h.api.getDashboard().reminders.pendingCount, 0);
});
test("paused and weekend schedules send no digest; uncertain sends do not retry the same day", () => {
  const h = harness();
  let s = h.init();
  s = h.api.createRequest(s.nonce, {
    id: "request-1234",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
    emailTo: "none",
  });
  h.api.sendCalmReminders();
  assert.equal(h.mails.length, 0);
  h.api.installReminders(s.nonce);
  h.setToday("2026-11-14");
  h.api.sendCalmReminders();
  assert.equal(h.mails.length, 0);
  h.setToday("2026-11-16");
  h.failMail();
  assert.throws(() => h.api.sendCalmReminders(), /uncertain/);
  assert.equal(h.properties.get("REMINDER_ATTEMPT_STATE"), "unknown");
  assert.throws(() => h.api.sendCalmReminders(), /uncertain/);
  assert.equal(h.mails.length, 0);
});

test("migration 002 appends routing without changing balances and never runs on GET", () => {
  const h = harness();
  let s = h.init();
  s = h.api.createRequest(s.nonce, {
    id: "request-1234",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
  });
  const old = JSON.parse(JSON.stringify(s.records[0])) as RecordEntry;
  delete old.input.emailTo;
  delete old.emailRecipients;
  h.rows.push(["historical", "request", JSON.stringify(old)]);
  h.properties.set("SCHEMA_VERSION", "1");
  const rows = h.rows.length,
    mails = h.mails.length;
  const before = h.api.getDashboard();
  assert.equal(h.rows.length, rows);
  assert.equal(h.properties.get("SCHEMA_VERSION"), "1");
  const after = h.api.initialize(before.nonce);
  assert.equal(h.properties.get("SCHEMA_VERSION"), "5");
  assert.equal(after.records[0].input.emailTo, "management");
  assert.equal(
    after.records[0].emailRecipients?.join(","),
    cfg.managementEmails.join(","),
  );
  assert.equal(JSON.stringify(after.totals), JSON.stringify(before.totals));
  assert.equal(h.mails.length, mails);
  const upgraded = h.rows.length;
  h.api.initialize(after.nonce);
  assert.equal(h.rows.length, upgraded);
});
test("cancellations stay in the CALM correction digest until explicitly confirmed", () => {
  const h = harness();
  let s = h.init();
  s = h.api.createRequest(s.nonce, {
    id: "request-1234",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
    emailTo: "none",
  });
  s = h.api.confirmCalm(s.nonce, "request-1234", 1);
  s = h.api.cancelRequest(s.nonce, "request-1234", 2);
  assert.equal(s.reminders.pendingCount, 1);
  s = h.api.sendReminderNow(s.nonce);
  assert.match(h.mails[0].body, /CORRECT REMOVED LEAVE/);
  s = h.api.confirmCalm(s.nonce, "request-1234", 3);
  assert.equal(s.reminders.pendingCount, 0);
});

test("ledger fiscal boundaries are stored and protected independently of its year label", () => {
  const h = harness();
  const s = h.init();
  assert.deepEqual(JSON.parse(JSON.stringify(s.fiscalPeriod)), {
    start: "2026-07-01",
    end: "2027-06-30",
  });
  assert.equal(h.properties.get("FISCAL_YEAR_START"), "07-01");
  h.properties.set("FISCAL_YEAR_START", "10-01");
  assert.throws(() => h.api.getDashboard(), /fiscal-year start/);
});

test("history import is private, idempotent, and does not change active records, totals, mail or Calendar", () => {
  const h = harness("google", [], historyFixture());
  let s = h.init();
  s = h.api.createRequest(s.nonce, {
    id: "request-history",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
    emailTo: "none",
  });
  const original = JSON.stringify({
    records: s.records,
    totals: s.totals,
    rows: h.rows,
    events: [...h.events],
    mails: h.mails,
  });
  assert.equal(s.history.pendingImportCount, 1);
  s = h.api.importHistory(s.nonce);
  assert.equal(s.history.years.length, 1);
  assert.equal(s.history.pendingImportCount, 0);
  assert.equal(h.properties.get("HISTORY_ANCHOR_FY"), "2027");
  assert.equal(h.historyRows.length, 2);
  s = h.api.importHistory(s.nonce);
  assert.equal(h.historyRows.length, 2);
  assert.equal(
    JSON.stringify({
      records: s.records,
      totals: s.totals,
      rows: h.rows,
      events: [...h.events],
      mails: h.mails,
    }),
    original,
  );
  assert.equal(h.api.getHistoryYear(2027).source.headerYear, "2026");
  assert.throws(() => h.api.getHistoryYear(2028), /No attendance/);
  h.setIdentity("outsider@example.edu");
  assert.throws(() => h.api.getHistoryYear(2027), /different account/);
});
test("migration 004 adds only the archive sheet and never writes during a read", () => {
  const h = harness("google", [], historyFixture());
  h.init();
  h.sheets.delete("History");
  h.historyRows.length = 0;
  h.properties.set("SCHEMA_VERSION", "3");
  const before = h.rows.length;
  let s = h.api.getDashboard();
  assert.equal(h.properties.get("SCHEMA_VERSION"), "3");
  assert.equal(h.sheets.has("History"), false);
  assert.throws(() => h.api.importHistory("invalid"), /Invalid confirmation/);
  s = h.api.importHistory(s.nonce);
  assert.equal(h.properties.get("SCHEMA_VERSION"), "5");
  assert.equal(h.rows.length, before);
  assert.equal(s.history.years.length, 1);
});

test("a changed source appends a history revision without replacing prior rows", () => {
  const archive = historyFixture(),
    h = harness("google", [], archive);
  let s = h.init();
  h.api.importHistory(s.nonce);
  const old = structuredClone(archive.years[0]);
  old.revision = "c".repeat(64);
  old.daily[0].mark = "Older source";
  h.historyRows.push([2027, old.revision, JSON.stringify(old)]);
  assert.equal(h.api.getHistoryYear(2027).daily[0].mark, "Older source");
  s = h.api.getDashboard();
  assert.equal(s.history.pendingImportCount, 1);
  s = h.api.importHistory(s.nonce);
  assert.equal(h.historyRows.length, 4);
  assert.equal(h.api.getHistoryYear(2027).revision, archive.years[0].revision);
  assert.equal(s.records.length, 0);
});

test("Calendar events carry instance, request and date ownership tags", () => {
  const h = harness();
  const s = h.init();
  h.api.createRequest(s.nonce, {
    id: "request-tagged",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
    emailTo: "none",
  });
  const e = [...h.events.values()][0];
  assert.deepEqual(e.extendedProperties?.private, {
    dayoffId: "request-tagged",
    dayoffInstance: "instance-test",
    dayoffDate: "2026-11-16",
  });
});
test("Calendar changes and deletion reject untagged, foreign or mismatched events", () => {
  for (const tags of [
    { dayoffId: "request-tagged" },
    {
      dayoffId: "request-tagged",
      dayoffInstance: "another-instance",
      dayoffDate: "2026-11-16",
    },
    {
      dayoffId: "another-request",
      dayoffInstance: "instance-test",
      dayoffDate: "2026-11-16",
    },
    {
      dayoffId: "request-tagged",
      dayoffInstance: "instance-test",
      dayoffDate: "2026-11-17",
    },
  ] as Record<string, string>[]) {
    const h = harness();
    let s = h.init();
    s = h.api.createRequest(s.nonce, {
      id: "request-tagged",
      category: "vacation",
      mode: "full",
      first: "2026-11-16",
      last: "2026-11-16",
      emailTo: "none",
    });
    const e = [...h.events.values()][0];
    e.extendedProperties = { private: tags };
    const before = JSON.stringify([...h.events]);
    assert.throws(
      () => h.api.confirmCalm(s.nonce, "request-tagged", 1),
      /Calendar.*ownership|Calendar.*tag/i,
    );
    s = h.api.getDashboard();
    assert.throws(
      () =>
        h.api.cancelRequest(s.nonce, "request-tagged", s.records[0].version),
      /Calendar.*ownership|Calendar.*tag/i,
    );
    assert.equal(JSON.stringify([...h.events]), before);
    assert.deepEqual(h.calendarWrites, ["insert"]);
    assert.equal(h.mails.length, 0);
  }
});
test("Calendar preflights every date before a batch and uses ETags against concurrent ownership changes", () => {
  const h = harness();
  let s = h.init();
  s = h.api.createRequest(s.nonce, {
    id: "request-tagged",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-18",
    emailTo: "none",
  });
  const all = [...h.events.values()];
  all[2].extendedProperties!.private!.dayoffInstance = "other";
  assert.throws(
    () => h.api.cancelRequest(s.nonce, "request-tagged", 1),
    /Calendar.*ownership|Calendar.*tag/i,
  );
  assert.equal(h.events.size, 3);
  assert.deepEqual(h.calendarWrites, ["insert", "insert", "insert"]);
  const race = harness();
  s = race.init();
  s = race.api.createRequest(s.nonce, {
    id: "request-race",
    category: "sick",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
    emailTo: "none",
  });
  race.beforeCalendarWrite(() => {
    const e = [...race.events.values()][0];
    e.etag = "external-change";
    e.extendedProperties!.private!.dayoffInstance = "other";
  });
  assert.throws(
    () => race.api.confirmCalm(s.nonce, "request-race", 1),
    /Calendar.*changed|Calendar.*update/i,
  );
  assert.equal([...race.events.values()][0].etag, "external-change");
  assert.deepEqual(race.calendarWrites, ["insert"]);
});
test("a grouped request has one email, independent events and precise date removal and reminders", () => {
  const h = harness();
  let s = h.init();
  s = h.api.createRequest(s.nonce, {
    id: "request-grouped",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-18",
    ranges: [
      { mode: "full", first: "2026-11-16", last: "2026-11-18" },
      { mode: "full", first: "2026-11-20", last: "2026-11-20" },
    ],
  });
  assert.equal(h.events.size, 4);
  assert.equal(h.mails.length, 1);
  assert.doesNotMatch(h.mails[0].body, /11\/19/);
  s = h.api.confirmCalm(s.nonce, "request-grouped", 1);
  s = h.api.removeRequestDate(
    s.nonce,
    "request-grouped",
    s.records[0].version,
    "2026-11-17",
  );
  assert.equal(h.events.size, 3);
  assert.equal(h.mails.length, 2);
  assert.equal(s.totals.planned.vacation, 2175);
  h.api.sendReminderNow(s.nonce);
  const digest = h.mails.at(-1)!.body;
  assert.match(digest, /2026-11-17: 7.25 hours/);
  assert.doesNotMatch(digest, /2026-11-18:|2026-11-20:/);
  assert.match(h.api.exportReport(), /cancelled.*2026-11-17/);
});

test("Calendar read failures and creation collisions never authorize changes to foreign events", () => {
  const h = harness();
  let s = h.init();
  h.failCalendarRead();
  assert.throws(
    () =>
      h.api.createRequest(s.nonce, {
        id: "request-readfail",
        category: "sick",
        mode: "full",
        first: "2026-11-16",
        last: "2026-11-16",
      }),
    /Calendar ownership/,
  );
  assert.equal(h.events.size, 0);
  assert.equal(h.mails.length, 0);
  assert.deepEqual(h.calendarWrites, []);
  const race = harness();
  s = race.init();
  const id = createHash("sha256")
    .update("request-collision:2026-11-16")
    .digest("hex");
  const foreign = {
    id,
    summary: "Unrelated event",
    etag: "other-version",
    extendedProperties: { private: { dayoffInstance: "other" } },
  };
  race.beforeCalendarWrite(() => race.events.set(id, structuredClone(foreign)));
  assert.throws(
    () =>
      race.api.createRequest(s.nonce, {
        id: "request-collision",
        category: "vacation",
        mode: "full",
        first: "2026-11-16",
        last: "2026-11-16",
      }),
    /Calendar event ownership/,
  );
  assert.deepEqual(race.events.get(id), foreign);
  assert.deepEqual(race.calendarWrites, []);
});
test("Calendar deletion fails closed if ownership changes after its check", () => {
  const h = harness();
  let s = h.init();
  s = h.api.createRequest(s.nonce, {
    id: "request-delete-race",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
    emailTo: "none",
  });
  h.beforeCalendarWrite(() => {
    const e = [...h.events.values()][0];
    e.etag = "changed";
    e.extendedProperties!.private!.dayoffInstance = "other";
  });
  assert.throws(
    () => h.api.cancelRequest(s.nonce, "request-delete-race", 1),
    /Calendar event changed/,
  );
  assert.equal(h.events.size, 1);
  assert.deepEqual(h.calendarWrites, ["insert"]);
});
test("migration 005 appends cancellation metadata without changing hours or touching Calendar on setup", () => {
  const h = harness();
  let s = h.init();
  s = h.api.createRequest(s.nonce, {
    id: "request-legacy",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
    emailTo: "none",
  });
  const payload = JSON.parse(h.rows.at(-1)![2] as string);
  delete payload.cancelledDates;
  delete payload.calmCorrectionDates;
  h.rows.at(-1)![2] = JSON.stringify(payload);
  h.properties.set("SCHEMA_VERSION", "4");
  const before = h.rows.length,
    totals = JSON.stringify(s.totals),
    writes = h.calendarWrites.length;
  s = h.api.getDashboard();
  assert.equal(h.rows.length, before);
  assert.equal(h.properties.get("SCHEMA_VERSION"), "4");
  s = h.api.saveReminders(s.nonce, 9, false);
  assert.equal(h.properties.get("SCHEMA_VERSION"), "5");
  assert.equal(h.rows.length, before + 1);
  assert.deepEqual([...s.records[0].cancelledDates!], []);
  assert.equal(JSON.stringify(s.totals), totals);
  assert.equal(h.calendarWrites.length, writes);
});

test("Staff Calendar reads are cached, refreshable and have no ledger, mail or event mutations", () => {
  const h = harness(),
    ranges = [{ first: "2026-11-16", last: "2026-11-18" }];
  h.events.set("coworker", {
    summary: "Alex Off",
    start: { date: "2026-11-16" },
    end: { date: "2026-11-18" },
  });
  const first = h.api.getStaffCalendar(ranges);
  assert.equal(first.cached, false);
  assert.equal(first.days[0].events[0].summary, "Alex Off");
  assert.equal(h.api.getStaffCalendar(ranges).cached, true);
  assert.equal(h.calendarLists.length, 1);
  assert.equal(h.calendarLists[0].calendarId, cfg.calendarId);
  assert.equal(h.calendarLists[0].options.singleEvents, true);
  assert.equal(
    h.calendarLists[0].options.fields,
    "items(summary,start,end,status),nextPageToken",
  );
  h.api.getStaffCalendar(ranges, true);
  assert.equal(h.calendarLists.length, 2);
  assert.equal(h.rows.length, 0);
  assert.equal(h.properties.size, 0);
  assert.equal(h.mails.length, 0);
  assert.deepEqual(h.calendarWrites, []);
  h.setIdentity("another@example.edu");
  assert.throws(() => h.api.getStaffCalendar(ranges), /different account/);
  assert.equal(h.calendarLists.length, 2);
});
test("invalid lookup ranges and provider failures stay read-only and return safe errors", () => {
  const h = harness();
  assert.throws(
    () => h.api.getStaffCalendar([{ first: "2028-01-01", last: "2028-01-02" }]),
    /fiscal/,
  );
  assert.equal(h.calendarLists.length, 0);
  h.failCalendarRead();
  assert.throws(
    () => h.api.getStaffCalendar([{ first: "2026-11-16", last: "2026-11-16" }]),
    /Calendar availability could not be checked/,
  );
  assert.deepEqual(h.calendarWrites, []);
  assert.equal(h.rows.length, 0);
});
