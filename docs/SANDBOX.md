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

## History

- **2026-09-22:** Initial entries after v0.1.8 (category-tree revalidation). Verified in this sandbox: `npm ci --ignore-scripts` → 86 packages, 248/248 Node tests, `next build` green, Playwright blocked as above. Source: session `arena/01a0ca74-simple-finance` discussion 2026-09-22 19:xx UTC.
- **2026-09-23:** Committed in v0.1.9 and every claim above re-probed in a **fresh** sandbox (session `arena/01a0cc97-simple-finance`), since uncommitted working-tree drafts do not survive between sessions. All reproduced: 86 packages, 248/248 tests, 67 suites, `tsc --noEmit` clean, `prettier --check .` clean, `next build` 15 routes, `npm audit --omit=dev` 0 vulnerabilities. Hosts re-confirmed — `nodejs.org` / `cdn.playwright.dev` / `objects.githubusercontent.com` fail with curl exit 35 (`SSL_ERROR_SYSCALL`), `deb.debian.org` with exit 52 and `apt-get update` failing all three indices at `151.101.x.x:80`, while `registry.npmjs.org`, `api.github.com` and `codeload.github.com` return HTTP/2 200. Missing browser libs re-confirmed absent via `ldconfig` (`libnss3`, `libgbm`, `libgtk-3`, `libxdamage`, `libxkbcommon`) and no `Xvfb`. One correction: `~/.nodebuild/nodedir` did not exist in the fresh sandbox, so entry 1 now says plainly that the header tree must be assembled first.
- **2026-09-23 (later, same session):** entries 6 and 7 added after hitting them while verifying the v0.1.9 publish. `ghcr.io` blocked with curl exit 35 including the anonymous pull-token endpoint, and no Docker daemon, so registry verification went via the publish workflow's step conclusion plus `/users/dougalbob/packages/container/simple-finance/versions` on `api.github.com` — note the **user** scope (`/orgs/...` 404s) and that the digest is the `name` field, since `digest` is always `null`. GitHub Actions log text blocked via `productionresultssa5.blob.core.windows.net`, so step conclusions were read instead. v0.1.9 resolved to `sha256:7b7d053dd4e2451c2076747acbe7a27fb0da89bc5847d042707ec244707a6b4d` on tags `v0.1.9` / `latest` / `sha-9393a85`, differing from v0.1.8's `sha256:da65d23e…`, which was not retagged.
- **2026-09-23 (v0.3.0, session `arena/01a0ce41-simple-finance`):** entry 7 gained the check-run annotations API after three red `browser` jobs on the All Transactions PR — `--log-failed` and `/actions/jobs/<id>/logs` both came back empty, while `check-runs/<jobId>/annotations` returned the full Playwright error (locator, received vs expected, source line) each time. Entry 6 re-confirmed the same session: `ghcr.io` still fails with curl exit 35 on both the manifest endpoint and the anonymous pull-token endpoint, no `docker`/`skopeo`/`crane` on PATH, and the versions API still reports the digest in `name` with `digest: null`. v0.3.0 resolved to `sha256:2db0a0c802d5055d1e7788b03dfd52c98bba0125dbbc032354b3b1f2d031da68` on tags `v0.3.0` / `latest` / `sha-96069a3`, differing from v0.2.1's `sha256:7008ed72…`, which was not retagged.
