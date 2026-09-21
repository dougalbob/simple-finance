# Simple Finance — Session Handoff

**Session:** 6 (Phase 5 — hardening & first release) · **Date:** 2026-09-21
**Branch:** `arena/01a0c193-simple-finance` · **Base:** `main` @ `07343df` (Phase 4b, PR #8)
**Head at handoff:** `6dbeafe` *("Phase 5 hardening: backup v2 with documents, live restore, attachments
pipeline, supplier details")* plus the uncommitted container/deployment/docs work listed below.

Read in this order: `AGENT_APP_BLUEPRINT.md` → `docs/SPEC.md` → `docs/IMPLEMENTATION_PLAN.md` (session map and
decision log, now including decisions 76–88 from this session) → this file.

---

## 1. What was delivered this session

**Release-blocking capability**

- **Backup format 2** (`src/lib/backup/backup.ts`): WAL-safe snapshot + every attachment the *snapshot*
  references + `manifest.json` (counts, per-file bytes and sha256, orphan report). A reference to a missing
  file fails the backup (409) instead of producing a misleading archive; orphans are reported and never
  touched.
- **Restore** (`src/lib/backup/restore.ts`): decrypt-first, strict member allowlist, manifest validation,
  per-member size + sha256, `quick_check` and table probing, referenced-document verification — all *before*
  the swap. The previous database (with its WAL sidecars) and documents directory are preserved under
  `.pre-restore-<stamp>` names; the error path rolls back and never deletes the last recoverable copy.
  Formats 1 (attachments-free) and 2 are accepted; format 1 *with* a document manifest is refused.
- **Live in-place restore** (`src/lib/backup/live-restore.ts`, `src/app/api/restore/route.ts`): closes the
  process-wide handle, restores, reopens, proves the reopened handle; authentication failures surface as
  wrong-password rather than generic failure; 512 MB bound; typed `RESTORE` confirmation; same-origin guard.
- **Attachment pipeline** (`src/lib/records/attachments.ts`): one module for sniffing, size limit, key
  pattern, display-name sanitising, transactional store + audit, and the read path — used by the upload
  action, the serving route, backup and restore.
- **Suppliers as domain operations** (`src/lib/records/supplier-details.ts`): reference pairs, interaction log
  and the contact-card edit, all validated, audited and version-guarded; `upcomingSupplierFollowUps` feeds the
  Contracts page. The contact card was previously write-only through the form action — it is now a real
  domain operation with tests.
- **Container least privilege** (closes the Phase 5 security-review item): `docker-entrypoint.sh` sources
  `/data/.env`, aligns `/data` ownership once, applies migrations, then `exec`s the server as `PUID:PGID`
  (Unraid 99:100) via `gosu`; `PUID=0` is the documented opt-out. CI and the publish workflow both assert
  `/proc/1/status` shows uid 99.
- **Unraid template + publish workflow**: `simple-finance.xml` (root, so Unraid's TemplateURL works),
  `.github/workflows/publish.yml` (tag-triggered or manual; version-vs-tag check; build; smoke test *before*
  push; then `vX.Y.Z`, `latest`, `sha-<short>` and a registry digest check). Merging a PR publishes nothing.
- **Playwright acceptance suite**: `playwright.config.ts`, `scripts/e2e-server.mts` (fictional seed into a
  git-ignored `.e2e-data`, then `next dev` on 3100 with the dev identity bypass), and `e2e/home.spec.ts`,
  `e2e/desktop.spec.ts`, `e2e/backup.spec.ts`. CI job `browser` installs Chromium and runs `npm run test:e2e`.

**Verified in this session**

| Check | Result |
| --- | --- |
| `npm test` | 224 tests / 62 suites / 224 pass / 0 fail (13.8 s) |
| `npm run format:check` | clean (Prettier; markdown excluded by `.prettierignore`) |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean (Turbopack; warning about dynamic `path.resolve` in `restore.ts` resolved with `/* turbopackIgnore: true */`) |
| `npm audit --omit=dev` | 0 vulnerabilities (4 moderate remain in the dev-only drizzle-kit/esbuild chain — **accepted**; do not run `npm audit fix --force`) |
| Dev server smoke (`next dev` on 3100 with seeded fictional data) | all nine pages return 200; health returns `{"status":"ok"}`; seeded renewal appears as "renews in 17 days", contract end "in 12 days", follow-ups present |
| `E2E_SEED_ONLY=1 node --import tsx scripts/e2e-server.mts` | seed runs clean against real domain modules |
| Server-rendered expectations used by the e2e specs | checked one by one against the running dev server (labels, headings, seeded rows, calendar `data-date` cells) |

**Not verified — and why**

- **No browser has executed the Playwright suite.** The sandbox cannot download browsers
  (`npx playwright install chromium` fails; the host is blocked) and has no system browser. The suite runs in
  the CI `browser` job; its first green run is required evidence before the `v0.1.0` tag.
- **No Docker in the sandbox.** The image build, the entrypoint's ownership/`gosu` behaviour and the publish
  workflow are exercised only by CI (`docker` job) and by the publish workflow itself.
- **Cloudflare Access sign-in** cannot be exercised here (needs the real team domain); it is on the household
  acceptance list below.

---

## 2. Uncommitted work on this branch (as of handoff)

`Dockerfile` · `docker-entrypoint.sh` · `simple-finance.xml` · `.github/workflows/{ci,publish}.yml` ·
`playwright.config.ts` · `scripts/e2e-server.mts` · `e2e/{home,desktop,backup}.spec.ts` ·
`docs/assets/simple-finance-icon.{svg,png}` · `next.config.ts` (`allowedDevOrigins`) · `.gitignore` ·
`package.json`/`package-lock.json` (Playwright dev dependency, `test:e2e` scripts) · docs
(`README.md`, `docs/SPEC.md` §18.2/§18.3/§23, `docs/IMPLEMENTATION_PLAN.md` status + decisions 76–88 +
file map, `.env.example`) · this file.

Everything listed was green-gated as shown above. **The next session's first job is to commit this set, push,
open the PR, get CI green (especially the `browser` job), merge, then tag `v0.1.0` and watch the publish
workflow.**

---

## 3. Immediate next steps (in order)

1. **Commit and push** the uncommitted set above; open the PR (documentation rides in the same PR as the code).
2. **CI**: confirm `gates`, `browser` and `docker` jobs are green. If `e2e/` selectors need adjusting, fix
   them there — they have never run in a browser. Expect possible first-run friction in
   `scripts/e2e-server.mts` (its domain calls were written against the interfaces, and the seed has been run
   successfully with `E2E_SEED_ONLY=1`, but the browser flows themselves are new).
3. **Merge** after review, then tag **`v0.1.0`** (annotated) on the merged commit and let `publish.yml` run;
   verify the published tags (`v0.1.0`, `latest`, `sha-<short>`) and the digest check in the workflow log.
4. **Household acceptance** (the product owner, on the real installation) — recorded in blueprint §12 terms:
   Force Update the Unraid container; sign in through the real Cloudflare Access hostname; record a real
   till-moment purchase on a phone **with a camera receipt attachment**; check the checkpoint/projection
   panels for sanity; confirm a renewal alert inside its window; then exercise **Settings → Backup** and
   **restore the archive into a clean isolated installation**, verifying that a receipt attached in step 3
   comes back (SPEC §18.5). Record the outcome, including anything that needed judgement.
5. **After acceptance**: leave the installation alone (no follow-up automation), and if the household wants
   v2 scope (income-schedule working-day shift, email alerts, HEIC conversion), those are already recorded as
   roadmap items in the plan — do not start them without a new instruction.

## 4. Things that will bite if forgotten

- **`simple-finance.xml`** maps `/data` → `/mnt/user/appdata/simple-finance` and documents a free host port;
  do not change the fixed `/data` path, and do not reuse another container's port when installing.
- **`/data/.env` overrides the template** — the entrypoint sources it with `set -a`. Its contents are
  secrets; it must stay out of the repository and out of any screenshot.
- **Never edit an applied migration.** New migrations are additive; `drizzle/` is the record.
- **The backup password is never stored and cannot be recovered.** The UI says so; the README says so.
- **`PUID`/`PGID` default to 99/100**; the smoke tests assert the server is not root. If a future change makes
  the entrypoint chown on every start, the tests will not catch it — the intent is "align once, then leave
  ownership alone".
- **`/api/health`** is public by design and reveals nothing; every other route authenticates independently.
- **The e2e seed is fictional-only and git-ignored** (`.e2e-data/`); never point it at real data.
- **The `docker` CI job needs the Docker daemon**; it is the only place the entrypoint is exercised outside a
  real Unraid box.

## 5. Small, known, non-blocking cleanups

- `src/lib/backup/backup.ts`: check for the leftover `countRows`/unused `db` helpers noted in an earlier
  session and remove them if still present.
- `scripts/e2e-server.mts`: a `void vehicleB;` line exists to keep the second seeded vehicle intentional
  (Insights honesty row); if it reads as dead code after the first CI run, replace it with a comment only.
- Four moderate dev-only advisories (drizzle-kit/esbuild) remain; `npm audit fix --force` would downgrade
  drizzle-kit to 0.18.1 — leave it.
