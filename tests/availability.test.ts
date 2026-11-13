import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { availabilityDates, staffSummary } from "../src/availability.js";
import type { Config } from "../src/domain.js";
const cfg = JSON.parse(readFileSync("config/example.json", "utf8")) as Config;
test("availability considers only selected working dates and validates fiscal limits", () => {
  assert.deepEqual(
    availabilityDates({ ...cfg, holidays: ["2026-11-26", "2026-11-27"] }, [
      { first: "2026-11-25", last: "2026-11-30" },
    ]),
    ["2026-11-25", "2026-11-30"],
  );
  assert.throws(
    () => availabilityDates(cfg, [{ first: "2027-07-01", last: "2027-07-02" }]),
    /fiscal/,
  );
  assert.throws(
    () =>
      availabilityDates(
        cfg,
        Array(33).fill({ first: "2026-11-16", last: "2026-11-16" }),
      ),
    /range/,
  );
});
test("calendar summaries handle exclusive all-day ends, multi-day absences and gaps", () => {
  const dates = ["2026-11-16", "2026-11-18", "2026-11-20"];
  const result = staffSummary(cfg, dates, [
    {
      summary: "Alex Off",
      start: { date: "2026-11-16" },
      end: { date: "2026-11-19" },
    },
    {
      summary: "Gap only",
      start: { date: "2026-11-19" },
      end: { date: "2026-11-20" },
    },
    {
      summary: "Cancelled",
      status: "cancelled",
      start: { date: "2026-11-20" },
      end: { date: "2026-11-21" },
    },
  ]);
  assert.deepEqual(
    result.days.map((d) => d.events.map((e) => e.summary)),
    [["Alex Off"], ["Alex Off"], []],
  );
  assert.equal(result.days[0].events[0].when, "All day");
});
test("timed events use the configured timezone and midnight ending does not include the next day", () => {
  const result = staffSummary(
    cfg,
    ["2026-11-16", "2026-11-17"],
    [
      {
        summary: "Taylor Out",
        start: { dateTime: "2026-11-16T19:00:00Z" },
        end: { dateTime: "2026-11-17T05:00:00Z" },
      },
    ],
  );
  assert.equal(result.days[0].events[0].when, "14:00–24:00");
  assert.equal(result.days[1].events.length, 0);
  const hidden = staffSummary(
    cfg,
    ["2026-11-16"],
    [
      {
        start: { date: "2026-11-16" },
        end: { date: "2026-11-17" },
        description: "Do not return descriptions",
      },
    ],
  );
  assert.equal(hidden.days[0].events[0].summary, "Busy (details unavailable)");
  assert.doesNotMatch(JSON.stringify(hidden), /Do not return/);
});
test("large calendar summaries are bounded and clearly marked incomplete", () => {
  const result = staffSummary(
    cfg,
    ["2026-11-16"],
    Array.from({ length: 300 }, (_, i) => ({
      summary: "Example " + i,
      start: { date: "2026-11-16" },
      end: { date: "2026-11-17" },
    })),
  );
  assert.equal(result.truncated, true);
  assert.ok(result.days[0].events.length <= 200);
});
