import { invariant } from "./domain.js";
export const categories = ["vacation", "sick", "personal"] as const;
type Category = (typeof categories)[number];
type Amounts = Record<Category, number>;
type Balances = Record<Category, number | null>;
export interface HistoryYear {
  fiscalYear: number;
  fiscalYearStart: "07-01";
  revision: string;
  source: {
    name: string;
    sha256: string;
    incomplete: boolean;
    headerYear: string;
  };
  policy: {
    openingVacation: number;
    openingSick: number;
    vacationMonthly: number;
    vacationCap: number;
    sickGrant: number;
    personalGrant: number;
  };
  carryCaps: { vacation: number; sick: number | null };
  months: ({ month: string; balances: Balances } & Amounts)[];
  daily: { date: string; cell: string; mark: string }[];
  unmapped: { cell: string; mark: string }[];
  legend: { cell: string; mark: string }[];
  totals: Amounts;
  balances: Balances;
  duplicateYears: number[];
  warnings: string[];
  reconciliation: {
    followingYear?: number;
    vacation?: CarryCheck;
    sick?: CarryCheck;
  };
}
interface CarryCheck {
  status: "matches" | "mismatch" | "unavailable";
  sourceClosing: number | null;
  nextOpening: number;
  carryCap: number | null;
  backwardConstraint: "exact" | "at-least" | "unavailable";
}
export interface HistoryArchive {
  schemaVersion: 1;
  anchorFiscalYear: number;
  years: HistoryYear[];
}
function year(n: unknown): n is number {
  return Number.isInteger(n) && Number(n) >= 2000 && Number(n) <= 2200;
}
function integer(n: unknown): n is number {
  return Number.isSafeInteger(n) && Math.abs(Number(n)) <= 100_000_000;
}
function text(s: unknown): s is string {
  return typeof s === "string" && s.length <= 2000;
}
const hash = (s: unknown) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
function check(condition: unknown): asserts condition {
  invariant(
    condition,
    "Invalid attendance history. Rebuild the private archive from its workbooks.",
  );
}
export function validateHistoryYear(value: unknown): HistoryYear {
  check(value && typeof value === "object");
  const y = value as HistoryYear;
  check(
    year(y.fiscalYear) && y.fiscalYearStart === "07-01" && hash(y.revision),
  );
  check(JSON.stringify(y).length <= 48_000);
  check(
    y.source &&
      text(y.source.name) &&
      !/[\\/]/.test(y.source.name) &&
      hash(y.source.sha256) &&
      typeof y.source.incomplete === "boolean" &&
      text(y.source.headerYear),
  );
  check(
    y.policy &&
      [
        y.policy.openingVacation,
        y.policy.openingSick,
        y.policy.vacationMonthly,
        y.policy.vacationCap,
        y.policy.sickGrant,
        y.policy.personalGrant,
      ].every((n) => integer(n) && n >= 0),
  );
  check(
    y.carryCaps &&
      integer(y.carryCaps.vacation) &&
      y.carryCaps.vacation >= 0 &&
      (y.carryCaps.sick === null ||
        (integer(y.carryCaps.sick) && y.carryCaps.sick >= 0)),
  );
  check(Array.isArray(y.months) && y.months.length === 12);
  for (const [i, m] of y.months.entries()) {
    const month = ((6 + i) % 12) + 1,
      actualYear = y.fiscalYear - 1 + Math.floor((6 + i) / 12);
    check(
      m.month === `${actualYear}-${String(month).padStart(2, "0")}` &&
        m.balances,
    );
    for (const c of categories)
      check(
        integer(m[c]) &&
          m[c] >= 0 &&
          (m.balances[c] === null || integer(m.balances[c])),
      );
  }
  check(y.totals && y.balances);
  for (const c of categories) {
    check(
      integer(y.totals[c]) &&
        y.totals[c] === y.months.reduce((sum, m) => sum + m[c], 0),
    );
    check(y.balances[c] === y.months[11].balances[c]);
  }
  for (const entries of [y.daily, y.unmapped, y.legend]) {
    check(Array.isArray(entries) && entries.length <= 400);
    for (const e of entries)
      check(
        e &&
          typeof e.cell === "string" &&
          /^[A-Z]{1,3}\d{1,3}$/.test(e.cell) &&
          text(e.mark),
      );
  }
  const dates = new Set<string>();
  for (const d of y.daily) {
    check(typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date));
    const date = new Date(d.date + "T00:00:00Z");
    check(
      Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === d.date &&
        d.date >= `${y.fiscalYear - 1}-07-01` &&
        d.date <= `${y.fiscalYear}-06-30` &&
        !dates.has(d.date),
    );
    dates.add(d.date);
  }
  check(
    Array.isArray(y.duplicateYears) &&
      y.duplicateYears.every((n) => year(n) && n !== y.fiscalYear),
  );
  check(
    Array.isArray(y.warnings) &&
      y.warnings.length <= 30 &&
      y.warnings.every(text),
  );
  check(y.reconciliation && typeof y.reconciliation === "object");
  if (y.reconciliation.followingYear !== undefined) {
    check(y.reconciliation.followingYear === y.fiscalYear + 1);
    for (const c of ["vacation", "sick"] as const) {
      const r = y.reconciliation[c];
      check(
        r &&
          ["matches", "mismatch", "unavailable"].includes(r.status) &&
          ["exact", "at-least", "unavailable"].includes(r.backwardConstraint) &&
          integer(r.nextOpening) &&
          (r.sourceClosing === null || integer(r.sourceClosing)) &&
          (r.carryCap === null || integer(r.carryCap)),
      );
      const expected =
        r.sourceClosing === null || r.carryCap === null
          ? "unavailable"
          : Math.min(r.sourceClosing, r.carryCap) === r.nextOpening
            ? "matches"
            : "mismatch";
      check(r.status === expected);
    }
  }
  return y;
}
export function validateHistory(value: unknown): HistoryArchive {
  check(value && typeof value === "object");
  const a = value as HistoryArchive;
  check(
    a.schemaVersion === 1 &&
      year(a.anchorFiscalYear) &&
      Array.isArray(a.years) &&
      a.years.length <= 201,
  );
  const ids = new Set<number>();
  for (const value of a.years) {
    const y = validateHistoryYear(value);
    check(!ids.has(y.fiscalYear) && y.fiscalYear <= a.anchorFiscalYear);
    ids.add(y.fiscalYear);
  }
  check(!a.years.length || ids.has(a.anchorFiscalYear));
  return a;
}
export function historyIndex(years: HistoryYear[]) {
  return [...years]
    .sort((a, b) => b.fiscalYear - a.fiscalYear)
    .map((y) => ({
      fiscalYear: y.fiscalYear,
      revision: y.revision,
      incomplete: y.source.incomplete,
      duplicateYears: y.duplicateYears,
      dailyCount: y.daily.length,
      warningCount: y.warnings.length,
    }));
}
