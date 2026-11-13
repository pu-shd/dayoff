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
import { migration002 } from "./migrations.js";
declare const DAYOFF_CONFIG: Config;
declare const DAYOFF_SEED: {
  policy?: Partial<Config["policy"]>;
  records: RecordEntry[];
  warnings?: string[];
};
const SCHEMA = 2;
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
    ["1", "2"].includes(props().getProperty("SCHEMA_VERSION") || ""),
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
function migrate(c: Config) {
  if (
    !props().getProperty("LEDGER_ID") ||
    props().getProperty("SCHEMA_VERSION") === String(SCHEMA)
  )
    return;
  invariant(
    props().getProperty("SCHEMA_VERSION") === "1",
    "Unsupported ledger schema.",
  );
  for (const r of list()) {
    const upgraded = migration002(r, c);
    if (upgraded !== r) save(upgraded);
  }
  props().setProperty("SCHEMA_VERSION", String(SCHEMA));
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
    migrate(c);
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
    reminders: reminderSettings(c, records),
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
          save(migration002(r, c));
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
    return {
      ...r,
      message: managementMessage(c, r),
      calendarPreview: r.days.map((d) => ({ ...d, title: title(c, d) })),
    };
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
        "Only confirm after verifying receipt or a delivery trace. Resubmission requires manual review.",
      );
      r.email = "accepted";
      r.version++;
      r.updated = new Date().toISOString();
      save(r);
      return dashboard(c);
    }),
  );
}
function reminderSettings(c: Config, records: RecordEntry[]) {
  const raw = props().getProperty("REMINDER_HOUR");
  const hour = raw === null ? c.reminderHour : Number(raw);
  const installed = ScriptApp.getProjectTriggers().some(
    (t) => t.getHandlerFunction() === "sendCalmReminders",
  );
  return {
    enabled:
      installed &&
      props().getProperty("REMINDERS_ENABLED") !== "false" &&
      c.delivery === "google",
    hour,
    timeZone: c.timeZone,
    recipient: c.ownerEmail,
    pendingCount: records.filter(pendingCalm).length,
    lastSentDate: props().getProperty("LAST_REMINDER"),
    lastSentAt: props().getProperty("LAST_REMINDER_AT"),
    attemptDate: props().getProperty("REMINDER_ATTEMPT_DATE"),
    attemptState: props().getProperty("REMINDER_ATTEMPT_STATE"),
  };
}
function saveReminders(token: string, hour: number, enabled: boolean) {
  return safe(() =>
    guard(token, (c) => {
      invariant(
        Number.isInteger(hour) && hour >= 0 && hour <= 23,
        "Invalid reminder hour.",
      );
      invariant(typeof enabled === "boolean", "Invalid reminder setting.");
      if (enabled) invariant(c.delivery === "google", "Delivery is disabled.");
      const old = ScriptApp.getProjectTriggers().filter(
        (t) => t.getHandlerFunction() === "sendCalmReminders",
      );
      // Create first so a failed replacement leaves the previous schedule intact.
      if (enabled)
        ScriptApp.newTrigger("sendCalmReminders")
          .timeBased()
          .everyDays(1)
          .atHour(hour)
          .inTimezone(c.timeZone)
          .create();
      for (const trigger of old) ScriptApp.deleteTrigger(trigger);
      props().setProperties({
        REMINDER_HOUR: String(hour),
        REMINDERS_ENABLED: String(enabled),
      });
      return dashboard(c);
    }),
  );
}
function installReminders(token: string) {
  const c = actor();
  return saveReminders(token, reminderSettings(c, []).hour, true);
}
function stopReminders(token: string) {
  const c = actor();
  return saveReminders(token, reminderSettings(c, []).hour, false);
}
function testMail(token: string) {
  return safe(() =>
    guard(token, (c) => {
      const now = Date.now(),
        last = Number(props().getProperty("LAST_MAIL_TEST") || 0);
      invariant(
        now - last >= 60000,
        "Only one delivery test is allowed per minute.",
      );
      // Record the attempt before sending: an uncertain result must not auto-retry.
      props().setProperty("LAST_MAIL_TEST", String(now));
      const reference = Utilities.getUuid();
      try {
        MailApp.sendEmail({
          to: c.ownerEmail,
          subject: "Dayoff email delivery test",
          body:
            "This is a one-time Google Apps Script MailApp delivery test. No leave request or calendar event was created.\n\nReference: " +
            reference,
        });
      } catch {
        throw new Error(
          "Email test outcome is uncertain. Check your inbox before retrying.",
        );
      }
      return { accepted: true, reference };
    }),
  );
}
function sendDigest(c: Config) {
  invariant(c.delivery === "google", "Delivery is disabled.");
  const today = Utilities.formatDate(new Date(), c.timeZone, "yyyy-MM-dd"),
    pending = list().filter(pendingCalm);
  if (!pending.length)
    return {
      sent: false,
      notice: "No outstanding CALM entries or corrections.",
    };
  if (props().getProperty("LAST_REMINDER") === today)
    return {
      sent: false,
      notice: "A CALM reminder has already been sent today.",
    };
  invariant(
    props().getProperty("REMINDER_ATTEMPT_DATE") !== today,
    "Email reminder outcome is uncertain. Check your inbox before another attempt.",
  );
  const url = ScriptApp.getService().getUrl();
  invariant(url, "No web deployment is available.");
  const lines = pending.map(
    (r) =>
      (r.calm === "correction" ? "CORRECT CANCELLED LEAVE" : "ENTER LEAVE") +
      " — " +
      r.input.category +
      " — " +
      hoursText(r.days.reduce((n, d) => n + d.hours, 0)) +
      " hours\n" +
      r.days
        .map((d) => d.date + ": " + hoursText(d.hours) + " hours")
        .join("\n") +
      "\nReview and confirm: " +
      url +
      "?request=" +
      encodeURIComponent(r.id) +
      "&version=" +
      r.version,
  );
  props().setProperties({
    REMINDER_ATTEMPT_DATE: today,
    REMINDER_ATTEMPT_STATE: "sending",
  });
  try {
    MailApp.sendEmail({
      to: c.ownerEmail,
      subject:
        "CALM: " +
        pending.length +
        " outstanding " +
        (pending.length === 1 ? "request" : "requests"),
      body:
        "Update these records in CALM, then open each link and confirm in Dayoff. Opening a link does not mark anything entered.\n\n" +
        lines.join("\n\n"),
    });
  } catch {
    props().setProperty("REMINDER_ATTEMPT_STATE", "unknown");
    throw new Error(
      "Email reminder outcome is uncertain. Check your inbox before retrying.",
    );
  }
  props().setProperties({
    LAST_REMINDER: today,
    LAST_REMINDER_AT: new Date().toISOString(),
    REMINDER_ATTEMPT_STATE: "accepted",
  });
  return { sent: true, notice: "CALM reminder sent to your email address." };
}
function sendReminderNow(token: string) {
  return safe(() =>
    guard(token, (c) => {
      const result = sendDigest(c);
      return { ...dashboard(c), notice: result.notice };
    }),
  );
}
function sendCalmReminders() {
  return safe(() =>
    locked(() => {
      const c = actor();
      if (c.delivery !== "google") return;
      migrate(c);
      if (!reminderSettings(c, []).enabled) return;
      const today = Utilities.formatDate(new Date(), c.timeZone, "yyyy-MM-dd");
      if ([0, 6].includes(new Date(today + "T12:00:00Z").getUTCDay())) return;
      return sendDigest(c);
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
  saveReminders,
  sendReminderNow,
  stopReminders,
  testMail,
  sendCalmReminders,
  exportReport,
  health,
};
