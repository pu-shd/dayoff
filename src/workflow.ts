import {
  createDays,
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
    status: "active",
    calm: "pending",
    calendar: "pending",
    email: "pending",
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
        other.days.some(
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
    const msg =
      r.status === "cancelled"
        ? {
            subject: "Cancelled: " + managementMessage(c, r).subject,
            body:
              "My leave request has been cancelled. The Staff Calendar has been updated. " +
              (r.calm === "correction"
                ? "I will correct CALM."
                : "No CALM correction is needed.") +
              "\n\nRequest: " +
              r.id,
          }
        : managementMessage(c, r);
    try {
      p.mail(c.managementEmails, msg.subject, msg.body);
    } catch {
      r.email = "unknown";
      p.save(r);
      throw new Error(
        "Email outcome is uncertain. Check Sent mail before recording it as sent. Automatic resending is disabled.",
      );
    }
    r.email = "accepted";
    p.save(r);
  }
  return r;
}
export function cancel(
  c: Config,
  p: Ports,
  id: string,
  version: number,
): RecordEntry {
  const r = p.list().find((x) => x.id === id);
  invariant(r && !r.legacy, "Request not found.");
  invariant(
    r.version === version,
    "The request changed. Refresh before continuing.",
  );
  if (r.status === "cancelled") return r;
  invariant(
    r.email !== "sending" && r.email !== "unknown",
    "Resolve the uncertain email status before cancellation.",
  );
  r.status = "cancelled";
  r.calm = r.calm === "entered" ? "correction" : "historical";
  r.version++;
  r.calendar = "pending";
  r.email = "pending";
  r.updated = p.now();
  p.save(r);
  return sync(c, p, r);
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
  r.version++;
  r.updated = p.now();
  r.calendar = r.status === "active" ? "pending" : r.calendar;
  p.save(r);
  return r;
}
