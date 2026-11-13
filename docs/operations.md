# Operations

Configuration comes from the file selected by DAYOFF_CONFIG in the environment or private .env. The builder parses .env as data rather than executing it. Apps Script has no Node environment; local configuration is validated and bundled into ignored deployment output.

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

For email unknown or sending, check Sent mail. If absent, manually send the intended message, then confirm its presence. Never create another request to work around an uncertain send.

CALM confirmation is saved before Calendar notes update. If that update fails, retry the Calendar operation; CALM remains confirmed.

A rejected request should be cancelled. Follow the correction reminder if it was already entered in CALM. Dayoff cannot change PeopleSoft itself.

Daily reminder deduplication is recorded after successful send acceptance. Process interruption around email delivery can still cause duplicate or missed reminders. The outstanding list remains visible in the app.

## Backups, teardown, and rollover

Export details and balances privately or copy the private Sheet in Drive. Never edit Journal rows manually. Exact legacy Excel layout export is not included.

Teardown first pushes disabled-delivery source so surviving triggers become inert, then removes the selected web deployment and retains the ledger. You can remove triggers in the app before teardown if desired.

For a new fiscal year, create a new instance with confirmed carryover/grants, cap, holiday dates, and schedules. Preserve the previous ledger for reports. Do not merely change the FY on a populated ledger.

A successor deploys their own app rather than inheriting OAuth tokens. Transfer a reviewed opening snapshot through normal private channels if needed.

## CLI limitations

The Apps Script API creates, uploads and deploys source; it cannot grant runtime consent for you. Resolve administrator scope restrictions through normal Google administration. Do not make the web app anonymous to bypass consent.

Only source and generic examples belong in Git. Keep workbooks, imports, live settings, credentials, and build output private. Builds embed imported attendance data and must never be uploaded as public artifacts.
