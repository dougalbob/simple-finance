# Handoff — money across the household boundary (unreleased; supersedes the v0.1.9 handoff)

Date: 2026-09-23. Branch: `arena/01a0ccc2-simple-finance` (from `main` @ `644f3af`).
Environment: this sandbox — no browser binaries, no Playwright download host, `npm ci
--ignore-scripts` (better-sqlite3 prebuild used as-is). Browser specs run in CI only.

## Session goal and outcome

The household reported three real-world gaps in v0.1.9 (their words, condensed): cash is a
"shared jar" but should be individual jars, so a £200 cash handover is untracked; a £1,000
family loan in cash paid into the bank has no honest home (is it income? a transfer?); and a
son paid in cash who gets a bank transfer back produces an unexplained cash increase with no
category for the transfer. This session designed and built the answer in full: the jar is
retired for one cash pot each, borrowing is loan movements plus a tracked lender (never
income), repayments reduce what is owed (never spending), swaps are atomic net-zero pairs,
and anything else crosses the boundary with a note.

Outcome: the feature is implemented, tested (269/269 green), documented (SPEC §4/§6/§7/§10/
§15/§17, plan decisions 93–97, README, handoff), and browser-covered by new specs that run
in CI. It is committed on the session branch and awaiting the household's release decision
(PR open or not — see "Open items").

## Current state

Done:

- Schema + migration: `debts` and `external_movements` tables, 4 indexes
  (`src/lib/db/schema.ts`, `drizzle/0005_external_money.sql`, journal count 6).
- Domain: `src/lib/records/debts.ts` (derived balances, summary, labels),
  `src/lib/records/external-movements.ts` (loan/other CRUD, atomic `createSwap` under one
  `exchange_key` with two audits, same-pot rejected; void per leg), `archivePot`
  (zero-referencing pots only) in `src/lib/records/pots.ts`.
- Estimate engine: external money in/out move per-pot and household estimates
  (`src/lib/records/estimates.ts`, `src/lib/records/money-view.ts`); Insights untouched
  by construction (allocations join); four pots everywhere (jar gone).
- Boundary + actions: Zod schemas (debt/external/swap/archive, note required for other)
  in `src/lib/validation.ts`; six audited server actions in `src/app/actions.ts`.
- UI: shared form components (`src/components/external-forms.tsx`, `record-forms.tsx`
  `VoidForm` external kind); fourth quick-entry tab (Move) on home + overview;
  owed/owing lines beside "available now"; Pots page gains Owed & owing, Borrow & repay,
  Swap, Other money, boundary history with void, and Archive in Edit pot.
- Fixtures + seed: `tests/household.ts` is four pots (alexCash/samCash); E8 recomputed
  to the no-jar figures (£938.70 available, −£579.62 low); `scripts/e2e-server.mts` seeds
  the same four pots.
- Tests: `tests/external-money.test.ts` (17: debts, swap atomicity/net-zero/round-trip,
  estimate≡Insights, archivePot guard), `tests/entry-validation.test.ts` +4 Zod boundary
  tests, migration-count and uncheckpointed-pot asserts updated honestly (6, 4).
- E2E: `e2e/external-money.spec.ts` (borrow → owed line; repay → balance falls; swap →
  household total unchanged), a Move-tab transfer test in `e2e/home.spec.ts`, and the
  `external` project in `playwright.config.ts` (runs before `backup`).
- Docs: SPEC delta (§2 scope, §4 four pots, §6 record types, §7.1 formula, §10 → 10.1 +
  10.2, §15.1 four actions, §15.2 Pots/Overview rows, E8 recompute, new E10–E12);
  plan decisions 93–97 + data-model sketch + test strategy + file map; README Move
  bullet + 269/73 counts; this handoff.

In progress: nothing — the tree is the deliverable.

Not started: cutting a release (version still 0.1.9; suggest 0.2.0 — new record types —
when the household says go), manual acceptance on the users' real phones (Move tab,
borrow/swap forms), the v2/roadmap watch-list below.

## Key decisions (2026-09-23, with the product owner)

- (a) Two personal cash pots, no jar — a handover is a visible transfer.
- (b) Loans are movements + a lender + a derived owed balance; repayments reduce it; no
  interest, no schedules — informal IOUs only (SPEC §10.2, plan decisions 93–94).
- (c) Swaps are linked net-zero pairs, atomic at creation, independently correctable
  afterwards (plan decision 95).
- (d) Full scope this session: design + build + tests + docs (this handoff).

Engineering decisions (agent, same day): debt balances derived, never stored (92/94);
debt direction and loan/swap/other kind + direction + debt link + exchange key immutable
(void-and-rerecord to fix); other requires a note; rename propagates to linked loan
copies in one transaction; archivePot refuses referenced pots; Insights exclusion by
construction, covered by an estimate≡Insights test; audits `debt.create/edit`,
`external.create/edit/void`, `pot.archive`.

## Exact file paths touched

New: `drizzle/0005_external_money.sql`, `e2e/external-money.spec.ts`,
`src/components/external-forms.tsx`, `src/lib/records/debts.ts`,
`src/lib/records/external-movements.ts`, `tests/external-money.test.ts`.

Modified: `README.md`, `docs/HANDOFF.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/SPEC.md`,
`drizzle/meta/_journal.json`, `e2e/home.spec.ts`, `playwright.config.ts`,
`scripts/e2e-server.mts`, `src/app/actions.ts`, `src/app/overview/page.tsx`,
`src/app/page.tsx`, `src/app/pots/page.tsx`, `src/components/pot-forms.tsx`,
`src/components/quick-entry.tsx`, `src/components/record-forms.tsx`,
`src/lib/db/schema.ts`, `src/lib/records/entry-view.ts`,
`src/lib/records/estimates.ts`, `src/lib/records/money-view.ts`,
`src/lib/records/pots.ts`, `src/lib/validation.ts`, `tests/backup-restore.test.ts`,
`tests/db-slice.test.ts`, `tests/entry-validation.test.ts`, `tests/household.ts`,
`tests/money-view.test.ts`, `tests/projection.test.ts`,
`tests/schedule-lifecycle.test.ts`, `tests/schedule-supplier.test.ts`,
`tests/settings-domain.test.ts`, `tests/transfers.test.ts`.

Reverted before commit: `next-env.d.ts` (dev-server import-path churn, not a change).

## Validation evidence (this sandbox, 2026-09-23)

- `npm test` — 269/269 green across 73 suites (baseline at session start: 248/248).
- `npx tsc --noEmit` — clean. `npx prettier --check .` — clean. `npm run build` —
  green, 15 routes.
- `E2E_SEED_ONLY=1 node --import tsx scripts/e2e-server.mts` — seed success, four pots
  (£42.10 / £1,612.35 / £1,200.00 / £28.62, household £2,883.07).
- Dev server smoke: `/`, `/overview`, `/pots` all 200 with the new sections (Move tab,
  Owed & owing, Borrow & repay, Swap, Other money, boundary history, Archive control);
  server stopped afterwards.
- Browser specs (`external-money`, Move-tab): written against verified selectors and
  project wiring, but NOT run — this sandbox has no browser. CI `npm run test:e2e` is
  the first real run (blueprint §9: never claim a browser run from markup rendering).

## Open items for next session

1. Merge + release decision (household's call): PR from the session branch to `main`,
   review, merge; then version bump (suggest 0.2.0) + tag per `docs/RELEASE_PROCESS.md`
   if they want this shipped.
2. CI must be green, including the first-ever run of the `external` project.
3. Manual acceptance on the real phones: Move tab at the till, a borrow + repay, a
   swap — the "walking out of Tesco" test for the new tab.
4. Watch-list (unchanged): phone camera formats (OQ9), attachment growth, email alerts
   (v2), PWA (post-v1), first Unraid install picks its own port (OQ8).

## Exact resume point

Branch `arena/01a0ccc2-simple-finance`, committed (see `git log --oneline -3`). Resume
with `git status`, `npm run check`, `npm test`, then continue from "Open items" above.

## Important lesson (do not repeat)

Parallel same-block edits to one file race: only the last write survives, silently
dropping the others (this session lost hunks in six files that way and had to redo
them). Rule for this repo: **one writer per file per block** — batch a file's edits
into a single script with `count == 1` asserts, and run files sequentially.
