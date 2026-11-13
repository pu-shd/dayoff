import { test } from "node:test";
import assert from "node:assert/strict";
import { validateHistory, historyIndex } from "../src/history.js";
import { historyFixture } from "./history-fixture.js";
test("history preserves raw marks and negative source balances", () => {
  const a = historyFixture();
  assert.equal(validateHistory(a), a);
  assert.equal(a.years[0].daily[0].mark, "<b>V</b>");
  assert.equal(a.years[0].balances.personal, -100);
  assert.equal(historyIndex(a.years)[0].dailyCount, 1);
});
test("history rejects duplicate years, altered totals and invalid source dates", () => {
  for (const mutate of [
    (a: ReturnType<typeof historyFixture>) => a.years.push(a.years[0]),
    (a: ReturnType<typeof historyFixture>) => a.years[0].totals.vacation++,
    (a: ReturnType<typeof historyFixture>) =>
      (a.years[0].daily[0].date = "2027-02-30"),
    (a: ReturnType<typeof historyFixture>) =>
      (a.years[0].source.name = "../private.xlsx"),
  ]) {
    const a = historyFixture();
    mutate(a);
    assert.throws(() => validateHistory(a), /Invalid attendance/);
  }
});
