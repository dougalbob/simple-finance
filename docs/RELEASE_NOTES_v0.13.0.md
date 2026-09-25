# Release notes — v0.13.0 (Horizon opens at the next payday window, and date changes apply immediately)

**Published:** _Pending tag push and Publish workflow completion_.
**Merge commit:** `8b7c23e77c8f7285d816aefb31bc3693c08c0097` (PR #53; short SHA `8b7c23e`)
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.13.0` · `latest` · `sha-<release short SHA>`
**Digest:** _Pending Publish workflow completion_.
**Version badge:** `v0.13.0 · pre-release`

## What changed

One behaviour update requested by the household on 2026-09-25 (decision 150).

### Horizon default and apply flow now match payday planning

**Default horizon date:** A visit to `/horizon` now defaults the **through date** to the day before the next
scheduled **receipt schedule** (the salary definition the household confirmed), not to a fixed five-week window.
A debt's expected support is intentionally excluded from this default, even when it lands first; the payday
window and till figure still include that support and are allowed to differ.

**Date changes apply themselves:** In Horizon's look-ahead form, changing the date now triggers submit
automatically (when the value is valid), so the estimate refreshes immediately without pressing **Apply**.
Pots and Day-to-day still require the Apply button, preserving the intended control order and no-JavaScript path.

**Guard rails preserved:** Explicit valid `?through=` values still win unchanged, "no scheduled income" still
falls back to today + 35 days, and very distant scheduled income is clamped to today + 400 days. This means
annual-only income setups can still open to a much longer default window than five weeks, by design.

## Schema and data

**No schema changes and no database migrations.** v0.13.0 is a planning-behaviour/UI interaction change only.
Existing databases, settings and backups from v0.12.1 (or earlier) work without any migration or modification.

## Version badge

The app identifies as **v0.13.0 · pre-release**. The badge in the navigation and on the home page reads
`v0.13.0 · pre-release` after updating.

## How to update (Unraid)

1. **Back up first**: Settings → _Backup and restore_ → take a backup, and keep the downloaded archive
   somewhere other than the array.
2. In Unraid, open the Simple Finance container and click **Force Update** on the Docker tab (the `latest`
   tag points at v0.13.0).
3. Verify the version badge reads **v0.13.0 · pre-release**.
4. Check Horizon: load `/horizon` and confirm the default through date is the day before the next scheduled
   salary date, then change the date and confirm the page applies immediately.

Release notes: [`docs/RELEASE_NOTES_v0.13.0.md`](RELEASE_NOTES_v0.13.0.md)
