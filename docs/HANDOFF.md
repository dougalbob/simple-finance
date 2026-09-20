# Handoff — 2026-09-20 — Session 3 complete: Phase 2b mobile entry build

## Goal and user decisions

Session 3 of the agreed session map (`docs/IMPLEMENTATION_PLAN.md` → *Session map*). Deliverable: Phase 2b —
server actions, Zod boundary schemas and mobile-first entry flows for Add Purchase, Add Fuel and Update Balance,
built on the Phase 2a domain. Documentation rides in the same change as the code, as instructed by the product
owner.

Standing decisions remain unchanged:

- Money is integer pence only; Zod validates at the server boundary and the domain remains the authority.
- People, vehicles and suppliers are household data and are never seeded. Categories are product content and
  remain seeded by the checked-in migration.
- The signed-in user has full mutual visibility/editing; every correction is audited and version guarded.
- Duplicate detection is non-blocking. A saved duplicate is reviewed and explicitly voided; it is never silently
  deleted or blocked.
- Release authority is the full delivery loop: gates → PR → merge → annotated tag → GHCR verification → user
  Force Update in Unraid and the documented acceptance checks. No release was made this session; v0.1.0 remains
  the end-of-Phase-5 release.

## Current state

- Repository: `dougalbob/simple-finance`.
- Session branch: `arena/01a0c0cb-simple-finance` (continue on this branch for this session; do not switch branches).
- Phase 0, Phase 1 and Phase 2a were merged to `main` in PRs #2 and #3. Phase 2b was merged to `main` via PR #4
  on 2026-09-20. Nothing has been deployed.
- Last user-confirmed deployed version: none. No tag and no image exist yet.
- The home page now has a mobile-first quick-entry surface. It intentionally does not show an estimate,
  projection or bank-connected balance before Phase 3.

## Implemented in Session 3

### Server boundary and actions

- `src/lib/validation.ts` adds strict parsed payload schemas for purchases, fuel and checkpoints. Dates are
  strict `YYYY-MM-DD` values; integer-pence bounds are shared with the existing money helpers; target shape is
  validated before the domain.
- `src/app/actions.ts` adds authenticated actions:
  - `addPurchaseAction`: parses the JSON split payload, resolves the visible payer, reuses `createPurchase`,
    and returns a serialisable duplicate notice after a successful save.
  - `addFuelAction`: resolves Vehicle Running / Fuel server-side and creates a vehicle-targeted purchase through
    the same domain path.
  - `addCheckpointAction` now accepts an optional effective date and keeps the end-of-local-date rule in the
    existing checkpoint domain.
  - `voidDuplicatePurchaseAction`: explicit version-guarded void action for the notice.
  - `addPersonAction` and `addVehicleAction`: small authenticated fresh-install setup paths; they do not seed
    personal data and are not a substitute for the Phase 4 Settings page.
- The existing domain validation is not duplicated: exact split totals, live category leaves, target existence,
  supplier inline creation, audit and concurrency still happen in `src/lib/records/`.

### Mobile entry UI

- `src/components/quick-entry.tsx` provides three tabbed flows:
  - Add Purchase: supplier datalist with recent suppliers first, inline unknown supplier creation, near-duplicate
    prompt, most-used supplier category preselection, visible pot/paid-by/for-whom selectors, split lines,
    exact-match status, one-tap remainder assignment, optional backdate/note, and Add another confirmation.
  - Add Fuel: amount-first entry with visible vehicle, paid-by and pot defaults; Fuel category is fixed on the
    server and the vehicle can be flipped in one tap.
  - Update Balance: pot, amount, optional date-only effective date and note.
- All three forms disable their save control while invalid or pending and use a submit ref guard so one flaky
  tap cannot create two in-flight submissions. Controlled inputs remain on screen after a server validation
  error.
- The duplicate notice links to the retained review row on the home page and offers an explicit “Void this copy”
  action. Voided history remains visible and marked.
- `src/components/household-setup.tsx` lets a fresh private installation add the people and vehicles needed by
  the visible attribution chips.
- The home page now includes recent entries, checkpoint review, the Phase 1 pot forms and honest labels saying
  these are reported figures, not bank balances.
- `src/lib/records/suppliers.ts` adds entry ordering: recently used non-void suppliers first, then alphabetical
  names. The most-used category remains live-derived, never cached.

### Tests and docs

- `tests/entry-validation.test.ts` adds four boundary-schema cases. The complete suite is now **111 tests**.
- README, implementation plan and this handoff were updated in the same change.
- The plan records Session 3 decisions 49–54, including the email-local-part payer fallback, supplier ordering,
  duplicate handling, fresh-install setup and browser harness status.

## Validation evidence

Run from the repository root:

- `npm ci --ignore-scripts` — pass in this sandbox. Plain `npm ci` remains the CI proof path because this
  environment may be unable to fetch Node headers from `nodejs.org`; the bundled better-sqlite3 prebuild works.
- `npm run format:check` — pass.
- `npm run typecheck` — pass.
- `npm test` — **111 tests, 111 pass, 0 fail**.
- `NEXT_TELEMETRY_DISABLED=1 npm run build` — pass; home page compiles as a dynamic route.
- `npm audit --omit=dev` — 0 vulnerabilities.
- `git diff --check` — pass after the final documentation/code edits.
- Playwright/browser run — **not claimed**. No Playwright package or browser is present in this sandbox. The
  mobile layout and single-flight guards are implemented; establish the browser harness before the Phase 2 exit
  is accepted as browser-tested, and repeat the E1/E2 flow at a real mobile viewport.

## Outstanding acceptance, risks and blockers

- Phase 2b has no known code blocker. Browser tooling is the explicit outstanding verification item.
- The payer default is deterministic until a Settings mapping exists: match a person label in the email local
  part, otherwise first person. It is visible and overrideable, and must not be presented as identity proof.
- `addPersonAction`/`addVehicleAction` are intentionally small setup paths; full labels, ordering and settings
  editing belong in Phase 4.
- Estimate/projection engines do not exist yet. No current UI may imply a safe-to-spend figure or forecast.
- Attachments, supplier interactions/reference pairs, schedules and renewals remain later planned work.
- Accepted trade-offs from previous sessions continue: assume-cleared checkpoint semantics, synchronous single
  writer concurrency assumption, container root user pending the Phase 5 security review.

## Next exact actions — Session 4 / Phase 3

1. Verify `origin/main`/the merged Phase 2b PR state before starting the next platform-assigned branch; do not
   reuse a previous session branch.
2. Read `AGENT_APP_BLUEPRINT.md`, SPEC §§7–8 and §§11, 15.2, 16–17, plus decisions 1–28 and 49–54 in the plan.
3. Build Phase 3 domain first: schedules and unique upcoming→converted instances, income receipts, due-date
   comparison semantics, estimate engine, payday projection with period-level half-up rounding, two warning
   tiers, and the pot-level transfer watch. Keep engines framework-free and test E3/E5/E8 with DST and date
   boundaries.
4. Decide and document the Phase 3 money-record shape for expected receipts before adding migrations; preserve
   the existing integer-pence/audit/version conventions.
5. Keep README, plan and handoff current in the same PR. Do not tag or publish; v0.1.0 remains at the end of
   Phase 5.

## File map for this handoff

- `src/app/actions.ts` — authenticated pot/checkpoint and Phase 2b entry/setup actions.
- `src/app/page.tsx` — authenticated home, quick-entry data assembly and recent-record review.
- `src/components/quick-entry.tsx` — mobile-first purchase, fuel and balance flows.
- `src/components/household-setup.tsx` — people/vehicle setup.
- `src/lib/action-state.ts` — action and duplicate-notice serialisable state.
- `src/lib/validation.ts` — Zod entry schemas plus Phase 1 schemas.
- `src/lib/records/suppliers.ts` — recent-first entry ordering and derived category memory.
- `tests/entry-validation.test.ts` — Phase 2b Zod boundary coverage.
- `README.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/HANDOFF.md` — same-session documentation.
