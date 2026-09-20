# Handoff — 2026-09-20 — Discovery complete; spec agreed; no code written

## Goal and user decisions

Requirements discovery for **Simple Finance** — a private, shared household spending app for two users
(fictional personas in docs: Alex and Sam) focused on available money, upcoming commitments and avoiding
overdraft charges. The discovery session's deliverable is this document set; the user explicitly directed
**no coding in the discovery session** to protect context length for the first coding session.

All product decisions are recorded in `docs/IMPLEMENTATION_PLAN.md` → *Decision log* (22 dated decisions),
with the full behavioural specification and worked fictional examples (E1–E8) in `docs/SPEC.md`.
Read, in order: `AGENT_APP_BLUEPRINT.md` (build contract) → `docs/SPEC.md` → `docs/IMPLEMENTATION_PLAN.md`
→ this file.

**Scope additions agreed later the same day (decisions 23–28 in the plan's decision log):** supplier contact
cards + reference pairs + interaction log; fixed-term contract end dates on schedules (alert-only, never
auto-stop); renewal records with per-item warning leads (default 21 days; **in-app channel confirmed for v1,
email alerts recorded as a v2 roadmap item**); receipt/invoice attachments (PNG/JPEG/PDF, desktop picker +
mobile camera, retroactive,
in backups with sha256 verification); fixed data root `/mnt/user/appdata/simple-finance` → `/data`
(sqlite, `.env`, `documents/`, `logging/`); dedicated backup/restore contract in SPEC §18; new SPEC §21–§23
and worked example E9; open questions OQ9–OQ13.

**Release authority for the coding session: FULL DELIVERY LOOP** (blueprint §10 option 1), granted by the
user 2026-09-20: gates → PR → merge → annotated `vX.Y.Z` tag → GHCR publish verification → user Force
Updates in Unraid and runs the acceptance checks you list. Recorded once per blueprint §1 — do not re-ask
per release. The *next session's* platform branch/remote restrictions still govern which branch you work on.

## Current state

- Repository: `https://github.com/dougalbob/simple-finance` — **public**, created 2026-09-20.
- `main` at `0b7035a` ("Add files via upload" — adds `AGENT_APP_BLUEPRINT.md`; base `5313a3e` "Initial commit").
- Discovery session branch: `arena/01a0c00b-simple-finance`, rebased onto `origin/main` (`0b7035a`),
  containing:
  - the four documents: `README.md` (updated), `docs/SPEC.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/HANDOFF.md`;
  - `.gitignore` (protects real data/secrets/backups — committed **before** any code, deliberately).
- **PR #1 (docs only) was merged into `main` on 2026-09-20 at the product owner's request.** Verify with
  `git log origin/main` — these documents should be present at the tip of `main`. The next session starts
  from `main` on its own assigned branch; the discovery branch `arena/01a0c00b-simple-finance` is history.
  If for any reason the merge did not land, do not assume the docs are on `main` — ask the user first.
- **No application code, no package.json, no CI, no image, no deployment.** Nothing has been published.
  Last user-confirmed deployed version: none (nothing exists to deploy).

## Implemented and files changed

Documents only (this session): `.gitignore`, `README.md`, `docs/SPEC.md`, `docs/IMPLEMENTATION_PLAN.md`,
`docs/HANDOFF.md`. No behaviour implemented; every "agreed" statement describes a decision, not built software.

## Validation evidence

- `git fetch`/rebase confirmed branch sits cleanly on `origin/main` (0b7035a).
- `gh` CLI authenticated; repo metadata verified via `gh repo view` (public, slug `simple-finance`).
- No tests exist (no code). All 22 decisions were confirmed interactively by the user in the discovery
  session, several via free-text answers quoted/summarised in the decision log.

## Outstanding acceptance, risks and blockers

- **User review of the spec docs** (the PR) is the gate before implementation begins.
- Open questions OQ1–OQ8 in `docs/IMPLEMENTATION_PLAN.md` — none block Phases 0–1; each has a proposed default.
- Binding constraints for the coding session:
  - Public repo → **fictional data only** in commits/PRs/issues/screenshots/fixtures/seeds/artefacts; real
    names, figures, payday, thresholds never leave the private installation config.
  - No bank integration, no bank credentials, ever (SPEC §19).
  - Money in integer pence; per-period rounding rules (SPEC §6–7); schedule instances exist in exactly one
    state (SPEC §11.2) — both property-tested.
  - Work on the next session's assigned branch only; follow its platform restrictions (blueprint §1).

## Next exact actions

1. Read `AGENT_APP_BLUEPRINT.md`, `docs/SPEC.md`, `docs/IMPLEMENTATION_PLAN.md` (profile → phases → decision
   log → open questions), this handoff. Confirm the docs PR is merged to `main` (or get it merged).
2. Start **Phase 0 (Bootstrap)** then **Phase 1 (thin vertical slice)** per `docs/IMPLEMENTATION_PLAN.md`,
   choosing current supported dependency versions (blueprint §3) — do not copy historical versions.
3. Resolve OQ5 (receipts storage shape) during Phase 3 design; apply proposed defaults for OQ1–OQ4, OQ6–OQ8
   unless the user objects.
4. Update README/plan/handoff **in the same PR as each behaviour change** (blueprint §8); first planned
   release is **v0.1.0** at end of Phase 5, using the full delivery loop authority recorded above.

## Environment facts verified this session (2026-09-20)

- Sandbox: workspace `/home/user/simple-finance`; `git` and `gh` both authenticated and working.
- `origin` = `https://github.com/dougalbob/simple-finance`; default branch `main`; repo public, not empty.
- Node/npm available in sandbox (versions not pinned this session — re-check in the coding session; do not
  carry assumptions forward). No browser tooling verified this session; the next session must establish what
  Playwright/preview capability exists rather than inheriting "no browser" (blueprint §8: record constraints
  with dates and evidence).
- **Sandbox git state can be reset between turns:** during this session the workspace was re-cloned from
  `origin` and the session branch was recreated from its recorded base commit, silently dropping earlier
  *local-only* commits (their files survived on disk as untracked copies; history did not). Lesson, verified
  2026-09-20: **only pushed commits are durable.** Push the working branch after every meaningful commit,
  and at the start of each turn verify `git log --oneline -5` / `git reflog` before building on history.
- These facts are dated; re-verify anything load-bearing before relying on it.
