# Release notes — v0.20.0 (monthly schedules can skip selected months)

**Published:** 2026-09-26 (tag pushed; Publish run `36246857266` passed; image verified in GHCR).
**Merge commit:** `2d4cb81b8c0a5819400c7eb6c58d1dea4732cbd1` (PR #70; short SHA `2d4cb81`)
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.20.0` ·
`ghcr.io/dougalbob/simple-finance:latest` · `ghcr.io/dougalbob/simple-finance:sha-2d4cb81`
**Digest:** `sha256:1e0db60a775f85958342420926b327994bf90cd58d7564b85cfaaaf5c0a92de2`, shared by all
three tags and different from v0.19.0's `sha256:596a0f8f9da86f9bc7b0f1f5674ce1ef6100dfa20ae8996dca48e24af8cc8937`
(verified through `/users/dougalbob/packages/container/simple-finance/versions`).
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
formatting and the production build passed. PR #70 and main CI on merge commit `2d4cb81` passed all
three jobs (gates, browser, docker). [Publish run `36246857266`](https://github.com/dougalbob/simple-finance/actions/runs/36246857266)
built and smoke-tested the image before pushing it; GHCR's package-version API groups all three tags
under the digest above.

## Updating in Unraid

1. **Take a backup first:** Settings → Backup, or a consistent backup of the appdata directory with the
   container stopped. Keep the backup somewhere safe outside the container.
2. In Unraid, **Force Update** the Simple Finance container to pull the new `latest` image. If you pin
   versions, use `ghcr.io/dougalbob/simple-finance:v0.20.0`.

After updating, the version badge should read **v0.20.0 · pre-release**.

[Release notes document](https://github.com/dougalbob/simple-finance/blob/main/docs/RELEASE_NOTES_v0.20.0.md)
