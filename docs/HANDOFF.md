# Handoff — 2026-09-20 — Session 1 complete: Phase 0 + Phase 1 (bootstrap + vertical slice)

## Goal and user decisions

Session 1 of the agreed **session map** (`docs/IMPLEMENTATION_PLAN.md` → *Session map* — adopted by the
product owner 2026-09-20; do not re-open phasing per session). Deliverables: Phase 0 (bootstrap) and
Phase 1 (thin vertical slice: authenticated access → validated write → persistent read → container
startup/migrations → backup/restore skeleton).

Standing user instructions:

- **Documentation rides in the same PR as the code, every session** (no document rot). README, plan and
  handoff were updated this session accordingly.
- **Release authority: full delivery loop** (blueprint §10 option 1), granted 2026-09-20 and recorded once:
  gates → PR → merge → annotated `vX.Y.Z` tag → GHCR publish verification → user Force Updates in Unraid
  and runs the listed acceptance checks. It applies to releases; **no release was made this session**
  (v0.1.0 lands at the end of Phase 5), so no tag and no image exist yet. Merging session PRs to `main` is
  within this authority and was done.

## Current state

- Repository: `dougalbob/simple-finance` (public). **Phase 0+1 merged to `main` via PR #2 on 2026-09-20**
  (merge commit — verify with `git log origin/main` if history matters to you). The session branch was
  `arena/01a0c083-simple-finance` (history now).
- Next session: work on **your own platform-assigned branch from `main`**; never reuse this one.
- Last user-confirmed deployed version: **none** (nothing deployed, by design — first release is v0.1.0,
  end of Phase 5).
- CI: `.github/workflows/ci.yml` runs on PRs and pushes to `main` — `gates` job (format, typecheck, 60
  tests, build, `npm audit --omit=dev`) and `docker` job (image build + start/health/recreate-with-volume
  smoke). Check the PR #2 run for the evidence; both were green at merge.

## Implemented and files changed (Session 1)

Full file map: `docs/IMPLEMENTATION_PLAN.md` → *File map (current)*. Summary:

- **Scaffold:** package.json + lockfile (Next 16.3.5, React 19.3, TS 5.9.3, Tailwind 4.3.3, drizzle-orm
  0.45.2 / drizzle-kit 0.31.10, better-sqlite3 13.0.3, zod 4.6.5, jose 6.2.12, tar 7.5.22), strict tsconfig,
  Prettier (ignores `*.md`), scripts for all gates, `drizzle/0000_phase1_slice.sql`.
- **Auth:** `src/lib/auth/verify.ts` (jose, RS256, issuer/audience/expiry/allowlist, JWKS cache),
  `current-user.ts` (framework-free, fail-closed; dev bypass computed impossible in production),
  `next.ts` (adapter). Env names per plan decision 33.
- **Domain:** `src/lib/records/pots.ts` (create pot, immutable checkpoint, reads), `money.ts` (integer
  pence), `time.ts` (Europe/London), `audit.ts` (in-transaction), `validation.ts` (Zod boundary).
- **App:** home page (pots + latest checkpoints + forms + recent table), unauthorized page, server actions,
  `/api/health` (public, no diagnostics), `/api/backup` (POST, authenticated, encrypted download,
  Content-Disposition filename).
- **Backup/restore skeleton:** `src/lib/backup/` — WAL-safe snapshot, manifest + sha256, AES-256-GCM +
  scrypt framing (`SFBA` v1), filename contract (DST/midnight tested), restore to isolated targets with
  integrity checks, safe-member filter, preserved-previous rollback. In-place live restore is Phase 5.
- **Container:** multi-stage `Dockerfile`, `docker-entrypoint.sh` (dirs → trusted `/data/.env` →
  migrations → exec), `scripts/migrate.cjs` (production runner, CJS, no TS deps), `.env.example`,
  `.dockerignore`.

## Validation evidence (Session 1, all commands run in the repo root)

- `npm run format:check` — pass. `npm run typecheck` — pass.
- `npm test` — **60 tests, 60 pass, 0 fail**, covering: money parsing/formatting; relative ages; backup
  filename contract incl. both 2026 DST transitions and local-midnight rollover; config defaults/overrides
  and the production dev-bypass refusal; JWT verification against a local JWKS server (valid, expired,
  wrong issuer/audience/key, off-allowlist, garbage, unconfigured); current-user fail-closed paths;
  isolated-DB slice (WAL, FK enforcement, audit-in-transaction, idempotent migrations, latest-checkpoint
  ordering); backup/restore round-trip incl. wrong password, tampered/truncated archives, previous-db
  preservation; the real `/api/backup` route handler (401/400/200 + restorable bytes);
  `scripts/migrate.cjs` idempotency; version/package.json alignment.
- `NEXT_TELEMETRY_DISABLED=1 npm run build` — pass (`/` dynamic, health/backup routes present).
- `npm audit --omit=dev` — 0 vulnerabilities.
- Entrypoint simulate (local, production mode, temp DATA_DIR): start → healthy in ~2s; **recreate** →
  migrations idempotent, database intact, healthy again. Live probes: `/` no/garbage token → 307 to
  `/unauthorized`; `/api/backup` no/garbage token → **401**; `/api/health` public 200.
- Docker itself is unavailable in this sandbox; the image build + container recreate smoke runs in the CI
  `docker` job (green on PR #2). An authenticated write through the real container remains a Phase 5
  acceptance item (needs the real Cloudflare hostname).
- **Sandbox caveat (blueprint §9, recorded, environmental):** plain `npm ci` fails here because
  `nodejs.org` is blocked (npm's gypfile auto-build wants Node headers to compile better-sqlite3). Use
  `npm ci --ignore-scripts` — the package bundles prebuilt binaries — and rely on the suite to verify the
  native module. CI proves plain `npm ci` in an unrestricted environment. Re-verify the constraint next
  session; it may not persist.

## Outstanding acceptance, risks and blockers

- Nothing blocks Session 2 (Phase 2a — records core). No open questions require the user.
- Phase 1 exit criteria: all met; the real-container authenticated write and real-Cloudflare sign-in are
  **Phase 5 acceptance items by design** (blueprint §12), not gaps.
- Playwright/browser tooling was **not** established this session (not needed for Phase 0+1). Session 3
  (Phase 2b, mobile UI) needs it — establish it there, and record what exists.
- Known accepted trade-offs: container runs as root (Phase 5 review); image size favours robustness over
  slimness; `estimate()`/projection engines do not exist yet (Phase 3) so the home page only ever shows
  *reported* checkpoint figures, never implied estimates (honesty rule, SPEC §1).

## Next exact actions (Session 2 — Phase 2a: core money records)

1. Read `AGENT_APP_BLUEPRINT.md` → `docs/SPEC.md` (§5–§10, §12) → plan (session map, data-model sketch,
   decision log 29–36) → this file. Verify `origin/main` contains PR #2 before building on it.
2. Phase 2a scope: extend the schema (people, vehicles, categories, suppliers, purchases + allocations
   with the exact-total constraint, transfers, refunds as negative allocations with `refund_of` link,
   void semantics) via **new** migrations; pure domain modules (split validation, category tree) in
   `src/lib/records/`; void/edit + audit + optimistic concurrency (version columns exist on pots; add to
   new entities); integration tests for **E1, E2, E4, E6, E7** (SPEC §17) on isolated databases.
3. Conventions to follow (learned this session): Drizzle needs terminal `.get()/.all()/.run()` (decision
   31); domain logic in framework-free modules used by both actions and tests; Zod at the boundary;
   money integer pence only; dates/instants per `src/lib/time.ts`; tests flat in `tests/*.test.ts`;
   Prettier never touches `*.md`.
4. End of session: update README/plan/handoff **in the same PR**, push after every meaningful commit
   (only pushed commits are durable), merge under the standing authority, no tag (no release until v0.1.0).

## Environment facts verified this session (2026-09-20)

- Sandbox: Node v22.22.3, npm 10.9.8, gcc/g++/python3/make present; `better-sqlite3` 13.0.3 native works
  (bundled linux-x64 prebuild; verified by the suite).
- Network: npm registry and github.com reachable; **nodejs.org blocked** (see caveat above). `docker` not
  installed locally. Live preview of `npm run dev` works (bind 0.0.0.0; dev bypass for identity).
- `git`/`gh` authenticated; repo public; PR #1 (docs) and PR #2 (Phase 0+1) merged into `main`.
- These facts are dated; re-verify anything load-bearing before relying on it.
