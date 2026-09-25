# Release notes — v0.12.1 ("Supplier card" links open that supplier)

**Published:** 2026-09-25 (tag pushed PENDING, image verified in the registry PENDING).
**Merge commit:** `PENDING` (PR #51; short SHA `PENDING`)
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.12.1` · `latest` · `sha-PENDING`
**Digest:** `sha256:PENDING`, one digest for all three tags, different from v0.12.0's
`sha256:153efbad…` (verified through `/users/dougalbob/packages/container/simple-finance/versions` after
Publish run `PENDING` passed).
**Version badge:** `v0.12.1 · pre-release`

## What changed

One UI fix the household asked for on 2026-09-25 (decision 149).

### The "Supplier card" link now lands on that supplier

**The problem:** v0.12.0 put a **Supplier card** link on every Recurring schedule that names a supplier, and
one on each fixed-term contract end on Contracts & Renewals. Both sent you to `/suppliers` — the top of a
full, collapsed list of every supplier you have ever used. You had to search for the one you had just
clicked from.

**What it does now:** the link carries the supplier's identity in the URL
(`/suppliers?supplierId=12`) and the Suppliers page opens on that supplier:

- the card is **expanded** — contact details, references, the interaction log and recent purchases are
  ready to read, with nothing to tap first;
- the **filter box holds that supplier's name**, so the list shows the one card (and its neighbours with a
  similar name) rather than everything;
- the page **scrolls that card into view**, clear of the sticky header;
- **clearing the filter** leaves the card open and brings the rest of the list back beside it — nothing is
  hidden from you afterwards;
- the **follow-up rows** under Contracts & Renewals ("Follow-ups you promised") are links to their supplier's
  card now too.

Also true, for links typed or bookmarked by hand: `/suppliers?q=insurer` searches for a supplier, and
`/suppliers#supplier-12` opens card 12. A link naming a supplier that no longer exists falls back to the
plain list rather than opening the wrong card, and a normal visit to **Suppliers** behaves exactly as before.

## Schema and data

**No schema changes and no database migrations.** v0.12.1 is a UI fix. Existing databases, settings and
backups from v0.12.0 (or earlier) work without any migration or modification.

## Version badge

The app identifies as **v0.12.1 · pre-release**. The badge in the navigation and on the home page reads
`v0.12.1 · pre-release` after updating.

## How to update (Unraid)

1. **Back up first**: Settings → _Backup and restore_ → take a backup, and keep the downloaded archive
   somewhere other than the array.
2. In Unraid, open the Simple Finance container and click **Force Update** on the Docker tab (the `latest`
   tag points at v0.12.1).
3. Verify the version badge reads **v0.12.1 · pre-release**.
4. Try it: **Recurring** → a schedule with a supplier → **Supplier card**. It should open the Suppliers page
   with that supplier's card already open, filtered to it, scrolled into view.

Release notes: [`docs/RELEASE_NOTES_v0.12.1.md`](RELEASE_NOTES_v0.12.1.md)
