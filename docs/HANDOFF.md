# Handoff — Income (v0.4.0)

Date: 2026-09-23. Branch: `arena/01a0cee8-simple-finance` (from `main` @ `11689bc`, post-v0.3.0).

**v0.4.0 is published.** Annotated tag `v0.4.0` on merge commit `4183cf4` (PR #32); `v0.4.0`,
`latest` and `sha-4183cf4` all resolve to `sha256:2d09b35ba93f0125acfdda7133a07c47f1f63045043a1f0759f450fa9e6833e8`.
Release notes: [`docs/RELEASE_NOTES_v0.4.0.md`](RELEASE_NOTES_v0.4.0.md). Nothing to do but take a
backup and Force Update in Unraid.

**This session built income.** The previous handoff was the investigation that deferred it (plan
decision 103); it is superseded by this note. Read [`docs/SPEC.md`](SPEC.md) §6, §11.3, §15.2 and
§15.3, and [`docs/IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) decisions **109–113** — those
record what was agreed with the household and why.

## What shipped

**Scheduled income was already there and still is:** an expected-receipt schedule converts itself at
local midnight on its due date. What changed for it is the **payday rule** and an editing surface.

- **One-off income** (`/income`, Quick Entry deliberately unchanged). Amount, pot, date, an optional
  **source** ("Sale of bicycle") and an optional note. Cash or bank transfer is simply which pot the
  money landed in. Migration `0006_income_source` adds the nullable `receipts.source` column; the
  domain (`createReceipt`/`editReceipt`) and three actions (`addReceiptAction`, `editReceiptAction`,
  `voidReceiptAction`) wrap it. No backup-format change.
- **A desktop-shaped Income page** — scheduled income (add/edit/cancel in place, "applies from the
  next instance onward"), one-off entry, and one list of everything received with inline edit/void
  and the retained history. Deep-link contract: `receipt-{id}` anchors plus `?receipt={id}`.
- **`BAC` rows in All Transactions** (closes the v0.3.0 deferral). Source = `source` ?? the income
  schedule's name ?? "Income"; category `—`; direction always `in`; primary link to
  `/income?receipt={id}#receipt-{id}`, plus `/recurring#schedule-{id}` for a converted receipt.
- **Payday never waits for the weekend** (OQ2 resolved, decision 112): an income schedule due on a
  Saturday or Sunday is expected on the **previous Friday** — always, for income only. Bank holidays
  are not handled (no holiday calendar in the app, and it will not guess one).

## Where the code is

- `src/lib/records/receipts.ts` — `source` on create/edit (trimmed, blank → NULL, 120 chars).
- `src/lib/records/income-view.ts` — the page's read model: `listIncomeSchedules`,
  `listIncomeRecords`, `getIncomeRecord` (deep link), `incomeSummary`. Read-only, like `activity.ts`.
- `src/lib/records/dates.ts` — `weekdayOf`, `shiftIncomeOffWeekend`.
- `src/lib/records/schedules.ts` — `dueDateForPeriod` / `candidateForPeriod` apply the payday rule
  wherever a due date is derived, and `syncScheduleInstances` re-dates an **upcoming** instance left
  on a weekend. Converted instances are never touched.
- `src/app/income/page.tsx`, `src/components/income-forms.tsx` — the page and its four forms. The
  schedule forms reuse `addScheduleAction` / `editScheduleAction` and `CancelScheduleForm`, so there
  is one schedule domain, not two.
- `src/lib/records/activity.ts` — the `BAC` family (family rank 3, so outgoings sort above receipts
  on the same instant).
- `src/components/site-nav.tsx`, `src/app/actions.ts` (`PAGE_PATHS`) — `/income` is in the menu and
  is revalidated by every action that writes a record.

## Watch out for (learned this session)

- **Do not touch estimates, projection or insights.** Receipts were already +signed pence there and
  insights are deliberately blind to income. `npm test` pins all of it.
- A shifted payday can land in the **previous month** (a salary configured for the 1st pays on the
  last Friday before), so one calendar month can hold two instances — but never two on the same
  date: `UNIQUE(schedule_id, due_date)` still holds, and the shift is at most two days against a
  month-long gap.
- Window membership for instance generation is decided by the **configured** date, never the shifted
  one (`candidateForPeriod`), or a payday that moves back over a window edge would vanish.
- The income edit form is asymmetric on purpose: a blank **note keeps** the current note (the
  convention every other edit form here follows), a blank **source clears** it (it is a correction,
  not context).

## Open / deferred (not forgotten)

- **Bank holidays** are not handled (decision 112). If the household wants it, it needs a holiday
  list and a decision about who maintains it — a bigger question than the rule itself.
- **Income analysis** stays out: no income-vs-spending, no income categories (decision 103, SPEC
  §12/§16). The page shows records and two plain figures — received this month, and the next payday.
- **Running balance** on All Transactions is still deferred (SPEC §15.3).
- The **mobile** home page has no income entry, by the household's choice (decision 111). If they
  ever record income at the till, that is a fresh decision, not a bug.

## Test state

`npm test` — **301 tests, all green** (was 286). `tests/income.test.ts` (15) covers the source
field, edit/void, the payday rule (mid-month, 1st-of-month, repair of a leftover weekend instance,
conversion on the Friday), the view model and the summary. `tests/activity.test.ts` now asserts
`BAC` rows instead of their absence. A new Playwright project **`income`**
(`e2e/income.spec.ts`, 4 specs) runs after `transactions` and before `backup`; browsers cannot run
in this sandbox, so CI's `browser` job is the proof — **39 specs across 9 projects passed** on the
PR run and again on the merge commit.

Two of the four new income specs failed on their first CI run and both were spec faults, not product
faults: a row matched on `hasText: 'Salary'` also matches every row whose pot picker offers
"Salary account", and re-clicking a row's "Correct or void" after a save had re-rendered the list
*closed* the disclosure box instead of opening it. Worth remembering for any future spec that drives
an inline `<details>` form: reload before the second interaction, or assert the field is visible
before filling it.
