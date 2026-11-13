import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createDays,
  fiscalBounds,
  validateConfig,
  report,
  title,
  managementMessage,
  pendingCalm,
  csvCell,
  type Config,
  type RecordEntry,
} from "../src/domain.js";
const cfg = JSON.parse(readFileSync("config/example.json", "utf8")) as Config;
function record(first = "2026-11-16"): RecordEntry {
  const input = {
    id: "request-1234",
    category: "vacation" as const,
    mode: "full" as const,
    first,
    last: first,
  };
  return {
    id: input.id,
    version: 1,
    input,
    days: createDays(cfg, input),
    status: "active",
    calm: "pending",
    calendar: "pending",
    email: "pending",
    created: "now",
    updated: "now",
  };
}
test("full day, half day and late arrival use the stated policy", () => {
  assert.equal(createDays(cfg, record().input)[0].hours, 725);
  const input = {
    ...record().input,
    mode: "half" as const,
    start: "08:45",
    end: "12:00",
  };
  assert.equal(createDays(cfg, input)[0].hours, 363);
  assert.equal(
    createDays(cfg, { ...input, mode: "partial", end: "11:00" })[0].hours,
    225,
  );
});
test("partial absence deducts only lunch overlap", () => {
  const input = {
    ...record().input,
    mode: "partial" as const,
    start: "11:45",
    end: "13:00",
  };
  assert.equal(createDays(cfg, input)[0].hours, 50);
  assert.throws(
    () => createDays(cfg, { ...input, start: "12:00", end: "12:45" }),
    /no working time/,
  );
});
test("effective dated schedules, weekends and holidays apply per day", () => {
  assert.equal(
    createDays(cfg, {
      ...record().input,
      first: "2026-07-03",
      last: "2026-07-06",
    }).length,
    2,
  );
  const c = { ...cfg, holidays: ["2026-07-03"] };
  assert.equal(
    createDays(c, {
      ...record().input,
      first: "2026-07-03",
      last: "2026-07-06",
    })[0].date,
    "2026-07-06",
  );
  assert.equal(
    createDays(cfg, {
      ...record().input,
      first: "2026-07-06",
      last: "2026-07-06",
    })[0].start,
    "08:30",
  );
  assert.equal(
    title(cfg, {
      ...record().days[0],
      allDay: false,
      start: "08:45",
      end: "11:00",
    }),
    "Your first name Arrives Late",
  );
});
test("invalid dates, fiscal boundaries, categories and configuration fail explicitly", () => {
  assert.throws(
    () => createDays(cfg, { ...record().input, first: "2026-02-30" }),
    /Invalid date/,
  );
  assert.throws(
    () => createDays(cfg, { ...record().input, last: "2027-07-01" }),
    /fiscal year/,
  );
  assert.throws(
    () => validateConfig({ ...cfg, managementEmails: [] }),
    /email/,
  );
  assert.throws(() => validateConfig({ ...cfg, schedules: [] }), /schedule/);
  assert.throws(
    () =>
      createDays(cfg, { ...record().input, category: "forged" as "vacation" }),
    /category/,
  );
});
test("monthly accrual applies cap after usage, with future leave shown separately", () => {
  const c = structuredClone(cfg);
  c.policy.openingVacation = 34800;
  const a = record("2026-07-15");
  const result = report(c, [a], "2026-07-20");
  assert.equal(result.available.vacation, 34075);
  assert.equal(result.projected.vacation, 34800);
  const future = report(c, [record("2027-06-15")], "2026-07-20");
  assert.equal(future.used.vacation, 0);
  assert.equal(future.planned.vacation, 725);
  assert.equal(future.available.vacation, 34800);
});
test("cancellation restores balances but CALM correction remains outstanding", () => {
  const r = record();
  r.status = "cancelled";
  r.calm = "correction";
  assert.equal(report(cfg, [r], "2026-12-01").used.vacation, 0);
  assert.equal(pendingCalm(r), true);
  r.calm = "entered";
  assert.equal(pendingCalm(r), false);
});
test("management email never claims pending CALM is entered; CSV blocks formulas", () => {
  const r = record();
  assert.match(managementMessage(cfg, r).body, /I’ll enter/);
  r.calm = "entered";
  assert.match(managementMessage(cfg, r).body, /I entered/);
  assert.equal(csvCell('=IMPORTDATA("x")'), '"\'=IMPORTDATA(""x"")"');
});

test("fiscal start defaults to July 1 and supports calendar and other fiscal years", () => {
  assert.deepEqual(fiscalBounds(cfg), {
    start: "2026-07-01",
    end: "2027-06-30",
  });
  assert.deepEqual(fiscalBounds({ ...cfg, fiscalYearStart: "01-01" }), {
    start: "2027-01-01",
    end: "2027-12-31",
  });
  const c = { ...cfg, fiscalYearStart: "10-01" };
  assert.deepEqual(fiscalBounds(c), { start: "2026-10-01", end: "2027-09-30" });
  assert.throws(
    () =>
      createDays(c, {
        ...record().input,
        first: "2026-09-30",
        last: "2026-09-30",
      }),
    /fiscal year/,
  );
  assert.equal(
    createDays(c, {
      ...record().input,
      first: "2027-09-30",
      last: "2027-09-30",
    })[0].hours,
    725,
  );
  assert.throws(
    () => validateConfig({ ...cfg, fiscalYearStart: "02-29" }),
    /fiscal/,
  );
});
test("custom fiscal periods credit twelve month ends and clip partial boundary months", () => {
  const c = { ...cfg, fiscalYearStart: "07-15" };
  const r = record();
  const result = report(c, [r], "2027-07-14");
  assert.equal(result.monthly.length, 13);
  assert.equal(result.projected.vacation, 12 * 1450 - 725);
  const january = report(
    { ...cfg, fiscalYearStart: "01-01" },
    [],
    "2027-12-31",
  );
  assert.equal(january.projected.vacation, 12 * 1450);
  assert.equal(january.monthly[0].month, "2027-01");
});
