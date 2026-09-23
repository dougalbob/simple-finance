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

## History

- **2026-09-22:** Initial entries after v0.1.8 (category-tree revalidation). Verified in this sandbox: `npm ci --ignore-scripts` → 86 packages, 248/248 Node tests, `next build` green, Playwright blocked as above. Source: session `arena/01a0ca74-simple-finance` discussion 2026-09-22 19:xx UTC.
- **2026-09-23:** Committed in v0.1.9 and every claim above re-probed in a **fresh** sandbox (session `arena/01a0cc97-simple-finance`), since uncommitted working-tree drafts do not survive between sessions. All reproduced: 86 packages, 248/248 tests, 67 suites, `tsc --noEmit` clean, `prettier --check .` clean, `next build` 15 routes, `npm audit --omit=dev` 0 vulnerabilities. Hosts re-confirmed — `nodejs.org` / `cdn.playwright.dev` / `objects.githubusercontent.com` fail with curl exit 35 (`SSL_ERROR_SYSCALL`), `deb.debian.org` with exit 52 and `apt-get update` failing all three indices at `151.101.x.x:80`, while `registry.npmjs.org`, `api.github.com` and `codeload.github.com` return HTTP/2 200. Missing browser libs re-confirmed absent via `ldconfig` (`libnss3`, `libgbm`, `libgtk-3`, `libxdamage`, `libxkbcommon`) and no `Xvfb`. One correction: `~/.nodebuild/nodedir` did not exist in the fresh sandbox, so entry 1 now says plainly that the header tree must be assembled first.
