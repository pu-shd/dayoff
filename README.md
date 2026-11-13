# Dayoff

Enter leave once, add it to the Google Staff Calendar, email your manager, and see your running balances. CALM remains the official record: Dayoff sends reminder emails until you confirm entry or correction.

This is a small Google Apps Script web app. Each employee deploys an **owner-only instance** with their own private Google Sheet, calendar permissions, management recipients, and leave policy. No shared employee database or always-running server is required.

## Features

- Full days, fixed-charge half days, and partial days with lunch overlap deducted.
- Multiple noncontiguous date ranges in one request, with individual date removal.
- Effective-dated schedules, holidays, and configurable fiscal years (July–June by default).
- Monthly capped vacation accrual; sick and personal allowances.
- Separate used, planned, currently available, and projected balances.
- Standard calendar titles, absence intervals, hours, and CALM status in notes.
- Request emails defaulting to self, with management and no-email options.
- Weekday reminder digests with authenticated confirmation links.
- Cancellation and CALM correction tracking.
- Private workbook import and details/balance CSV exports.
- Private multi-year attendance archive with raw daily markings and carryover checks.
- Preview mode that creates no records, calendar events, or emails.
- CLI deployment, containerized tests, lint, formatting, types, and CI.

## Install your own instance

Requirements: macOS with zsh (or zsh on Linux), Node.js 24.11.1+, Docker, `docker-compose`, and a Google account allowed to use Apps Script and edit your Staff Calendar. The optional importer uses Python 3.13+ and a project-local `.venv`; `uv` manages its locked development dependencies.

```sh
git clone https://github.com/pu-shd/dayoff.git
cd dayoff
./scripts/bootstrap-local.sh \
  --calendar-id 'YOUR_STAFF_CALENDAR_ID' \
  --management-email 'manager@example.edu'
```

The bootstrap command sets the supplied Calendar ID in private configuration and preserves existing settings when re-run. Review it first with `./scripts/bootstrap-local.sh --calendar-id 'YOUR_STAFF_CALENDAR_ID' --dry-run`. To change the ID later without reinstalling dependencies:

```sh
node scripts/configure.ts --calendar-id 'YOUR_STAFF_CALENDAR_ID' --dry-run
node scripts/configure.ts --calendar-id 'YOUR_STAFF_CALENDAR_ID'
./scripts/update.sh
```

Set or replace management recipients without changing the calendar or delivery mode:

```sh
node scripts/configure.ts --management-email 'manager@example.edu' --dry-run
node scripts/configure.ts --management-email 'manager@example.edu'
./scripts/update.sh
```

Repeat `--management-email` to supply multiple recipients. Each invocation replaces the entire recipient list; it does not append to the old list. Calendar and management flags can be combined, and bootstrap accepts both flags too.

The command follows `DAYOFF_CONFIG` in the environment or `.env`, defaulting to `local/config.json`. It also accepts `--config PATH`. Use the Calendar ID from Calendar settings, not a sharing URL. Live IDs and recipient addresses are not printed in logs or written into source files.

Edit `local/config.json` to configure your **owner email**, **display name**, FY, allowances, schedules, holidays, and reminder hour. Every employee can have different management recipients and reporting lines. Connection flags preserve these existing settings.

Keep `delivery: "disabled"` for your first trial. All amounts are integer hundredths of an hour: 725 means 7.25 hours and 363 means 3.63 hours. Example schedule transition dates and the lunch window are placeholders; replace them with your actual dates and lunch period.

The annual rollover date defaults to July 1 and is configurable as `fiscalYearStart` in `MM-DD` format. Set it during setup with `--fiscal-year-start '07-01'`, which works with both bootstrap and `node scripts/configure.ts`. For example, `10-01` gives FY2027 the period October 1, 2026–September 30, 2027; `01-01` makes FY2027 the 2027 calendar year. Date inputs, validation, and balance reports follow this setting. Monthly accrual still posts at calendar month-end.

Choose the date before initializing a ledger. An initialized ledger retains its fiscal boundaries. Annual rollover remains an explicit new-year setup with reviewed carryover; changing the configured date does not move existing records or automatically open another year. The legacy workbook importer supports its July–June layout and rejects a conflicting fiscal start at build time.

Optional workbook import:

```sh
.venv/bin/python scripts/import_workbook.py "your attendance.xlsx" --fy 2027 --output local/legacy.json
```

The explicit FY overrides stale internal year labels. Opening balances and allowances from the import override matching configuration fields. If you have no workbook, remove `DAYOFF_IMPORT` from `.env`. The importer validates cached monthly amounts against annual totals; recalculate and save in Excel first if caches are missing or stale.

Authenticate and deploy using the pinned CLI:

```sh
npx --no-install clasp login
./scripts/test.sh
./scripts/deploy.sh --dry-run
./scripts/deploy.sh
```

Open the printed `/exec` URL, complete Google's first-use OAuth consent if required, and choose **Create private ledger**. Creation, source upload, and versioned deployment happen through the CLI. No editor copy/paste is needed. Administrators may need to permit Apps Script; enable API access at https://script.google.com/home/usersettings if requested.

CLI authorization and runtime authorization are separate. Google can require browser consent even for a CLI-built deployment. `clasp run` needs additional API-executable/Cloud-project setup and is not required by this app.

## Enable live delivery

The first adapter sends using Google `MailApp` as the deploying Google account. MailApp is a sending service separate from Gmail; Google documents that it can send for accounts that do not use Gmail. An Outlook-provisioned account may therefore work, subject to its organization's configuration. This does **not** send through Microsoft 365. See [Google's explanation](https://workspace.google.com/blog/product-announcements/change-to-mail-service-in-apps-script).

While delivery is disabled, use **Send test email to me** under CALM reminders. The test sends only to the configured owner and creates no leave request or Calendar event. It requires a fresh confirmation nonce and permits one attempt per minute. A success means MailApp accepted the message; confirm actual arrival in your normal mailbox, including Junk. If it fails or does not arrive, retain preview mode while a Microsoft 365 adapter is configured.

Verify the sender, management recipients, Calendar ID, schedules, holidays, and policy. Set `delivery: "google"` locally and run `./scripts/update.sh`. Preview shows a request summary, daily hours, Calendar title, and the exact email draft. Entering the first date fills the last date automatically; it follows the first date until you enter an explicit last date. Leaving the last date blank at preview uses the first date. Nothing is saved or sent until you choose Save.

The header combines readiness and delivery mode into one badge. Routine preview instructions stay with the preview.

Use **Add dates** for additional date ranges in a single submission, such as three days followed by a gap and one more day. Each row has its own length, dates, and optional absence times; the leave type and email choice apply to the whole request. Remove an unsaved range before preview if needed. Up to 32 ranges are supported, with each working date appearing once. Weekends and configured holidays are excluded per row. Duplicate dates are rejected before anything is saved.

Saving sends one chosen request email and creates one Calendar event per working date. All dates share a CALM confirmation and reminder entry, with every date and its hours listed. **Remove date** restores only that date's personal allowance and removes only its owned Calendar event. **Cancel all remaining dates** cancels the rest. A removal sends one update through the original email choice. Dates removed after CALM confirmation remain on the checklist as specific corrections; remaining dates keep their entered status. Changed hours or added dates after saving require a separate request.

Request email defaults to **Email me a copy to resend**. You can instead select **Email the configured management recipients** or **No request email**. Saving always records the leave and updates Calendar; CALM tracking works with all three email choices. Each request retains its recipient choice for retries and cancellation notices. A new request defaults to self again.

## Calendar event ownership

Every new event is tagged with the Apps Script project ID, request ID, and date in Calendar private extended properties. The project ID stays stable across CLI deployments. Before updating or deleting events, the adapter checks all dates in that request, then uses `If-Match` with the retrieved event version for each mutation. Missing/mismatched tags, read failures, and concurrent changes stop the operation; a duplicate event ID alone never authorizes an update. Existing unrelated event information is preserved. See [Google's extended-property guide](https://developers.google.com/workspace/calendar/api/guides/extended-properties) and [conditional updates](https://developers.google.com/apps-script/advanced/calendar).

**Events created by older versions have only a request tag. They are left untouched by the new ownership guard.** Updating/cancelling those events requires a separately reviewed migration that establishes their origin and adds the instance/date tags. This release does not claim events automatically from a matching title, date, or ID. If the check stops a saved change, its Calendar work remains pending and no request/update email is sent until synchronization succeeds. Review the event before retrying; unrelated events must remain unmodified. Tags are metadata, not a secrecy or authorization boundary against other Calendar editors.

## CALM checklist and reminders

The CALM section lists outstanding entries and corrections with dates, category, and hours. After updating PeopleSoft, choose **Confirm entered in CALM** or **Confirm CALM corrected**. Reminder links open and highlight the record for review; following a link never marks it entered. Older links ask you to review the latest revision.

Choose a reminder hour and select **Enable weekday reminders**. The app retains this setting privately, replacing previous reminder triggers so only one schedule remains. Delivery occurs around that hour in your configured timezone, Monday–Friday. Use **Update reminder schedule** to change the hour, **Pause reminders** to stop the schedule, or **Send today’s reminder now** for an on-demand digest. The section shows the last successful send and uncertain outcomes.

Digests go only to your owner email, independently of request-email choices. They include every outstanding date and its hours. No digest is sent when the checklist is empty. At most one digest is attempted per local date; uncertain sends are not automatically repeated that day. A cancellation after CALM entry remains on the correction checklist until you confirm it.

## Balances and imported history

Vacation information uses light blue, sick uses pea green, and personal uses purple across balance cards, history columns, request previews, records, and the CALM checklist. Category names remain visible alongside the colors.

Current vacation includes accrual through completed months. FY-end projection includes future accrual and planned usage, applying the cap each month after usage. CALM confirmation is a personal assertion, not verification against PeopleSoft.

Imports preserve **monthly totals**, not guessed daily hours. Charges are assigned to month-end; balances within an imported month are approximate. Imported CALM state is unverified, and historical summaries create no reminders or calendar/email activity. Avoid re-entering requests already included in those totals, especially future bookings.

Initialize the starting snapshot once. Redeploying the same import is idempotent. Changing an imported month's contents does not overwrite its existing record; corrections require a reviewed migration. Do not manually edit the Journal.

For a folder of past workbooks named `fyYYYY...xlsx`, collate a separate private archive:

```sh
.venv/bin/python scripts/import_workbook.py \
  --source-directory '/path/to/attendance workbooks' \
  --anchor-fy 2027 --output local/attendance-history.json
```

Add `DAYOFF_HISTORY=local/attendance-history.json` to your private `.env`, then run `./scripts/update.sh`. Refresh the app and select **Import attendance history**. This authenticated action imports the configured years without sending mail, creating Calendar events, or changing current-year charges or balances. Importing the same archive again is safe. Deployment alone does not import it.

**Attendance history** shows each year's monthly usage, cached closing balances, raw dated markings, source legend, and CSV totals. Each month in **Monthly source figures** links to that month on the configured target calendar in a new tab, using the configured timezone. The link uses Google's calendar viewer and retains its existing access permissions; sign into an account with access to that calendar. See [Google Calendar sharing and viewer guidance](https://support.google.com/calendar/answer/41207). It starts with the latest workbook as the balance anchor and checks earlier closing balances against the following year's opening and carry cap. Caps can prevent a unique reverse balance; discrepancies remain visible rather than rewriting sources. No daily hours or CALM status are inferred from letter codes. Incomplete filenames, repeated daily/monthly data, stale internal year labels, and invalid-date markings are flagged. The archive is a source transcription, not proof that each year's contents were independently verified. No combined lifetime tally is shown when repeated source data could inflate it.

The anchor is the most recent source FY, independent of the active ledger's FY. A snapshot for the active FY remains the original workbook view; current balances above it continue to reflect live requests. Changed archive sources append a new revision in the private Sheet's `History` tab, retaining prior revisions. Removing a source file does not delete saved history. Archive imports use the legacy template's July–June dates; the active ledger can use another configured fiscal boundary. See [operations](docs/operations.md) for recovery and [GitOps](docs/gitops.md) for optional private archive secrets.

Remove individual dates or cancel all remaining dates from Your Record. Create a separate request to add dates or change hours/category. Manual Calendar edits are not imported. Full-day policy is independent of elapsed office hours: 8:45–5 minus 45 minutes is 7.5 hours, but the configured full day is 7.25. Two half days can total 7.26; choose Full day for a whole-day absence and confirm rounding rules with your organization.

## Development

```sh
npm ci
npm run check
uv sync --locked
uv run ruff check scripts/import_workbook.py tests/test_import_workbook.py
uv run mypy scripts/import_workbook.py tests/test_import_workbook.py
uv run python -m unittest discover -s tests -p 'test_*.py' -v
./scripts/test.sh
```

Docker and CI run named tests, mocked Google integrations, lint, format, type checks, and production bundling. A real account still needs first-use consent and a live trial.

Updates reuse `local/deployment.json` to keep reminder URLs stable. Teardown pushes disabled-delivery source before removing the web deployment, making retained triggers inert and keeping the private ledger.

Workbooks, `local/`, `.env*`, credentials, deployment IDs, and bundles are ignored. **The generated bundle contains your private settings and imported data; never publish it as a release or CI artifact.** The source workbook is unchanged.

See [architecture](docs/architecture.md), [operations](docs/operations.md), and [CLI/GitOps](docs/gitops.md). MIT licensed.
