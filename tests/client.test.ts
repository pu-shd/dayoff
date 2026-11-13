import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
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
function harness(records: RecordEntry[] = [], focus = { id: "", version: "" }) {
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
  const state = {
    initialized: true,
    nonce: "test-nonce",
    config: cfg,
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
    return structuredClone(state);
  }
  function response(name: string, args: unknown[]) {
    calls.push({ name, args });
    if (name === "preview") {
      const r = record(args[0] as Input);
      return {
        ...r,
        message: managementMessage(cfg, r),
        calendarPreview: r.days.map((d) => ({ ...d, title: title(cfg, d) })),
      };
    }
    if (name === "createRequest") {
      state.records.push(record(args[1] as Input));
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
  return { document, window, get, calls, tick, preview, choice };
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
  assert.equal((h.get("email-choice") as HTMLSelectElement).value, "self");
  assert.match(h.get("message").textContent!, /No request email/);
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
