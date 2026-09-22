# Simple Finance v0.1.8

**Release date:** 2026-09-22
**Published:** pending — filled in after the annotated tag, publish workflow and GHCR verification.
**Type:** cache revalidation only. No schema change, no migration, no data change.
**Previous published image:** v0.1.7. Do not rewrite `docs/RELEASE_NOTES_v0.1.7.md` and do not retag v0.1.7.

## What to do in Unraid

1. Take a backup first (Settings → Backup & restore). There is no migration in this release, but a current archive is always the right starting point before a Force Update.
2. Docker → the Simple Finance container → **Force Update**. This pulls
   `ghcr.io/dougalbob/simple-finance:latest` after v0.1.8 is published.
3. Start it and read the log. Expect no migration step this time, then `starting Simple Finance on port 3000 as 99:100`.
4. Confirm the version badge in the navigation reads **v0.1.8 · pre-release**.
5. Open Settings → Category tree. Add a parent category, then a child under it. Both should appear in the tree immediately, with no browser refresh.

## What changed

Settings → Category tree updates in place again.

- `saveCategoryAction` now revalidates after every successful operation — add parent, add child, rename and retire — where previously it wrote to the database, returned its success message and revalidated nothing.
- The visible symptom was that adding a parent or a child showed the success message but the new entry stayed out of the tree until the page was refreshed by hand. Rename and retire carried the same stale-tree risk and are fixed with it.
- The category tree on Settings is server-rendered into `CategoryTreeEditor`, and the leaf categories also feed the pickers on Quick Entry, Purchases and Recurring. Those pages are revalidated too, so a newly added leaf is selectable without a refresh.
- This brings category operations in line with the other Settings writes — pot edits, person/vehicle renames and warning leads already revalidated. Category operations were the odd one out.

## Image tags and digest

Filled in after publish:

- `ghcr.io/dougalbob/simple-finance:v0.1.8`
- `ghcr.io/dougalbob/simple-finance:latest`
- `ghcr.io/dougalbob/simple-finance:sha-<merge short SHA>`

Digest: pending.
Previous v0.1.7 digest was `sha256:890271632e63dba2e1badf26c68068c3c85dc7c223e18d2864e754f03b7f2d9c`; it was not retagged.

## Schema / data notes

- No migration. The database schema is unchanged from v0.1.7.
- No change to the backup archive format (still format 2).
- No new receipts, purchases or real financial data in code or tests. The browser acceptance case uses fictional category names (`Playwright Garden`, `Playwright Seedlings`).

## What is not in this release

- No changes to the published v0.1.7 image or tag.
- No unrelated HANDOFF open items (refund version guard, upload error handling, logging/, documents mode).
