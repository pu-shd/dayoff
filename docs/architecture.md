# Architecture

The TypeScript domain module calculates working time and balances. The workflow module persists request progress before external calls. The Apps Script adapter supplies authentication, single-use confirmation nonces, Sheets storage, Calendar operations, and email. Responsive HTML works in macOS and iOS browsers.

## Migration 001: journal

The private Sheet contains an append-only Journal with timestamp, kind, and JSON payload columns. Each save appends a complete request snapshot; reads fold snapshots by request ID. Script Properties hold the ledger ID, schema version, and reminder date.

Initialization creates the journal once and never replaces existing imported IDs. Future changes require numbered migrations. Unsupported schemas fail explicitly. A script lock serializes mutations and reminders; request versions reject stale confirmations.

Amounts are integer hundredths of an hour. Partial working minutes round to the nearest hundredth. Full and half days use independent policy charges. Requests retain calculated day intervals and charges so later schedule changes do not recalculate past usage.

## Migration 002: request email routing

New requests persist their email choice (self, management, or none) and a recipient snapshot. Migration 002 appends routing metadata to older snapshots on the first authorized mutation or scheduled reminder run. GET and preview do not migrate the journal. Original rows, hours, dates, CALM state, and balances remain intact; retries skip already-upgraded snapshots.

Earlier versions sent every request to management and did not store recipient snapshots. Their migration records management routing with the management list configured at upgrade time. Imported monthly summaries receive no-email routing. New requests default to self. The sheet columns remain unchanged; routing snapshots are appended before the schema version advances.

## Migration 003: fiscal boundaries

Migration 003 records the fiscal-year start in Script Properties and advances the schema version to 3. Existing ledgers default to July 1. Fiscal dates are configurable at setup and protected thereafter, alongside the year label. Date validation, date-picker limits, and reports derive from the same fiscal-boundary helper. Non-month-start boundaries clip the first/last reporting months, while monthly vacation accrual remains on calendar month ends.

## Migration 004: private attendance archive

Migration 004 creates a separate `History` tab with `fiscal_year`, `revision`, and JSON `payload` columns and advances the schema to 4. It runs under the existing authenticated write lock; GET stays read-only. The active Journal, request IDs, imported policies, and totals remain unchanged. A partially completed migration can safely resume.

The optional `DAYOFF_HISTORY` bundle contains source-year snapshots. An explicit `importHistory` action validates them and appends only changed revisions. Reads fold by fiscal year, while older revisions remain in the sheet. Authentication applies to history reads and imports; imports also consume a single-use nonce. History data never enters Calendar, MailApp, the CALM queue, or current-year balance calculations. The dashboard returns an index; year details load separately.

The importer compares cached monthly and annual totals, preserves raw daily codes without allocating hours, records source hashes, and flags incomplete or repeated data. It works backwards from the latest supplied FY and checks adjacent carryover using the following year's cap. An opening equal to the cap establishes only a lower bound on the preceding closing balance. Source balances are retained, including negative balances; mismatches remain reviewable. Hashes and source revisions support repeatable imports, not independent verification of spreadsheet contents.

## Migration 005: grouped dates and cancellations

New inputs may contain up to 32 ranges sharing a category and email choice. Each row calculates its working dates independently, then the dates are sorted; duplicate dates across rows are rejected. The original single-range input remains supported. Calculated days remain fixed snapshots.

Migration 005 appends `cancelledDates` and `calmCorrectionDates` defaults to nonlegacy journal snapshots. Already-cancelled requests keep their cancelled dates and outstanding corrections. Legacy monthly summaries stay unchanged. The migration runs under the existing write lock on the next authenticated write or scheduled reminder, never on GET. It preserves request IDs, hours, timestamps, versions, and active balances; no Calendar tagging occurs in this migration.

Per-date removal records the cancelled date while retaining all original calculated days for audit. Active totals and overlap checks exclude cancelled dates. A request stays active while any dates remain. Entered dates removed later are retained in the CALM correction set until confirmation. Calendar retries process every original date and skip already-absent cancellations. Notifications use the original recipient snapshot; one grouped email is sent per submission or removal, and the digest lists only dates needing action.

## External effects and recovery

Calendar event IDs derive deterministically from request ID and date. Each working day gets one event. Full days use exclusive next-day end dates; timed events include the configured timezone. New events include private `dayoffInstance` (Apps Script project ID), `dayoffId`, and `dayoffDate` tags. Every sync reads and verifies all existing target events before its first mutation. Updates/deletes require exact tags and an ETag, which is sent as `If-Match`. Concurrent changes fail closed. Duplicate insert conflicts are re-read and must pass the same check before a conditional patch. Non-404/410 read errors stop synchronization instead of being treated as absence. Categories remain private to the ledger and management email; Calendar notes contain hours, CALM status, and a reference. Extended properties are correlation metadata, not a confidentiality boundary.

Calendar completes before the chosen request email. The journal records email sending before MailApp and accepted afterward. An exception leaves unknown; process interruption can leave sending. Neither state is automatically resent. Confirm recipient receipt or consult a delivery trace. MailApp need not create a copy in Outlook Sent; absence there does not establish failure. Manually resend only after establishing non-delivery. Provider acceptance does not prove delivery.

Cancellation removes app-owned events and reverses personal usage. If CALM was entered, its correction stays outstanding. Cancellation notices follow the request’s stored email choice; no-email requests stay silent. Individual dates can be removed while preserving the request's other events and charges. Added dates or changed hours use a separate request. Older Calendar events lacking the new instance/date tags require a separately reviewed ownership migration and are never automatically adopted.

Reminder settings are stored privately in Script Properties. Schedule replacement creates the new trigger before deleting old ones. A script lock serializes digest attempts; an attempt marker is persisted before MailApp so failures and interruptions cannot cause an automatic same-day resend. Successful sends also record their local date and timestamp. Scheduled runs skip weekends and paused schedules. On-demand digests require an authenticated, single-use nonce.

## Access

Each deployment uses MYSELF access and executes as its deployer. Every handler also verifies the configured owner's effective identity. Coworkers deploy separately.

GET never changes CALM. Reminder links carry ID and revision, not authorization secrets. Confirmation uses authenticated RPC, a single-use expiring nonce, and a version check. Older links ask the owner to review the latest record.

The browser uses text nodes for record content. CSV exports escape formulas. Server-side checks validate configuration and request inputs. Raw provider errors, attendance payloads, tokens, and email contents are not logged.

## Limits

- Google email sender; Outlook requires another adapter.
- No CALM automation or official-balance verification.
- Historical daily markings cannot establish exact daily hours or CALM state.
- No inbound sync for manual Calendar edits or approval replies.
- One active fiscal year per populated ledger; a separate archive can hold many source years. Annual rollover uses a new instance.
- Apps Script scheduling is approximate and quota-limited.
- Mocked tests cannot establish actual account OAuth or Google service behavior.

A future departmental portal would need centrally managed identity, per-user authorization, and private storage. The domain and workflow modules can be retained.
