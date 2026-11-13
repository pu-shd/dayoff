# Architecture

The TypeScript domain module calculates working time and balances. The workflow module persists request progress before external calls. The Apps Script adapter supplies authentication, single-use confirmation nonces, Sheets storage, Calendar operations, and email. Responsive HTML works in macOS and iOS browsers.

## Migration 001: journal

The private Sheet contains an append-only Journal with timestamp, kind, and JSON payload columns. Each save appends a complete request snapshot; reads fold snapshots by request ID. Script Properties hold the ledger ID, schema version, and reminder date.

Initialization creates the journal once and never replaces existing imported IDs. Future changes require numbered migrations. Unsupported schemas fail explicitly. A script lock serializes mutations and reminders; request versions reject stale confirmations.

Amounts are integer hundredths of an hour. Partial working minutes round to the nearest hundredth. Full and half days use independent policy charges. Requests retain calculated day intervals and charges so later schedule changes do not recalculate past usage.

## External effects and recovery

Calendar event IDs derive deterministically from request ID and date. Each working day gets one event. Full days use exclusive next-day end dates; timed events include the configured timezone. Retried duplicate inserts update the existing event. Categories remain private to the ledger and management email; Calendar notes contain hours, CALM status, and a reference. Extended properties are correlation metadata, not a confidentiality boundary.

Calendar completes before management email. The journal records email sending before MailApp and accepted afterward. An exception leaves unknown; process interruption can leave sending. Neither state is automatically resent. Check Sent mail; if absent, manually send the intended message before confirming it. Provider acceptance does not prove delivery.

Cancellation removes app-owned events and reverses personal usage. If CALM was entered, its correction stays outstanding. Management receives a cancellation notice. Dates/hours changes use cancellation plus replacement in this version.

## Access

Each deployment uses MYSELF access and executes as its deployer. Every handler also verifies the configured owner's effective identity. Coworkers deploy separately.

GET never changes CALM. Reminder links carry ID and revision, not authorization secrets. Confirmation uses authenticated RPC, a single-use expiring nonce, and a version check. Older links ask the owner to review the latest record.

The browser uses text nodes for record content. CSV exports escape formulas. Server-side checks validate configuration and request inputs. Raw provider errors, attendance payloads, tokens, and email contents are not logged.

## Limits

- Google email sender; Outlook requires another adapter.
- No CALM automation or official-balance verification.
- Monthly history cannot reconstruct exact daily allocations or CALM state.
- No inbound sync for manual Calendar edits or approval replies.
- One fiscal year per populated ledger; annual rollover uses a new instance.
- Apps Script scheduling is approximate and quota-limited.
- Mocked tests cannot establish actual account OAuth or Google service behavior.

A future departmental portal would need centrally managed identity, per-user authorization, and private storage. The domain and workflow modules can be retained.
