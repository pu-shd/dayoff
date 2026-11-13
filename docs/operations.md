# Operations

Configuration comes from the file selected by DAYOFF_CONFIG in the environment or private .env. The builder parses .env as data rather than executing it. Apps Script has no Node environment; local configuration is validated and bundled into ignored deployment output.

Set the Staff Calendar ID through `node scripts/configure.ts --calendar-id 'YOUR_STAFF_CALENDAR_ID'`, or supply the same flag to `./scripts/bootstrap-local.sh`. Both support `--dry-run`. This updates private configuration while retaining delivery mode, reporting recipients, allowances, and schedules. Run `./scripts/update.sh` to apply changes to the deployed app. Coworkers supply their own ID; no live organizational Calendar ID belongs in the public example.

Set management recipients through `node scripts/configure.ts --management-email 'manager@example.edu'`. Repeat the flag for multiple addresses; the supplied list replaces the previous list. This flag can be used alone, combined with `--calendar-id`, or passed through bootstrap. Use `--dry-run` first, then run the command without it and deploy with `./scripts/update.sh`. None of these configuration commands enables delivery or sends an email.

## Reconfiguration through the CLI

1. Preview a calendar or recipient change with `node scripts/configure.ts ... --dry-run`.
2. Apply it by repeating that command without `--dry-run`.
3. For schedules, lunch, holidays, allowances, owner identity, or delivery mode, edit the private JSON selected by `DAYOFF_CONFIG`. The dedicated CLI flags currently cover calendar and management recipients.
4. Run `./scripts/update.sh --dry-run` to review the deployment operation, then `./scripts/update.sh` to build, validate, push, and update the existing deployment ID.
5. Refresh the printed canonical web app URL and verify the preview. Configuration changes retain the existing private ledger. Changing the FY on a populated ledger is rejected; use the documented rollover process.

The configuration command's dry run validates input without writing. The deployment script's dry run describes its operations; the actual deployment performs full configuration validation before upload. A successful MailApp test does not automatically enable normal delivery or install reminders. Enable live delivery deliberately after recipient, calendar, schedule, and holiday checks, then enable the reminder trigger in the app.

For teardown, `./scripts/teardown.sh --dry-run` previews the operation and `./scripts/teardown.sh DEPLOYMENT_ID` pushes disabled-delivery source before removing that web deployment. The ledger is retained.

The owner-only MailApp diagnostic can run in preview mode via **Send test email to me**. It sends no attendance information and cannot target management or arbitrary recipients. Check mailbox receipt rather than relying solely on provider acceptance. The Apps Script CLI cannot always invoke functions on a default Cloud project; the authenticated web app is the supported fallback. Calendar and email diagnostics must not create real leave entries.

## First use

1. Deploy with delivery disabled.
2. Complete Google's runtime authorization if prompted.
3. Initialize the private ledger.
4. Compare imported category totals with the workbook.
5. Verify FY, opening balances, cap, accrual timing, schedules, lunch window, holidays, and rounding.
6. Preview full, half, academic partial, and summer partial requests.
7. Confirm Google is the intended sender and verify management recipients and the Staff Calendar ID.
8. Enable live delivery, then enable reminders.

Each employee configures their own reporting line. Do not share a personal deployment or ledger as a multiuser departmental resource.

## Recovery

Use Retry incomplete steps for pending Calendar work. Stable IDs prevent duplicate events.

For email unknown or sending, confirm recipient receipt or consult a delivery trace. MailApp need not populate Outlook Sent, so absence there does not prove non-delivery. Resend manually only after establishing non-delivery, then confirm receipt. Never create another request to work around an uncertain send.

CALM confirmation is saved before Calendar notes update. If that update fails, retry the Calendar operation; CALM remains confirmed.

A rejected request should be cancelled. Follow the correction reminder if it was already entered in CALM. Dayoff cannot change PeopleSoft itself.

Daily reminder deduplication is recorded after successful send acceptance. Process interruption around email delivery can still cause duplicate or missed reminders. The outstanding list remains visible in the app.

## Backups, teardown, and rollover

Export details and balances privately or copy the private Sheet in Drive. Never edit Journal rows manually. Exact legacy Excel layout export is not included.

Teardown first pushes disabled-delivery source so surviving triggers become inert, then removes the selected web deployment and retains the ledger. You can remove triggers in the app before teardown if desired.

For a new fiscal year, create a new instance with confirmed carryover/grants, cap, holiday dates, and schedules. Preserve the previous ledger for reports. Do not merely change the FY on a populated ledger.

A successor deploys their own app rather than inheriting OAuth tokens. Transfer a reviewed opening snapshot through normal private channels if needed.

## CLI limitations

Use the canonical web app URL printed by deployment, which is read from Google's deployment metadata. Workspace accounts can receive a domain-specific `/a/macros/DOMAIN/s/.../exec` address; do not replace it with a guessed generic URL.

If Google shows "Sorry, unable to open the file at this time," first use the canonical URL while signed into the deployment owner's account. For multi-account routing problems, try a private browser window signed into only that account, as described in [Google's troubleshooting guide](https://developers.google.com/apps-script/guides/support/troubleshooting#issues_with_multiple_google_accounts).

Google may show an unverified-app notice during first-use consent. The private app has not been submitted for public OAuth verification. Review the project/account and requested permissions before authorizing; deployment does not itself grant runtime consent. See [Google's authorization documentation](https://developers.google.com/apps-script/guides/services/authorization).

The Apps Script API creates, uploads and deploys source; it cannot grant runtime consent for you. Resolve administrator scope restrictions through normal Google administration. Do not make the web app anonymous to bypass consent.

Only source and generic examples belong in Git. Keep workbooks, imports, live settings, credentials, and build output private. Builds embed imported attendance data and must never be uploaded as public artifacts.

## Request preview and email choices

The preview presents dates, per-day hours, Calendar titles, and an exact email draft. New requests default to self so the owner can resend the copy to management. Select management to use the configured list or no request email to save silently. CALM reminders remain independent. Retries and cancellation use the stored recipient snapshot.

## CALM reminder controls

Use the CALM checklist to review entries and corrections before confirming completion in PeopleSoft. Choose an hour and enable weekday reminders; saving a new schedule replaces the previous trigger. Pause removes reminder triggers. The preferred hour persists privately across CLI deployments and overrides the configuration file’s default. If the configured timezone changes, save the reminder schedule again.

Send today’s reminder now produces the same digest, including all outstanding dates and hours, even when the recurring schedule is paused. Manual sends and scheduled sends share one-attempt-per-local-date protection. A successful result means MailApp accepted the email. If the outcome is uncertain, check the mailbox or delivery trace; another automatic attempt is allowed on a later weekday if CALM remains outstanding.

Migration 002 appends email-routing metadata without changing existing hours or balances. It runs on the next authorized write or scheduled reminder, never on GET. Old requests used management routing; their snapshot uses the management addresses configured at upgrade. New requests use self by default. No mail is sent by the migration.
