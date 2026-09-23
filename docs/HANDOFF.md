# Simple Finance — Session Handoff

**Session:** v0.1.9 — documentation carry-over (sandbox notes, working ethos) · **Date:** 2026-09-23
**Branch:** `arena/01a0cc97-simple-finance` · **Base:** `main` @ `921233a` (v0.1.8 published, tag `v0.1.8` on `00976f7`)
Supersedes the v0.1.5 handoff. That file is preserved in git history.

Read `docs/SPEC.md` for the product, and this file before changing the app. `docs/IMPLEMENTATION_PLAN.md` is
the decision log — read the decisions that touch the area you are changing.
Sandbox constraints and proven workarounds live in [`docs/SANDBOX.md`](SANDBOX.md) — check it before you chase
a failing `npm ci` or `playwright install`.
`AGENT_APP_BLUEPRINT.md` supported the initial build through the first release; it is historical context,
**not required reading**. Do not send a later session back to it first.

`AGENTS.md` carries the working ethos: these docs are a guiding hand, not a pact. If one is getting in the
way, say so and propose an alternative before deviating. `docs/RELEASE_PROCESS.md` is the one strict rule.

---

## 0. Read this before touching anything

This sandbox **can** run the Node suite. `npm ci --ignore-scripts` is enough: the `better-sqlite3` package
ships a linux-x64 / Node 22 prebuild. Re-check rather than copy a previous session's "cannot run tests" note.
The full list of blocked hosts and the proven workaround for each is in
[`docs/SANDBOX.md`](SANDBOX.md) — read that before retrying a failing install.

Re-verified in this sandbox on 2026-09-23, not copied from an earlier session:

| Capability | Status here | Consequence |
| --- | --- | --- |
| `npm ci --ignore-scripts` | **ran** | 86 packages; `better-sqlite3` prebuild loads (SQLite 3.53.4) |
| `npm test` | **ran** | 248 tests, 67 suites, all passed |
| `npx tsc --noEmit` | **ran** | clean |
| `npx prettier --check .` | **ran** | clean (markdown is excluded by `.prettierignore`) |
| `npm run build` | **ran** | compiled, 15 routes |
| `npm audit --omit=dev` | **ran** | 0 vulnerabilities |
| Playwright (`npm run test:e2e`) | **not run** | `cdn.playwright.dev` and `deb.debian.org` blocked, no system browser libs. CI's `browser` job is the evidence |
| Docker | **absent** | no daemon here. CI's `docker` job is the evidence |

**Hard rule:** never commit, screenshot or fixture real receipts or household financial data (SPEC §19, §23.3).

**Tag casing.** Always lower-case `vX.Y.Z`, annotated, on the merge commit. Never move a published tag —
v0.1.8 is published. This release line is **v0.1.9**. Merging does not publish; the tag does.

---

## 1. What this session did

Documentation only. No application behaviour changed. This is the carry-over that could not ride in the
v0.1.8 pull request because it was written after that merge.

- **`docs/SANDBOX.md` (new).** Append-only field notes on the sandbox: `nodejs.org` blocked but
  `better-sqlite3` ships prebuilds, so `npm ci --ignore-scripts` is the answer; `cdn.playwright.dev` and
  `deb.debian.org` blocked and no system libs, so browsers cannot run locally; `codeload.github.com`
  reachable where `objects.githubusercontent.com` is not. A session that hits a **new** limit must record it
  there before merging — Arena will not accept substantive pushes afterwards.
- **`AGENTS.md`.** Added "Working ethos — how to use the docs": SPEC / IMPLEMENTATION_PLAN / BLUEPRINT are a
  guiding hand, not an unbreakable pact. Challenge the spec and propose alternatives; have the short
  conversation before deviating rather than working around a doc silently. `docs/RELEASE_PROCESS.md` is the
  explicit exception — strict, and owned end to end by the agent without pulling in the household.
- **`docs/HANDOFF.md`.** This rewrite: points at `docs/SANDBOX.md`, supersedes the v0.1.5 header, and carries
  the still-open list forward **re-verified against the code** rather than copied.
- **Version `0.1.9`** in `package.json`, `package-lock.json` (both root fields), `src/lib/version.ts` and
  `simple-finance.xml`. Release notes: `docs/RELEASE_NOTES_v0.1.9.md`.

`docs/RELEASE_PROCESS.md` was deliberately left untouched.

---

## 2. Verification

| Check | Run here | Result |
| --- | --- | --- |
| `npm ci --ignore-scripts` | yes | 86 packages, no compile needed |
| `npm test` | yes | 248 passed, 67 suites, 0 failed |
| `npx tsc --noEmit` | yes | clean |
| `npx prettier --check .` | yes | clean |
| `npm run build` | yes | compiled, 15 routes |
| `npm audit --omit=dev` | yes | 0 vulnerabilities |
| `npm run test:e2e` | no | no browser binary, no system libs |

No new browser coverage — nothing in `src/` changed except the version string, so the existing `e2e/` specs
are unchanged and CI's `browser` job should pass on them as before.

Note that `npm run format` does **not** reformat markdown: `.prettierignore` excludes `*.md` because the docs
are hand-authored. Formatting a new doc is a no-op, not a check.

---

## 3. What is not open

The v0.1.8 category-tree revalidation fix is published and is not this session's work. Do not treat the
v0.1.5 mobile-filter handoff content as current; it is preserved in git history only.

---

## 4. Still open — not done, do not sneak them in

Carried forward from earlier sessions. **Each was re-verified against the code on 2026-09-23**, so this list
is current rather than inherited. v0.1.8's release notes explicitly deferred all four.

1. **Refunds are not version-guarded.** `RefundForm` posts `expectedVersion`, but `addRefundAction`
   (`src/app/actions.ts:1016`) never reads it — the field is absent from its schema parse, so a concurrent
   edit is not detected.
2. **Upload still rethrows non-domain errors.** `uploadAttachmentAction` (`src/app/actions.ts:266`) returns a
   friendly message only for `AttachmentInputError` and rethrows everything else.
   `deleteAttachmentAction` (`:315`) already logs and returns a message instead.
3. **`logging/` is created and its ownership repaired, but nothing in the app writes to it.** Created at
   `docker-entrypoint.sh:38` and `Dockerfile:54`; there are no references to it anywhere in `src/`.
4. **`documents/` mode.** `src/lib/records/attachments.ts:172` asks for `0o700`, but `mkdir` with `recursive`
   does not tighten an existing directory and the entrypoint contains no `chmod`, so the mode depends on the
   umask.
5. **`/data/.env` lives in a directory the app user owns.** Pre-existing.
6. **Tag casing.** Always lower-case `vX.Y.Z`. Do not move a published tag.

---

## 5. v0.1.9 — pending publish

Docs-only release. Delivery follows `docs/RELEASE_PROCESS.md` exactly: merge commit not squash, wait for
`gates` / `browser` / `docker` on the pull request and then on the `main` merge commit, annotated lower-case
tag `v0.1.9` on that merge commit, publish workflow, registry verification of all three tags against one
digest that differs from v0.1.8's, then the GitHub release marked Latest.

`docs/RELEASE_NOTES_v0.1.9.md` ships with the merge SHA and the `sha256` digest marked **pending**. They are
completed by the follow-up `docs: complete RELEASE_NOTES_v0.1.9 publish metadata` pull request, matching the
v0.1.7 (#21) and v0.1.8 (#23) pattern.

The household takes a backup, then Force Updates in Unraid, and follows
[`docs/RELEASE_NOTES_v0.1.9.md`](RELEASE_NOTES_v0.1.9.md). The badge should read **v0.1.9 · pre-release**.

---

## Next session

Not yet decided — ask the household what they'd like to do.

The four verified open items in section 4 are the natural candidates, but none was chosen this session.
