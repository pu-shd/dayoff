import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type Config, type RecordEntry, type Input } from "../src/domain.js";
import { submit, sync, cancel, markCalm, type Ports } from "../src/workflow.js";
const cfg = {
  ...JSON.parse(readFileSync("config/example.json", "utf8")),
  delivery: "google",
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
