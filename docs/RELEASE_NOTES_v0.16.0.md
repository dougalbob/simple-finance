# Release notes — v0.16.0 (colour lives in one place)

**Published:** 2026-09-25 (tag pushed, Publish run `36198977745` passed, image verified in the registry).
**Merge commit:** `8adab266ae085c00d092f1eb0d80b2c5919c6c1f` (PR #62; short SHA `8adab26`)
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.16.0` · `latest` · `sha-8adab26`
**Digest:** `sha256:e0b7994fb1a20da797934ad573417fe5f6982c6ad33f670ade139377ce9743ab`, one digest for all
three tags, different from v0.15.0's `sha256:224cfdc9…` (verified through
`/users/dougalbob/packages/container/simple-finance/versions`).
**Version badge:** `v0.16.0 · pre-release`

## What changed

No behaviour and no visual change at all. This release is a **structural re-foundation of the colour
scheme** (Phase 1 of 2) so that the household's standing requirement — *adding a new theme must be a
small, single-place change, not an app-wide edit in every page* — is now actually true, and recorded
as decision **159** and SPEC **§15.4**.

### The whole colour scheme now lives in one block

- Every colour is a custom property in a single Tailwind v4 `@theme` block in
  `src/app/globals.css`: semantic names for the neutral spine and the by-design-dark till
  (`canvas`, `surface`, `border`, `ink`…`ink-ghost`, `till`, `till-ink`, …) and ramp numbers for the
  chromatic families (`accent`, `positive`, `warning`, `danger`, `negative`, `note`, `chart-1…5`).
- All 35 page/component files and the hand-rolled SVG chart kit were migrated 1:1 through a fixed
  mapping table (decision 159); today's distinctions stay distinct (`ink-muted` ≠ `ink-soft`).
- A theme is therefore one future block that re-declares the same `--color-*` names — nothing else.
  That proof (the first theme + a Settings toggle) is deliberately **Phase 2, next session**.

### How "zero visual change" was proven

39 screenshots (13 pages at 320px / 412px / 1400px) of the previous code versus this code, on the
same seeded data, differ by **0 pixels** — charts included. The only caption that moves with wall-clock
time ("just now" / "N minutes ago") was normalised before comparing, so a diff would mean a real change.

### Guards so colour can't creep back

- New `tests/colour-tokens.test.ts` fails the build if a raw palette class or a colour literal
  re-enters `src` (the one allowed literal is the PWA `themeColor`, which the browser reads before any
  stylesheet exists), if a referenced `var(--color-…)` is undefined, or if a semantic token disappears.
- The PWA `theme_color`/manifest keep their literals, pinned to the till colour and documented as the
  Phase-2 limitation (they cannot be CSS variables).

## Schema and data

None. No schema change, no migration, no data change.

## Updating in Unraid

1. **Take a backup first** (Settings → Backup, or your own copy of the appdata directory).
2. In Unraid, **Force Update** the Simple Finance container so it pulls `v0.16.0`.

You should see the version badge read `v0.16.0 · pre-release`. Nothing on screen should look
different — that is the point.

## Release notes document

Full decision log: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) decision **159**; spec:
[`SPEC.md`](SPEC.md) §15.4.
