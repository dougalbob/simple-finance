# Simple Finance v0.5.0

**Release date:** 2026-09-24
**Published:** yes — annotated tag `v0.5.0` on merge commit `<MERGE_SHA>` (PR `<PR_NUMBER>`), publish run
`<PUBLISH_RUN_ID>`. `v0.5.0`, `latest` and `sha-<MERGE_SHA_SHORT>` all resolve to one digest. Force
Update now brings this release.
**Image digest:** `<DIGEST_SHA256>`.
**Type:** feature release — **Horizon** and **expected support payments**. A new page (`/horizon`) that
projects how far the money would go to any date up to 400 days ahead, and a read-only expected-inflow
expectation on debts that feeds the projections as flagged, expected money — borrowed money is still
never income.
**One additive migration (`0007_debt_expected_inflow`), no backup-format change.**
**Previous published image:** v0.4.0. Do not rewrite `docs/RELEASE_NOTES_v0.4.0.md` and do not retag
v0.4.0.

## What to do in Unraid

1. **Take a backup first** (Settings → Backup & restore). This release adds two columns to the debts
   table, and although migrations run automatically and are additive, there is no downgrade path — the
   archive is the only way back.
2. Docker → the Simple Finance container → **Force Update**. This pulls
   `ghcr.io/dougalbob/simple-finance:latest`.
3. Start it and read the log. Expect the usual `starting Simple Finance on port 3000 as 99:100`, with
   the migration applying before the server starts.
4. Confirm the version badge in the navigation reads **v0.5.0 · pre-release**, and that **Horizon**
   appears in the menu between Recurring and Income.

## What changed

**A Horizon page** (`/horizon`), laptop-shaped by the household's choice — "how far the money would go"
is a sit-down question, so it joins the menu between Recurring and Income and Quick Entry deliberately
gained nothing:

- Pick any date up to **today + 400 days** and the page projects the whole window with the same engine
  the payday panel uses — the chosen date is simply the window's end, so "where we'd land" and the
  payday projection can never disagree on shared days.
- **Headline:** "Free to spend up to {date}", with the context line "Where we'd land on {date}". The
  **lowest point always shows**, with its date and the §8 tier, whatever the window — a long,
  healthy-looking window can still dip hard on the 1st when the direct debits leave.
- **All pots selected by default**; untick to scope the projection. **Day-to-day** (groceries + fuel)
  included by default and toggleable — with it off the page relabels itself "Free to spend on *bills*
  up to {date}", so the figure is never mistaken for the full answer.
- Detail blocks (commitments, expected money in, day-by-day table) stay open for windows of 60 days or
  less and start collapsed beyond that; the through date, pot selection and toggle persist in the URL.

**Debts can expect a support payment.** The household's motivating shape — the £1,000 loan from a family
member, with money reliably sent each 12th — is now something the app can plan around. A debt can carry
an **expected inflow**: an amount and a day of the month, set together or not at all, editable in the
debt's "Edit" form on Accounts & Pots.

- The expectation feeds the **payday projection** and the **horizon** as money in, flagged `expected`
  and shown with an `≈` (an expectation, never a received `+`). It is *read-only*: it never touches
  the estimate, the Income page, All Transactions' `BAC` rows or any insight — the actual deposit is
  still a Borrow movement, and borrowed money is still never income.
- It lands on the debt's day of the month, clamped like a schedule (the 31st lands on the 30th in short
  months) and moved off a weekend onto the **Friday before**, exactly like a salary payday. A settled
  (or overpaid) debt expects nothing.
- Where the two meet, **earliest wins**: if the next expected support lands before the next salary, the
  planning cycle flips to it, and Settings says so rather than silently pointing at a schedule.

## Tests

- `npm test` — **311 tests across 80 suites** (was 301/79). The 8 new tests in `tests/horizon.test.ts`
  pin the horizon read model's reuse of the payday engine (the "where we'd land" figure equals
  `available + receipts − commitments − day-to-day` on the final day, to the penny), the
  pair-or-nothing expected-inflow edit, its absence from estimates, its weekend shift, the
  settled-debt-expects-nothing rule, and pot scoping. `tests/dates.test.ts` gains two cadence tests for
  the new `incomeOccurrencesBetween` and `shiftIncomeOffWeekend`. `tests/backup-restore.test.ts` asserts
  eight migrations now that `0007` is applied.
- New browser project **`horizon`** (`e2e/horizon.spec.ts`, 5 specs): the seeded scope (headline, lowest
  point, all pots ticked, the expected-support flag), choosing a date, toggling day-to-day, unticking a
  pot (the support expectation disappears with its pot), and the 60-day `<details open>` rule. The
  seeded household on the e2e server now carries the "Mum" support loan so the page has an expectation
  to render; `e2e/external-money.spec.ts` is adjusted for the extra seeded debt.
- The whole browser acceptance job — **44 specs across 10 projects** — runs in CI's `browser` job,
  which the agent sandbox cannot run locally (no browser there). `npm run format:check`,
  `npm run typecheck`, `npm run build` (**18 routes**, was 17) and `npm audit --omit=dev`
  (0 vulnerabilities) all clean.

## Image tags and digest

The publish workflow put these tags on one digest:

- `ghcr.io/dougalbob/simple-finance:v0.5.0`
- `ghcr.io/dougalbob/simple-finance:latest`
- `ghcr.io/dougalbob/simple-finance:sha-<MERGE_SHA_SHORT>`

Digest: `<DIGEST_SHA256>` — confirmed by the publish workflow's registry verification and the package
versions API. v0.4.0 (`sha256:2d09b35ba93f0125acfdda7133a07c47f1f63045043a1f0759f450fa9e6833e8`) was
not retagged, and the v0.5.0 digest differs from it.

## Verification of the registry

`ghcr.io` is blocked in the agent sandbox (see `docs/SANDBOX.md` entry 6), so the tags are verified two
ways: the publish workflow's own registry verification step, and
`GET /users/dougalbob/packages/container/simple-finance/versions` over `api.github.com`. Both succeeded
for this release — the versions API returned one entry carrying exactly `["sha-<MERGE_SHA_SHORT>",
"v0.5.0", "latest"]`, with `latest` moved off the v0.4.0 entry.

## Schema / data notes

- **Additive migration `0007_debt_expected_inflow`: two nullable columns on `debts`** —
  `expected_inflow_amount_pence` and `expected_inflow_day_of_month`, both set or both null (enforced at
  the Zod boundary and again in the domain). Existing rows are unaffected: a debt simply has no
  expectation until the household sets one. Nothing is rewritten, nothing is deleted, and there is no
  downgrade path.
- **No change to the backup archive format** (still format 2). The new columns ride along inside the
  database snapshot, exactly as `receipts.source` did in v0.4.0; an older backup restores, and a newer
  backup contains the expectations.
- No new real financial data in code, tests or documentation; the seed and the browser specs use the
  fictional household only (SPEC §19, §23.3).

## What is not in this release

- **No automatic borrowing.** An expected support payment is a label, not a record — when the money
  really arrives it is still Borrow, by hand, so the estimate and the owed balance move together.
- **Bank holidays** remain unhandled (decision 112, unchanged): the app keeps no holiday calendar, so a
  support payment expected on a Good Friday still expects that day.
- **Income analysis** stays out (no income-vs-spending, no income categories).
- `docs/RELEASE_PROCESS.md` is deliberately untouched.

## Version badge

Navigation should read **v0.5.0 · pre-release**.

- **Version `0.5.0`** in `package.json`, `package-lock.json` (root `version` and `packages[""]`),
  `src/lib/version.ts`, `simple-finance.xml` and this document. The README's stale `v0.1.5` status and
  version lines were reconciled to v0.5.0 in the same pass.

## Release notes doc

This file: [`docs/RELEASE_NOTES_v0.5.0.md`](RELEASE_NOTES_v0.5.0.md).
