import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activeDays,
  calmDays,
  report,
  type Config,
  type RecordEntry,
  type Input,
} from "../src/domain.js";
import {
  submit,
  sync,
  cancel,
  markCalm,
  removeDate,
  type Ports,
} from "../src/workflow.js";
const cfg = {
  ...JSON.parse(readFileSync("config/example.json", "utf8")),
  delivery: "google",
  hrSystemName: "CALM",
} as Config;
const input: Input = {
  id: "request-1234",
  category: "vacation",
  mode: "full",
  first: "2026-11-16",
  last: "2026-11-16",
};
function mock() {
  const records = new Map<string, RecordEntry>(),
    calls = { calendar: 0, mail: 0 };
  const p: Ports = {
    list: () => structuredClone([...records.values()]),
    save: (r) => {
      records.set(r.id, structuredClone(r));
    },
    now: () => "2026-11-13T12:00:00Z",
    calendar: () => {
      calls.calendar++;
    },
    mail: () => {
      calls.mail++;
    },
  };
  return { p, calls };
}
test("duplicate submission cannot send another management email", () => {
  const { p, calls } = mock();
  submit(cfg, p, input);
  submit(cfg, p, input);
  assert.deepEqual(calls, { calendar: 1, mail: 1 });
});
test("calendar failure preserves a pending record; retry sends mail only after calendar", () => {
  const { p, calls } = mock();
  p.calendar = () => {
    throw Error("offline");
  };
  assert.throws(() => submit(cfg, p, input), /offline/);
  assert.equal(calls.mail, 0);
  p.calendar = () => {
    calls.calendar++;
  };
  sync(cfg, p, p.list()[0]);
  assert.equal(calls.mail, 1);
  assert.equal(p.list()[0].calendar, "done");
});
test("uncertain email is not automatically resent", () => {
  const { p } = mock();
  let attempts = 0;
  p.mail = () => {
    attempts++;
    throw Error("timeout");
  };
  assert.throws(() => submit(cfg, p, input), /uncertain/);
  sync(cfg, p, p.list()[0]);
  assert.equal(attempts, 1);
  assert.equal(p.list()[0].email, "unknown");
});
test("preview performs no ledger, calendar or email mutations", () => {
  const { p, calls } = mock();
  submit({ ...cfg, delivery: "disabled" }, p, input);
  assert.deepEqual(calls, { calendar: 0, mail: 0 });
  assert.equal(p.list().length, 0);
});
test("CALM confirmation is version checked and stops outstanding state", () => {
  const { p } = mock();
  const r = submit(cfg, p, input);
  assert.throws(() => markCalm(p, r.id, 99), /changed/);
  const done = markCalm(p, r.id, 1);
  assert.equal(done.calm, "entered");
  assert.equal(done.version, 2);
  assert.throws(() => markCalm(p, r.id, 1), /No outstanding/);
});
test("cancellation after CALM entry requires a correction and calendar removal", () => {
  const { p, calls } = mock();
  submit(cfg, p, input);
  markCalm(p, input.id, 1);
  const r = cancel(cfg, p, input.id, 2);
  assert.equal(r.status, "cancelled");
  assert.equal(r.calm, "correction");
  assert.equal(calls.calendar, 2);
  assert.equal(calls.mail, 2);
});
test("overlapping requests are rejected before side effects", () => {
  const { p, calls } = mock();
  submit(cfg, p, input);
  assert.throws(
    () => submit(cfg, p, { ...input, id: "request-5678" }),
    /overlaps/,
  );
  assert.equal(calls.calendar, 1);
});

test("request email defaults to self and supports management or no email", () => {
  for (const route of [undefined, "management", "none"] as const) {
    const { p, calls } = mock();
    const recipients: string[][] = [];
    p.mail = (to) => {
      recipients.push([...to]);
      calls.mail++;
    };
    const r = submit(cfg, p, {
      ...input,
      ...(route ? { emailTo: route } : {}),
    });
    assert.equal(calls.calendar, 1);
    assert.deepEqual(
      recipients,
      route === "none"
        ? []
        : [route === "management" ? cfg.managementEmails : [cfg.ownerEmail]],
    );
    assert.equal(r.calm, "pending");
    assert.equal(r.email, route === "none" ? "skipped" : "accepted");
  }
});
test("email recipients are retained across retries and cancellations; none stays silent", () => {
  const { p } = mock();
  const destinations: string[][] = [];
  p.mail = (to) => {
    destinations.push([...to]);
  };
  const r = submit(cfg, p, { ...input, emailTo: "management" });
  cancel(
    { ...cfg, managementEmails: ["changed@example.edu"] },
    p,
    r.id,
    r.version,
  );
  assert.deepEqual(destinations, [cfg.managementEmails, cfg.managementEmails]);
  const silent = mock();
  submit(cfg, silent.p, { ...input, emailTo: "none" });
  cancel(cfg, silent.p, input.id, 1);
  assert.equal(silent.calls.mail, 0);
});
test("invalid email choices cannot write or send", () => {
  const { p, calls } = mock();
  assert.throws(
    () => submit(cfg, p, { ...input, emailTo: "arbitrary" as "self" }),
    /email/i,
  );
  assert.deepEqual(calls, { calendar: 0, mail: 0 });
  assert.equal(p.list().length, 0);
});

test("grouped requests send once and individual removal preserves other dates and charges", () => {
  const { p, calls } = mock();
  let r = submit(cfg, p, {
    ...input,
    emailTo: "none",
    ranges: [
      { mode: "full", first: "2026-11-16", last: "2026-11-18" },
      { mode: "full", first: "2026-11-20", last: "2026-11-20" },
    ],
  });
  assert.equal(calls.calendar, 1);
  assert.equal(calls.mail, 0);
  assert.equal(report(cfg, [r], "2026-11-30").used.vacation, 2900);
  r = removeDate(cfg, p, r.id, r.version, "2026-11-17");
  assert.deepEqual(
    activeDays(r).map((d) => d.date),
    ["2026-11-16", "2026-11-18", "2026-11-20"],
  );
  assert.equal(report(cfg, [r], "2026-11-30").used.vacation, 2175);
  assert.equal(r.status, "active");
  assert.equal(r.calm, "pending");
  assert.equal(r.days.length, 4);
  assert.throws(() => removeDate(cfg, p, r.id, 1, "2026-11-18"), /changed/);
  const before = calls.calendar;
  removeDate(cfg, p, r.id, r.version, "2026-11-17");
  assert.equal(calls.calendar, before);
});
test("removing entered dates keeps a precise CALM correction through further removals and cancellation", () => {
  const { p } = mock();
  let r = submit(cfg, p, { ...input, last: "2026-11-18" });
  r = sync(cfg, p, markCalm(p, r.id, 1));
  r = removeDate(cfg, p, r.id, r.version, "2026-11-16");
  assert.equal(r.calm, "correction");
  assert.deepEqual(
    calmDays(r).map((d) => d.date),
    ["2026-11-16"],
  );
  r = removeDate(cfg, p, r.id, r.version, "2026-11-17");
  assert.deepEqual(
    calmDays(r).map((d) => d.date),
    ["2026-11-16", "2026-11-17"],
  );
  r = cancel(cfg, p, r.id, r.version);
  assert.equal(r.status, "cancelled");
  assert.equal(r.calm, "correction");
  assert.equal(calmDays(r).length, 3);
  r = markCalm(p, r.id, r.version);
  assert.equal(r.calm, "entered");
  assert.deepEqual(r.calmCorrectionDates, []);
});
test("removing a date sends one update via the stored route, and unconfirmed removals do not become CALM corrections", () => {
  const { p, calls } = mock(),
    mail: { subject: string; body: string; to: string[] }[] = [];
  p.mail = (to, subject, body) => {
    calls.mail++;
    mail.push({ to, subject, body });
  };
  let r = submit(cfg, p, {
    ...input,
    emailTo: "management",
    last: "2026-11-18",
  });
  r = removeDate(
    { ...cfg, managementEmails: ["changed@example.edu"] },
    p,
    r.id,
    1,
    "2026-11-17",
  );
  assert.equal(calls.mail, 2);
  assert.match(mail[1].subject, /Updated/);
  assert.deepEqual(mail[1].to, cfg.managementEmails);
  assert.match(mail[1].body, /2026-11-17/);
  assert.equal(r.calm, "pending");
  assert.deepEqual(r.calmCorrectionDates, []);
});
