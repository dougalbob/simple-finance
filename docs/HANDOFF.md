# Handoff — Expected support: a real start, a changeable day and an end (v0.7.0)

Date: 2026-09-24. Branch: `arena/01a0d490-simple-finance` (from `main` @ `102570a`, post-v0.6.0 and its
release).

**This session turns a debt's expected inflow into a plan the household can live with** — SPEC §10.2, §7.2,
§7.6, §15.3 and §17 E11 amended, decisions **120–121**. It answers the three gaps the household hit in
v0.5.0's expectation: a brand-new debt (no movements, £0) projected nothing at all; there was no way to say
when the arrangement ends; and the projected month did not give way to the money when it was actually
recorded. The real arrangement behind it: **£1,000 on the 10th for about five payments while probate
completes**, released before the first payment (Fri 9 Oct 2026) so it pre-projects.

## What changed

- `drizzle/0008_debt_expected_inflow_until.sql` **(new)** + journal entry — additive nullable
  `debts.expected_inflow_until_date`. **No backup-format change**, no data rewrite. `tests/backup-restore`
  counts migrations: bump the number whenever a migration is added.
- `src/lib/records/debts.ts` — the expectation's rules, all in `expectedInflowOccurrences`:
  **settled stops** (movements exist and `debtBalance` ≤ 0 ⇒ nothing; a debt with **no** movements is *not*
  settled and projects — the v0.5.0 gap); **until inclusive** (compared against the *configured*, unshifted
  date); **an answered month stops projecting** (`OCCURRENCE_ANSWER_LEAD_DAYS = 2` before the expected date
  up to the next occurrence — a live money-in *is* that month's money). `expectedInflowPotId` replaces
  `firstMovementPotOf`: the most recent **live** movement's pot, else the household default (the pot labelled
  `Main account`, else the first live pot), so a not-started debt's expectation still has an honest home.
  `editDebt` persists `untilDate` under the existing version check.
- `src/lib/records/dates.ts` — `lastOccurrenceDate(dayOfMonth, fromDate, count)`: the Nth clamped monthly
  occurrence after `fromDate` (1–240; null on bad input). Form helper only — no read model uses it. The
  **window rule** in `incomeOccurrencesBetween` is refined: an occurrence counts when its configured **or**
  its shifted date falls in `(after, through]`, and the month loop runs one month past `through` (December
  wraps) so a 1st/2nd-of-month payment shifting back into the window is found.
- `src/lib/records/money-view.ts` — both read models take the pot from `expectedInflowPotId`, so a
  not-started debt projects; `firstMovementPotOf` is gone. `src/lib/records/activity.ts` — `EXP<` rows
  (family `expected`), always money in, `sortAt = endOfLocalDate(dueDate)`, skipped for months before
  `plannedFrom` (the local date of the debt's last edit), and **outside the totals**:
  `expectedRowCount` / `expectedInPence` carry them.
- UI — `src/app/transactions/page.tsx` (count line, "Expected support (N expectations, not counted)" footer
  row, footnote, empty state); `src/app/overview/projection-panel.tsx` ("Expected support in this forecast
  (N)" from the `expected`-flagged receipt lines); `src/app/pots/page.tsx` (per-debt status: *settled* vs
  *expecting*, `id="debt-{id}"` anchor for the All-Transactions link); `src/components/external-forms.tsx`
  (`DebtEditForm`: day, optional until date, "Fill the end date" from a payment count, status line).

## Watch out for (learned this session)

- **Never income, never an estimate move** (decision 116 and the v0.5.0 notes hold unchanged): no income
  checkbox, no Income-page rows, no insights, no `BAC`; the pot moves only when the Borrow is actually
  recorded, and the expectation is only ever flagged `expected`.
- **One source of truth for occurrences.** Both read models (`money-view.ts`, `activity.ts`) call the same
  `expectedInflowOccurrences`; fix the rule there, never in a caller.
- Do not "simplify" the window membership back to the configured date alone: the first payment (Sat 10 Oct
  2026 → **Fri 9 Oct**) must count in a window ending on the Friday, and a configured 1st must be able to
  shift back into the previous month.
- **The expectation is a plan, not a promise**: no late month is flagged, the next month still projects, and
  a day-of-month or until-date edit is forward-looking — recorded movements are never rewritten.
- If you add a family to the All-Transactions table, keep the expected rows out of `inPence`/`outPence` and
  update the count line, the totals row and the footnote together, or the page stops being honest about what
  it excludes.
- The e2e spec derives the server's own today from the End-date input's `max` (the window never reaches into
  the future) instead of trusting the browser clock — reuse that pattern in any date-sensitive spec.

## Test state

`npm test` — **335 tests, all green, 84 suites** (was 323/81). New coverage: `tests/dates.test.ts`
(`lastOccurrenceDate` + the window edges), `tests/horizon.test.ts` (plan → change the day → stop, 5 tests),
`tests/money-view.test.ts` (the first payment pre-Borrow, the day change, settling), `tests/activity.test.ts`
(`EXP<` appears, converts to `LN<`, pot scoping). `npm run format:check`, `npx tsc --noEmit` and
`npm run build` are clean. Playwright cannot run in this sandbox (`docs/SANDBOX.md` entry 2) — CI's
`browser` job is the proof; the new spec is `e2e/transactions.spec.ts` ("expected support appears from its
due date and gives way to the recorded borrowing").

## Open / deferred (not forgotten)

- **Bank holidays** remain unhandled (decision 112) — and the expectation follows the income cadence, so a
  Good Friday payment still reads that day.
- Cadence learning stays a deliberate non-goal; the fixed monthly cadence is the explainable rule.
- A token-small purchase categorised as Weekly Shop still resets the week (by design).
- **Running balance** on All Transactions is still deferred (SPEC §15.3); **income analysis** stays out
  (decision 103).
