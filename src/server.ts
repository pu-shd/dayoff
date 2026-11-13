import {
  validateConfig,
  report,
  hoursText,
  managementMessage,
  title,
  plusDays,
  pendingCalm,
  invariant,
  csvCell,
  type Config,
  type RecordEntry,
  type Input,
} from "./domain.js";
import { submit, sync, cancel, markCalm, type Ports } from "./workflow.js";
declare const DAYOFF_CONFIG: Config;
declare const DAYOFF_SEED: {
  policy?: Partial<Config["policy"]>;
  records: RecordEntry[];
  warnings?: string[];
};
const SCHEMA = 1;
function config(): Config {
  return validateConfig({
    ...DAYOFF_CONFIG,
    policy: { ...DAYOFF_CONFIG.policy, ...DAYOFF_SEED.policy },
  });
}
function actor(): Config {
  const c = config(),
    email = Session.getEffectiveUser().getEmail().toLowerCase();
  invariant(
    email === c.ownerEmail.toLowerCase(),
    "This installation belongs to a different account.",
  );
  const storedYear = props().getProperty("FISCAL_YEAR");
  invariant(
    !storedYear || storedYear === String(c.fiscalYear),
    "This ledger belongs to another fiscal year. Create a new instance for rollover.",
  );
  return c;
}
function props() {
  return PropertiesService.getScriptProperties();
}
function store() {
  const id = props().getProperty("LEDGER_ID");
  invariant(id, "Initialize your private ledger first.");
  const book = SpreadsheetApp.openById(id);
  invariant(
    props().getProperty("SCHEMA_VERSION") === String(SCHEMA),
    "Unsupported ledger schema. Apply a versioned migration.",
  );
  const sheet = book.getSheetByName("Journal");
  invariant(sheet, "Ledger journal is missing.");
  return sheet;
}
function list(): RecordEntry[] {
  const sheet = store(),
    latest = new Map<string, RecordEntry>();
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  for (const row of values) {
    const r = JSON.parse(String(row[2])) as RecordEntry;
    latest.set(r.id, r);
  }
  return [...latest.values()];
}
function save(r: RecordEntry) {
  store().appendRow([new Date().toISOString(), "request", JSON.stringify(r)]);
}
function locked<T>(fn: () => T): T {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
function nonce(): string {
  const n = Utilities.getUuid();
  CacheService.getUserCache().put("csrf:" + n, "1", 1800);
  return n;
}
function consume(value: string): void {
  invariant(
    typeof value === "string" && /^[\w-]{36}$/.test(value),
    "Invalid confirmation. Refresh this page.",
  );
  const cache = CacheService.getUserCache();
  invariant(
    cache.get("csrf:" + value) === "1",
    "Confirmation expired. Refresh this page.",
  );
  cache.remove("csrf:" + value);
}
function guard<T>(token: string, fn: (c: Config) => T): T {
  return locked(() => {
    const c = actor();
    consume(token);
    return fn(c);
  });
}
function safe<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (
      e instanceof Error &&
      /^(Invalid|Configure|No |This |The |Partial|Absence|Dates|Request|Email|Delivery|Historical|Unsupported|Initialize|Confirmation|Resolve|Calendar|Only|Explicit)/.test(
        e.message,
      )
    )
      throw e;
    throw new Error(
      "The operation could not complete. Refresh to inspect its saved status, then retry.",
    );
  }
}
function eventId(id: string, date: string): string {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    id + ":" + date,
  )
    .map((x) => (x < 0 ? x + 256 : x).toString(16).padStart(2, "0"))
    .join("");
}
function calendar(c: Config, r: RecordEntry): void {
  const events = Calendar?.Events;
  invariant(events, "Calendar advanced service is unavailable.");
  for (const d of r.days) {
    const id = eventId(r.id, d.date);
    if (r.status === "cancelled") {
      try {
        events.remove(c.calendarId, id, { sendUpdates: "none" });
      } catch (e) {
        if (!/404|410|Not Found|notFound|has been deleted/i.test(String(e)))
          throw new Error("Calendar cancellation failed. Retry this request.");
      }
      continue;
    }
    const description =
      "Hours: " +
      hoursText(d.hours) +
      "\nCALM: " +
      (r.calm === "entered" ? "Entered" : "Pending") +
      "\nDayoff reference: " +
      r.id;
    const event: GoogleAppsScript.Calendar.Schema.Event = {
      id,
      summary: title(c, d),
      description,
      start: d.allDay
        ? { date: d.date }
        : { dateTime: d.date + "T" + d.start + ":00", timeZone: c.timeZone },
      end: d.allDay
        ? { date: plusDays(d.date, 1) }
        : { dateTime: d.date + "T" + d.end + ":00", timeZone: c.timeZone },
      extendedProperties: { private: { dayoffId: r.id } },
      transparency: "opaque",
    };
    try {
      events.insert(event, c.calendarId, { sendUpdates: "none" });
    } catch (e) {
      if (/409|already exists|duplicate/i.test(String(e)))
        events.patch(event, c.calendarId, id, { sendUpdates: "none" });
      else throw new Error("Calendar update failed. Retry this request.");
    }
  }
}
function ports(c: Config): Ports {
  return {
    list,
    save,
    now: () => new Date().toISOString(),
    calendar: (r) => calendar(c, r),
    mail: (to, subject, body) =>
      MailApp.sendEmail({ to: to.join(","), subject, body }),
  };
}
function dashboard(c: Config) {
  const initialized = !!props().getProperty("LEDGER_ID"),
    records = initialized ? list() : [];
  const today = Utilities.formatDate(new Date(), c.timeZone, "yyyy-MM-dd");
  return {
    initialized,
    nonce: nonce(),
    config: { ...c },
    records,
    totals: report(c, records, today),
    today,
    ledgerUrl: initialized
      ? "https://docs.google.com/spreadsheets/d/" +
        props().getProperty("LEDGER_ID") +
        "/edit"
      : "",
    warnings: DAYOFF_SEED.warnings || [],
    remindersInstalled: ScriptApp.getProjectTriggers().some(
      (t) => t.getHandlerFunction() === "sendCalmReminders",
    ),
    selectedUrl: ScriptApp.getService().getUrl(),
  };
}
function doGet(e: GoogleAppsScript.Events.DoGet) {
  actor();
  const template = HtmlService.createTemplateFromFile("Index");
  template.focus = JSON.stringify({
    id: e?.parameter?.request || "",
    version: e?.parameter?.version || "",
  }).replace(/</g, "\\u003c");
  return template
    .evaluate()
    .setTitle("Dayoff")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}
function getDashboard() {
  return safe(() => dashboard(actor()));
}
function initialize(token: string) {
  return safe(() =>
    guard(token, (c) => {
      if (!props().getProperty("LEDGER_ID")) {
        // Migration 001: append-only request journal. Never replace an existing ledger.
        const book = SpreadsheetApp.create(
          "Dayoff FY" + c.fiscalYear + " — Private",
        );
        const sheet = book.getSheets()[0];
        sheet.setName("Journal");
        sheet.appendRow(["timestamp", "kind", "payload"]);
        sheet.setFrozenRows(1);
        props().setProperties({
          LEDGER_ID: book.getId(),
          SCHEMA_VERSION: String(SCHEMA),
          FISCAL_YEAR: String(c.fiscalYear),
        });
      }
      const ids = new Set(list().map((r) => r.id));
      for (const r of DAYOFF_SEED.records)
        if (!ids.has(r.id)) {
          invariant(
            r.legacy === true && r.calm === "historical",
            "Invalid historical import.",
          );
          save(r);
        }
      return dashboard(c);
    }),
  );
}
function preview(input: Input) {
  return safe(() => {
    const c = actor();
    const r = submit(
      { ...c, delivery: "disabled" },
      { ...ports(c), list: () => [] },
      input,
    );
    return { ...r, message: managementMessage(c, r) };
  });
}
function createRequest(token: string, input: Input) {
  return safe(() =>
    guard(token, (c) => {
      invariant(c.delivery === "google", "Delivery is disabled. Use Preview.");
      submit(c, ports(c), input);
      return dashboard(c);
    }),
  );
}
function cancelRequest(token: string, id: string, version: number) {
  return safe(() =>
    guard(token, (c) => {
      cancel(c, ports(c), id, version);
      return dashboard(c);
    }),
  );
}
function confirmCalm(token: string, id: string, version: number) {
  return safe(() =>
    guard(token, (c) => {
      const r = markCalm(ports(c), id, version);
      // Calendar synchronization is retryable; CALM confirmation remains saved if it fails.
      if (c.delivery === "google") sync(c, ports(c), r);
      return dashboard(c);
    }),
  );
}
function retryRequest(token: string, id: string) {
  return safe(() =>
    guard(token, (c) => {
      const r = list().find((x) => x.id === id);
      invariant(r, "Request not found.");
      sync(c, ports(c), r);
      return dashboard(c);
    }),
  );
}
function resolveEmail(
  token: string,
  id: string,
  version: number,
  accepted: boolean,
) {
  return safe(() =>
    guard(token, (c) => {
      const r = list().find((x) => x.id === id);
      invariant(r && r.version === version, "Request changed or not found.");
      invariant(
        r.email === "unknown" || r.email === "sending",
        "No uncertain email to resolve.",
      );
      invariant(
        accepted === true,
        "Only confirm after checking Sent mail. Resubmission requires manual review.",
      );
      r.email = "accepted";
      r.version++;
      r.updated = new Date().toISOString();
      save(r);
      return dashboard(c);
    }),
  );
}
function installReminders(token: string) {
  return safe(() =>
    guard(token, (c) => {
      invariant(c.delivery === "google", "Delivery is disabled.");
      if (
        !ScriptApp.getProjectTriggers().some(
          (t) => t.getHandlerFunction() === "sendCalmReminders",
        )
      )
        ScriptApp.newTrigger("sendCalmReminders")
          .timeBased()
          .everyDays(1)
          .atHour(c.reminderHour)
          .inTimezone(c.timeZone)
          .create();
      return dashboard(c);
    }),
  );
}
function stopReminders(token: string) {
  return safe(() =>
    guard(token, (c) => {
      ScriptApp.getProjectTriggers()
        .filter((t) => t.getHandlerFunction() === "sendCalmReminders")
        .forEach((t) => ScriptApp.deleteTrigger(t));
      return dashboard(c);
    }),
  );
}
function sendCalmReminders() {
  return safe(() =>
    locked(() => {
      const c = actor();
      if (c.delivery !== "google") return;
      const now = new Date(),
        today = Utilities.formatDate(now, c.timeZone, "yyyy-MM-dd");
      if (
        [0, 6].includes(new Date(today + "T12:00:00Z").getUTCDay()) ||
        props().getProperty("LAST_REMINDER") === today
      )
        return;
      const pending = list().filter(pendingCalm);
      if (!pending.length) return;
      const url = ScriptApp.getService().getUrl();
      invariant(url, "No web deployment is available.");
      const lines = pending.map(
        (r) =>
          r.days[0].date +
          " — " +
          r.input.category +
          " — " +
          hoursText(r.days.reduce((n, d) => n + d.hours, 0)) +
          " hours" +
          (r.calm === "correction" ? " — CANCEL IN CALM" : "") +
          "\n" +
          url +
          "?request=" +
          encodeURIComponent(r.id) +
          "&version=" +
          r.version,
      );
      MailApp.sendEmail({
        to: c.ownerEmail,
        subject:
          "CALM: " +
          pending.length +
          " outstanding leave " +
          (pending.length === 1 ? "entry" : "entries"),
        body:
          "Enter or correct these records in CALM, then open each link to confirm.\n\n" +
          lines.join("\n\n"),
      });
      props().setProperty("LAST_REMINDER", today);
    }),
  );
}
function exportReport() {
  return safe(() => {
    actor();
    const rows = [
      ["request", "status", "date", "category", "hours", "CALM", "source"],
    ];
    for (const r of list())
      for (const d of r.days)
        rows.push([
          r.id,
          r.status,
          d.date,
          r.input.category,
          hoursText(d.hours),
          r.calm,
          r.legacy ? "monthly workbook summary" : "dayoff",
        ]);
    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  });
}
function health() {
  return safe(() => {
    const c = actor();
    return {
      ok: true,
      fiscalYear: c.fiscalYear,
      delivery: c.delivery,
      initialized: !!props().getProperty("LEDGER_ID"),
      schema: SCHEMA,
    };
  });
}
export const handlers = {
  doGet,
  getDashboard,
  initialize,
  preview,
  createRequest,
  cancelRequest,
  confirmCalm,
  retryRequest,
  resolveEmail,
  installReminders,
  stopReminders,
  sendCalmReminders,
  exportReport,
  health,
};
