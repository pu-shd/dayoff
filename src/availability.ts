import {
  dateValid,
  fiscalBounds,
  invariant,
  plusDays,
  type Config,
} from "./domain.js";
export interface CalendarRange {
  first: string;
  last: string;
}
export interface StaffDay {
  date: string;
  events: { summary: string; when: string }[];
}
export interface StaffLookup {
  days: StaffDay[];
  truncated: boolean;
  checkedAt: string;
  cached: boolean;
}
export function availabilityDates(c: Config, value: unknown): string[] {
  invariant(
    Array.isArray(value) && value.length > 0 && value.length <= 32,
    "Invalid calendar date ranges.",
  );
  const dates = new Set<string>(),
    period = fiscalBounds(c);
  for (const raw of value) {
    invariant(raw && typeof raw === "object", "Invalid calendar date range.");
    const r = raw as CalendarRange;
    invariant(
      typeof r.first === "string" &&
        typeof r.last === "string" &&
        dateValid(r.first) &&
        dateValid(r.last) &&
        r.first <= r.last,
      "Invalid calendar date range.",
    );
    invariant(
      r.first >= period.start && r.last <= period.end,
      "Dates must fall within the configured fiscal year.",
    );
    for (let d = r.first; d <= r.last; d = plusDays(d, 1)) {
      const weekday = new Date(d + "T12:00:00Z").getUTCDay();
      if (weekday !== 0 && weekday !== 6 && !c.holidays.includes(d))
        dates.add(d);
    }
  }
  return [...dates].sort();
}
export function staffSummary(
  c: Config,
  dates: string[],
  events: GoogleAppsScript.Calendar.Schema.Event[],
): { days: StaffDay[]; truncated: boolean } {
  const days = dates.map((date) => ({
    date,
    events: [] as StaffDay["events"],
  }));
  let count = 0,
    truncated = false;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: c.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  function local(value: string) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(value)).map((p) => [p.type, p.value]),
    );
    return {
      date: parts.year + "-" + parts.month + "-" + parts.day,
      time: parts.hour + ":" + parts.minute,
      midnight:
        parts.hour === "00" && parts.minute === "00" && parts.second === "00",
    };
  }
  for (const event of events) {
    if (event.status === "cancelled") continue;
    const allDay = !!event.start?.date;
    let first: string,
      last: string,
      from = "",
      until = "",
      midnight = false;
    if (allDay) {
      first = event.start!.date!;
      last = event.end?.date ?? "";
      if (!dateValid(first) || !dateValid(last) || first >= last) continue;
    } else {
      const start = event.start?.dateTime,
        end = event.end?.dateTime;
      if (
        !start ||
        !end ||
        !Number.isFinite(Date.parse(start)) ||
        !Number.isFinite(Date.parse(end)) ||
        Date.parse(start) >= Date.parse(end)
      )
        continue;
      const a = local(start),
        b = local(end);
      first = a.date;
      last = b.date;
      from = a.time;
      until = b.time;
      midnight = b.midnight;
    }
    const summary =
      event.summary?.trim().slice(0, 160) || "Busy (details unavailable)";
    for (const day of days) {
      if (
        day.date < first ||
        day.date > last ||
        (day.date === last && (allDay || midnight))
      )
        continue;
      if (count >= 200) {
        truncated = true;
        continue;
      }
      day.events.push({
        summary,
        when: allDay
          ? "All day"
          : (day.date === first ? from : "00:00") +
            "–" +
            (day.date === last ? until : "24:00"),
      });
      count++;
    }
  }
  return { days, truncated };
}
