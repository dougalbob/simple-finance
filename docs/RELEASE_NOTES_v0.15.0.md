# Release notes — v0.15.0 (the phone opens at the till)

**Published:** 2026-09-25 (tag pushed PENDING, image verified in the registry PENDING).
**Merge commit:** `PENDING` (PR #PENDING; short SHA `PENDING`)
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.15.0` · `latest` · `sha-PENDING`
**Digest:** `sha256:PENDING`, one digest for all three tags, different from v0.14.0's
`sha256:b0caec1f…` (verified through `/users/dougalbob/packages/container/simple-finance/versions` after
Publish run `PENDING` passed).
**Version badge:** `v0.15.0 · pre-release`

## What changed

One behaviour update requested by the household on 2026-09-25 (decision 158).

### The home page opens at the till on a phone

Open the app on a phone and it now lands on the **Quick entry** till: the card's top sits just below
the header, with the **Purchase / Fuel / Balance / Move** tabs on screen — ready to record a purchase
in one tap. Previously the page opened at the top ("Shared household ledger", the household total and
the payday projection), more than a thousand pixels above the till, so every purchase at the checkout
started with a scroll.

- **Nothing takes focus on arrival.** The keyboard stays down and no field lights up — tap Supplier or
  Amount when you want them. The page moves by an ordinary scroll, never by stealing focus, so the
  v0.13.1 rule ("the till grabs no field when it opens") stands unchanged.
- **The menu keeps its promise now:** the phone drawer's **Quick Entry (Till)** entry carries the
  anchor, so tapping it lands on the till even when the page is already open.
- **A laptop is unchanged.** Desktop still opens at the top with the household total and the
  projection — this is a phone-layout change only.
- For the record: the view people remembered from before v0.13.1 was an autofocus side-effect, not a
  feature — nothing had ever implemented "open at the till" until this release. It is now deliberate,
  tested, and does not drag the keyboard up with it.

## Schema and data

**No schema changes and no database migrations.** v0.15.0 is a scroll-behaviour change only. Existing
databases, settings and backups from v0.14.0 (or earlier) work without any migration or modification.

## Checks

`npm test` 461 tests / 112 suites green. Formatting, TypeScript and the production build clean.
Playwright 71 tests green locally across every project, including two new specs: the home page opens
at the till with nothing focused, and the drawer's Quick Entry (Till) link lands on the till.

## Version badge

The app identifies as **v0.15.0 · pre-release**. The badge in the navigation and on the home page reads
`v0.15.0 · pre-release` after updating.

## How to update (Unraid)

1. **Back up first**: Settings → _Backup and restore_ → take a backup, and keep the downloaded archive
   somewhere other than the array.
2. In Unraid, open the Simple Finance container and click **Force Update** on the Docker tab (the `latest`
   tag points at v0.15.0).
3. Verify the version badge reads **v0.15.0 · pre-release**.
4. Open the home page **on the phone**: it should land straight on the till — tabs on screen, keyboard
   down, Supplier ready to tap. On a laptop, check it still opens at the top with the household total.

Release notes: [`docs/RELEASE_NOTES_v0.15.0.md`](RELEASE_NOTES_v0.15.0.md)
