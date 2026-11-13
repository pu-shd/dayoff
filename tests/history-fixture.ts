import type { HistoryArchive, HistoryYear } from "../src/history.js";
export function historyFixture(): HistoryArchive {
  const balances = { vacation: 10000, sick: 5000, personal: -100 };
  const y: HistoryYear = {
    fiscalYear: 2027,
    fiscalYearStart: "07-01",
    revision: "a".repeat(64),
    source: {
      name: "fy2027.xlsx",
      sha256: "b".repeat(64),
      incomplete: false,
      headerYear: "2026",
    },
    policy: {
      openingVacation: 10000,
      openingSick: 5000,
      vacationMonthly: 1450,
      vacationCap: 34800,
      sickGrant: 5800,
      personalGrant: 1450,
    },
    carryCaps: { vacation: 34800, sick: 5800 },
    months: Array.from({ length: 12 }, (_, i) => ({
      month: `${2026 + Math.floor((6 + i) / 12)}-${String(((6 + i) % 12) + 1).padStart(2, "0")}`,
      vacation: i === 0 ? 725 : 0,
      sick: 0,
      personal: 0,
      balances,
    })),
    daily: [{ date: "2026-07-02", cell: "C20", mark: "<b>V</b>" }],
    unmapped: [],
    legend: [{ cell: "L7", mark: "V: Vacation" }],
    totals: { vacation: 725, sick: 0, personal: 0 },
    balances,
    duplicateYears: [],
    warnings: ["Internal year label differs."],
    reconciliation: {},
  };
  return { schemaVersion: 1, anchorFiscalYear: 2027, years: [y] };
}
