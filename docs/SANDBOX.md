# Sandbox notes — constraints of the Arena agent environment

> **For the agent:** read this before you assume a tool is broken. It saves you an hour of retrying a blocked host.
> **For the household:** you don't need to read this — it's the agent's field notes on the sandbox where the code is written.

This file is append-only. Each entry is a constraint we actually hit, plus the workaround that is proven to work here. Don't delete old entries — future sessions will hit the same walls. Add new ones at the bottom with the date (Europe/London).

## How to use it

1. **Check here first** when `npm ci`, `npx playwright install`, `apt-get`, or a download fails. If it's listed below, use the workaround — don't brute-force the same URL.
2. If you hit a new sandbox issue, **add it before you merge your PR**. The merge closes the session — Arena won't let you push substance after that. Record the symptom, the blocked host/path, and the fix that worked.
3. Reference this file from `docs/HANDOFF.md` and from the relevant entry in `docs/IMPLEMENTATION_PLAN.md` so the next session finds it.

---

## 1. `nodejs.org` is blocked — `node-gyp` can't fetch headers

**Symptom:** `npm ci` fails during `better-sqlite3` install with `curl exit 35` / `HTTP 000` fetching from `nodejs.org`. The error rolls back the install.

**Reality:** `better-sqlite3@13.0.3` **ships prebuilds** (`prebuilds/linux-x64.node` for Node 22) and does not need a compile on this image. The failure is only `node-gyp` trying to download headers, not a missing package.

**What works here:**

- `npm ci --ignore-scripts` succeeds (86 packages) and `require('better-sqlite3')` loads the bundled prebuild. `npm test` (248 tests), `typecheck`, `format:check`, and `next build` all pass this way.
- If you need a full `npm ci` with scripts, stage a Node header tree and point npm at it:
  ```bash
  # fetched once via codeload, which is reachable (see below)
  # headers live at ~/.nodebuild/nodedir/include/node (+ config.gypi)
  npm_config_nodedir=/home/user/.nodebuild/nodedir npm ci
  ```
  Plain `~/.cache/node-gyp/.../config.gypi` alone is ignored — npm uses its own `--devdir` (`~/.npm/_node-gyp`). `npm_config_nodedir` is what npm respects.
  That header tree is **not shipped in the sandbox and is not in the repo** — a fresh session has to assemble it first, from the codeload tarball in entry 4. Until then `--ignore-scripts` above is the only route that works, and for this repo it is enough.

**Do not:** keep retrying `nodejs.org` or `npm rebuild better-sqlite3` — the prebuild exists, the host does not.

**Hosts:** `registry.npmjs.org` ✔ reachable, `api.github.com` ✔ reachable, `codeload.github.com` ✔ reachable, `nodejs.org` ✘ blocked, `objects.githubusercontent.com` (release assets) ✘ blocked after redirect.

---

## 2. `cdn.playwright.dev` is blocked — no browser download

> **Partly superseded by entry 8 (2026-09-24):** the *download* is still blocked and `apt` still has
> no `libnss3`, but `@sparticuz/chromium` on the npm registry provides both a browser and the libs, and
> the real Playwright suite runs locally through a throwaway config overlay. Read entry 8 before you
> accept a red `browser` job.

**Symptom:** `npx playwright install chromium` fails with `ECONNRESET` to `cdn.playwright.dev`. `npx playwright install --with-deps chromium` also fails — `apt-get` can't reach `deb.debian.org` and the required libs (`libnss3`, `libgbm`, `libgtk-3`, etc.) are absent (`ldconfig` finds none), so even a sideloaded binary wouldn't start.

**What works here:**

- Don't try to make Playwright run locally. The repo is designed for this: `playwright.config.ts` wires `scripts/e2e-server.mts` (fictional seed data in `.e2e-data`, port 3100, dev identity bypass) and CI runs the real browsers.  See `docs/HANDOFF.md` · `docs/IMPLEMENTATION_PLAN.md` decision 87 and `playwright.config.ts` comment.
- Run every gate that *can* run locally — `npm ci`, `format:check`, `typecheck`, `npm test`, `next build`, `npm audit --omit=dev` — and let the CI `browser` job be the proof for the new specs. An older handoff note claimed the suite "cannot run tests" here; that is wrong and is kept only as a warning. `npm test` runs (248 tests), Playwright does not.

---

## 3. `deb.debian.org` is blocked — no `apt` system deps

**Symptom:** `apt-get update` / `playwright install --with-deps` → `Connection failed` to `151.101.x.x:80`, packages `libxdamage1`, `libxkbcommon0`, `xvfb`, fonts, etc. all `Unable to locate`.

**Implication:** same as above — you cannot bring a browser into this sandbox. Don't spend the session fighting `apt`.

---

## 4. GitHub release assets redirect off-domain

**Symptom:** `gh` API works, but downloading a release asset (redirect to `objects.githubusercontent.com`) is blocked. `codeload.github.com` *is* reachable, which is how the Node header tarball was fetched (`https://codeload.github.com/nodejs/node/tar.gz/v22.22.3`). Remember the tarball prefix is `node-22.22.3` (no `v`) and `include/node` must be assembled — the tarball has `src/` but not a ready `include/node` tree.

---

## 5. `npm_config_nodedir` vs `~/.cache/node-gyp`

Staging `~/.cache/node-gyp/22.22.3/config.gypi` (`installVersion: 2`) is not enough — `npm` passes its own `--devdir` and bypasses that cache. The env var `npm_config_nodedir` is the one `npm` honours.

---

## 6. `ghcr.io` is blocked — you cannot inspect the registry from the sandbox

**Symptom:** any `curl` to `ghcr.io` fails with `curl exit 35` (`SSL_ERROR_SYSCALL`), including the anonymous pull-token endpoint `https://ghcr.io/token?scope=repository:dougalbob/simple-finance:pull`. There is also no Docker daemon in the sandbox, so `docker buildx imagetools inspect` — the command the publish workflow uses — is not available either way.

**Consequence:** release step 9/10 ("confirm GHCR carries all three tags and that they resolve to one digest differing from the previous release") **cannot be done the obvious way from here.** Do not conclude the release is unverified. Two routes work:

- **The publish workflow already proves it.** Its `Verify the registry tags resolve` step resolves the remote digest for all three tags and compares it against the digest of the image it just built and smoke tested, failing the job on any mismatch. Read the step's **conclusion**, not its output: `gh run view <id> --json jobs -q '.jobs[0].steps[] | {name, conclusion}'`. A `success` there *is* the one-digest proof.
- **`api.github.com` gives you the digest directly** (reachable, entry 1). Package versions live under the **user** scope, not the org scope — `dougalbob` is a user, so `/orgs/...` returns 404:
  ```bash
  gh api "/users/dougalbob/packages/container/simple-finance/versions?per_page=20" \
    -q '.[] | "tags=\(.metadata.container.tags|join(","))  digest=\(.name)"'
  ```
  The digest is the **`name`** field — there is a `digest` field too and it is always `null`. One entry carrying `["sha-<short>", "vX.Y.Z", "latest"]` confirms step 9, and comparing `name` against the previous release's entry confirms the digest moved.

**Do not:** retry `ghcr.io`, or try `docker login` / `docker manifest inspect`. Neither the host nor a daemon exists here.

---

## 7. GitHub Actions log text is unreachable — read step conclusions instead

**Symptom:** `gh run view <id> --log` and `gh api repos/<owner>/<repo>/actions/jobs/<jobId>/logs` both return nothing usable. The API responds with a redirect to `productionresultssa5.blob.core.windows.net`, which is blocked, so the fetch dies with a `Get "https://productionresultssa5.blob.core.windows.net/..."` error. The run **step summary** (`### ... >> $GITHUB_STEP_SUMMARY`) is not retrievable this way either.

**Consequence:** you cannot read what a CI step printed. You can still read **whether it passed**, which is usually the actual question.

**What works here:**

- Per-step conclusions: `gh run view <id> --json jobs -q '.jobs[0].steps[] | "\(.name): \(.conclusion)"'`.
- Check runs on a commit: `gh api repos/<owner>/<repo>/commits/<sha>/check-runs -q '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion)"'`.
- **Check-run annotations carry the actual failure text**, and they are served by `api.github.com` so
  they work when the log endpoints do not:
  `gh api repos/<owner>/<repo>/check-runs/<jobId>/annotations -q '.[] | "\(.path): \(.message)"'`.
  Playwright's `github` reporter puts the full error there — the failing locator, the received and
  expected values, the source line — which is exactly what a red browser job needs. Use this instead
  of `--log-failed`.
- `gh run watch <id> --exit-status` blocks until done and returns non-zero on failure — good for gating a merge or a tag.
- For values CI computed but you cannot read (a digest, a resolved tag), re-derive them from a reachable API instead — see entry 6.

**Do not:** assume a step was skipped because its log is empty. Empty log ≠ did not run; check `conclusion`.

---

## 8. A browser *can* run here — `@sparticuz/chromium` from the npm registry (2026-09-24)

**Correction to entries 2 and 3.** "No browser download" and "no `apt` system deps" are both still true, but
that does not make the browser suite impossible. `registry.npmjs.org` is reachable, and
`@sparticuz/chromium` ships a Chromium build **inside its npm tarball** (no CDN fetch) together with the
Amazon-Linux shared libraries Chromium needs from an `al2023.tar.br` blob.

**Recipe (proven — the whole suite runs green locally):**

```bash
mkdir -p /tmp/pwbrowsers && cd /tmp/pwbrowsers && npm init -y && npm i @sparticuz/chromium
# writes the binary to /tmp/chromium (+ /tmp/fonts, /tmp/swiftshader)
node -e "import('@sparticuz/chromium').then(async (m) => console.log(await m.default.executablePath()))"
# the al2023 libs are only auto-extracted when the package detects Amazon Linux, so inflate them yourself
node -e "import('/tmp/pwbrowsers/node_modules/@sparticuz/chromium/build/lambdafs.js').then(m => m.inflate('/tmp/pwbrowsers/node_modules/@sparticuz/chromium/bin/al2023.tar.br'))"
LD_LIBRARY_PATH=/tmp/al2023/lib /tmp/chromium --version   # Chromium 153.0.8010.0
```

A throwaway config overlay points the repo's own projects at that binary (the repo's
`playwright.config.ts` stays untouched, and the overlay is never committed):

```ts
// playwright.local.config.ts
import { defineConfig } from '@playwright/test';
import base from './playwright.config';
const launchOptions = {
  executablePath: '/tmp/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
};
export default defineConfig({
  ...base,
  projects: (base.projects ?? []).map((project) => ({ ...project, use: { ...project.use, launchOptions } })),
  use: { ...base.use, launchOptions },
});
```

```bash
LD_LIBRARY_PATH=/tmp/al2023/lib npx playwright test --config playwright.local.config.ts
```

Notes from using it: the package's own `chromium.args` include `--single-process`, which Playwright does not
like — pass your own args as above. Playwright wanted 153.0.8010.12 and got 153.0.8010.0; the version gap has
not mattered. The suite needs the web server, and Playwright starts it (`reuseExistingServer` is on outside
CI, so kill any server already on 3100 if you want a fresh seed — the server reseeds `.e2e-data` on start).
Fifty tests across all projects took ~2 minutes, versus ~16 CI minutes per push: fix browser failures here,
not in CI.

## 9. Turbopack dev serves a stale SSR module after an edit (2026-09-24)

**Symptom:** you add an attribute to a client component and `curl http://127.0.0.1:3100/` never shows it,
even though the file on disk has it and the page hot-reloads. (Here: `inert` never appeared because the
server-rendered HTML kept coming from the pre-edit module.)

**What works:** restart the dev server, and if the new markup still does not appear, `rm -rf .next` first. A
fresh `scripts/e2e-server.mts` start after clearing `.next` rendered the attribute immediately. Do not
conclude the code is wrong from a `curl` against a long-running dev server.

## 10. Unpushed commits die with the sandbox — push after every step (2026-09-25)

**What happened:** after v0.9.0 was published, session `arena/01a0d55f-simple-finance` committed four
follow-up fixes locally (decisions 134–137) while GitHub was having an outage, so the push never landed.
That sandbox was then gone; the next session found `main` and the session branch still at the v0.9.0 merge
and had to re-implement the fixes from the conversation's description (session
`arena/01a0d778-simple-finance`, v0.10.0).

**What to do:** push the session branch after **every** commit (`git push origin <session branch>`) and check
it with `git ls-remote origin <session branch>` — a local commit is not saved work. If a push fails, say so
to the household at once and keep a note of what is unpushed in `docs/HANDOFF.md` at the next successful
push, rather than carrying on for several commits.

**Related trap:** `npm run format:check` runs `prettier --check .`, which also sees the untracked,
git-excluded `playwright.local.config.ts` from entry 8. CI never has that file, so it cannot fail CI, but the
local check reports it — run `npx prettier --write playwright.local.config.ts` once after creating it.

---

## 11. The fuzzy edit tool can quietly mangle a large file — diff after every edit (2026-09-25)

**Symptom:** three `edit_file` calls against `src/components/quick-entry.tsx` (1900 lines) each reported
success, and `npm test` even stayed green — but `tsc --noEmit` failed with two `TS1005: ':' expected`. The
diff showed what had happened: `linePence[index] ?? 0` had become `linePence? 0` (~40 lines away from the
edited hunk), a stray `   null,` had been inserted into an unrelated JSX prop, and one of the three edits
had not applied at all. The Node test suite never noticed because it does not import client components.

**What works here:**

- Run `git diff` (or `npx tsc --noEmit`, which catches it in ~15s) **after every edit** to a large file,
  not once at the end of the session. Fixes are trivial when the hunk is still fresh in mind.
- For a surgical change in a big file, a small `python3 -` heredoc with `assert s.count(old) == 1` before
  `s.replace(...)` is both exact and self-checking: it fails loudly if the anchor is not unique.
- Trusting "Edit succeeded" is not verification. Neither is a green `npm test` for a **component** change —
  the unit suites are server-side; component behaviour is only covered by `tsc` and the Playwright suite.

---

## History

- **2026-09-24 (v0.9.0, session `arena/01a0d55f-simple-finance`):** entries 8 and 9 added. The v0.9.0 `browser`
  job came back red on four specs, and this time the annotations alone were not enough to be sure of the
  cause — so the suite was brought up locally instead. Entry 8's recipe is the result: `@sparticuz/chromium`
  from the npm registry, its `al2023.tar.br` libs inflated by hand, `LD_LIBRARY_PATH` set, a throwaway
  `playwright.local.config.ts` overlay — and the full suite (50 tests, every project, seeded server) runs
  green in ~2 minutes. The four failures were one race: taps and keystrokes landing before React hydrated the
  quick-entry island. Fixed in the product (`data-till-ready` + `inert`, SPEC §15.1 · decision 131), in the
  specs (`e2e/support.ts` · `waitForTill`) and in the pot guard (decision 132). Entry 9 records the Turbopack
  dev-cache surprise found on the way. Everything else behaved as recorded: `npm ci --ignore-scripts`,
  `npm test`, `tsc --noEmit`, `format:check`, `next build` all green locally.
- **2026-09-25 (v0.10.0, session `arena/01a0d778-simple-finance`):** entry 10 added after the post-v0.9.0
  commits were lost with their sandbox. Entry 8 re-proved from scratch in a fresh sandbox (Debian 12 image,
  `libnss3` still missing without `LD_LIBRARY_PATH`): the full suite, now 55 tests, green in ~2.3 minutes.
  `npm test` 376/95, `tsc --noEmit`, `format:check` and `next build` green locally.
- **2026-09-22:** Initial entries after v0.1.8 (category-tree revalidation). Verified in this sandbox: `npm ci --ignore-scripts` → 86 packages, 248/248 Node tests, `next build` green, Playwright blocked as above. Source: session `arena/01a0ca74-simple-finance` discussion 2026-09-22 19:xx UTC.
- **2026-09-23:** Committed in v0.1.9 and every claim above re-probed in a **fresh** sandbox (session `arena/01a0cc97-simple-finance`), since uncommitted working-tree drafts do not survive between sessions. All reproduced: 86 packages, 248/248 tests, 67 suites, `tsc --noEmit` clean, `prettier --check .` clean, `next build` 15 routes, `npm audit --omit=dev` 0 vulnerabilities. Hosts re-confirmed — `nodejs.org` / `cdn.playwright.dev` / `objects.githubusercontent.com` fail with curl exit 35 (`SSL_ERROR_SYSCALL`), `deb.debian.org` with exit 52 and `apt-get update` failing all three indices at `151.101.x.x:80`, while `registry.npmjs.org`, `api.github.com` and `codeload.github.com` return HTTP/2 200. Missing browser libs re-confirmed absent via `ldconfig` (`libnss3`, `libgbm`, `libgtk-3`, `libxdamage`, `libxkbcommon`) and no `Xvfb`. One correction: `~/.nodebuild/nodedir` did not exist in the fresh sandbox, so entry 1 now says plainly that the header tree must be assembled first.
- **2026-09-23 (later, same session):** entries 6 and 7 added after hitting them while verifying the v0.1.9 publish. `ghcr.io` blocked with curl exit 35 including the anonymous pull-token endpoint, and no Docker daemon, so registry verification went via the publish workflow's step conclusion plus `/users/dougalbob/packages/container/simple-finance/versions` on `api.github.com` — note the **user** scope (`/orgs/...` 404s) and that the digest is the `name` field, since `digest` is always `null`. GitHub Actions log text blocked via `productionresultssa5.blob.core.windows.net`, so step conclusions were read instead. v0.1.9 resolved to `sha256:7b7d053dd4e2451c2076747acbe7a27fb0da89bc5847d042707ec244707a6b4d` on tags `v0.1.9` / `latest` / `sha-9393a85`, differing from v0.1.8's `sha256:da65d23e…`, which was not retagged.
- **2026-09-23 (v0.3.0, session `arena/01a0ce41-simple-finance`):** entry 7 gained the check-run annotations API after three red `browser` jobs on the All Transactions PR — `--log-failed` and `/actions/jobs/<id>/logs` both came back empty, while `check-runs/<jobId>/annotations` returned the full Playwright error (locator, received vs expected, source line) each time. Entry 6 re-confirmed the same session: `ghcr.io` still fails with curl exit 35 on both the manifest endpoint and the anonymous pull-token endpoint, no `docker`/`skopeo`/`crane` on PATH, and the versions API still reports the digest in `name` with `digest: null`. v0.3.0 resolved to `sha256:2db0a0c802d5055d1e7788b03dfd52c98bba0125dbbc032354b3b1f2d031da68` on tags `v0.3.0` / `latest` / `sha-96069a3`, differing from v0.2.1's `sha256:7008ed72…`, which was not retagged.
- **2026-09-24 (v0.7.0, session `arena/01a0d490-simple-finance`):** entry 7 re-proved and extended. On a red
  `browser` job, `gh run view --job <id> --log-failed`, `gh api .../jobs/<id>/logs` and even the failure
  artifact download (`gh api .../artifacts/<id>/zip`, redirected to `productionresultssa12.blob.core.windows.net`)
  all died with `EOF` — the log/artifact blob hosts are not just slow here, they are unreachable. The
  check-run annotations route worked first time and named both failing specs with the locator, the received
  vs expected values and the source line, which is all that was needed to fix them; the report artifact was
  not needed at all. Everything else about the sandbox behaved as recorded: `npm ci --ignore-scripts`,
  `npm test` (335/84), `tsc --noEmit`, `format:check` and `next build` all green locally, Playwright only in
  CI. Also worth remembering: `next build` rewrites `next-env.d.ts` (its two `reference` imports flip
  between `./.next/dev/types/…` and `./.next/types/…`), so `git checkout -- next-env.d.ts` before committing
  unless the change is the point.
- **2026-09-25 (v0.13.1, session `arena/01a0d93c-simple-finance`):** entry 8 re-proved a fourth time in a
  fresh sandbox (the `@sparticuz/chromium` install took 3s and `inflate()` wrote `/tmp/al2023` as before):
  the full suite, 63 tests across every project, green in ~2.5 minutes with `LD_LIBRARY_PATH=/tmp/al2023/lib`.
  Entry 11 added — the fuzzy edit tool mangled `quick-entry.tsx` in three places while reporting success,
  caught by `tsc --noEmit` and undone by diff review. Also re-confirmed: `npm ci --ignore-scripts`,
  `npm test` (416/103), `tsc --noEmit`, `format:check`, `next build` and `npm audit --omit=dev` all green
  locally, and `next build` flipped `next-env.d.ts` again (reverted with `git checkout --`).
- **2026-09-25 (v0.12.1, session `arena/01a0d879-simple-finance`):** entry 8 re-proved a third time in a fresh
  sandbox (Debian 12): `@sparticuz/chromium` from the registry, `al2023.tar.br` inflated by hand,
  `LD_LIBRARY_PATH=/tmp/al2023/lib`, the throwaway `playwright.local.config.ts` overlay — the full suite,
  58 tests across every project, green in ~2.5 minutes. `npm ci --ignore-scripts`, `npm test` (404/101),
  `tsc --noEmit`, `format:check` and `next build` all green locally. Two small additions to the watch-list:
  a throwaway spec that seeds supplier rows directly with `better-sqlite3` (no domain write needed) is a quick
  way to force a long `/suppliers` list and check that a deep link really scrolls the named card to the top;
  and `next build` flipped `next-env.d.ts` again — reverted with `git checkout -- next-env.d.ts` as entry 8's
  history already advises.
