# Simple Finance v0.1.3

**Release date:** 2026-09-22
The image publishes only when the lower-case tag `v0.1.3` is pushed. Merging the pull request does not
publish by itself.
**Type:** small feature. No schema change, no migration, no configuration change, no change to the backup
archive format (still format 2).
**Previous published image:** v0.1.2. Do not rewrite `docs/RELEASE_NOTES_v0.1.2.md` and do not retag v0.1.2.

## What to do in Unraid

1. Take a backup first (Settings → Backup & restore). No migration runs, so nothing is rewritten — a current
   archive is still the right starting point, and it is the only way back if you later remove a receipt you
   wanted to keep.
2. Docker → the Simple Finance container → **Force Update** (pulls `ghcr.io/dougalbob/simple-finance:latest`
   once `v0.1.3` has been tagged). Until that tag exists, Force Update still gives you v0.1.2.
3. Start it and read the log. Expect the migration step, then `starting Simple Finance on port 3000 as 99:100`.
4. Confirm the version badge in the navigation reads **v0.1.3 · pre-release**.

## What changed

A receipt attached to a purchase can be removed from Purchases, Overview and Suppliers.

- **Remove** sits beside the receipt chip (not inside the view link). It asks once more before it acts.
  Removing a receipt deletes the file from this installation. An older backup is the only way to get it back.
  The purchase record itself is not deleted.
- The removal is in that purchase's **History** on the Purchases page: who removed it, when, and the file's
  name, size and type.
- The database records the removal first, then the file is deleted. If the process died the other way around,
  the next backup would refuse to build. A file that cannot be deleted is reported as an unreferenced file on
  Settings; the purchase no longer shows the receipt.
- Opening the old receipt link returns 404. A backup taken after the removal does not include that file and
  does not list it as an orphan. A backup taken before the removal still restores it.

## What is not in this release

- No undelete, and no automatic pruning of old receipts (plan OQ12 is unchanged).
- No new way to attach a receipt that is not tied to a purchase.
- No schema change. `attachments.state` already had no check constraint, so `deleted` needed no migration.

## Known limitations (stated honestly)

- If the file cannot be deleted after the database has recorded the removal, the chip disappears and the
  leftover file shows on Settings as an unreferenced file. That is the designed report, not a failed backup.
- The browser acceptance test for this control runs in CI. A sandbox without Playwright's browser cannot
  claim that run.
