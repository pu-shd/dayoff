export type Category = "vacation" | "sick" | "personal" | "other";
export type Mode = "full" | "half" | "partial";
export interface Schedule {
  effective: string;
  start: string;
  end: string;
  lunchStart: string;
}
export interface Config {
  fiscalYear: number;
  timeZone: string;
  displayName: string;
  ownerEmail: string;
  managementEmails: string[];
  calendarId: string;
  delivery: "disabled" | "google";
  reminderHour: number;
  policy: {
    fullDay: number;
    halfDay: number;
    lunchMinutes: number;
    openingVacation: number;
    vacationMonthly: number;
    vacationCap: number;
    openingSick: number;
    sickGrant: number;
    personalGrant: number;
  };
  schedules: Schedule[];
  holidays: string[];
}
export interface Input {
  id: string;
  category: Category;
  mode: Mode;
  first: string;
  last: string;
  start?: string;
  end?: string;
}
export interface Day {
  date: string;
  hours: number;
  allDay: boolean;
  start: string;
  end: string;
}
export interface RecordEntry {
  id: string;
  version: number;
  input: Input;
  days: Day[];
  status: "active" | "cancelled";
  calm: "pending" | "entered" | "correction" | "historical";
  calendar: "pending" | "done" | "disabled";
  email: "pending" | "sending" | "accepted" | "unknown" | "disabled";
  created: string;
  updated: string;
  legacy?: boolean;
}
export function invariant(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function dateValid(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function minutes(value: string): number {
  invariant(
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
    "Use a valid 24-hour time.",
  );
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
export function plusDays(value: string, count: number): string {
  return new Date(Date.parse(value + "T12:00:00Z") + count * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function validateConfig(c: Config): Config {
  invariant(
    c &&
      Number.isInteger(c.fiscalYear) &&
      c.fiscalYear >= 2000 &&
      c.fiscalYear <= 2200,
    "Invalid fiscal year.",
  );
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: c.timeZone });
  } catch {
    throw new Error("Invalid timezone.");
  }
  const email = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
  invariant(
    email.test(c.ownerEmail) &&
      c.managementEmails?.length > 0 &&
      c.managementEmails.every((x) => email.test(x)),
    "Configure valid owner and management email addresses.",
  );
  invariant(
    typeof c.displayName === "string" &&
      c.displayName.trim().length > 0 &&
      c.displayName.length <= 80 &&
      !/[\r\n<>]/.test(c.displayName),
    "Invalid display name.",
  );
  invariant(
    typeof c.calendarId === "string" && c.calendarId.length > 0,
    "Calendar ID is required.",
  );
  invariant(
    ["disabled", "google"].includes(c.delivery),
    "Invalid delivery mode.",
  );
  invariant(
    Number.isInteger(c.reminderHour) &&
      c.reminderHour >= 0 &&
      c.reminderHour <= 23,
    "Invalid reminder hour.",
  );
  invariant(
    c.policy &&
      Object.values(c.policy).every((x) => Number.isInteger(x) && x >= 0) &&
      c.policy.fullDay > 0 &&
      c.policy.halfDay > 0 &&
      c.policy.vacationCap >= c.policy.openingVacation,
    "Invalid leave allowances (integer hundredths of hours).",
  );
  invariant(c.schedules?.length > 0, "Configure a work schedule.");
  const dates = new Set<string>();
  for (const s of c.schedules) {
    invariant(
      dateValid(s.effective) && !dates.has(s.effective),
      "Invalid or duplicate schedule date.",
    );
    dates.add(s.effective);
    invariant(
      minutes(s.start) < minutes(s.end) &&
        minutes(s.lunchStart) >= minutes(s.start) &&
        minutes(s.lunchStart) + c.policy.lunchMinutes <= minutes(s.end),
      "Invalid schedule or lunch window.",
    );
  }
  invariant(
    c.schedules.some((s) => s.effective <= c.fiscalYear - 1 + "-07-01"),
    "Schedule must cover the fiscal year start.",
  );
  invariant(
    Array.isArray(c.holidays) && c.holidays.every(dateValid),
    "Invalid holiday dates.",
  );
  return c;
}
export function scheduleOn(c: Config, date: string): Schedule {
  const s = [...c.schedules]
    .sort((a, b) => b.effective.localeCompare(a.effective))
    .find((s) => s.effective <= date);
  invariant(s, "No schedule covers this date.");
  return s;
}
export function createDays(c: Config, input: Input): Day[] {
  invariant(
    input && /^[a-zA-Z0-9-]{8,80}$/.test(input.id),
    "Invalid request ID.",
  );
  invariant(
    ["vacation", "sick", "personal", "other"].includes(input.category),
    "Invalid leave category.",
  );
  invariant(
    ["full", "half", "partial"].includes(input.mode),
    "Invalid absence mode.",
  );
  invariant(
    dateValid(input.first) &&
      dateValid(input.last) &&
      input.first <= input.last,
    "Invalid date range.",
  );
  invariant(
    input.first >= c.fiscalYear - 1 + "-07-01" &&
      input.last <= c.fiscalYear + "-06-30",
    "Dates must fall within the configured fiscal year.",
  );
  const days: Day[] = [];
  for (let date = input.first; date <= input.last; date = plusDays(date, 1)) {
    const dow = new Date(date + "T12:00:00Z").getUTCDay();
    if (dow === 0 || dow === 6 || c.holidays.includes(date)) continue;
    const s = scheduleOn(c, date);
    let hours = c.policy.fullDay;
    const start = input.mode === "full" ? s.start : input.start || "";
    const end = input.mode === "full" ? s.end : input.end || "";
    if (input.mode !== "full") {
      const a = minutes(start),
        b = minutes(end),
        lunch = minutes(s.lunchStart);
      invariant(
        a < b && a >= minutes(s.start) && b <= minutes(s.end),
        "Absence must be within office hours and end after it starts.",
      );
      const net =
        b -
        a -
        Math.max(
          0,
          Math.min(b, lunch + c.policy.lunchMinutes) - Math.max(a, lunch),
        );
      invariant(net > 0, "Absence contains no working time.");
      hours =
        input.mode === "half" ? c.policy.halfDay : Math.round((net * 100) / 60);
      invariant(
        hours <= c.policy.fullDay,
        "Partial absence exceeds the full-day charge; select Full day.",
      );
    }
    days.push({ date, hours, allDay: input.mode === "full", start, end });
  }
  invariant(days.length > 0, "No working days in this range.");
  return days;
}
export function title(c: Config, d: Day): string {
  if (d.allDay) return c.displayName + " Off";
  const s = scheduleOn(c, d.date);
  return (
    c.displayName +
    (d.start === s.start
      ? " Arrives Late"
      : d.end === s.end
        ? " Leaves Early"
        : " Out of Office")
  );
}
export function hoursText(n: number): string {
  return (n / 100).toFixed(2);
}
export function report(c: Config, records: RecordEntry[], today: string) {
  const used = { vacation: 0, sick: 0, personal: 0, other: 0 },
    planned = { ...used };
  const active = records.filter((r) => r.status === "active");
  let vacation = c.policy.openingVacation,
    projected = vacation;
  const monthly = [];
  for (let i = 0; i < 12; i++) {
    const year = c.fiscalYear - 1 + Math.floor((6 + i) / 12),
      month = ((6 + i) % 12) + 1;
    const first = year + "-" + String(month).padStart(2, "0") + "-01";
    const end = plusDays(
      new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
      -1,
    );
    const charges = active
      .flatMap((r) => r.days.map((d) => ({ ...d, category: r.input.category })))
      .filter((d) => d.date >= first && d.date <= end);
    for (const d of charges)
      (d.date <= today ? used : planned)[d.category] += d.hours;
    const taken = charges
      .filter((d) => d.category === "vacation")
      .reduce((n, d) => n + d.hours, 0);
    projected = Math.min(
      c.policy.vacationCap,
      projected - taken + c.policy.vacationMonthly,
    );
    if (first <= today) {
      vacation -= charges
        .filter((d) => d.category === "vacation" && d.date <= today)
        .reduce((n, d) => n + d.hours, 0);
      if (end <= today)
        vacation = Math.min(
          c.policy.vacationCap,
          vacation + c.policy.vacationMonthly,
        );
    }
    monthly.push({
      month: first.slice(0, 7),
      vacationTaken: taken,
      projectedVacation: projected,
    });
  }
  return {
    used,
    planned,
    available: {
      vacation,
      sick: c.policy.openingSick + c.policy.sickGrant - used.sick,
      personal: c.policy.personalGrant - used.personal,
    },
    projected: {
      vacation: projected,
      sick:
        c.policy.openingSick + c.policy.sickGrant - used.sick - planned.sick,
      personal: c.policy.personalGrant - used.personal - planned.personal,
    },
    monthly,
  };
}
export function managementMessage(
  c: Config,
  r: RecordEntry,
): { subject: string; body: string } {
  const dates = r.days.map((d) => d.date),
    dateLabel = dates[0] + (dates.length > 1 ? "–" + dates.at(-1) : "");
  const mmdd = (d: string) => d.slice(5, 7) + "/" + d.slice(8, 10);
  const subject =
    "Day Off, " +
    mmdd(dates[0]) +
    (dates.length > 1 ? "–" + mmdd(dates.at(-1)!) : "");
  return {
    subject,
    body:
      "I need to take " +
      dateLabel +
      " off as " +
      r.input.category +
      " leave (" +
      hoursText(r.days.reduce((n, d) => n + d.hours, 0)) +
      " hours). I put it on the Staff Calendar. " +
      (r.calm === "entered"
        ? "I entered it into CALM."
        : "I’ll enter it into CALM.") +
      "\n\nRequest: " +
      r.id,
  };
}
export function pendingCalm(r: RecordEntry): boolean {
  return (
    !r.legacy &&
    ((r.calm === "pending" && r.status === "active") || r.calm === "correction")
  );
}
export function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
