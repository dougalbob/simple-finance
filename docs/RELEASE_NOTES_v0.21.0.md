# Release notes — v0.21.0 (one codebase, two homes: the phone till and the laptop dashboard)

**Published:** 2026-09-26 (tag pushed; Publish run `36257538054` passed; image verified in GHCR).
**Merge commit:** `4b177a5db2b756aa99d6188fd223199128f8c4c2` (PR #73; short SHA `4b177a5`)
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.21.0` ·
`ghcr.io/dougalbob/simple-finance:latest` · `ghcr.io/dougalbob/simple-finance:sha-4b177a5`
**Digest:** `sha256:dec7f9a26eaa914b33f93e52717867fdf417075899bad6aed98966ff36ceb346`, shared by all
three tags and different from v0.20.0's `sha256:1e0db60a775f85958342420926b327994bf90cd58d7564b85cfaaaf5c0a92de2`
(verified through `/users/dougalbob/packages/container/simple-finance/versions`).
**Version badge:** `v0.21.0 · pre-release`

## What changed

The phone and the laptop now lead somewhere different, and each screen says one thing. On a phone, `/` is
the till: what is available now, the till itself, the payday projection, what is due this week, and three
links — Charts, Purchases, Horizon. On a laptop, `/overview` stays the dense dashboard. Nothing has been
taken away: the panels that appeared twice moved to the page that owns them.

- **Overview** no longer repeats purchase review, transfers, Add a pot or checkpoints. The household money
  row, payday projection, quick entry, due this week, key dates, this month so far and vehicles stay.
- **Purchases** is the one place purchase rows are reviewed, edited, voided and given receipts (the supplier
  card keeps its own receipt control). Attaching or removing a receipt on Overview is gone with the rows.
- **Accounts & Pots** now carries **Transfers between pots** — the recent list with a void control, the same
  pattern the page already used for boundary money. All Transactions links a transfer row straight there
  (`/pots?transfer={id}#transfer-{id}`), and a transfer older than the twenty most recent is still found and
  shown at the top of the list. Recording a transfer is unchanged: Quick Entry → Move → Between pots.
- **Phone home** runs in the order it is used: available now → Quick Entry (the page still opens parked at
  the till) → payday projection → due this week → links to Charts, Purchases and Horizon. The recurring
  schedule dump, pot list, recent purchases table, key dates, Add a pot and checkpoint cards have left it.
- **Phone drawer** leads with Quick Entry · Purchases · Horizon · Charts · Overview · Recurring under
  **Daily**; everything else sits under **More**. There is still no tab bar, and the laptop navigation bar
  is unchanged — it lists every page.
- **Recurring on a laptop** reads as one row now: the calendar on the left with the compact projection
  figures under it, and the schedules panel beside it matched to the calendar's height, scrolling inside
  itself with **Add a schedule** pinned below and renewals underneath. On a phone the four stack unclipped.
  Tapping a schedule name on All Transactions still scrolls the list to that row.

No rule about money changed. Estimates, projections, warning tiers and record-keeping behave exactly as they
did in v0.20.0. The house rules behind the layout are decision **164** and SPEC **§15.1**, **§15.2**,
**§15.3** and **§23.4**, all updated where the old text described the old layout.

## How to use it

- **Phone:** open the app and you are at the till — available now at the top, the entry card right below it.
  Tap the drawer (☰) and the six daily pages come first; **More** holds the rest.
- **Laptop:** **Overview** is still the sit-down dashboard. To review a purchase, open **Purchases**. To
  void a transfer, open **Accounts & Pots** → **Transfers between pots**.
- **Deep links:** tapping a transfer on All Transactions lands on Accounts & Pots with that transfer
  highlighted; tapping a `DD` / `SO` row still lands on its schedule in Recurring.

## Schema and data

**None.** No schema change and no migration in this release — v0.21.0 uses the v0.20.0 database as-is, so
startup is unchanged and rolling back is a plain image change. Take a backup before updating all the same.

## Verification

Implementation gates (PR #72, merge commit `f598ead`): **506 automated tests** and **78 browser tests**
passed; TypeScript, formatting and the production build passed; that PR's CI passed all three jobs (gates,
browser, docker). This release PR (#73, merge commit `4b177a5`), changing only version metadata and
documentation, passed the same three jobs. [Publish run `36257538054`](https://github.com/dougalbob/simple-finance/actions/runs/36257538054)
built and smoke-tested the image before pushing it; GHCR's package-version API groups all three tags
under the digest above.

## Updating in Unraid

1. **Take a backup first:** Settings → Backup, or a consistent backup of the appdata directory with the
   container stopped. Keep the backup somewhere safe outside the container.
2. In Unraid, **Force Update** the Simple Finance container to pull the new `latest` image. If you pin
   versions, use `ghcr.io/dougalbob/simple-finance:v0.21.0`.

After updating, the version badge should read **v0.21.0 · pre-release**.

[Release notes document](https://github.com/dougalbob/simple-finance/blob/main/docs/RELEASE_NOTES_v0.21.0.md)
