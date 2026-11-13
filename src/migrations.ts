import type { Config, RecordEntry } from "./domain.js";
// Migration 002 appends routing metadata; original journal rows remain intact.
export function migration002(r: RecordEntry, c: Config): RecordEntry {
  if (r.input.emailTo !== undefined && Array.isArray(r.emailRecipients))
    return r;
  const route = r.legacy ? "none" : (r.input.emailTo ?? "management");
  return {
    ...r,
    input: { ...r.input, emailTo: route },
    emailRecipients:
      r.emailRecipients ??
      (route === "none"
        ? []
        : route === "self"
          ? [c.ownerEmail]
          : [...c.managementEmails]),
  };
}

// Migration 005 adds per-date cancellation metadata without recalculating charges.
export function migration005(r: RecordEntry): RecordEntry {
  if (
    r.legacy ||
    (Array.isArray(r.cancelledDates) && Array.isArray(r.calmCorrectionDates))
  )
    return r;
  return {
    ...r,
    cancelledDates:
      r.cancelledDates ??
      (r.status === "cancelled" ? r.days.map((d) => d.date) : []),
    calmCorrectionDates:
      r.calmCorrectionDates ??
      (r.calm === "correction" ? r.days.map((d) => d.date) : []),
  };
}
