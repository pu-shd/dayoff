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
      formatDate: () => "2026-11-13",
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
      sendEmail: (m: { to: string; subject: string; body: string }) =>
        mails.push(m),
    },
    ScriptApp: {
      getProjectTriggers: () => [],
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
