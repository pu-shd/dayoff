import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import type { Config, RecordEntry } from "../src/domain.js";
type Handlers = typeof import("../src/server.js").handlers;
const cfg = JSON.parse(readFileSync("config/example.json", "utf8")) as Config;
function harness(
  delivery: Config["delivery"] = "google",
  seed: RecordEntry[] = [],
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
  let today = "2026-11-13",
    failMail = false;
  let identity = cfg.ownerEmail,
    created = 0;
  const sheet = {
    setName: () => {},
    appendRow: (row: unknown[]) => rows.push(row),
    setFrozenRows: () => {},
    getLastRow: () => rows.length,
    getRange: (first: number, _column: number, count: number) => ({
      getValues: () => rows.slice(first - 1, first - 1 + count),
    }),
  };
  const book = {
    getId: () => "private-ledger",
    getSheets: () => [sheet],
    getSheetByName: () => sheet,
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
        insert: (e: GoogleAppsScript.Calendar.Schema.Event) => {
          if (events.has(e.id!)) throw Error("409 duplicate");
          events.set(e.id!, e);
        },
        patch: (
          e: GoogleAppsScript.Calendar.Schema.Event,
          _calendar: string,
          id: string,
        ) => events.set(id, e),
        remove: (_calendar: string, id: string) => events.delete(id),
      },
    },
    MailApp: {
      sendEmail: (m: { to: string; subject: string; body: string }) => {
        if (failMail) throw Error("private-provider-details");
        mails.push(m);
      },
    },
    ScriptApp: {
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
    properties,
    events,
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
  assert.equal(h.properties.get("SCHEMA_VERSION"), "2");
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
  assert.match(h.mails[0].body, /CORRECT CANCELLED LEAVE/);
  s = h.api.confirmCalm(s.nonce, "request-1234", 3);
  assert.equal(s.reminders.pendingCount, 0);
});
