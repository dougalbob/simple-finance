# Simple Finance v0.3.0

**Release date:** 2026-09-23
**Published:** _to be completed after the publish run — merge commit, short SHA, publish run id and
image digest._
**Type:** feature release. One new page: **All Transactions** (`/transactions`) — a read-only,
one-pot activity view. **No schema change, no migration, no backup-format change.**
**Previous published image:** v0.2.1. Do not rewrite `docs/RELEASE_NOTES_v0.2.1.md` and do not retag
v0.2.1.

## What to do in Unraid

1. Take a backup first (Settings → Backup & restore). There is no migration in this release, so this
   is the standard "a fresh archive before any update" habit.
2. Docker → the Simple Finance container → **Force Update**. This pulls
   `ghcr.io/dougalbob/simple-finance:latest`.
3. Start it and read the log. Expect `starting Simple Finance on port 3000 as 99:100` with no
   migration step (none exists in this release).
4. Confirm the version badge in the navigation reads **v0.3.0 · pre-release**, and that
   **All Transactions** appears in the menu between Purchases and Recurring.

If the badge reads v0.3.0 and your data looks as you left it, the update succeeded.

## What changed

**New page: All Transactions** (`/transactions`), built from the household's hand-drawn sketch. Pick
one account or cash pot and a date range; the page lists every movement that touched that pot in the
window, newest first:

- **One amount column, coloured by direction** — green is money into the selected pot, red is money
  out, with a `+`/`−` sign as well as the colour. One pot→pot transfer is therefore red on the pot it
  left and green on the pot it reached, from the same record.
- **Compact type codes** from the sketch: `PUR` (purchase), `DD` (direct debit), `SO` (standing
  order), `REF` (refund), `TX<`/`TX>` (transfer in/out, internal or across the boundary), `LN<`/`LN>`
  (borrowing/repayment), `SW<`/`SW>` (swap legs, with a badge naming the paired leg and pot). `POS`
  and `BYP` are deliberately not used: purchases carry no payment channel, and no channel field was
  added. `BAC` (income) is reserved — see "not in this release".
- **Source, category and note cells** sourced from the original record: the supplier (or the other
  pot's label, or the counterparty), the allocation's `Parent / Child (Target)` — a split shows its
  first line and "+N more" — and the record's own note field.
- **Checkpoints render as divider rows** carrying the *reported* figure, visually distinct and
  excluded from the totals.
- **Date column is date-only `YYYY-MM-DD`**, as chosen by the household: a record entered without a
  time carries an end-of-day marker as its instant, so printing that instant would show a `23:59`
  that never happened.
- **Filters:** the target pot, a start/end date pair, and quick picks — Last 30 days (the default),
  Since last checkpoint, This month.
- **Deep links from every row** to the record's canonical page: purchases to their filtered row on
  `/purchases`, direct debits and standing orders additionally to their schedule on `/recurring`,
  transfers to `/overview` and boundary money to `/pots`. New anchors (`#purchase-{id}`,
  `#transfer-{id}`, `#external-{id}`) and `?transfer=` / `?external=` parameters mean a link lands on
  the record itself even when it has fallen out of that page's recent list.
- **Read-only, by construction:** the page renders no form and cannot create, edit or void anything.
  Voided records are not listed. Corrections happen where they always did.

**Honest totals.** The footer reads **"Movements shown"** — the sum of the rows above — and says
plainly that it is not the change in the pot's estimate: voided records are invisible here, and a
date-only credit on a checkpoint's own day is treated as already counted by the estimate (SPEC
§7.1). Refunds *are* shown, as green `REF` rows, because a refund is already just a purchase with a
negative total and the estimate counts it.

Everything else in the app is unchanged. `docs/SPEC.md` gains §15.3 and a menu-table row;
`docs/IMPLEMENTATION_PLAN.md` gains decisions 101–108.

## Tests

- `npm test` — **286 tests across 76 suites** (was 279/75). The 7 new tests exercise the projection
  directly: every record family and its code, sign relative to the selected pot, void exclusion,
  income exclusion, date-window edges, checkpoint divider placement, the split "+N more" summary, the
  500-row cap with an exact hidden-row count, and the rule that a pot with records cannot be archived
  (which is what makes offering live pots only safe).
- New browser project **`transactions`** (`e2e/transactions.spec.ts`, 3 specs) covering the
  projection on real pages, the red-out/green-in pair for one transfer, and the purchase deep link.
  It runs in CI's `browser` job; it was not run in the agent sandbox (no browser there).
- `npm run format:check`, `npm run typecheck`, `npm run build` (16 routes) and
  `npm audit --omit=dev` (0 vulnerabilities) all clean. A dev-server smoke test against seeded
  fictional data rendered the page, the checkpoint divider, both sides of a transfer, and both
  deep-link anchors.

## Schema / data notes

- **No schema change and no migration.** The page is a projection of the records that already exist:
  `purchases`, `transfers`, `external_movements` and `checkpoints`. Nothing new is written by it.
- No change to the backup archive format (still format 2).
- No new receipts, purchases or real financial data in code, tests or documentation; the seed and the
  browser specs use the fictional household only (SPEC §19, §23.3).

## What is not in this release

- **Income rows.** `BAC` is reserved. Income can only enter the app by schedule conversion today —
  there is no manual income entry and no income list — so the sketch's income row needs an income
  feature of its own, not a display tweak. A one-off credit from a third party is recorded as other
  money in and appears as `TX<` with its counterparty.
- **No running balance.** Every pot balance is checkpoint-based, so any running figure would be
  relative to the last checkpoint only (deferred, not rejected).
- **No purchase channel field**, so no `POS`/`BYP` split.
- **No statement import or bank reconciliation** — still an explicit non-goal (SPEC §2). This page
  lists the household's own records, not a bank's lines.
- `docs/RELEASE_PROCESS.md` is deliberately untouched.

## Version badge

Navigation should read **v0.3.0 · pre-release**.

- **Version `0.3.0`** in `package.json`, `package-lock.json` (root `version` and `packages[""]`),
  `src/lib/version.ts` and `simple-finance.xml`.

## Release notes doc

This file: [`docs/RELEASE_NOTES_v0.3.0.md`](RELEASE_NOTES_v0.3.0.md).
