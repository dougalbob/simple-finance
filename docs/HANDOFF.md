# Handoff — Installable PWA, no offline access (v0.8.0)

Date: 2026-09-24. Branch: `arena/01a0d4f9-simple-finance` (from `main` @ `837845a`, post-v0.7.0 and its
release).

**This session ships PWA installability** — manifest + icons, no service worker, no offline caching.
SPEC §14's online-only rule stands unchanged; the household confirmed they do not want offline access.

## What changed

- `public/manifest.webmanifest` **(new)** — static file (not a Next route, because a route would sit
  behind Cloudflare Access). Declares `name`, `short_name`, `start_url`, `scope`, `display: standalone`,
  `background_color` / `theme_color` `#0f172a`, two icons with `purpose: any`.
- `public/icon-192.png` (192×192), `public/icon-512.png` (512×512), `public/apple-touch-icon.png`
  (180×180) **(new)** — derived from the existing `docs/assets/simple-finance-icon.svg` / `.png`.
  One identity, no new design work.
- `src/app/layout.tsx` — metadata gains `manifest: '/manifest.webmanifest'`, `icons.apple` and
  `appleWebApp: { capable: true, title }`; `viewport` export gains `themeColor: '#0f172a'` (Next 16
  API — `themeColor` on `Metadata` is deprecated; the docs at `node_modules/next/dist/lib/metadata/types/`
  confirm the split).
- `Dockerfile` runtime stage — added `COPY --from=builder /app/public ./public`. **The trap**: without
  this the container serves 404s for every file in `public/` even though the files exist in the repo.
  `.dockerignore` does not exclude `public/`, confirmed.
- CI smoke tests — `ci.yml` docker job and `publish.yml` both `curl -fsS` the four PWA paths and
  assert 200 + correct content types.
- Tests — `tests/pwa-manifest.test.ts` (5 tests: manifest parses, required fields, icon files exist at
  declared pixel sizes, colours, scope); `e2e/pwa.spec.ts` (Playwright: four paths return 200 with
  correct content types).
- Decisions **122–123** added to IMPLEMENTATION_PLAN.md. OQ7 resolved.

## Watch out for (learned this session)

- **The `Viewport` export is separate from `Metadata`.** Next 16 deprecated `themeColor` and
  `colorScheme` on the `Metadata` interface. They belong in a separate `export const viewport: Viewport`
  import. The source of truth is `node_modules/next/dist/lib/metadata/types/metadata-interface.d.ts`
  (the `@deprecated` annotations). Do not add `themeColor` to `metadata` — TypeScript will accept it
  (it is deprecated, not removed) but it generates a console warning at build time.
- **`public/` must be copied into the Docker image.** The `next build` output in `.next` does not
  contain the files from `public/` — they are served from `public/` at runtime. The runtime stage must
  `COPY --from=builder /app/public ./public` or they 404 in production.
- **The manifest is a static file, not a route.** A Next route handler for `/manifest.webmanifest` would
  sit behind Cloudflare Access and require authentication. A static file in `public/` is served directly
  by the web server and bypasses middleware, which is exactly what the Access bypass needs.
- **`next build` rewrites `next-env.d.ts`** — run `git checkout -- next-env.d.ts` before committing
  unless that change is the point (the `.next/dev` ↔ `.next` reference paths flip).

## Test state

`npm test` — **340 tests, all green, 85 suites** (was 335/84). New coverage:
`tests/pwa-manifest.test.ts` (5 tests). `npm run format:check`, `npx tsc --noEmit` and `npm run build`
are clean. Playwright cannot run in this sandbox (`docs/SANDBOX.md` entry 2) — CI's `browser` job is
the proof; the new spec is `e2e/pwa.spec.ts` (four PWA paths return 200 with correct content types).

## Open / deferred (not forgotten)

- The household's Cloudflare Access bypass app should be updated to include the four PWA paths and
  delete the `/sw.js` destination (no service worker ships). Access session duration can be raised
  to up to one month in the main app's settings if daily re-login on the home-screen app is unwelcome.
- Offline access remains deliberately out of scope (SPEC §14).