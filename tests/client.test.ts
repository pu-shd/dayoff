import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { removeDate } from "../src/workflow.js";
import { historyFixture } from "./history-fixture.js";
import { historyIndex } from "../src/history.js";
import type { HistoryArchive } from "../src/history.js";
import { parseHTML } from "linkedom";
import {
  createDays,
  managementMessage,
  title,
  report,
  pendingCalm,
  type Config,
  type Input,
  type RecordEntry,
} from "../src/domain.js";
const cfg = {
  ...JSON.parse(readFileSync("config/example.json", "utf8")),
  delivery: "google",
  hrSystemName: "CALM",
} as Config;
const html = readFileSync("src/Index.html", "utf8");
function record(input: Input): RecordEntry {
  return {
    id: input.id,
    input,
    version: 1,
    days: createDays(cfg, input),
    status: "active",
    calm: "pending",
    calendar: "done",
    email: input.emailTo === "none" ? "skipped" : "accepted",
    created: "now",
    updated: "now",
  };
}
function harness(
  records: RecordEntry[] = [],
  focus = { id: "", version: "" },
  archive?: HistoryArchive,
  config: Config = cfg,
) {
  const { document, window } = parseHTML(html);
  // linkedom omits native select.value setter/default selection; emulate browser behavior.
  Object.defineProperty(window.HTMLSelectElement.prototype, "value", {
    configurable: true,
    get() {
      return (
        [...this.querySelectorAll("option")]
          .find((x) => x.hasAttribute("selected"))
          ?.getAttribute("value") ??
        this.querySelector("option")?.getAttribute("value") ??
        ""
      );
    },
    set(value: string) {
      for (const o of this.querySelectorAll("option"))
        o.toggleAttribute(
          "selected",
          o.getAttribute("value") === String(value),
        );
    },
  });
  const calls: { name: string; args: unknown[] }[] = [];
  let staffResponse:
    | ((ranges: { first: string; last: string }[]) => unknown)
    | undefined;
  const failures = new Map<string, { message: string; persist: boolean }>();
  const state = {
    fiscalPeriod: { start: "2026-07-01", end: "2027-06-30" },
    initialized: true,
    history: {
      anchorFiscalYear: 2027,
      configuredCount: archive?.years.length ?? 0,
      pendingImportCount: archive?.years.length ?? 0,
      years: [] as ReturnType<typeof historyIndex>,
    },
    nonce: "test-nonce",
    config,
    records,
    totals: report(cfg, records, "2026-11-13"),
    today: "2026-11-13",
    ledgerUrl: "https://docs.google.com/spreadsheets/d/example/edit",
    remindersInstalled: false,
    reminders: {
      enabled: false,
      hour: 9,
      timeZone: cfg.timeZone,
      recipient: cfg.ownerEmail,
      pendingCount: records.filter(pendingCalm).length,
      lastSentDate: null as string | null,
      lastSentAt: null,
      attemptDate: null as string | null,
      attemptState: null as string | null,
    },
  };
  function refresh() {
    state.reminders.pendingCount = state.records.filter(pendingCalm).length;
    state.totals = report(state.config, state.records, state.today);
    return structuredClone(state);
  }
  function response(name: string, args: unknown[]) {
    calls.push({ name, args });
    const failure = failures.get(name);
    failures.delete(name);
    if (failure && !failure.persist) throw new Error(failure.message);
    if (name === "getStaffCalendar") {
      if (staffResponse)
        return staffResponse(args[0] as { first: string; last: string }[]);
      return {
        days: [],
        truncated: false,
        checkedAt: "2026-11-13T17:00:00Z",
        cached: false,
      };
    }
    if (name === "importHistory") {
      state.history.years = historyIndex(archive!.years);
      state.history.pendingImportCount = 0;
      return refresh();
    }
    if (name === "getHistoryYear")
      return structuredClone(
        archive!.years.find((y) => y.fiscalYear === args[0]),
      );
    if (name === "preview") {
      const r = record(args[0] as Input);
      return {
        ...r,
        message: managementMessage(state.config, r),
        calendarPreview: r.days.map((d) => ({
          ...d,
          title: title(state.config, d),
        })),
      };
    }
    if (name === "removeRequestDate") {
      removeDate(
        state.config,
        {
          list: () => structuredClone(state.records),
          save: (r) => {
            state.records = state.records.map((old) =>
              old.id === r.id ? r : old,
            );
          },
          now: () => "example",
          calendar: () => {},
          mail: () => {},
        },
        args[1] as string,
        args[2] as number,
        args[3] as string,
      );
      return refresh();
    }
    if (name === "createRequest") {
      state.records.push(record(args[1] as Input));
      if (failure) throw new Error(failure.message);
      return refresh();
    }
    if (name === "saveReminders") {
      state.reminders.enabled = args[2] as boolean;
      state.reminders.hour = args[1] as number;
      return refresh();
    }
    if (name === "sendReminderNow") {
      state.reminders.lastSentDate = state.today;
      state.reminders.attemptDate = state.today;
      state.reminders.attemptState = "accepted";
      return { ...refresh(), notice: "CALM reminder sent." };
    }
    if (name === "confirmCalm") {
      const r = state.records.find((r) => r.id === args[1])!;
      r.calm = "entered";
      r.version++;
      return refresh();
    }
    return refresh();
  }
  const run = {
    withSuccessHandler(success: (v: unknown) => void) {
      return {
        withFailureHandler(failure: (e: unknown) => void) {
          return new Proxy(
            {},
            {
              get:
                (_target, key) =>
                (...args: unknown[]) => {
                  Promise.resolve()
                    .then(() => response(String(key), args))
                    .then(success, failure);
                },
            },
          );
        },
      };
    },
  };
  class Form extends Map<string, string> {
    constructor(form: HTMLElement) {
      super(
        [
          ...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
            "[name]",
          ),
        ].map((n) => [n.getAttribute("name")!, n.value]),
      );
    }
  }
  const script = html
    .match(/<script>([\s\S]*?)<\/script>/)![1]
    .replace("<?!= focus ?>", JSON.stringify(focus));
  runInNewContext(script, {
    document,
    google: { script: { run } },
    Intl,
    Date,
    crypto: { randomUUID },
    FormData: Form,
    confirm: () => true,
    URL,
    Blob,
    setTimeout,
    clearTimeout,
  });
  const get = (id: string) => document.getElementById(id)!;
  async function tick() {
    for (let i = 0; i < 4; i++)
      await new Promise<void>((resolve) => setImmediate(resolve));
  }
  async function preview() {
    (document.querySelector("[name=first]") as HTMLInputElement).value =
      "2026-11-16";
    (document.querySelector("[name=last]") as HTMLInputElement).value =
      "2026-11-16";
    get("request-form").dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await tick();
  }
  async function choice(value: string) {
    (get("email-choice") as HTMLSelectElement).value = value;
    get("email-choice").dispatchEvent(new window.Event("change"));
    await tick();
  }
  return {
    document,
    window,
    get,
    calls,
    tick,
    preview,
    choice,
    staffResponse: (
      fn: (ranges: { first: string; last: string }[]) => unknown,
    ) => {
      staffResponse = fn;
    },
    failNext: (name: string, message: string, persist = false) =>
      failures.set(name, { message, persist }),
  };
}
test("preview presents dates, fixed hours and an accurate self-addressed draft without submitting", async () => {
  const h = harness();
  await h.tick();
  await h.preview();
  assert.equal(h.get("preview-hours").textContent, "7.25");
  assert.match(h.get("preview-date").textContent!, /Monday, November 16, 2026/);
  assert.equal(h.get("preview-to").textContent, cfg.ownerEmail);
  assert.match(h.get("send").textContent!, /email me/);
  assert.doesNotMatch(h.get("preview-body").textContent!, /Request:/);
  assert.equal(h.calls.filter((x) => x.name === "createRequest").length, 0);
});
test("email choice refreshes the draft and none saves the request into the CALM queue", async () => {
  const h = harness();
  await h.tick();
  await h.preview();
  await h.choice("management");
  assert.equal(
    h.get("preview-to").textContent,
    cfg.managementEmails.join(", "),
  );
  await h.choice("none");
  assert.equal(h.get("email-draft").classList.contains("hide"), true);
  h.get("send").click();
  await h.tick();
  const call = h.calls.find((x) => x.name === "createRequest")!;
  assert.equal((call.args[1] as Input).emailTo, "none");
  assert.equal(h.get("calm-count").textContent, "1 outstanding");
  assert.equal((h.get("email-choice") as HTMLSelectElement).value, "none");
  assert.match(h.get("request-save-status").textContent!, /No request email/);
  await h.preview();
  assert.equal((h.get("email-choice") as HTMLSelectElement).value, "self");
});
test("reminder controls set the schedule, send once and confirm entry from the checklist", async () => {
  const r = record({
    id: "request-1234",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
    emailTo: "none",
  });
  const h = harness([r]);
  await h.tick();
  (h.get("reminder-hour") as HTMLSelectElement).value = "10";
  h.get("install").click();
  await h.tick();
  assert.deepEqual(
    h.calls.find((c) => c.name === "saveReminders")?.args.slice(1),
    [10, true],
  );
  h.get("send-now").click();
  await h.tick();
  assert.equal((h.get("send-now") as HTMLButtonElement).disabled, true);
  (h.get("calm-queue").querySelector("button") as HTMLButtonElement).click();
  await h.tick();
  assert.equal(h.get("calm-count").textContent, "0 outstanding");
  assert.equal(h.get("calm-empty").classList.contains("hide"), false);
});
test("opening an older reminder highlights review without confirming anything", async () => {
  const r = record({
    id: "request-1234",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
  });
  r.version = 2;
  const h = harness([r], { id: r.id, version: "1" });
  await h.tick();
  assert.match(h.get("focus-notice").textContent!, /earlier revision/);
  assert.equal(h.calls.filter((c) => c.name === "confirmCalm").length, 0);
});

test("private history imports explicitly, displays source figures and treats raw marks as text", async () => {
  const h = harness([], undefined, historyFixture());
  await h.tick();
  assert.equal(h.get("history-section").classList.contains("hide"), false);
  assert.equal(h.get("history-browser").classList.contains("hide"), true);
  assert.equal(h.calls.filter((c) => c.name === "importHistory").length, 0);
  h.get("import-history").click();
  await h.tick();
  assert.equal(h.get("history-count").textContent, "1 fiscal years");
  assert.equal(h.get("history-months").children.length, 12);
  assert.match(h.get("history-daily").textContent!, /<b>V<\/b>/);
  assert.equal(h.get("history-daily").querySelector("b"), null);
  assert.match(h.get("history-summary").textContent!, /-1.00 h/);
  assert.equal(h.get("import-history").classList.contains("hide"), true);
  assert.equal(
    h.calls.some((c) =>
      ["createRequest", "confirmCalm", "testMail"].includes(c.name),
    ),
    false,
  );
});

test("history months link to the configured calendar, timezone and exact month in a new tab", async () => {
  const config = {
    ...cfg,
    calendarId: "staff+archive#team@group.calendar.google.com",
    timeZone: "Pacific/Auckland",
  };
  const h = harness([], undefined, historyFixture(), config);
  await h.tick();
  h.get("import-history").click();
  await h.tick();
  const links = [...h.get("history-months").querySelectorAll("a")];
  assert.equal(links.length, 12);
  for (const [index, link] of links.entries()) {
    const month = historyFixture().years[0].months[index].month;
    const start = month.replace("-", "") + "01";
    const next = new Date(month + "-01T00:00:00Z");
    next.setUTCMonth(next.getUTCMonth() + 1);
    const end = next.toISOString().slice(0, 10).replaceAll("-", "");
    const url = new URL(link.getAttribute("href")!);
    assert.equal(url.origin, "https://calendar.google.com");
    assert.equal(url.pathname, "/calendar/embed");
    assert.equal(url.searchParams.get("src"), config.calendarId);
    assert.equal(url.searchParams.get("ctz"), config.timeZone);
    assert.equal(url.searchParams.get("mode"), "MONTH");
    assert.equal(url.searchParams.get("dates"), start + "/" + end);
    assert.equal(link.textContent, month);
    assert.equal(link.getAttribute("target"), "_blank");
    assert.match(link.getAttribute("rel")!, /noopener/);
    assert.match(link.getAttribute("aria-label")!, /configured calendar/);
  }
  assert.equal(h.calls.filter((c) => c.name === "createRequest").length, 0);
});

test("leave categories stay identifiable across balances, source columns, preview, records and CALM", async () => {
  const categories = ["vacation", "sick", "personal"] as const;
  const records = categories.map((category, index) =>
    record({
      id: "category-" + category,
      category,
      mode: "full",
      first: "2026-11-" + (16 + index),
      last: "2026-11-" + (16 + index),
    }),
  );
  const h = harness(records, undefined, historyFixture());
  await h.tick();
  h.get("import-history").click();
  await h.tick();
  assert.deepEqual(
    [...h.get("cards").children].map((n) => n.getAttribute("data-category")),
    categories,
  );
  assert.deepEqual(
    [...h.get("history-summary").children].map((n) =>
      n.getAttribute("data-category"),
    ),
    categories,
  );
  const expected = [null, ...categories, ...categories];
  assert.deepEqual(
    [
      ...h.get("history-months").parentElement!.querySelectorAll("thead th"),
    ].map((n) => n.getAttribute("data-category")),
    expected,
  );
  for (const row of h.get("history-months").children)
    assert.deepEqual(
      [...row.children].map((n) => n.getAttribute("data-category")),
      expected,
    );
  for (const category of categories) {
    assert.equal(
      h.get("calm-category-" + category).getAttribute("data-category"),
      category,
    );
    assert.equal(
      h.get("records").querySelector(`[data-category="${category}"]`)?.tagName,
      "TR",
    );
    (h.document.querySelector("[name=category]") as HTMLSelectElement).value =
      category;
    await h.preview();
    assert.equal(h.get("preview").getAttribute("data-category"), category);
  }
});

test("last date defaults to the first date and follows it until an explicit end date is entered", async () => {
  const h = harness();
  await h.tick();
  const first = h.document.querySelector("[name=first]") as HTMLInputElement;
  const last = h.document.querySelector("[name=last]") as HTMLInputElement;
  first.value = "2026-11-16";
  first.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(last.value, "2026-11-16");
  first.value = "2026-11-17";
  first.dispatchEvent(new h.window.Event("change", { bubbles: true }));
  assert.equal(last.value, "2026-11-17");
  last.value = "2026-11-20";
  last.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  first.value = "2026-11-18";
  first.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(last.value, "2026-11-20");
  last.value = "";
  last.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(last.hasAttribute("required"), false);
  h.get("request-form").dispatchEvent(
    new h.window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await h.tick();
  const input = h.calls.find((c) => c.name === "preview")!.args[0] as Input;
  assert.equal(input.last, input.first);
  assert.equal(last.value, first.value);
  assert.equal(h.get("preview-hours").textContent, "7.25");
});

test("readiness is consolidated into Live and preview creates no routine header banner", async () => {
  const h = harness();
  await h.tick();
  assert.equal(h.get("mode").textContent, "Live · Ready");
  assert.equal(h.get("message").classList.contains("hide"), true);
  await h.preview();
  assert.equal(h.get("message").classList.contains("hide"), true);
  assert.doesNotMatch(
    h.get("message").textContent!,
    /Review the dates|defaults to you/,
  );
});
test("date rows can be added and removed with independent defaults and one grouped submission", async () => {
  const h = harness();
  await h.tick();
  const first = h.document.querySelector("[name=first]") as HTMLInputElement;
  first.value = "2026-11-16";
  first.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  (h.document.querySelector("[name=last]") as HTMLInputElement).value =
    "2026-11-18";
  h.get("add-dates").click();
  let rows = [...h.get("date-rows").querySelectorAll<HTMLElement>(".date-row")];
  assert.equal(rows.length, 2);
  const secondFirst = rows[1].querySelector("[name=first]") as HTMLInputElement;
  secondFirst.value = "2026-11-20";
  secondFirst.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(
    (rows[1].querySelector("[name=last]") as HTMLInputElement).value,
    "2026-11-20",
  );
  h.get("request-form").dispatchEvent(
    new h.window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await h.tick();
  assert.equal(h.get("preview-hours").textContent, "29.00");
  assert.equal(h.get("preview-days").children.length, 4);
  assert.doesNotMatch(h.get("preview-body").textContent!, /11\/19/);
  const input = h.calls.find((c) => c.name === "preview")!.args[0] as Input;
  assert.equal(input.ranges?.length, 2);
  h.get("send").click();
  await h.tick();
  assert.equal(h.calls.filter((c) => c.name === "createRequest").length, 1);
  assert.equal(h.get("records").children.length, 1);
  assert.equal(h.get("records").querySelectorAll("[data-date]").length, 4);
  assert.equal(
    h.get("records").querySelector("details")!.hasAttribute("open"),
    false,
  );
  assert.equal(h.get("calm-count").textContent, "1 outstanding");
  h.get("add-dates").click();
  rows = [...h.get("date-rows").querySelectorAll<HTMLElement>(".date-row")];
  (rows[2].querySelector(".remove-dates") as HTMLButtonElement).click();
  assert.equal(h.get("date-rows").querySelectorAll(".date-row").length, 2);
  (rows[0].querySelector(".remove-dates") as HTMLButtonElement).click();
  assert.equal(h.get("date-rows").querySelectorAll(".date-row").length, 1);
  assert.equal(h.get("preview").classList.contains("hide"), true);
});
test("individual date removal preserves remaining entries and shows only the CALM correction dates", async () => {
  const r = record({
    id: "request-grouped",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-18",
    emailTo: "none",
  });
  r.calm = "entered";
  const h = harness([r]);
  await h.tick();
  const details = h.get("records").querySelector("details")!;
  details.setAttribute("open", "");
  const row = h.get("records").querySelector('[data-date="2026-11-17"]')!;
  const remove = [...row.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "Remove date",
  )!;
  remove.click();
  await h.tick();
  const call = h.calls.find((c) => c.name === "removeRequestDate")!;
  assert.deepEqual(call.args.slice(1), [r.id, 1, "2026-11-17"]);
  assert.equal(h.get("records").children.length, 1);
  assert.equal(h.get("records").querySelectorAll("[data-date]").length, 3);
  assert.equal(
    h.get("records").querySelector("details")!.hasAttribute("open"),
    true,
  );
  assert.match(h.get("calm-queue").textContent!, /2026-11-17/);
  assert.doesNotMatch(
    h.get("calm-queue").textContent!,
    /2026-11-16|2026-11-18/,
  );
});

test("Day Off uses the requested header and keeps balance details and history collapsed initially", async () => {
  const h = harness([], undefined, historyFixture());
  await h.tick();
  assert.equal(h.document.querySelector("h1")?.textContent, "Day Off");
  assert.equal(
    h.get("tagline").textContent,
    "A individual ledger for tracking time.",
  );
  assert.doesNotMatch(
    h.document.querySelector("header")!.textContent!,
    /A little less administration/i,
  );
  const details = [...h.get("cards").querySelectorAll("details")];
  assert.equal(details.length, 3);
  assert.equal(
    details.some((n) => n.hasAttribute("open")),
    false,
  );
  assert.equal(h.get("history-section").tagName, "DETAILS");
  assert.equal(h.get("history-section").hasAttribute("open"), false);
  assert.match(
    h.get("history-section").querySelector("summary")!.textContent!,
    /Attendance history/,
  );
  assert.doesNotMatch(
    h.get("history-section").textContent!,
    /Your workbook archive/i,
  );
});

test("legacy month disclosures label calculated posting dates without inventing daily charges", async () => {
  const r = record({
    id: "legacy-example",
    category: "vacation",
    mode: "full",
    first: "2026-11-30",
    last: "2026-11-30",
  });
  r.legacy = true;
  r.calm = "historical";
  const h = harness([r]);
  await h.tick();
  const disclosure = h.get("records").querySelector("details")!;
  assert.ok(disclosure);
  assert.equal(disclosure.hasAttribute("open"), false);
  assert.match(disclosure.textContent!, /2026-11-30/);
  assert.match(
    disclosure.textContent!,
    /Exact daily charges cannot be inferred/,
  );
  assert.equal(disclosure.querySelector("button"), null);
});

test("save confirmation stays beside the disabled Save button with no duplicate header notice", async () => {
  const h = harness();
  await h.tick();
  await h.preview();
  h.get("send").click();
  await h.tick();
  const notice = h.get("request-save-status");
  assert.ok(notice);
  assert.equal(
    notice.closest(".preview-footer"),
    h.get("send").closest(".preview-footer"),
  );
  assert.match(notice.textContent!, /Request saved and Calendar updated/);
  assert.equal(notice.getAttribute("role"), "status");
  assert.equal(notice.classList.contains("hide"), false);
  assert.equal(h.get("preview").classList.contains("hide"), false);
  assert.equal(h.get("preview-status").textContent, "Saved");
  assert.equal((h.get("send") as HTMLButtonElement).disabled, true);
  assert.equal((h.get("email-choice") as HTMLSelectElement).disabled, true);
  assert.equal(h.get("message").classList.contains("hide"), true);
  assert.equal(h.get("message").textContent, "");
  h.get("send").click();
  await h.tick();
  assert.equal(h.calls.filter((c) => c.name === "createRequest").length, 1);
  await h.preview();
  assert.equal(notice.classList.contains("hide"), true);
  assert.equal(h.get("preview-status").textContent, "Not submitted");
  assert.equal((h.get("email-choice") as HTMLSelectElement).disabled, false);
});

test("reminder and CALM action results appear by their controls even after the queue rerenders", async () => {
  const r = record({
    id: "request-local-feedback",
    category: "vacation",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-16",
    emailTo: "none",
  });
  const h = harness([r]);
  await h.tick();
  h.get("install").click();
  await h.tick();
  const reminderNotice = h
    .get("install")
    .closest(".actions")!.nextElementSibling!;
  assert.equal(reminderNotice.getAttribute("data-action-feedback"), "");
  assert.equal(reminderNotice.textContent, "Saved.");
  assert.equal(h.get("message").classList.contains("hide"), true);
  (h.get("calm-queue").querySelector("button") as HTMLButtonElement).click();
  await h.tick();
  const calmNotice = h
    .get("calm-queue")
    .querySelector("[data-action-feedback]")!;
  assert.ok(calmNotice);
  assert.equal(calmNotice.textContent, "Saved.");
  assert.equal(calmNotice.getAttribute("role"), "status");
  assert.equal(h.get("message").classList.contains("hide"), true);
});

test("date removal confirmation stays in the affected date row after rerendering", async () => {
  const r = record({
    id: "request-row-feedback",
    category: "sick",
    mode: "full",
    first: "2026-11-16",
    last: "2026-11-18",
    emailTo: "none",
  });
  const h = harness([r]);
  await h.tick();
  h.get("records").querySelector("details")!.setAttribute("open", "");
  (
    h
      .get("records")
      .querySelector('[data-date="2026-11-17"] button') as HTMLButtonElement
  ).click();
  await h.tick();
  const row = h.get("records").querySelector('[data-date="2026-11-17"]')!;
  assert.equal(
    row.querySelector("[data-action-feedback]")?.textContent,
    "Saved.",
  );
  assert.equal(h.get("message").classList.contains("hide"), true);
});

test("action errors remain beside the originating controls after recovery refresh", async () => {
  const h = harness();
  await h.tick();
  h.failNext("saveReminders", "Email reminder setup could not complete.");
  h.get("install").click();
  await h.tick();
  const notice = h.get("install").closest(".actions")!.nextElementSibling!;
  assert.match(notice.textContent!, /could not complete/);
  assert.equal(notice.classList.contains("error"), true);
  assert.equal(h.get("message").classList.contains("hide"), true);
  assert.equal(h.get("mode").textContent, "Live · Needs attention");
});
test("a recorded request with unfinished work keeps its local error visible and prevents another submission", async () => {
  const h = harness();
  await h.tick();
  await h.preview();
  h.failNext(
    "createRequest",
    "Calendar update failed. Retry incomplete steps.",
    true,
  );
  h.get("send").click();
  await h.tick();
  assert.equal(h.get("preview").classList.contains("hide"), false);
  assert.equal(h.get("preview-status").textContent, "Action needed");
  assert.equal((h.get("send") as HTMLButtonElement).disabled, true);
  const notice = h.get("request-save-status");
  assert.equal(notice.classList.contains("hide"), false);
  assert.equal(notice.classList.contains("error"), true);
  assert.match(notice.textContent!, /Calendar update failed/);
  assert.doesNotMatch(notice.textContent!, /Calendar updated/);
  assert.equal(h.get("message").classList.contains("hide"), true);
});

test("holiday-only date rows are flagged before preview and the configured dates are visible", async () => {
  const config = { ...cfg, holidays: ["2026-11-26", "2026-11-27"] };
  const h = harness([], undefined, undefined, config);
  await h.tick();
  assert.match(h.get("holiday-summary").textContent!, /2 configured holidays/);
  const first = h.document.querySelector("[name=first]") as HTMLInputElement;
  first.value = "2026-11-26";
  first.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.match(
    h.document.querySelector(".date-warning")!.textContent!,
    /No working days/,
  );
  assert.equal((h.get("preview-request") as HTMLButtonElement).disabled, true);
  const last = h.document.querySelector("[name=last]") as HTMLInputElement;
  last.value = "2026-11-30";
  last.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal((h.get("preview-request") as HTMLButtonElement).disabled, false);
  assert.match(
    h.document.querySelector(".date-warning")!.textContent!,
    /2 holidays/,
  );
  assert.match(h.get("holiday-dates").textContent!, /2026-11-26/);
});
test("an empty holiday list is stated explicitly and saved holiday charges are flagged for review", async () => {
  const h = harness();
  await h.tick();
  assert.match(
    h.get("holiday-summary").textContent!,
    /No holidays are configured/,
  );
  const r = record({
    id: "request-holiday",
    category: "vacation",
    mode: "full",
    first: "2026-11-26",
    last: "2026-11-26",
  });
  const config = { ...cfg, holidays: ["2026-11-26"] };
  const loaded = harness([r], undefined, undefined, config);
  await loaded.tick();
  assert.match(loaded.get("records").textContent!, /saved holiday date/);
  assert.match(loaded.get("records").textContent!, /7.25/);
});

test("Staff Calendar lookup is debounced, read-only and does not hold up preview", async () => {
  const h = harness();
  await h.tick();
  h.staffResponse((ranges) => ({
    days: [
      {
        date: ranges[0].first,
        events: [{ summary: "<b>Alex Off</b>", when: "All day" }],
      },
    ],
    truncated: false,
    checkedAt: "2026-11-13T17:00:00Z",
  }));
  const first = h.document.querySelector("[name=first]") as HTMLInputElement;
  first.value = "2026-11-16";
  first.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  await h.preview();
  assert.equal(h.get("preview-hours").textContent, "7.25");
  assert.equal(h.calls.filter((c) => c.name === "getStaffCalendar").length, 0);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await h.tick();
  assert.equal(h.calls.filter((c) => c.name === "getStaffCalendar").length, 1);
  assert.match(h.get("staff-results").textContent!, /<b>Alex Off<\/b>/);
  assert.equal(h.get("staff-results").querySelector("b"), null);
  h.get("staff-refresh").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await h.tick();
  assert.equal(
    h.calls.filter((c) => c.name === "getStaffCalendar").at(-1)!.args[1],
    true,
  );
});
test("late Calendar responses cannot replace the context for newly selected dates", async () => {
  const h = harness();
  await h.tick();
  h.staffResponse((ranges) => {
    const value = {
      days: [
        {
          date: ranges[0].first,
          events: [
            {
              summary:
                ranges[0].first === "2026-11-16"
                  ? "Old context"
                  : "Current context",
              when: "All day",
            },
          ],
        },
      ],
      truncated: false,
      checkedAt: "2026-11-13T17:00:00Z",
    };
    return ranges[0].first === "2026-11-16"
      ? new Promise((resolve) => setTimeout(() => resolve(value), 800))
      : value;
  });
  const first = h.document.querySelector("[name=first]") as HTMLInputElement;
  first.value = "2026-11-16";
  first.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 550));
  first.value = "2026-11-20";
  first.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 850));
  await h.tick();
  assert.match(h.get("staff-results").textContent!, /Current context/);
  assert.doesNotMatch(h.get("staff-results").textContent!, /Old context/);
});

test("the HR system name is configurable throughout the visible interface and preview", async () => {
  const config = { ...cfg, hrSystemName: "Example HR Ledger" };
  const h = harness([], undefined, undefined, config);
  await h.tick();
  await h.preview();
  assert.match(
    h.get("calm-section").querySelector("h2")!.textContent!,
    /Example HR Ledger/,
  );
  assert.match(
    h.document.querySelector("footer")!.textContent!,
    /Example HR Ledger/,
  );
  assert.match(h.get("preview-body").textContent!, /Example HR Ledger/);
  assert.doesNotMatch(h.document.body.textContent!, /CALM/);
});
