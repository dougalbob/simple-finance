# Handoff — 2026-09-20 — Session 2 complete: Phase 2a (core money records)

## Goal and user decisions

Session 2 of the agreed **session map** (`docs/IMPLEMENTATION_PLAN.md` → *Session map* — adopted by the
product owner 2026-09-20; the map table itself was written down this session because the plan and README
referenced it but it never existed). Deliverable: Phase 2a — schema + pure domain modules for the core
money records, with E1/E2/E4/E6/E7 as integration tests.

Standing user instructions (unchanged):

- **Documentation rides in the same PR as the code, every session** (no document rot). README, plan and
  handoff were updated this session accordingly (PR #3, second commit).
- **Release authority: full delivery loop** (blueprint §10 option 1), granted 2026-09-20 and recorded once:
  gates → PR → merge → annotated `vX.Y.Z` tag → GHCR publish verification → user Force Updates in Unraid
  and runs the listed acceptance checks. It applies to releases; **no release was made this session**
  (v0.1.0 lands at the end of Phase 5), so no tag and no image exist yet. Merging session PRs to `main` is
  within this authority and was done.

## Current state

- Repository: `dougalbob/simple-finance` (public). **Phase 2a merged to `main` via PR #3 on 2026-09-20**.
  The session branch was `arena/01a0c0b4-simple-finance` (history now).
- Next session: work on **your own platform-assigned branch from `main`**; never reuse this one.
- Last user-confirmed deployed version: **none** (nothing deployed, by design — first release is v0.1.0,
  end of Phase 5).
- CI: `.github/workflows/ci.yml` runs on PRs and pushes to `main` — `gates` job (format, typecheck, 107
  tests, build, `npm audit --omit=dev`) and `docker` job (image build + start/health/recreate-with-volume
  smoke). Check the PR #3 run for the evidence; both were green at merge.
- The Phase 2a domain has **no UI yet** — the home page still shows pots and checkpoints only. Mobile entry
  flows are Session 3 (Phase 2b).

## Implemented and files changed (Session 2)

Full file map: `docs/IMPLEMENTATION_PLAN.md` → *File map (current)*. Summary:

- **Schema:** `drizzle/0001_phase2a_records.sql` (additive; 0000 untouched) — `people`, `vehicles`,
  `categories` (seeded with the 39-row SPEC §12 tree in-migration), `suppliers` (+ contact-card columns),
  `purchases` + `allocations`, `transfers`; CHECK backstops (non-zero totals, refund sign, positive transfer
  amounts, distinct transfer pots); indexes for pot/time/supplier/category reads. Journal + snapshot updated
  via `drizzle-kit generate`, seed appended by hand.
- **Domain (`src/lib/records/`):** `splits.ts` (pure exact-total rule shared by UI/server/tests),
  `categories.ts` (two levels, sibling-name uniqueness, retire-preserves-history), `people.ts`,
  `vehicles.ts`, `suppliers.ts` (contact card, normalized uniqueness, live-derived most-used-category
  memory), `purchases.ts` (splits, refunds as linked negatives with (category,target) match + cumulative
  cap, duplicate-notice search), `transfers.ts`, `occurred.ts` (backdating rule), `errors.ts` (optimistic
  concurrency). Edit/void with in-transaction audit + version checks on every correctable record.
- **Shared helpers:** `src/lib/time.ts` (+ `isValidLocalDate`, `toLocalDateString`, `endOfLocalDate` —
  DST-tested); `src/lib/money.ts` (+ exported `MAX_ABS_PENCE`/`isValidPenceAmount`, reused by Zod schema).
- **Checkpoints:** `addCheckpoint` gains the SPEC §5 effective-date rule (date-only → end of local date,
  today-or-earlier) plus future-date rejection and amount/note validation. `effectiveAt` is now optional
  (backward compatible — existing callers unchanged).
- **Tests (107 total, was 60):** `tests/splits.test.ts`, `tests/categories.test.ts` (full SPEC §12 seed
  assertion), `tests/parties.test.ts`, `tests/purchases.test.ts` (E1, E2, E6, E7 as named scenarios +
  refund/edit/void/concurrency/filter rules), `tests/transfers.test.ts` (E4 + rules), `tests/household.ts`
  fixture; `tests/time.test.ts` extended (local dates, DST days). Phase-1 maintenance: fixed-date
  checkpoint tests pass explicit `now`; `__drizzle_migrations` count bumped to 2.
- **Docs:** session-map table added to the plan (decision 29 referenced one that never existed); README
  status + test count; plan decisions 37–48 (refund linkage, derived memory, backdating, void discipline,
  sync-tx concurrency assumption, duplicate rule, seeding policy).

## Validation evidence (Session 2, all commands run in the repo root)

- `npm run format:check` — pass. `npm run typecheck` — pass.
- `npm test` — **107 tests, 107 pass, 0 fail**: E1 (mixed split, paid/entered/for-whom distinct, Sam's
  share, supplier memory), E2 (fuel + vehicle flip edit), E4 (two-sided legs, household net zero, excluded
  from spending), E6 (backdate ordering vs both checkpoints, date-only checkpoint rule), E7 (21-minute
  duplicate notice, non-blocking, void resolution, voided copies excluded, window/scope negatives);
  split edge cases (signs, zero, mismatch); category retire-blocks-new/preserves-history; refund caps and
  link rules; stale-version conflicts; void discipline; supplier memory tie-breaks; DST transition days;
  all 60 Phase-1 tests still green.
- `NEXT_TELEMETRY_DISABLED=1 npm run build` — pass.
- `npm audit --omit=dev` — 0 vulnerabilities.
- Migration verified on a scratch database (fresh apply + idempotent re-apply, 39 seeded categories);
  `scripts/migrate.cjs` test green (covers the new migration file).
- Docker unavailable in this sandbox; image build + container smoke ran in the CI `docker` job (green on
  PR #3).
- **Sandbox caveat (blueprint §9, re-verified 2026-09-20):** `nodejs.org` is still blocked here
  (SSL_SYSCALL on connect), so this session again used `npm ci --ignore-scripts` (prebuilt
  `better-sqlite3`, verified by the suite). CI proves plain `npm ci`. Re-verify next session.

## Outstanding acceptance, risks and blockers

- Nothing blocks Session 3 (Phase 2b — mobile entry UI). No open questions require the user.
- Playwright/browser tooling is **still not established** — Session 3 needs it for the mobile-viewport run
  (Phase 2 exit criteria). Establish it there, and record what exists.
- The Phase 4a/4b page split in the new session-map table is a working split — confirm the exact allocation
  with the product owner when Session 5 starts (noted in the plan; not a blocker for Sessions 3–4).
- Known accepted trade-offs (carried): container runs as root (Phase 5 review); `estimate()`/projection
  engines do not exist yet (Phase 3), so no UI may imply an estimate — only reported figures and record
  counts; supplier interaction log + reference pairs deferred to Phase 2b with the entry UI.

## Next exact actions (Session 3 — Phase 2b: mobile entry UI)

1. Read `AGENT_APP_BLUEPRINT.md` → `docs/SPEC.md` (§9, §15.1) → plan (session map, decisions 37–48) →
   this file. Verify `origin/main` contains PR #3 before building on it.
2. Phase 2b scope: server actions + Zod schemas for purchase/fuel/checkpoint entry on top of the Phase 2a
   domain (no new validation logic — reuse the domain errors); mobile-first entry flows (Add Purchase with
   splits + remainder helper, Add Fuel prefills, Update Balance with effective date); supplier autocomplete
   (recents first, inline add, near-duplicate prompt) + most-used-category chip; visible default chips
   (target, pot, paid-by) with one-tap overrides; duplicate-notice display (non-blocking) with review/void
   link; single in-flight submission guard (§14); mobile-viewport Playwright run of E1/E2.
3. Conventions to follow (learned Sessions 1–2): Drizzle needs terminal `.get()/.all()/.run()`; domain
   logic in framework-free modules used by both actions and tests; Zod at the boundary; money integer pence
   only; dates/instants per `src/lib/time.ts` + `src/lib/records/occurred.ts`; tests flat in
   `tests/*.test.ts` with the `tests/household.ts` fixture; Prettier never touches `*.md`; read helpers
   accept `Db | DbTx` so actions and tests share one path.
4. End of session: update README/plan/handoff **in the same PR**, push after every meaningful commit
   (only pushed commits are durable), merge under the standing authority, no tag (no release until v0.1.0).

## Environment facts verified this session (2026-09-20)

- Sandbox: Node v22.22.3, npm 10.9.8; `better-sqlite3` 13.0.3 native works via bundled prebuild (verified
  by the suite after `npm ci --ignore-scripts`).
- Network: npm registry and github.com reachable; **nodejs.org still blocked** (see caveat above).
  `docker` not installed locally.
- `git`/`gh` authenticated; repo public; PR #3 (Phase 2a) merged into `main`.
- Local clone was single-branch (`remote.origin.fetch` pinned to `main`); widened to
  `+refs/heads/*:refs/remotes/origin/*` this session so `gh` could see the pushed session branch. If a
  future session hits "you must first push the current branch" after pushing, check the fetch refspec.
- Tooling lesson (2026-09-20): do not batch two edits to the **same file** in one parallel tool block —
  the second write can clobber the first. Same-file edits go in sequence.
- These facts are dated; re-verify anything load-bearing before relying on it.
