# Dayoff

Enter leave once, add it to the Google Staff Calendar, email your manager, and see your running balances. CALM remains the official record: Dayoff sends reminder emails until you confirm entry or correction.

This is a small Google Apps Script web app. Each employee deploys an **owner-only instance** with their own private Google Sheet, calendar permissions, management recipients, and leave policy. No shared employee database or always-running server is required.

## Features

- Full days, fixed-charge half days, and partial days with lunch overlap deducted.
- Effective-dated schedules, holidays, and July–June fiscal years.
- Monthly capped vacation accrual; sick and personal allowances.
- Separate used, planned, currently available, and projected balances.
- Standard calendar titles, absence intervals, hours, and CALM status in notes.
- Management emails with configurable recipients and accurate CALM wording.
- Weekday reminder digests with authenticated confirmation links.
- Cancellation and CALM correction tracking.
- Private workbook import and details/balance CSV exports.
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

Verify the sender, management recipients, Calendar ID, schedules, holidays, and policy. Set `delivery: "google"` locally and run `./scripts/update.sh`. Creating a request in live mode explicitly records it, updates Calendar, and sends management email. Preview never sends.

Enable daily reminders in the app. One weekday digest goes to your owner email around the configured hour. Links open the record for review; they never mark CALM entered merely by being followed. Confirm after actually entering CALM. A cancellation after CALM entry remains on the correction checklist until confirmed.

## Balances and imported history

Current vacation includes accrual through completed months. FY-end projection includes future accrual and planned usage, applying the cap each month after usage. CALM confirmation is a personal assertion, not verification against PeopleSoft.

Imports preserve **monthly totals**, not guessed daily hours. Charges are assigned to month-end; balances within an imported month are approximate. Imported CALM state is unverified, and historical summaries create no reminders or calendar/email activity. Avoid re-entering requests already included in those totals, especially future bookings.

Initialize the starting snapshot once. Redeploying the same import is idempotent. Changing an imported month's contents does not overwrite its existing record; corrections require a reviewed migration. Do not manually edit the Journal.

Cancel and recreate a request to change dates, hours, or category. Manual Calendar edits are not imported. Full-day policy is independent of elapsed office hours: 8:45–5 minus 45 minutes is 7.5 hours, but the configured full day is 7.25. Two half days can total 7.26; choose Full day for a whole-day absence and confirm rounding rules with your organization.

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
