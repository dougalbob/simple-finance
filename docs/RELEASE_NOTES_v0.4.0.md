# Simple Finance v0.4.0

**Release date:** 2026-09-23
**Published:** yes — annotated tag `v0.4.0` on merge commit `4183cf4` (PR #32), publish run
`35893148549`. `v0.4.0`, `latest` and `sha-4183cf4` all resolve to one digest. Force Update now
brings this release.
**Image digest:** `sha256:2d09b35ba93f0125acfdda7133a07c47f1f63045043a1f0759f450fa9e6833e8`.
**Type:** feature release — **Income**. A new page (`/income`), one-off income recorded by hand with a
source, income rows (`BAC`) in All Transactions, and a payday that moves off the weekend.
**One additive migration (`0006_income_source`), no backup-format change.**
**Previous published image:** v0.3.0. Do not rewrite `docs/RELEASE_NOTES_v0.3.0.md` and do not retag
v0.3.0.

## What to do in Unraid

1. **Take a backup first** (Settings → Backup & restore). This release adds a column, and although
   migrations run automatically and are additive, there is no downgrade path — the archive is the only
   way back.
2. Docker → the Simple Finance container → **Force Update**. This pulls
   `ghcr.io/dougalbob/simple-finance:latest`.
3. Start it and read the log. Expect the usual `starting Simple Finance on port 3000 as 99:100`, with
   the migration applying before the server starts.
4. Confirm the version badge in the navigation reads **v0.4.0 · pre-release**, and that **Income**
   appears in the menu between Recurring and Accounts & Pots.

## What changed

**One-off income can now be recorded.** Before this release, income could enter the app in exactly one
way: a salary schedule converting itself at local midnight. Anything that arrived once — the bicycle
sold for cash, the bank transfer from a buyer, a refund from a third party, a gift, a one-off job —
had to be squeezed into "other money in" with a counterparty. Now `/income` records it properly:
amount, which pot it landed in (cash or bank transfer is simply which pot), the date, an optional
**source** saying what or who it came from, and an optional note. Income still has no category and no
target, because income is not spending.

**A new Income page** (`/income`), built laptop-first — the household said income is not something they
record from a phone, so Quick Entry deliberately gained nothing:

- **Regular income (scheduled):** the salary, with its amount, day of the month and the pot it is paid
  into, editable in place — a change applies from the next instance onward, never rewriting a month
  that has already happened — and cancellable with an effective date.
- **Record one-off income:** the form above.
- **Income received:** scheduled and one-off income in one list, newest first, with inline correction
  and void. Voided income stays in the list, struck through with its reason.
- Two plain figures at the top: what has been received this month, and the next payday. That is
  record-keeping, not analysis — there is still no income-versus-spending and no income categories.

**Income shows up in All Transactions as `BAC`** — the code the household's original sketch reserved.
The source cell reads the typed source, or the schedule's name for a converted salary, or "Income"; the
category cell is `—`, because income has none; a converted salary also links to its schedule on
`/recurring`. Every row links to the record on `/income`.

**Payday moves off the weekend (the household's rule).** A salary configured for a day that falls on a
**Saturday or Sunday** is now expected on the **Friday before** — that is when the money actually
lands, and not waiting for Monday changes what the projection tells you. It applies to income
schedules only (a direct debit still leaves on the date you configured), it is always on, and the page
says so rather than silently showing a different date ("The 27th falls on a weekend — expected on the
Friday before"). Two consequences worth knowing: a payday configured for the 1st can land in the
previous month, so one calendar month can hold two paydays; and **bank holidays are not handled** —
the app keeps no holiday calendar and will not guess one, so a Friday bank holiday still expects the
money that day and the receipt can be corrected by hand.

Everything else is unchanged. Estimates, the to-payday projection and Insights were already correct
about income (a receipt was always +signed pence, and insights are deliberately blind to income); no
code in those engines changed. Borrowing is still never income.

`docs/SPEC.md` gains §11.3's one-off income and payday rule, an Income row in the §15.2 menu table
and an un-reserved `BAC` row in §15.3. `docs/IMPLEMENTATION_PLAN.md` gains decisions 109–113 and
resolves open question OQ2.

## Tests

- `npm test` — **301 tests across 77 suites** (was 286/76). The 15 new tests in `tests/income.test.ts`
  cover the source field (stored trimmed, blank as none, over-long rejected), edit and void (including
  version conflicts and a voided record refusing edits), the payday rule (a mid-month Saturday, a
  1st-of-month Saturday that lands in the previous month, re-dating an upcoming instance left on a
  weekend, and conversion on the Friday), and the Income page's read model — source resolution
  (typed → schedule name → "Income"), per-pot and date-window scoping, and the two summary figures.
- `tests/activity.test.ts` now asserts `BAC` rows — the one-off sale and the converted salary, their
  sources, amounts, schedule link and deep links — instead of asserting their absence.
- New browser project **`income`** (`e2e/income.spec.ts`, 4 specs): recording one-off income with a
  source, correcting and voiding it (and seeing it leave All Transactions), moving the salary to a
  weekend day and reading back the Friday the app now expects (the day is computed in the spec, so it
  is not tied to a calendar date), and adding a second scheduled income.
- `e2e/transactions.spec.ts` gains a fifth spec: seeded income rendered as a `BAC` row — its source,
  `+` amount, "Collected in cash", `—` category and the link through to `/income?receipt=…`.
- The whole browser acceptance job — **39 specs across 9 projects** — concluded success on the pull
  request run `35892134193` (1.3m) and again on the merge commit run `35892829568`. It runs in CI's
  `browser` job, which the agent sandbox cannot run locally (no browser there). The project's first
  run, `35889857166`, failed two of the four new income specs, and both were spec bugs rather than
  product bugs: the seeded-salary row was matched on the word "Salary", which every row also carries
  in its pot picker ("Salary account"), and the void step clicked "Correct or void" when the row's
  disclosure box was already open after the previous save, closing it. Fixed in `7525d98`; the
  product code was not touched.
- `npm run format:check`, `npm run typecheck`, `npm run build` (**17 routes**, was 16) and
  `npm audit --omit=dev` (0 vulnerabilities) all clean. A dev-server smoke run against the fictional
  seed rendered the page, the seeded "Sale of bicycle" income, the `BAC` row on `/transactions` with
  its `/income?receipt=…` link, and the live payday shift (salary due Sunday the 27th → expected
  Friday the 25th).

## Image tags and digest

The publish workflow put these tags on one digest:

- `ghcr.io/dougalbob/simple-finance:v0.4.0`
- `ghcr.io/dougalbob/simple-finance:latest`
- `ghcr.io/dougalbob/simple-finance:sha-4183cf4`

Digest: `sha256:2d09b35ba93f0125acfdda7133a07c47f1f63045043a1f0759f450fa9e6833e8` — confirmed by the
publish workflow's registry verification and the package versions API.
v0.3.0 (`sha256:2db0a0c802d5055d1e7788b03dfd52c98bba0125dbbc032354b3b1f2d031da68`) was not retagged,
and the v0.4.0 digest differs from it.

## Verification of the registry

`ghcr.io` is blocked in the agent sandbox (see `docs/SANDBOX.md` entry 6), so the tags are verified
two ways: the publish workflow's own registry verification step (it fails unless every tag's registry
digest equals the image it just built and smoke tested), and
`GET /users/dougalbob/packages/container/simple-finance/versions` over `api.github.com`. Both
succeeded for this release: the publish job concluded success, and the versions API returned one
entry — `sha256:2d09b35ba93f0125acfdda7133a07c47f1f63045043a1f0759f450fa9e6833e8` — carrying exactly
`["sha-4183cf4", "v0.4.0", "latest"]`, with `latest` moved off the v0.3.0 entry.

## Schema / data notes

- **Additive migration `0006_income_source`: one nullable `source` column on `receipts`** (free text,
  120 characters). Existing rows are unaffected — a converted salary simply has no source and reads
  its schedule's name instead. Nothing is rewritten, nothing is deleted, and there is no downgrade
  path.
- **No change to the backup archive format** (still format 2). The new column rides along inside the
  database snapshot, exactly as the `debts` and `external_movements` tables did in v0.2.0: an older
  backup restores, and a newer backup contains income.
- Salary instances already converted under the old rule keep their original dates — history is never
  rewritten. Only *upcoming* weekend instances move.
- No new real financial data in code, tests or documentation; the seed and the browser specs use the
  fictional household only (SPEC §19, §23.3).

## What is not in this release

- **Bank holidays** are not handled (see above).
- **Income analysis** — no income-versus-spending, no income categories, no charts (SPEC §12/§16).
- **No income entry on the mobile quick-entry panel**, by the household's choice.
- **No running balance** on All Transactions — still deferred, not rejected (SPEC §15.3).
- `docs/RELEASE_PROCESS.md` is deliberately untouched.

## Version badge

Navigation should read **v0.4.0 · pre-release**.

- **Version `0.4.0`** in `package.json`, `package-lock.json` (root `version` and `packages[""]`),
  `src/lib/version.ts` and `simple-finance.xml`.

## Release notes doc

This file: [`docs/RELEASE_NOTES_v0.4.0.md`](RELEASE_NOTES_v0.4.0.md).
