# Simple Finance v0.7.0

**Release date:** 2026-09-24
**Published:** pending — this block is completed at release (merge commit, tag, publish run, digest).
**Type:** feature release — **expected support gets a real start, a changeable day and an end** (SPEC §10.2,
decisions 120–121). A debt's expectation now pre-projects before the first payment arrives, follows its
recorded money, ends by itself on an until date, and appears on All Transactions as flagged, expected rows.
Borrowed money is still never income.
**One additive migration (`0008_debt_expected_inflow_until`), no backup-format change.**
**Previous published image:** v0.6.0 (`b0379eb`). Do not rewrite `docs/RELEASE_NOTES_v0.6.0.md` and do not
retag v0.6.0.

## What to do in Unraid

1. **Take a backup first** (Settings → Backup & restore). This release adds one nullable column to the
   debts table; migrations run automatically and are additive, but there is no downgrade path — the archive
   is the only way back.
2. Docker → the Simple Finance container → **Force Update**. This pulls
   `ghcr.io/dougalbob/simple-finance:latest`.
3. Start it and read the log. Expect the usual startup line, with `[entrypoint] applying database
   migrations...` applying `0008_debt_expected_inflow_until` before the server starts.
4. Confirm the version badge in the navigation reads **v0.7.0 · pre-release**, then open
   **Accounts & Pots** and set the loan's expectation (see below).

## What changed

**The family loan is now a plan the app can carry from before the first payment to after the last.** The
household's arrangement — £1,000 on the 10th each month for about five months while probate completes —
ran into three limits in v0.5.0's expectation: a brand-new debt (no movements, £0, nothing borrowed yet)
projected **nothing**, there was no way to say when the arrangement **ends**, and the projected month did
not give way when the Borrow was actually recorded. All three are fixed:

- **It projects before the first money moves.** A debt with no movements is *not* settled — it is exactly
  the debt the expectation exists for — so the payday panel and the horizon show the first payment as
  expected support from the day the expectation is set. Nothing about the estimate moves: the pot only
  moves when the Borrow is actually recorded.
- **The day can change mid-flight, forward-looking.** Move it from the 10th to the 13th and only what is
  still expected moves; months already recorded stay exactly as they were. The income cadence is unchanged
  — clamped to the month and shifted off a weekend onto the Friday before, so **Sat 10 Oct 2026 reads
  Fri 9 Oct** and **Sun 10 Jan 2027 reads Fri 8 Jan**.
- **It ends by itself.** An optional **until date** (with a “Fill the end date” helper: type 5 payments and
  the form computes the last date) makes the last payment the last projection — nothing appears from the
  following month. Recording the real Borrow silences that month's expectation immediately, and a debt
  that is actually settled (money in, repaid to zero) expects nothing at all.
- **It is visible in All Transactions.** On the due date an `EXP<` row appears — green, badged
  *expected — not recorded yet*, linking to the loan panel — so the next payment waits among the recorded
  history as the nudge to record it, and it gives way to the real `LN<` row the moment it does. Expected
  rows are deliberately **outside the totals**: the count line and the footer row say how many were shown
  and what they come to ("≈"), and the footnote says plainly that they are not counted, because nothing
  has moved.
- **It is visible in the forecast.** The payday panel lists "Expected support in this forecast (N)" with
  the dates and amounts it is counting, and the loan panel says whether the debt is *settled* or *expecting*
  (amount, day and end date).

**Never income, still.** No income checkbox, no Income-page rows, no insights, no `BAC`: an expectation is
a labelled plan, and the household total moves only when money really does — if the payment is late, the
books stay true and the panel is late with it.

**SPEC** §10.2 (the expectation's rules), §7.2/§7.6 (the window and the horizon), §15.3 (the `EXP<` rows)
and worked example **E11** are amended, with the decision log recording the rules in decisions **120–121**.

## Tests

- `npm test` — **335 tests across 84 suites** (was 323/81). New coverage: `tests/dates.test.ts` (the
  last-occurrence helper and the window edges around the weekend shift), `tests/horizon.test.ts` (plan →
  change the day → stop, five cases), `tests/money-view.test.ts` (the first payment before any Borrow, the
  day change, settling) and `tests/activity.test.ts` (`EXP<` appears, converts to `LN<`, pot scoping).
- The whole browser acceptance job runs in CI's `browser` job, which the agent sandbox cannot run (no
  browser there — `docs/SANDBOX.md` entry 2). The new spec is `e2e/transactions.spec.ts`: a brand-new debt,
  the expectation set on the Pots page, the `EXP<` row and footer, then the Borrow recorded and the row
  giving way to `LN<`.
- `npm run format:check`, `npm run typecheck`, `npm run build` and `npm audit --omit=dev` all clean.

## Version badge

Navigation should read **v0.7.0 · pre-release**.

## Release notes doc

This file: [`docs/RELEASE_NOTES_v0.7.0.md`](RELEASE_NOTES_v0.7.0.md).
