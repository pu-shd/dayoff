# Operations

Configuration comes from the file selected by DAYOFF_CONFIG in the environment or private .env. The builder parses .env as data rather than executing it. Apps Script has no Node environment; local configuration is validated and bundled into ignored deployment output.

Set the Staff Calendar ID through `node scripts/configure.ts --calendar-id 'YOUR_STAFF_CALENDAR_ID'`, or supply the same flag to `./scripts/bootstrap-local.sh`. Both support `--dry-run`. This updates private configuration while retaining delivery mode, reporting recipients, allowances, and schedules. Run `./scripts/update.sh` to apply changes to the deployed app. Coworkers supply their own ID; no live organizational Calendar ID belongs in the public example.

Set management recipients through `node scripts/configure.ts --management-email 'manager@example.edu'`. Repeat the flag for multiple addresses; the supplied list replaces the previous list. This flag can be used alone, combined with `--calendar-id`, or passed through bootstrap. Use `--dry-run` first, then run the command without it and deploy with `./scripts/update.sh`. None of these configuration commands enables delivery or sends an email.

## Reconfiguration through the CLI

1. Preview a calendar or recipient change with `node scripts/configure.ts ... --dry-run`.
2. Apply it by repeating that command without `--dry-run`.
3. For schedules, lunch, holidays, allowances, owner identity, or delivery mode, edit the private JSON selected by `DAYOFF_CONFIG`. Dedicated CLI flags cover calendar, management recipients, fiscal start, holiday files, and the HR system name.
4. Run `./scripts/update.sh --dry-run` to review the deployment operation, then `./scripts/update.sh` to build, validate, push, and update the existing deployment ID.
5. Refresh the printed canonical web app URL and verify the preview. Configuration changes retain the existing private ledger. Changing the FY on a populated ledger is rejected; use the documented rollover process.

The configuration command's dry run validates input without writing. The deployment script's dry run describes its operations; the actual deployment performs full configuration validation before upload. A successful MailApp test does not automatically enable normal delivery or install reminders. Enable live delivery deliberately after recipient, calendar, schedule, and holiday checks, then enable the reminder trigger in the app.

For teardown, `./scripts/teardown.sh --dry-run` previews the operation and `./scripts/teardown.sh DEPLOYMENT_ID` pushes disabled-delivery source before removing that web deployment. The ledger is retained.

The owner-only MailApp diagnostic can run in preview mode via **Send test email to me**. It sends no attendance information and cannot target management or arbitrary recipients. Check mailbox receipt rather than relying solely on provider acceptance. The Apps Script CLI cannot always invoke functions on a default Cloud project; the authenticated web app is the supported fallback. Calendar and email diagnostics must not create real leave entries.

## First use

1. Deploy with delivery disabled.
2. Complete Google's runtime authorization if prompted.
3. Read the setup warning and type `CREATE NEW LEDGER` to initialize a genuinely new installation.
4. Compare imported category totals with the workbook.
5. Verify FY, opening balances, cap, accrual timing, schedules, lunch window, holidays, and rounding.
6. Preview full, half, academic partial, and summer partial requests.
7. Confirm Google is the intended sender and verify management recipients and the Staff Calendar ID.
8. Enable live delivery, then enable reminders.

Each employee configures their own reporting line. Do not share a personal deployment or ledger as a multiuser departmental resource.

## Recovery

Use Retry incomplete steps for pending Calendar work. Stable IDs prevent duplicate events.

For email unknown or sending, confirm recipient receipt or consult a delivery trace. MailApp need not populate Outlook Sent, so absence there does not prove non-delivery. Resend manually only after establishing non-delivery, then confirm receipt. Never create another request to work around an uncertain send.

HR accounting system confirmation is saved before Calendar notes update. If that update fails, retry the Calendar operation; HR accounting system remains confirmed.

A rejected request should be cancelled. Follow the correction reminder if it was already entered in HR accounting system. Dayoff cannot change your HR accounting system itself.

Daily reminder deduplication is recorded after successful send acceptance. Process interruption around email delivery can still cause duplicate or missed reminders. The outstanding list remains visible in the app.

## Backups, teardown, and rollover

Ledger creation is blocked once this Apps Script project has a ledger binding. A repeated or stale setup call is rejected under the script lock before migrations, workbook seed imports or other ledger writes. There is no overwrite switch. If the ledger link is missing but schema/fiscal/history metadata remains, setup displays recovery guidance and blocks creation. An interrupted setup retains the binding as soon as the new Sheet ID is available; inspect and repair that same ledger rather than creating another one. A missing or changed Journal header blocks reads and new request records until that same ledger is repaired.

When recovering a workstation, clone the private configuration repo, run bootstrap, and sign in again with the existing account. Keep the original Apps Script project, deployment and Google Sheet. Do not delete Script Properties to bypass the creation guard. Git preserves configuration and original workbooks; the live journal and reminder state remain in Google. This guard protects application setup; it cannot prevent manual deletion or editing in Google Drive or the Apps Script editor.

Export details and balances privately or copy the private Sheet in Drive. Never edit Journal rows manually. Exact legacy Excel layout export is not included.

Teardown first pushes disabled-delivery source so surviving triggers become inert, then removes the selected web deployment and retains the ledger. You can remove triggers in the app before teardown if desired.

For a new fiscal year, create a new instance with confirmed carryover/grants, cap, holiday dates, and schedules. Preserve the previous ledger for reports. Do not merely change the FY on a populated ledger.

Set the annual boundary with `node scripts/configure.ts --fiscal-year-start '07-01'` or the same flag during bootstrap. `07-01` is the default; `MM-DD` must be a date that recurs every year. The FY label denotes the year in which the period ends. Choose another date only for a new instance or a reviewed migration. Migration 003 stores the existing ledger's boundary in Script Properties; a missing legacy setting is treated as July 1. It changes no attendance rows or balances. A workbook import declaring or implicitly using July 1 cannot be combined with another fiscal start.

A successor deploys their own app rather than inheriting OAuth tokens. Transfer a reviewed opening snapshot through normal private channels if needed.

## CLI limitations

Use the canonical web app URL printed by deployment, which is read from Google's deployment metadata. Workspace accounts can receive a domain-specific `/a/macros/DOMAIN/s/.../exec` address; do not replace it with a guessed generic URL.

If Google shows "Sorry, unable to open the file at this time," first use the canonical URL while signed into the deployment owner's account. For multi-account routing problems, try a private browser window signed into only that account, as described in [Google's troubleshooting guide](https://developers.google.com/apps-script/guides/support/troubleshooting#issues_with_multiple_google_accounts).

Google may show an unverified-app notice during first-use consent. The private app has not been submitted for public OAuth verification. Review the project/account and requested permissions before authorizing; deployment does not itself grant runtime consent. See [Google's authorization documentation](https://developers.google.com/apps-script/guides/services/authorization).

The Apps Script API creates, uploads and deploys source; it cannot grant runtime consent for you. Resolve administrator scope restrictions through normal Google administration. Do not make the web app anonymous to bypass consent.

Only source and generic examples belong in Git. Keep workbooks, imports, live settings, credentials, and build output private. Builds embed imported attendance data and must never be uploaded as public artifacts.

## Request preview and email choices

The preview presents dates, per-day hours, Calendar titles, and an exact email draft. New requests default to self so the owner can resend the copy to management. Select management to use the configured list or no request email to save silently. HR accounting system reminders remain independent. Retries and cancellation use the stored recipient snapshot.

## HR accounting system reminder controls

Use the HR accounting system checklist to review entries and corrections before confirming completion in your HR accounting system. Choose an hour and enable weekday reminders; saving a new schedule replaces the previous trigger. Pause removes reminder triggers. The preferred hour persists privately across CLI deployments and overrides the configuration file’s default. If the configured timezone changes, save the reminder schedule again.

Send today’s reminder now produces the same digest, including all outstanding dates and hours, even when the recurring schedule is paused. Manual sends and scheduled sends share one-attempt-per-local-date protection. A successful result means MailApp accepted the email. If the outcome is uncertain, check the mailbox or delivery trace; another automatic attempt is allowed on a later weekday if HR accounting system remains outstanding.

Migration 002 appends email-routing metadata without changing existing hours or balances. It runs on the next authorized write or scheduled reminder, never on GET. Old requests used management routing; their snapshot uses the management addresses configured at upgrade. New requests use self by default. No mail is sent by the migration.

## Multi-year attendance history

Use the directory import command in the README with one `fyYYYY...xlsx` source per year and the latest FY as `--anchor-fy`. The source files are never modified. The filename supplies the authoritative year even if the internal header is stale. The supported template is July–June. Keep the generated archive inside ignored `local/`, select it with `DAYOFF_HISTORY`, and deploy. No archive is required for an employee starting fresh.

Open the canonical app URL, refresh, expand **Attendance history**, and use **Import attendance history**. It is an authenticated write, required because `clasp run` is unavailable on many default Cloud projects. CLI deployment prepares the source; this action imports it into the existing private ledger. An interrupted import can be retried: unchanged year revisions are skipped. Review the year selector, raw markings, and carryover checks. An incomplete source remains incomplete even if some totals reconcile. Repeated data is retained per source year and flagged. The latest workbook anchors the collation without replacing live requests.

The `History` tab stores complete source-year snapshots in append-only rows. Do not manually edit it. Copy the private Sheet or retain the original workbooks and private archive for backup. Revised sources require rerunning the importer, redeploying, and choosing Import again; old revisions are preserved. Imports do not delete years missing from a subsequent folder. To remove history or replace active-year ledger entries, use an explicitly reviewed migration.

After importing, removing `DAYOFF_HISTORY` from configuration can reduce future bundle size without deleting saved history. The last imported anchor remains stored privately when the bundled source is removed. History exports contain source monthly usage and balances, not current live balances. Use the existing current-year balance export for management reconciliation against HR accounting system.

## Grouped dates and Calendar ownership

Use Add dates to create noncontiguous ranges in one request. Each range can be full, half, or partial, while category and recipient choice remain shared. Expand a request in Your record to see its calculated dates and individual Remove date controls. The saved request retains every calculated date; removing one restores only its hours. Entered HR accounting system dates require explicit correction confirmation after removal. Remaining dates preserve their entered status.

Migration 005 appends per-date cancellation defaults on the next authenticated write or reminder. It changes no original dates or charges and never tags Calendar events. New Calendar events carry the Apps Script project ID, request ID and date; updates and deletes require matching tags and conditional event versions. An event with missing or mismatched ownership tags is left untouched. A failed Calendar read does not authorize event creation or deletion. Resolve the conflict before retrying pending steps.

Older events with only `dayoffId` need a separate, reviewed ownership migration. Do not work around a conflict by creating a duplicate request, manually editing the Journal, or applying another instance's tags. Establish the event's original project and matching saved request first. This release deliberately provides no automatic claim-by-title/date/ID operation. A copied Apps Script project has a different identity and cannot adopt the old project's events. Keep the existing project for ordinary CLI updates.

## Holiday configuration and Calendar context

Set holidays with `node scripts/configure.ts --holidays-file PATH` (also accepted by bootstrap). The JSON array replaces the list; use --dry-run first. Dates must be unique, real ISO dates in the configured fiscal year. Review the public FY2027 Princeton preset's cited sources in the README before using it. Update your private configuration secret after a local change if using GitOps.

The native date picker allows date selection, while row validation rejects ranges with no working days. The form states the active holiday count or explicitly says none are configured. Newly configured holidays do not rewrite saved charges; review flagged active requests and remove incorrect dates through the app. The original monthly import remains the balance anchor.

Staff Calendar lookup starts after date entry pauses. It uses one bounded Calendar list request with recurring events expanded and a two-minute private Script Cache. Refresh bypasses that cache. Calendar mutation invalidates subsequent lookup keys. Preview and Save do not await availability results. No Calendar event data is logged or persisted to the attendance ledger.

## HR system display name

Use `node scripts/configure.ts --hr-system-name 'Timekeeping'`, or the same flag in bootstrap. It changes the private `hrSystemName` field while retaining other settings. Omit the field for the generic default, HR accounting system. Names must be nonempty single-line text of at most 80 characters. Deploy with the usual update command and update the private configuration secret when using GitOps. This changes display and message wording only; saved record keys, events' ownership tags, and installed trigger handlers remain compatible.
