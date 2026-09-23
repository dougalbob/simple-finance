# Simple Finance v0.2.1

**Release date:** 2026-09-23
**Published:** pending — annotated tag `v0.2.1` on the merge commit, publish run to be confirmed.
`v0.2.1` / `latest` / `sha-<merge short SHA>` must all resolve to one digest. This line and the digest
below are completed by the follow-up "docs: complete RELEASE_NOTES_v0.2.1 publish metadata" commit on
`main`, as they were for v0.1.7 through v0.2.0.
**Image digest:** pending — recorded after the publish workflow verifies the registry tags.
**Type:** bugfix release. Three fixes to v0.2.0: same-day credit double-count in the estimate,
checkpoint staleness on /pots and /overview, and swap management (find, edit, void as a pair). No
new record types, no new pages. **No schema change, no migration, no backup-format change.**
**Previous published image:** v0.2.0. Do not rewrite `docs/RELEASE_NOTES_v0.2.0.md` and do not retag
v0.2.0.

## What to do in Unraid

1. Take a backup first (Settings → Backup & restore). There is no migration in this release, so
   this is simply the standard "a fresh archive before any update" habit.
2. Docker → the Simple Finance container → **Force Update**. This pulls
   `ghcr.io/dougalbob/simple-finance:latest` after v0.2.1 is published.
3. Start it and read the log. Expect `starting Simple Finance on port 3000 as 99:100` with no
   migration step (none exists in this release).
4. Confirm the version badge in the navigation reads **v0.2.1 · pre-release**.

If the badge reads v0.2.1 and your data looks as you left it, the update succeeded.

## What changed

Three real-world defects the household reported against v0.2.0, fixed:

- **Same-day credit double-count (the "£180" bug, SPEC E13).** A date-only record sharing a
  checkpoint's date always counted as *after*; safe for spending, but a same-day *credit* (a swap
  in-leg, a receipt, a transfer-in, a refund) was counted again by a same-day checkpoint, and no
  same-day checkpoint could ever self-correct it — a cash pot could read £180.00 instead of
  £100.00 for the rest of the day. The tie-break is now sign-aware (SPEC §7.1, amended): same-day
  credits are absorbed, same-day debits keep counting. The estimate may read low for a day, never
  high. **Live v0.2.0 data self-heals under the new rule — no migration.**
- **Checkpoints left the page they were recorded on stale.** Checkpointing from /pots or /overview
  revalidated only the home page, so those pages showed the old estimate until a manual refresh.
  Every action now revalidates the shared page set — the pot card's estimate (the simple figure,
  e.g. ≈ £100.00) and the "Last reported" line update in place.
- **Swaps are managed where they were made.** The "Swap with someone outside" section on /pots
  lists recent swaps as pairs with their net total (balanced / legs differ / voided), with per-leg
  editing and single-leg void, plus a two-click "Void both legs" (one transaction, one shared
  reason). Pot cards link to the list when involved in a pair.

Known accepted trade-off (pinned in SPEC §7.1 and E13, asserted by the browser specs): a same-day
swap **or transfer** makes the household total read one leg low until the next checkpoint — the
safe direction. No rule is both per-pot-safe and household-net-zero on the day.

Also: 10 new unit tests (E13 acceptance scenario, `voidSwap` atomicity/guards, Zod boundaries),
a new browser project `checkpoint` (in-place refresh on /pots) and rewritten `external-money` +
home Move-tab browser specs; the CI browser run on this release's pull request is the first real
browser verification of all three fixes. SPEC §7.1/§10.2 amended, E13 added, plan decisions
98–100, README count 279/75, HANDOFF rewritten.

- **Version `0.2.1`** in `package.json`, `package-lock.json` (root `version` and `packages[""]`),
  `src/lib/version.ts` and `simple-finance.xml`.

## Image tags and digest

The publish workflow put these tags on one digest:

- `ghcr.io/dougalbob/simple-finance:v0.2.1`
- `ghcr.io/dougalbob/simple-finance:latest`
- `ghcr.io/dougalbob/simple-finance:sha-<merge short SHA>`

Digest: pending (see the "Published" line once the publish workflow verifies the registry tags).
v0.2.0 (`sha256:76b3c5bac7be9490f9f71d105048782df1d1aad05d7c231acd77287325f8cd38`) was not retagged,
and the v0.2.1 digest must differ from it.

## Verification of the registry

`ghcr.io` is blocked in the agent sandbox (see `docs/SANDBOX.md` entry 6), so the tags are verified
two ways: the publish workflow's own `Verify the registry tags resolve` step (it fails unless every
tag's registry digest equals the image it just built and smoke tested), and
`GET /users/dougalbob/packages/container/simple-finance/versions` over `api.github.com`.

## Schema / data notes

- **No schema change and no migration in this release.** The estimate rule (SPEC §7.1) is code,
  not data: existing checkpoints and records are re-read under the sign-aware rule, and any
  v0.2.0 double-count self-corrects on first load.
- No change to the backup archive format (still format 2).
- Voiding a swap pair (new) or editing a boundary movement (new) keeps the history — voided legs
  remain visible, marked, with the shared reason.
- No new receipts, purchases or real financial data in code, tests or documentation.

## What is not in this release

- No changes to the published v0.2.0 image or tag.
- No version of the old itemised "since the last checkpoint" breakdown: the pot card shows the
  simple estimate figure (household decision during this session's review).
- No unrelated HANDOFF open items: manual acceptance on the real phones, phone camera formats
  (OQ9), attachment growth, email alerts (v2), PWA (post-v1) all stay open.
- `docs/RELEASE_PROCESS.md` is deliberately untouched.

## Version badge

Navigation should read **v0.2.1 · pre-release**.

## Release notes doc

This file: [`docs/RELEASE_NOTES_v0.2.1.md`](RELEASE_NOTES_v0.2.1.md).
