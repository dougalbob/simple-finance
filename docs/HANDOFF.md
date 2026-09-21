# Handoff — 2026-09-20 — Session 5 complete: Phase 4a desktop pages + Insights v1

## Goal and user decisions

Session 5 of the agreed session map (`docs/IMPLEMENTATION_PLAN.md` → *Session map*). Deliverable: Phase 4a —
the desktop pages (Overview, Purchases with filters + inline edit, Recurring Payments with the read-only
month calendar, Accounts & Pots, Settings) and Insights v1 panels 1–4 including the projection honesty
loop, plus the version display. Reuse the existing pure engines — no arithmetic duplicated in UI code.
Documentation rides in the same PR as the code, as instructed by the product owner.

Standing decisions remain unchanged:

- Work on the platform-assigned session branch; never reuse/switch branches (this session:
  `arena/01a0c132-simple-finance`).
- Money is integer pence only; Zod validates at the server boundary and the domain remains the authority.
- People, vehicles and suppliers are household data and are never seeded. Categories are product content and
  remain seeded by the checked-in migration.
- Engines stay framework-free (pure modules) and are tested with DST and date boundaries.
- Never edit an applied migration; new migrations are additive. **Phase 4a needed no migration** (still 3).
- Release authority is the full delivery loop, but **no tag and no publish this session** — v0.1.0 remains
  the end-of-Phase-5 release.
- The sandbox blocks `nodejs.org` (re-verified; plan decision 36): local gates use
  `npm ci --ignore-scripts`; plain `npm ci` is the CI proof path. Do not "fix" the repo for this.
- No browser run is claimed without Playwright present (decision 54: absent in this sandbox).

## Current state

- Repository: `dougalbob/simple-finance`.
- Session branch: `arena/01a0c132-simple-finance` (continue on this branch; do not switch branches).
- Phases 0, 1, 2a and 2b are merged to `main` (PRs #2–#4). Phase 3 is on its session branch. Phase 4a is
  complete on this session branch with README, implementation plan and this handoff refreshed in the same
  PR. Nothing has been deployed.
- Last user-confirmed deployed version: none. No tag and no image exist yet.
- The app now has six nav pages (home + Overview, Purchases, Recurring Payments, Accounts & Pots, Insights,
  Settings) with a version badge in the nav on desktop and mobile. Both money figures remain clearly
  labelled as estimates/projections — never a bank balance, never a bank connection.

## Implemented in Session 5

### Pure engine (framework-free, shared by UI and tests)

- `src/lib/records/insights.ts` — Insights v1 (SPEC §16): `summarizeSpending` (calendar month or range,
  per parent/child + totals), `compareCalendarMonths` (current "in progress" flag; month-over-month delta),
  `personalSpending` (only explicit person targets — **household allocations are never attributed to whoever
  paid**; zero-activity people listed), `vehicleRunningCosts` (rolling 12 = first of (month − 11) → today,
  per vehicle, by child category), `computeHonestyLoop` (groceries = last 8 **complete** Monday–Sunday weeks;
  fuel = last 3 **complete** calendar months; `roundHalfUpDivide` averages; `drift = average − configured`,
  `null` when unconfigured; partial current week/month never enters the average). Local `startOfWeekLocal`
  (Monday) + `firstOfLocalMonth` live here with the engine, DST-safe by construction (tested across
  2026-03-29).
- `src/lib/records/insights-view.ts` — DB assembly for the four views. Each view runs the lazy due pass
  first (converted schedule purchases are ordinary spending), then joins allocations ⋈ purchases
  (non-void) ⋈ categories. **Transfers and receipts are excluded by construction** (SPEC §10) — the
  allocations join means the UI and the tests share one code path.

### Schedule engine fix (found by the Phase 4a exit criterion)

- `src/lib/records/schedules.ts` — `syncScheduleInstances` gained `{ regenerateFromToday }`. The old
  code kept already-materialised upcoming instances, so **changing a due day never moved a single
  materialised instance** — contradicting SPEC §11.1 "applies from the next instance onward". `editSchedule`
  now regenerates the whole upcoming window under the schedule's *current* cadence from
  `max(last converted + 1 day, today)` (no backfill of past dates under the new cadence); creation and the
  daily pass keep history-based materialisation. Regression: `tests/recurring-calendar.test.ts`
  (plan decision 75).

### Domain additions

- `src/lib/records/pots.ts` — `editPot` (label/kind/overdraft limit/warning threshold, version guard,
  `pot.edit` audit; whitespace-collapsing label; blank clears; threshold requires a limit and sits at or
  below it — `InvalidPotInputError`); `checkpointsForPot`; `recentCheckpoints`.
- `src/lib/records/purchases.ts` — `PurchaseFilters` += `scheduleOnly` / `refundsOnly` / `voidedOnly`
  (isNotNull on `scheduleInstanceId` / `refundOfPurchaseId` / `voidedAt`; `voidedOnly` overrides the default
  voided exclusion).
- `src/lib/records/entry-view.ts` — shared QuickEntryData builder so the mobile home and the desktop
  overview use one code path (the home page's inline builder was removed).

### Server boundary and actions

- `src/lib/validation.ts` — new boundary schemas: `purchaseEditEntrySchema` (full line replacement; pence
  integer), `refundEntrySchema` (positive magnitudes — the action flips the signs), `voidRecordEntrySchema`
  (purchase or transfer + reason rules), `transferEntrySchema`, `potEditEntrySchema`,
  `categoryEntrySchema` (op: add-parent | add-child | rename | retire), `renameTargetEntrySchema`
  (person | vehicle), `warningLeadsEntrySchema` (0–365 days each).
- `src/app/actions.ts` — 11 new actions: `editPurchaseAction`, `addRefundAction` (negates totals/lines
  before `createRefund`), `voidPurchaseAction` / `voidTransferAction`, `addTransferAction`,
  `editPotAction`, `saveCategoryAction`, `renameTargetAction`, `saveWarningLeadsAction`. Every action
  revalidates `['/', '/overview', '/purchases', '/recurring', '/pots', '/insights', '/settings']`;
  every new page exports `dynamic = 'force-dynamic'` (single-user household app — no caching of money
  figures).

### Pages and components

- `src/app/layout.tsx` + `src/components/site-nav.tsx` — menu for all six pages with `aria-current` and the
  **version badge** (desktop + mobile; the only place the version is shown).
- `src/app/overview/page.tsx` — the dense dashboard (SPEC §15.2): money row with tier banner, projection
  panel with the "what's in this forecast" day-by-day `<details>`, due this week, key dates, month-to-date
  by-parent bars with last-month comparison, vehicle rolling-12, and the review list with inline
  edit/refund/void. Quick entry embedded via `buildEntryData`.
- `src/app/purchases/page.tsx` — filter form (search, pot, parent category, state incl. voided-only,
  date range), receipt-style table (parent ⋅ children, pot, supplier, target chips, refund/void
  badges), row edit/refund/void via `RecentEntryActions`.
- `src/app/recurring/page.tsx` — **the read-only month calendar**: server-rendered Mon-first grid (42
  cells) from `listInstances` for the `?month=YYYY-MM` window — one query, one row per cell, so the
  calendar and the lists below it are consistent **by construction**. Per-day details, schedule edit form
  (composite target picker; `#schedule-edit-<id>` anchors from the grid), cancel form, renewal list +
  add forms, projection figures. The page states the boundary in plain language: **app date changes never
  move bank instructions** — direct debits/standing orders are agreed with the bank; the app only changes
  which records it will make.
- `src/app/pots/page.tsx` — pot cards (estimate, overdraft + warning threshold, last checkpoint) with edit
  forms, recent checkpoints per pot, create-pot + add-checkpoint forms.
- `src/app/insights/page.tsx` — panels 1–4 with `?month=YYYY-MM`: month comparison (in-progress flag),
  per-person attribution, vehicle running costs (rolling 12 + by child), and the honesty loop (config vs
  average, drift wording). Engine numbers only — zero arithmetic in the page.
- `src/app/settings/page.tsx` — household renames (people/vehicles), per-pot edits, the **category tree
  editor** (add parent/child, rename, retire — parents can't be retired while history points at them;
  retired categories stay selectable in history, blocks new allocations), projection figures, warning
  leads, payday pointer into Recurring.
- `src/components/record-forms.tsx` — line editor (hidden `linesJson`, integer pence), `PurchaseEditForm`,
  `RefundForm`, generic `VoidForm(recordId, expectedVersion, reason)` for purchase and transfer rows,
  `TransferForm`, `RecentEntryActions` (edit | refund | void switcher; `mode: 'none'` for schedule-origin
  rows — a schedule purchase edits through its schedule, per SPEC §11.1).
- `src/components/schedule-forms.tsx` — `ScheduleEditForm`, `RenewalEditForm`.
- `src/components/settings-forms.tsx` — `TargetRenameForm`, `PotEditForm`, `CategoryTreeEditor`,
  `WarningLeadsForm`.
- `src/components/recurring.tsx` — `ProjectionSettingsForm` slimmed to
  `{ weeklyGroceriesPence, monthlyFuelPence }` (shared by home, recurring, settings).
- `src/app/page.tsx` — now the slim mobile home (quick entry + review + money/projection sections via the
  shared builder); the desktop density lives on /overview.

### Tests (suite now 182; 28 new this session)

- `tests/insights.test.ts` — pure engine: month boundaries (incl. the 2026-03-29 → 2026-04-01 DST
  spring-forward), per-person attribution (household never attributed), vehicle rolling-12 window,
  honesty-loop complete weeks/months + half-up rounding.
- `tests/insights-view.test.ts` — **Phase 4a exit criterion**: every insight figure reconciles with an
  independent sum over `listPurchases` + categories; transfers asserted to have no effect; converted
  schedule purchases counted exactly once (no double count across the due pass).
- `tests/recurring-calendar.test.ts` — **Phase 4a exit criterion**: base calendar, edit (incl. due-day
  edit moving the next instance, no backfill), cancellation, month-end clamping (31 → 28/30), grid
  construction, stale-due-date purge regression.
- `tests/settings-domain.test.ts` — pot edit rules (overdraft context, version guard, threshold rules),
  category tree operations (parent/child uniqueness, retire, assignment block, double-retire error),
  target renames (duplicate + version guards), warning-lead round-trip.

## Validation evidence

Run from the repository root:

- `npm ci --ignore-scripts` — pass in this sandbox (bundled better-sqlite3 prebuild). Plain `npm ci` remains
  the CI proof path (plan decision 36).
- `npm run format:check` — pass (all files Prettier-clean).
- `npm run typecheck` — pass.
- `npm test` — **182 tests, 182 pass, 0 fail** (154 baseline + 28 Phase 4a).
- `NEXT_TELEMETRY_DISABLED=1 npm run build` — pass; `/overview /purchases /recurring /pots /insights
  /settings` all compile as dynamic routes.
- Dev-server smoke (not a browser run): seeded a fictional household into an isolated `DATA_DIR` and
  GET-ed all six pages plus `?month`/filter variants — 200s, correct figures (e.g. household estimate
  £1,612.35 = 412.35 + 1,200.00 per the estimate rule), calendar cells populated from the instance list,
  month navigation renders October 2026. No Playwright present — **no browser run is claimed**
  (decision 54); mobile viewport and Playwright acceptance remain Phase 5 gates.
- No new migration; `tests/backup-restore.test.ts` still asserts 3 migrations and passes.
- `npm audit --omit=dev` — not re-run this session; run it with the Phase 5 release gates (no dependency
  changes were made in Session 5).

## Outstanding acceptance, risks and blockers

- No known code blockers in Phase 4a. Browser tooling is the explicit outstanding verification item
  (Phase 5, with Playwright).
- The dev-server smoke above is a server-side render check; **no click-through browser verification** was
  performed (no Playwright in the sandbox). The form/action contracts are typechecked and follow the
  Phase 2b/3 conventions (Zod → domain → `revalidatePath`), but the first real browser pass is still
  owed in Phase 5.
- Schedule edits now regenerate the upcoming window (decision 75). Consequence to re-check in the browser
  pass: an edit made *on* the new due day creates an instance due today (it stays "upcoming" until the
  next lazy due pass) — that is intended, not a bug.
- Recurring page shows the latest 50 instances per month window; the calendar itself is complete for the
  month (one query). Long-lived schedules beyond the window are still listed in the schedules section.
- Settings "retire category" is terminal for new allocations but history keeps the label (the tree shows
  retired children greyed); there is no un-retire (the SPEC only defines retiring).
- OQ2 (weekend/bank-holiday shift for salary) remains intentionally unimplemented (plan, unchanged).
- Accepted trade-offs from previous sessions continue: assume-cleared checkpoint semantics, synchronous
  single-writer concurrency assumption (decision 42), container root user pending the Phase 5 security
  review.

## Next exact actions — Session 6 / Phase 4b

1. Verify `origin/main`/the merged Phase 3 + 4a PR state before starting the next platform-assigned
   branch; do not reuse this session branch.
2. Read `docs/HANDOFF.md`, `docs/IMPLEMENTATION_PLAN.md` (Session 5 decisions 63–75) and the blueprint,
   then begin Session 6 / Phase 4b on the assigned branch.
3. Phase 4b scope (plan, session map): **Suppliers page** (contact card, reference pairs, interaction log,
   supplier edits — SPEC §21), **Contracts & Renewals page** + its Overview panel (SPEC §22, reusing the
   `keydates` engine and renewal records), **receipt/invoice attachments** (desktop picker, mobile camera
   capture, retroactive attach, authenticated viewer — SPEC §23; this is the first migration change since
   Phase 3 — expect migration `0003` and bump the backup/restore count test to 4), scenario E9 coverage.
   Reuse the existing pure engines — never duplicate their arithmetic in UI code.
4. Keep README, plan and handoff current in the same PR. Do not tag or publish; v0.1.0 remains at the end of
   Phase 5.

## Standing session protocol (exact lines, per product owner instruction)

Read docs/HANDOFF.md, docs/IMPLEMENTATION_PLAN.md and the blueprint, then begin Session 5 / Phase 4a from main on this session's assigned branch: desktop pages (Overview, Purchases, Recurring Payments month calendar, Accounts & Pots, Settings) and Insights v1 panels 1–4 including the projection honesty loop; update all docs in the same PR.

At the end, repeat these exact two lines in your final response and refreshed docs/HANDOFF.md, alongside validation evidence, blockers and next actions, so the next session can continue without another handoff request.

## File map for this handoff

- `src/lib/records/insights.ts`, `src/lib/records/insights-view.ts` — pure Insights v1 engine + DB
  assembly (due pass first; transfers/receipts excluded by construction).
- `src/lib/records/schedules.ts` — `syncScheduleInstances` `{ regenerateFromToday }` (decision 75).
- `src/lib/records/pots.ts` — `editPot`, `checkpointsForPot`, `recentCheckpoints`;
  `src/lib/records/purchases.ts` — new filter flags; `src/lib/records/entry-view.ts` — shared entry data.
- `src/lib/validation.ts` — Phase 4a boundary schemas; `src/app/actions.ts` — 11 new actions.
- `src/app/{overview,purchases,recurring,pots,insights,settings}/page.tsx` — the six pages (force-dynamic).
- `src/components/{record-forms,schedule-forms,settings-forms,site-nav}.tsx` — Phase 4a client components;
  `src/components/recurring.tsx` — slim projection form.
- `tests/{insights,insights-view,recurring-calendar,settings-domain}.test.ts` — 28 new tests.
- `README.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/HANDOFF.md` — same-PR documentation.
