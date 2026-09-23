# Handoff — v0.2.1 bugfixes (unreleased; supersedes the v0.2.0 boundary handoff)

Date: 2026-09-23. Branch: `arena/01a0cd32-simple-finance` (from `main` @ `1a16268`, which is
post-v0.2.0). Environment: this sandbox — no browser binaries, no Playwright download host,
`npm ci --ignore-scripts` (better-sqlite3 prebuild used as-is). Browser specs run in CI only.

## Session goal and outcome

The household reported three real-world defects in v0.2.0. All three are fixed, tested,
documented and browser-covered:

1. **Same-day credit double-count ("£180" bug, SPEC E13).** The estimate counted a date-only
   record sharing a checkpoint's date as *after*, always. That is safe for debits (understates,
   self-corrects) but **overstated credits** — a swap in-leg, receipt, transfer-in or refund —
   and a same-day checkpoint could never self-correct it, because the counted credit was already
   inside the counted balance. A cash pot read £180.00 instead of £100.00.
2. **Checkpoint left the page it was recorded on stale.** `addCheckpointAction` (and six sibling
   actions) revalidated only `/`, so checkpointing from /pots or /overview left those pages
   showing the old estimate until a manual refresh. The pot card shows the simple estimate
   figure (≈ £100.00) and the "Last reported" line — no itemised breakdown (see "Key
   decisions").
3. **Swaps were unmanageable.** The boundary list at the foot of /pots existed but was buried
   below four pot cards and six sections, and it offered no edit and no honest whole-pair
   correction.

Outcome: all three are implemented, tested (279/279 green), documented (SPEC §7.1/§10.2/E12/E13,
plan decisions 98–100, README, this handoff) and covered by new/changed browser specs that run in
CI. Committed on the session branch; the release decision is the household's.

## The fix, precisely

- **Bug A — sign-aware comparison (`src/lib/records/estimates.ts`).** Where a record is date-only
  and shares a checkpoint's local date, the direction is now decided by the record's sign:
  a same-day **credit** counts as *absorbed*; a same-day **debit** still counts as *after*. Timed
  records are unchanged. The rejected alternative — flipping `>=` to `>` for everything — would
  have absorbed same-day *spending* after a checkpoint (overstating, and wrong for the bank
  pot). Live v0.2.0 data self-heals under the new rule; **no migration**.
- **Bug B — `revalidatePages()` everywhere.** All seven actions that revalidated only `/` now use
  the shared nine-path set, so /pots and /overview refresh in place after a checkpoint — the pot
  card's estimate badge (≈ £100.00) and "Last reported" line update without a manual reload
  (`src/app/actions.ts`).
- **Gap C — swaps managed where they were made.** The "Swap with someone outside" section on /pots
  now lists recent pairs **grouped by exchange key** with the net total (green £0.00 balanced,
  amber "legs differ" when one leg was edited or voided alone, grey "voided"), per-leg edit and
  single-leg void under "Correct or void one leg", and a two-click **"Void both legs"** that voids
  the pair in one transaction with one shared reason. Pot cards link to the list when involved.
  New domain `voidSwap` (version-guarded per leg, one transaction, two audits); new actions
  `editExternalMovementAction` + `voidSwapAction`; new Zod schemas and forms.

## Current state

Done (this session, on top of the merged v0.2.0):

- `src/lib/records/estimates.ts` — sign-aware `recordIsAfterCheckpoint`; header comments updated
  in `estimates.ts`, `occurred.ts`, `time.ts`.
- `src/lib/records/external-movements.ts` — exported `voidSwap` (atomic, per-leg version guards,
  one shared reason, two audits) + `describeExternalMovement` label helper.
- `src/lib/validation.ts` — `editExternalMovementEntrySchema`, `voidSwapEntrySchema`.
- `src/app/actions.ts` — all seven lone-`/` actions now `revalidatePages()`; new
  `editExternalMovementAction` + `voidSwapAction`.
- `src/components/external-forms.tsx` — `ExternalMovementEditForm`, `VoidSwapPairForm`.
- `src/app/pots/page.tsx` — "Recent swaps" paired management list (net total, edit, void one,
  void both), pot-card links to `#swaps`, shared label helper.
- Tests: `tests/estimate.test.ts` (E13 5-step 2000/10000×4 + debit mirror + same-day credit),
  `tests/external-money.test.ts` (E13 describe + `voidSwap` atomicity/guards),
  `tests/entry-validation.test.ts` (+4 Zod boundary tests).
- E2E: `e2e/checkpoint.spec.ts` (new project `checkpoint`, between `external` and `backup` —
  checkpoint on /pots updates the estimate in place, no reload); `e2e/external-money.spec.ts`
  rewritten (same-day swap reads one leg **low**; paired list findable, editable, voidable as a
  pair).
- Docs: SPEC §7.1 comparison rule amended (sign-aware), §10.2 swaps bullet + E12 "provably"
  softened to the honest net-zero-on-a-later-date / one-leg-low-same-day, new E13; plan
  decisions 98–100; README count 279/75; this handoff.

In progress: nothing — the tree is the deliverable.

Not started: cutting a release (version still 0.2.0; suggest **0.2.1** — bugfixes only — when
the household says go), manual acceptance on the real phones (checkpoint in place, swap pair
edit/void-both).

## Key decisions (2026-09-23)

- **Bug A is sign-aware, not a blanket flip.** Absorbing same-day credits only; debits keep
  counting. The household must understand the accepted cost: a same-day swap makes the household
  total read **one leg low** until the next checkpoint (the out-leg dips, the in-leg is
  absorbed). No rule is both per-pot-safe and household-net-zero on the day, and low was chosen
  over high. (SPEC §7.1, plan decision 98, E13.)
- **The pot card shows the simple figure, not a breakdown (household correction, 2026-09-23).**
  The original request's "£100 = £20 + £80" was a demonstration of how the estimate is derived,
  not a display requirement. An itemised "Since the last checkpoint" block was first built and
  then withdrawn (pot cards, `money-view.ts`, tests) — the estimate badge (≈ £100.00) and the
  "Last reported" line are the display, and they update in place after a checkpoint.
- **Void both legs is the honest whole-pair correction; single-leg void stays** for the
  "cash never arrived" case, leaving the survivor visible rather than cascading. The paired list
  shows the state (balanced / legs differ / voided) so an orphaned leg can never be mistaken for
  a net-zero swap.
- **Edit covers pot/amount/date/note — and the counterparty name, for swaps and other money**
  (a typo can be corrected without voiding the pair). For loan legs the name carries the debt's
  name and is locked — rename the debt instead. Kind, direction, debt link and exchange key are
  immutable — to change those, void and re-record. An edit that breaks the pair's net-zero is
  shown, not hidden: the paired list reads "legs differ · net ±£X" in amber.

## Exact file paths touched

New: `e2e/checkpoint.spec.ts`.

Modified: `README.md`, `docs/HANDOFF.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/SPEC.md`,
`e2e/external-money.spec.ts`, `playwright.config.ts`, `src/app/actions.ts`,
`src/app/pots/page.tsx`, `src/components/external-forms.tsx`, `src/lib/records/estimates.ts`,
`src/lib/records/external-movements.ts`, `src/lib/records/occurred.ts`, `src/lib/time.ts`,
`src/lib/validation.ts`, `tests/entry-validation.test.ts`, `tests/estimate.test.ts`,
`tests/external-money.test.ts`.

## Validation evidence (this sandbox, 2026-09-23)

- `npm test` — **279/279 green across 75 suites** (baseline at session start, on merged v0.2.0:
  269/269 across 73).
- `npx tsc --noEmit` — clean. `npm run format:check` — clean. `npm run build` — green, 15 routes.
- `E2E_SEED_ONLY=1 node --import tsx scripts/e2e-server.mts` — seed success (fictional data only).
- Dev-server smoke against the seeded data: `/`, `/overview`, `/pots` all 200; /pots shows the
  "Swap with someone outside" + "Recent swaps" sections with the correct empty state, no server
  errors. Server stopped afterwards.
- Browser specs (`checkpoint`, rewritten `external-money`): written against verified selectors
  and project wiring, but **NOT run** — this sandbox has no browser. CI `npm run test:e2e` is the
  first real run (blueprint §9: never claim a browser run from markup rendering).

## Open items for next session

1. Merge + release decision (the household's call): PR from the session branch to `main`, review,
   merge; then bump to **0.2.1** (bugfixes only) + tag per `docs/RELEASE_PROCESS.md` if they want
   it shipped.
2. CI must be green, including the first-ever run of the `checkpoint` project and the rewritten
   `external-money` same-day-low assertion.
3. Manual acceptance on the real phones: a checkpoint that updates /pots in place; a swap pair
   found next to the swap form, edited, and voided as a pair.
4. Watch-list (unchanged): phone camera formats (OQ9), attachment growth, email alerts (v2), PWA
   (post-v1), first Unraid install picks its own port (OQ8).

## Exact resume point

Branch `arena/01a0cd32-simple-finance` (see `git log --oneline -3`). Resume with `git status`,
`npm run typecheck`, `npm run format:check`, `npm test`, then continue from "Open items" above.

## Important lesson (do not repeat) — and it happened again this session

Parallel same-block edits to one file race: only the last write survives, silently dropping the
others. **This session lost 1,336 lines of `src/app/actions.ts`** (truncated 1820→495) to exactly
that, and recovered by `git checkout --` and re-applying **sequentially, one edit per block**.
Rule for this repo, now load-bearing: **one writer per file per block** — never issue parallel
`edit_file` calls against the same file; batch a file's edits into sequential steps (or a single
script) and run files in order. When a shared file must change a lot, prefer one careful edit per
hunk, re-reading between, over several at once.
