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
