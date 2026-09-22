# Simple Finance v0.1.7

**Release date:** 2026-09-22
**Published:** yes — annotated tag `v0.1.7` on merge commit `14b9a6d`, publish run
[35764397737](https://github.com/dougalbob/simple-finance/actions/runs/35764397737) green. `v0.1.7` / `latest` /
`sha-14b9a6d` all resolve to one digest. Force Update now brings this release.
**Image digest:** `sha256:890271632e63dba2e1badf26c68068c3c85dc7c223e18d2864e754f03b7f2d9c`.
**Type:** schema + domain. One additive migration (`schedules.supplier_id`). Backup archive format unchanged (still format 2).
**Previous published image:** v0.1.6. Do not rewrite `docs/RELEASE_NOTES_v0.1.6.md` and do not retag v0.1.6.

## What to do in Unraid

1. Take a backup first (Settings → Backup & restore). This release runs one additive migration on start; a current archive is the right starting point.
2. Docker → the Simple Finance container → **Force Update**. This pulls
   `ghcr.io/dougalbob/simple-finance:latest` after v0.1.7 is published.
3. Start it and read the log. Expect the migration step (including `0004_schedule_supplier`), then `starting Simple Finance on port 3000 as 99:100`.
4. Confirm the version badge in the navigation reads **v0.1.7 · pre-release**.
5. Open Recurring Payments. Add or edit a direct debit: choose an existing supplier or **Add a new supplier…** by name. Confirm the same supplier appears on Suppliers, is selectable on a renewal, and (after the due date) lands on converted purchases under that supplier card.

## What changed

Recurring direct debits and standing orders now link to the same canonical Supplier records used by Purchases, Fuel, Renewals and the Suppliers page.

- `schedules.supplier_id` is a nullable foreign key to `suppliers.id` (migration `0004_schedule_supplier`).
- The schedule name and the supplier are separate: e.g. schedule “Electricity bill”, supplier “Northern Power Co”.
- Add/edit schedule forms can select an existing supplier or create one by name through the audited supplier domain path. Contact details, references and interactions are still added on the Suppliers page afterwards.
- Direct debits require a supplier. Standing orders that are household transfers have an explicit **No supplier / household transfer** option. Expected receipts stay supplier-free.
- When a direct debit or standing order converts into a purchase, `schedule.supplierId` is copied onto `purchase.supplierId` so the entry appears under the correct Supplier card.
- A schedule and a renewal can share one supplier without double-counting (they remain separate records).
- Recurring, Contracts and the home schedule list show the supplier name and link toward the Suppliers page where practical.
- Creating a supplier from Recurring revalidates Recurring, Renewals, Suppliers, Contracts and Purchases so the new name is immediately selectable.
- No historical backfill: installations with no pre-existing schedule rows need nothing repaired. Existing supplier records are not recreated.

## Image tags and digest

The publish workflow put these tags on one digest:

- `ghcr.io/dougalbob/simple-finance:v0.1.7`
- `ghcr.io/dougalbob/simple-finance:latest`
- `ghcr.io/dougalbob/simple-finance:sha-14b9a6d`

Digest: `sha256:890271632e63dba2e1badf26c68068c3c85dc7c223e18d2864e754f03b7f2d9c`.
The previous v0.1.6 digest was `sha256:dfdb2922328798deda99a2382264c563adf48f82ce1aa77efa5ea3c5db3aa83d`; it was not retagged.

## Schema / data notes

- One additive migration: `ALTER TABLE schedules ADD supplier_id` plus an index. Existing schedule rows (if any) keep `supplier_id` null until edited.
- No change to the backup archive format (still format 2).
- No new receipts, purchases or real financial data in code or tests (fictional names only).

## What is not in this release

- No changes to the published v0.1.6 image or tag.
- No unrelated HANDOFF open items (refund version guard, upload error handling, logging/, documents mode).

## Version badge

Navigation should read **v0.1.7 · pre-release**.
