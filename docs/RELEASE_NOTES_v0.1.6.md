# Simple Finance v0.1.6

**Release date:** 2026-09-22
**Published:** pending the merge and tag workflow.
**Type:** household configuration. No schema change, no migration, no change to the backup archive format
(still format 2).
**Previous published image:** v0.1.5. Do not rewrite `docs/RELEASE_NOTES_v0.1.5.md` and do not retag v0.1.5.

## What to do in Unraid

1. Take a backup first (Settings → Backup & restore). No migration runs, so nothing is rewritten — a current
   archive is still the right starting point.
2. Docker → the Simple Finance container → **Force Update**. This pulls
   `ghcr.io/dougalbob/simple-finance:latest` after v0.1.6 is published.
3. Start it and read the log. Expect the migration step, then `starting Simple Finance on port 3000 as 99:100`.
4. Confirm the version badge in the navigation reads **v0.1.6 · pre-release**.
5. Open Settings → Household names and use **Add vehicle**. Give it a label, optionally choose its owner,
   and confirm the new vehicle is available in Quick Entry → Fuel, Purchases target filters, Recurring targets
   and Insights.

## What changed

Additional vehicles can now be added from Settings after the household already has a vehicle.

- Settings → Household names has an **Add vehicle** form with a required label (maximum 60 characters) and
  an optional owner chosen from the two household people.
- The existing duplicate-label guard remains case-insensitive, and the existing rename flow is unchanged.
- A newly added vehicle is refreshed into Quick Entry Fuel, Purchases target filters, Recurring targets,
  Insights and the per-vehicle projection settings.
- The people limit remains unchanged. This release adds vehicles only.

## Image tags and digest

The publish workflow puts these tags on one digest:

- `ghcr.io/dougalbob/simple-finance:v0.1.6`
- `ghcr.io/dougalbob/simple-finance:latest`
- `ghcr.io/dougalbob/simple-finance:sha-<merge short SHA>`

The final published digest and merge short SHA are recorded here after the tag-triggered Publish workflow
completes.

## What is not in this release

- No schema change or migration.
- No new receipts, purchases or other financial data in code or tests.
- No changes to the published v0.1.5 image or tag.
