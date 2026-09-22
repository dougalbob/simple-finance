# Simple Finance v0.1.5

**Release date:** 2026-09-22
The image publishes only when the lower-case tag `v0.1.5` is pushed. Merging the pull request does not
publish by itself.
**Type:** layout polish. No schema change, no migration, no configuration change, no change to the backup
archive format (still format 2).
**Previous published image:** v0.1.4. Do not rewrite `docs/RELEASE_NOTES_v0.1.4.md` and do not retag v0.1.4.

## What to do in Unraid

1. Take a backup first (Settings → Backup & restore). No migration runs, so nothing is rewritten — a current
   archive is still the right starting point.
2. Docker → the Simple Finance container → **Force Update** (pulls `ghcr.io/dougalbob/simple-finance:latest`
   once `v0.1.5` has been tagged). Until that tag exists, Force Update still gives you v0.1.4.
3. Start it and read the log. Expect the migration step, then `starting Simple Finance on port 3000 as 99:100`.
4. Confirm the version badge in the navigation reads **v0.1.5 · pre-release**.
5. On a phone, open Purchases: the filter card should start as a **Show filters** button. Tap it, check that
   From date and To date sit on one row, and that Pot / Supplier / Category / Paid by stay inside the white
   card. Apply a filter and the panel should stay open after the page reloads.

## What changed

The Purchases filter card fits a phone.

- **From date** and **To date** sit on the same row.
- **Pot**, **Supplier**, **Category** and **Paid by** stay one per row, shrunk so they do not spill out of
  the rounded white card.
- A full-width **Show filters** / **Hide filters** button collapses the panel on a phone. It starts collapsed
  when nothing is filtered, and open if any filter is already applied. Tablet and desktop keep the filters
  visible, as before.

## What is not in this release

- No change to how filters query purchases.
- No schema, migration, backup-format or configuration change.

## Known limitations (stated honestly)

- The collapse control is phone-only (below the `sm` breakpoint). A tablet in landscape still shows the
  full form.
- The browser acceptance test for this layout runs in CI. A sandbox without Playwright's browser cannot
  claim that run.
