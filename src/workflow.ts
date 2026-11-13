import {
  createDays,
  activeDays,
  hoursText,
  invariant,
  managementMessage,
  pendingCalm,
  type Config,
  type Input,
  type RecordEntry,
} from "./domain.js";
export interface Ports {
  list(): RecordEntry[];
  save(r: RecordEntry): void;
  now(): string;
  calendar(r: RecordEntry): void;
  mail(to: string[], subject: string, body: string): void;
}
export function submit(c: Config, p: Ports, input: Input): RecordEntry {
  input = { ...input, emailTo: input.emailTo ?? "self" };
  const days = createDays(c, input),
    existing = p.list().find((r) => r.id === input.id);
  if (existing) {
    invariant(
      JSON.stringify(existing.input) === JSON.stringify(input),
      "This request ID already has different details.",
    );
    return existing;
  }
  const r: RecordEntry = {
    id: input.id,
    version: 1,
    input,
    days,
    cancelledDates: [],
    calmCorrectionDates: [],
    status: "active",
    calm: "pending",
    calendar: "pending",
    email: input.emailTo === "none" ? "skipped" : "pending",
    emailRecipients:
      input.emailTo === "none"
        ? []
        : input.emailTo === "management"
          ? [...c.managementEmails]
          : [c.ownerEmail],
    created: p.now(),
    updated: p.now(),
  };
  if (c.delivery === "disabled")
    return { ...r, calendar: "disabled", email: "disabled" };
  for (const other of p
    .list()
    .filter((x) => x.status === "active" && !x.legacy)) {
    invariant(
      !days.some((d) =>
        activeDays(other).some(
          (x) =>
            x.date === d.date &&
            (x.allDay || d.allDay || (x.start < d.end && d.start < x.end)),
        ),
      ),
      "This absence overlaps an existing request.",
    );
  }
  p.save(r);
  return sync(c, p, r);
}
export function sync(c: Config, p: Ports, r: RecordEntry): RecordEntry {
  invariant(
    !r.legacy,
    "Historical summaries do not create calendar events or emails.",
  );
  invariant(
    c.delivery === "google",
    "Delivery is disabled. Use previews until delivery is configured.",
  );
  if (r.calendar !== "done") {
    p.calendar(r);
    r.calendar = "done";
    r.updated = p.now();
    p.save(r);
  }
  if (r.email === "pending") {
    r.email = "sending";
    p.save(r);
    const msg = deliveryMessage(c, r);
    try {
      p.mail(r.emailRecipients ?? c.managementEmails, msg.subject, msg.body);
    } catch {
      r.email = "unknown";
      p.save(r);
      throw new Error(
        "Email outcome is uncertain. Verify recipient receipt or a delivery trace. Automatic resending is disabled.",
      );
    }
    r.email = "accepted";
    p.save(r);
  }
  return r;
}
function editable(p: Ports, id: string, version: number): RecordEntry {
  const r = p.list().find((x) => x.id === id);
  invariant(r && !r.legacy, "Request not found.");
  invariant(
    r.version === version,
    "The request changed. Refresh before continuing.",
  );
  invariant(
    r.email !== "sending" && r.email !== "unknown",
    "Resolve the uncertain email status before changing dates.",
  );
  return r;
}
function removeDates(
  c: Config,
  p: Ports,
  r: RecordEntry,
  dates: string[],
): RecordEntry {
  const entered = r.calm === "entered" || r.calm === "correction";
  r.cancelledDates = [...new Set([...(r.cancelledDates ?? []), ...dates])];
  r.calmCorrectionDates = [
    ...new Set([...(r.calmCorrectionDates ?? []), ...(entered ? dates : [])]),
  ];
  r.lastRemovedDates = dates;
  const remaining = activeDays(r);
  r.status = remaining.length ? "active" : "cancelled";
  r.calm = r.calmCorrectionDates.length
    ? "correction"
    : remaining.length
      ? "pending"
      : "historical";
  r.version++;
  r.calendar = "pending";
  r.email =
    r.input.emailTo === "none" || r.emailRecipients?.length === 0
      ? "skipped"
      : "pending";
  r.updated = p.now();
  p.save(r);
  return sync(c, p, r);
}
export function removeDate(
  c: Config,
  p: Ports,
  id: string,
  version: number,
  date: string,
): RecordEntry {
  const r = editable(p, id, version);
  invariant(
    r.days.some((d) => d.date === date),
    "Invalid date for this request.",
  );
  if (r.status === "cancelled" || r.cancelledDates?.includes(date)) return r;
  invariant(
    r.calendar === "done",
    "Request has unfinished Calendar work. Retry incomplete steps first.",
  );
  return removeDates(c, p, r, [date]);
}
export function cancel(
  c: Config,
  p: Ports,
  id: string,
  version: number,
): RecordEntry {
  const r = editable(p, id, version);
  if (r.status === "cancelled") return r;
  return removeDates(
    c,
    p,
    r,
    activeDays(r).map((d) => d.date),
  );
}
function deliveryMessage(
  c: Config,
  r: RecordEntry,
): { subject: string; body: string } {
  if (!r.lastRemovedDates?.length && r.status !== "cancelled")
    return managementMessage(c, r);
  const removed = r.days.filter((d) =>
    (r.lastRemovedDates ?? r.days.map((x) => x.date)).includes(d.date),
  );
  const line = (d: RecordEntry["days"][number]) =>
    d.date + " · " + hoursText(d.hours) + " hours";
  const remaining = activeDays(r);
  return {
    subject:
      (r.status === "cancelled" ? "Cancelled: " : "Updated: ") +
      managementMessage(c, r).subject,
    body:
      (r.status === "cancelled"
        ? "My leave request is now cancelled."
        : "I am removing the following dates from my leave request.") +
      "\n\nRemoved (" +
      r.input.category +
      "):\n" +
      removed.map(line).join("\n") +
      (remaining.length
        ? "\n\nRemaining leave:\n" + remaining.map(line).join("\n")
        : "") +
      "\n\nThe Staff Calendar has been updated. " +
      (r.calm === "correction"
        ? "I will correct the removed dates in CALM."
        : remaining.length
          ? "I’ll enter the remaining dates into CALM."
          : "No CALM correction is needed."),
  };
}
export function markCalm(p: Ports, id: string, version: number): RecordEntry {
  const r = p.list().find((x) => x.id === id);
  invariant(
    r && pendingCalm(r),
    "No outstanding CALM action for this request.",
  );
  invariant(
    r.version === version,
    "The request changed. Refresh before confirming CALM.",
  );
  r.calm = "entered";
  r.calmCorrectionDates = [];
  r.version++;
  r.updated = p.now();
  r.calendar = r.status === "active" ? "pending" : r.calendar;
  p.save(r);
  return r;
}
