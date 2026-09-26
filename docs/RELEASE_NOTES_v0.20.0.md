# Release notes — v0.20.0 (monthly schedules can skip selected months)

**Publication status:** Prepared; awaiting merge, passing main CI and image publication.
**Merge commit, image digest and published date:** To be recorded after verification.
**Planned image tags:** `ghcr.io/dougalbob/simple-finance:v0.20.0` · `latest` · `sha-<merge short SHA>`
**Version badge:** `v0.20.0 · pre-release`

## What changed

Monthly schedules can now exclude selected calendar months every year. A ten-payment-year direct
debit stays **monthly**: select February and March as months with no payment, and the schedule expects
payments from April through January without needing to stop and reopen it each year.

- Add and Edit share one compact **Select any months with no payment** disclosure. It starts closed,
  showing only the selected month names (or “none”), with the same native marker and small summary
  styling as Horizon. Opening it reveals twelve labelled checkboxes in a responsive grid.
- The control appears only for monthly schedules, including direct debits, standing orders and expected
  income. Dedicated Income forms use the same control.
- Next-due dates, generated payments, calendars and instance-backed forecasts respect the exclusions.
- Existing schedules keep their current cadence until you choose exclusions. At least one payment
  month must remain. Switching to annual clears exclusions on save.
- Edits apply to future instances; recorded payments and past due instances awaiting conversion remain
  intact. Moving the start earlier still backfills under the saved cadence, respecting skipped months.
- For income, exclusions refer to the configured month, **before** weekend adjustment. An August
  payday on July's final Friday is still an August payment.

This changes the app's expectations only; it never changes a bank instruction.

## How to use it

Open **Recurring payments → your schedule → Edit schedule**. Keep Frequency set to Monthly, open
**Select any months with no payment**, select February and March, then save. The closed summary will
read **Select any months with no payment: February, March**. The same control is available when adding
a schedule.

## Schema and data

Migration **0011_schedule_excluded_months** adds a JSON list of excluded calendar months to schedules,
with an empty-list default. It runs automatically on container startup. Existing schedules keep their
cadence; the migration does not rewrite instances, purchases or receipts. Older-backup migration and
restore are tested. Take a backup before updating; do not downgrade an upgraded database in place—use
a compatible pre-update backup if rollback is needed.

## Verification

Implementation gates: **506 automated tests** and **76 browser tests** passed locally; TypeScript,
formatting and the production build passed. Release PR/main CI and publication results will be recorded
when complete.

## Updating in Unraid

1. **Take a backup first:** Settings → Backup, or a consistent backup of the appdata directory with the
   container stopped. Keep the backup somewhere safe outside the container.
2. In Unraid, **Force Update** the Simple Finance container to pull the new `latest` image. If you pin
   versions, use `ghcr.io/dougalbob/simple-finance:v0.20.0`.

After updating, the version badge should read **v0.20.0 · pre-release**.

[Release notes document](https://github.com/dougalbob/simple-finance/blob/main/docs/RELEASE_NOTES_v0.20.0.md)
