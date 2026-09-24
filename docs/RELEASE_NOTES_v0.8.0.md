# Release notes — v0.8.0 (installable PWA, no offline access)

**Published:** 2026-09-24.
**Merge commit:** … (PR …; short SHA …)
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.8.0` · `latest` · `sha-<short>`
**Digest:** `sha256:…`

## What changed

v0.8.0 makes Simple Finance installable as a PWA — manifest and icons only.
**No service worker, no caching, no offline queue.** SPEC §14's online-only
rule stands unchanged; the household confirmed they do not want offline access.

The fix ships because the household configured Cloudflare Access bypasses for
the PWA asset paths and found them 404 — the files had never existed.

### PWA assets (new)

- `public/manifest.webmanifest` — static file (not a Next route), fetchable
  without Access credentials. Declares `name`, `short_name`, `start_url: /`,
  `scope: /`, `display: standalone`, `background_color` and `theme_color`
  `#0f172a`, icons for 192×192 and 512×512 (`purpose: any`).
- `public/icon-192.png` (192×192), `public/icon-512.png` (512×512),
  `public/apple-touch-icon.png` (180×180) — derived from the existing
  `docs/assets/simple-finance-icon.svg` / `.png`. One identity, no new design.

### Metadata (updated)

- `src/app/layout.tsx` — the manifest is linked via `metadata.manifest`, the
  apple-touch icon via `metadata.icons.apple` and `metadata.icons.appleWebApp`,
  and the theme colour via `viewport.themeColor` (the Next 16 API; `themeColor`
  on `Metadata` is deprecated).

### Dockerfile (fix)

- Runtime stage gains `COPY --from=builder /app/public ./public`. Without this
  the container served 404s for the manifest and icon paths even though the
  files existed in the repo — the trap.

### CI (updated)

- `ci.yml` docker job: `curl -fsS` the four PWA paths, assert 200 and verify
  content types (`application/manifest+json`, `image/png`).
- `publish.yml` smoke test: same four-path assertion, so a release cannot
  publish an image that 404s the PWA assets.

### Tests (new)

- `tests/pwa-manifest.test.ts` — 5 tests: manifest parses, declares
  start_url/display/name, every icon file exists at the declared pixel size
  (PNG header), uses the correct colours, declares scope.
- `e2e/pwa.spec.ts` — Playwright spec: request the four PWA paths, assert 200
  and correct content types. Runs in CI's `browser` job.

### Schema and data

No schema changes. No migrations. No backup-format change. The version is
bumped in all five places (package.json, package-lock.json root and
packages[""], src/lib/version.ts, simple-finance.xml, this document).

## Cloudflare checklist (after this release)

**Main app:** hostname-wide, email policy for the two authorised users, session
duration raised to taste (up to one month if daily re-login on the home-screen
app is unwelcome).

**Second app, path-scoped with Bypass → Everyone:**
- `<host>/manifest.webmanifest`
- `<host>/icon-192.png`
- `<host>/icon-512.png`
- `<host>/apple-touch-icon.png`

Delete the `/sw.js` destination — no service worker ships, and a public 404
is worse than no destination at all. Keep this app's bypass scoped to those
four paths and nothing else.

## Household acceptance

After Force Update:

1. `curl -sI https://<host>/manifest.webmanifest` → 200 +
   `application/manifest+json` with no Access cookie — that is the bypass
   proof.
2. Android Chrome offers Install; iOS Safari → Share → Add to Home Screen
   gives the icon and a standalone window with no browser chrome.
3. Every other URL (including `/`) still asks for the Cloudflare login; the
   badge reads `v0.8.0 · pre-release`.
4. DevTools → Application → Service Workers shows nothing registered.
5. If the IdP login misbehaves inside the installed window, report it — do
   not add caching to work around it.

## Unraid backup and update

1. **Back up** from Settings → Backup & restore (takes seconds, downloads an
   encrypted archive of the database and every receipt attachment).
2. **Force Update** the container in Unraid (Docker → check Simple Finance →
   Force Update), then start it again. Migrations run automatically on startup.