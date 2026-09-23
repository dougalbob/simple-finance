# Handoff — "All Transactions" (v0.3.0: designed, built, shipped 2026-09-23)

Date: 2026-09-23. Branch: `arena/01a0ce41-simple-finance` (from `main` @ `7fc9c7b`, post-v0.2.1),
merged as PR #29 → merge commit `96069a3`. v0.3.0 is published: annotated tag `v0.3.0` on that merge
commit, publish run `35871843722`, digest
`sha256:2db0a0c802d5055d1e7788b03dfd52c98bba0125dbbc032354b3b1f2d031da68` carrying `v0.3.0`,
`latest` and `sha-96069a3`.

## What this session did

The household sent a hand-drawn sketch (`transactions.txt`) and a discussion note for a one-page,
read-only activity view per pot/account. This session verified the note against the schema, settled
four forks with the household (plus two at build time), wrote the design into the spec, built the
page, tested it and shipped it as v0.3.0.

Changed: `docs/SPEC.md` (§15.2 menu-table row + new §15.3 "All Transactions"),
`docs/IMPLEMENTATION_PLAN.md` (decisions 101–108), `src/lib/records/activity.ts` (new projection),
`src/lib/records/pots.ts` (`listPotsIncludingArchived`), `src/app/transactions/page.tsx` (new page),
`src/components/site-nav.tsx` (nav entry), `src/app/purchases/page.tsx` (`#purchase-{id}` anchors),
`src/app/overview/page.tsx` (`#transfer-{id}` + `?transfer=` force-render), `src/app/pots/page.tsx`
(`#external-{id}` + `?external=` force-render), `tests/activity.test.ts` (7 tests),
`e2e/transactions.spec.ts` + the `transactions` Playwright project, `README.md`, this file.

## The four household answers (2026-09-23)

1. **Type vocabulary: keep the sketch's codes.** `POS`/`BYP` stay unallocated — `PUR` covers all
   purchases and no channel field is added. `DD`/`SO` split by the schedule's kind; `REF`, `TX<`,
   `TX>`, `LN<`, `LN>`, `SW<`, `SW>` as sketched; `BAC` reserved.
2. **Income rows deferred.** The sketch's `BAC` row is not producible today (see below).
3. **Refunds shown as green `REF` rows; voids excluded silently.** No void/refund machinery.
4. **Deep links: add the stable row anchors**, not a second transfers/income feature.

## Facts verified against the code (keep these; they cost an hour to find)

- `receipts` has **no supplier/counterparty column and no category column**; `createReceipt` is
  called only by `schedules.ts:679` (schedule conversion) and tests — there is **no manual income
  entry**; `listReceipts` has **no caller in `src/`** — no page lists income. That is why the
  sketch's `BAC` row is a feature, not a display tweak (decision 103).
- Converted records already carry `note: From schedule "<name>"` (`schedules.ts:685, 712`), so `DD`
  rows have a populated Notes cell with no change.
- Deep-link destinations exist only for purchases (`/purchases?potId&from&to`, filters on
  `occurred_date`) and DD/SO (`/recurring#schedule-{id}`). Transfers sit in a **last-5** list on
  /overview (`overview/page.tsx:69`), boundary money in a **20-row** list on /pots
  (`pots/page.tsx:51`, `includeVoided: true`), swap pairs in `listExchanges(... limit: 20)` — and
  **none of those rows has an anchor id**. Hence decision 105.
- `formatInstantLocal` on a date-only record prints **"20 Sept 2026, 23:59"** (verified by running
  `endOfLocalDate('2026-09-20')` → `2026-09-20T22:59:59.999Z`). The new page must render
  `occurred_date` and use `isRecordDateOnly` for the time. Three date formats already coexist
  (en-GB medium on four pages, raw ISO on /pots' boundary list, the sketch's DD.MM.YYYY).
- `listPots` filters `archivedAt === null` (`pots.ts:385-392`), so archived pots must be added to
  the target selector explicitly or their history disappears.
- The window total can never be called "estimate change": `recordIsAfterCheckpoint`
  (`estimates.ts`) absorbs a date-only **credit** sharing a checkpoint's local date and counts a
  date-only **debit** (§7.1, E13). Hence "movements shown" (decision 106).
- The category cell convention is `Parent / Child (Target)` — "Vehicle Running / Fuel (Mercedes)",
  slash and spaces (`purchases/page.tsx`), not the sketch's colon form.
- Schedules are never deleted (no `.delete()` anywhere in `src/lib/records/`), so a converted
  purchase's `DD` vs `SO` origin is always resolvable.

## Verification evidence (this sandbox, 2026-09-23)

- `npm test` — **286/286 across 76 suites** (baseline before this feature: 279/75). The 7 new tests
  in `tests/activity.test.ts` execute `listPotActivity` directly: codes per record family, sign
  relative to the selected pot, void exclusion, income (`BAC`) exclusion, window edges, checkpoint
  divider placement, split "+N more", the row cap with an exact hidden count, and the
  archive-refuses-records rule that makes "live pots only" safe.
- `npm run format:check`, `npm run typecheck`, `npm run build` — clean; the build lists 16 routes
  including `/transactions`.
- Dev-server smoke against the seeded fictional data (`scripts/e2e-server.mts`, port 3100):
  `/transactions` 200 with the Corner Foods split row (`PUR`, `Groceries / Weekly Shop (household)
  +1 more`, `−£63.47`, note "Weekly shop"), the `SO` row showing the schedule name where no supplier
  exists, the `DD` row, a `Checkpoint · reported £1,612.35` divider and a `Movements shown
  +£15.00 / −£115.46, net −£100.46` total. The same transfer renders `TX> −£5.00` on Main and
  `TX< +£5.00` on Alex's cash. `/overview?transfer=1` renders `id="transfer-1"` and
  `/pots?external=1` renders `id="external-1"`. Server stopped afterwards.
- `npx playwright test --list` — 34 tests in 8 files; the new `transactions` project resolves with
  its 3 specs between `checkpoint` and `backup`. The browser specs cannot run in this sandbox — no
  browser (`docs/SANDBOX.md` §2) — so CI's `browser` job was their first real run: **success**, all
  34 specs, on the pull-request run `35871229504` and again on the merge commit. Three CI rounds
  were needed to get there; see "Watch out for" below for the two causes.

## Watch out for

- The projection's per-family fetches are capped, so `hiddenRowCount` comes from `count(*)` over the
  window, not from what was fetched. A test asserted the fetched count once and was wrong by three.
- Record ids repeat across tables. Anything matching rows must use the family-qualified key
  (`purchase-3`, not `3`); two tests initially collided a swap leg with a purchase.
- `archivePot` refuses a pot that has *any* record, including voided ones. Do not design a feature
  around "archived pot history" — there is none, by construction.
- **Browser specs must not pin seed text that an earlier project mutates.** All eight projects run
  against one seeded database in order, so by the time `transactions` runs, `desktop.spec.ts` has
  already edited the seeded Corner Foods note and moved the Phone plan schedule to the 21st — and
  that move back-fills a *second* converted SO row inside the 30-day window, because
  `syncScheduleInstances` regenerates from `lastConverted + 1`. Assert presence and shape, not seed
  wording, and add `.first()` to any row locator a preceding project can duplicate.
- **`getByRole(name:)` matches the accessible name, which is not the visible text.** Blink
  concatenates a subtree's text without inserting spaces where the DOM has none, and JSX leaves no
  whitespace between the code badge and the schedule link — so that cell's name is
  `"SOOpen the schedule"` and `/^SO\b/` never matches (use `/^SO/`). It is also case-insensitive and
  unanchored, so `{ name: 'PUR' }` also matched "Corner Foods — Open this **pur**chase".

---

# Previous handoff — v0.2.1 bugfixes (released 2026-09-23; supersedes the v0.2.0 boundary handoff)

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
