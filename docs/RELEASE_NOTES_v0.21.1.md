# Release notes — v0.21.1 (a same-day transfer recorded after a checkpoint counts)

**Publication status:** Prepared; awaiting merge, passing main CI and image publication.
**Merge commit, image digest and published date:** To be recorded after verification.
**Planned image tags:** `ghcr.io/dougalbob/simple-finance:v0.21.1` · `latest` · `sha-<merge short SHA>`
**Version badge:** `v0.21.1 · pre-release`

v0.21.0 is already published and is not retagged. Unraid Force Update pulls `latest`, which moves to this
release. If a container is pinned to `v0.21.0`, change the repository to `latest` or to `v0.21.1`.

## What changed

A transfer written down after a checkpoint was moving only one pot. Natwest checkpointed at −£443.65, then
£1,500 moved in from Nationwide the same day, stayed on −£443.65. Nationwide fell, correctly. Overview and
Horizon both read that estimate, so both showed the checkpoint. The expected figure is **£1,056.35**.

Since v0.2.1 every date-only credit on a checkpoint's own day was treated as already inside the reported
figure. That stopped a cash count being added twice (the £180 bug). It also dropped a credit recorded
*after* the count, because a transfer only stores a date. The outbound leg still counted.

The tie-break is now entry order (decision **165**, SPEC §7.1):

- a credit written down **after** the checkpoint counts — it cannot already be inside that figure;
- a credit written down **before** the checkpoint is still absorbed, so the £180 case stays fixed;
- a same-day debit still always counts.

No other money rule changed. After this image, that Natwest pot reads £1,056.35 and the household total
rises by the same £1,500 (from −£301.21 to £1,198.79 on the figures reported with the bug).

## Schema and data

**None.** No schema change and no migration. v0.21.1 uses the v0.21.0 database as-is. Existing rows already
carry the entry time the new rule reads, so the estimate updates on the next page load. Take a backup
before updating all the same. Rolling back is a plain image change.

## Verification

Implementation is PR #75. Gates, browser and docker are recorded on that pull request; the merge commit's
checks and the Publish run are filled in after they pass.

## Updating in Unraid

1. **Take a backup first:** Settings → Backup, or a consistent backup of the appdata directory with the
   container stopped. Keep the backup somewhere safe outside the container.
2. In Unraid, **Force Update** the Simple Finance container to pull the new `latest` image. If you pin
   versions, use `ghcr.io/dougalbob/simple-finance:v0.21.1` — do not stay on `v0.21.0`.

After updating, the version badge should read **v0.21.1 · pre-release**. Natwest should read **£1,056.35**,
not −£443.65.

[Release notes document](https://github.com/dougalbob/simple-finance/blob/main/docs/RELEASE_NOTES_v0.21.1.md)
