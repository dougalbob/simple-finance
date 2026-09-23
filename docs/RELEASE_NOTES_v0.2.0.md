# Simple Finance v0.2.0

**Release date:** 2026-09-23
**Published:** yes — annotated tag `v0.2.0` on merge commit `e2e813b`, publish run
[35825816256](https://github.com/dougalbob/simple-finance/actions/runs/35825816256) green. `v0.2.0` / `latest` /
`sha-e2e813b` all resolve to one digest. Force Update now brings this release.
**Image digest:** `sha256:76b3c5bac7be9490f9f71d105048782df1d1aad05d7c231acd77287325f8cd38`.
**Type:** feature release. New record types (debts, external movements), new Move entry tab, Pots page
gains debt/borrow/swap/other sections. Schema migration 0005 (new tables only — no existing data
touched). No backup-format change.
**Previous published image:** v0.1.9. Do not rewrite `docs/RELEASE_NOTES_v0.1.9.md` and do not retag v0.1.9.

## What to do in Unraid

1. Take a backup first (Settings → Backup & restore). There is a migration in this release (new
   tables), so a current archive is the right starting point before a Force Update.
2. Docker → the Simple Finance container → **Force Update**. This pulls
   `ghcr.io/dougalbob/simple-finance:latest` after v0.2.0 is published.
3. Start it and read the log. Expect a migration step applying `0005_external_money`, then
   `starting Simple Finance on port 3000 as 99:100`.
4. Confirm the version badge in the navigation reads **v0.2.0 · pre-release**.
5. If you ever created a "Shared jar" pot: it keeps working exactly as before — nothing about
   existing pots changes. The suggested shape now is one cash pot each: rename the jar to one
   person's cash (Pots → Edit pot) and add a second cash pot for the other person. A pot with any
   history cannot be archived, by design — archiving is a tidy-up for empty pots only, never a
   deletion.

If the badge reads v0.2.0 and your data looks as you left it, the update succeeded.

## What changed

Three real-world gaps the household reported against v0.1.9, closed:

- **One cash pot each, no shared jar.** Seed and demo data now carry four pots (Main, Salary,
  Alex's cash, Sam's cash). A cash handover between the two people is an ordinary transfer with a
  note — visible, never an unexplained move. (SPEC §4, §10.1; worked example E10.)
- **Informal debts, borrowing and repayments.** Track who the money is owed to or by on `/pots`;
  borrowing raises the pot estimate *and* the owed balance together, and the Overview shows owed /
  owing beside "available now" — borrowed money is never income, repayments are never spending.
  Balances are always derived from the linked movements, never stored, so they cannot drift. No
  interest, no schedules — IOUs only. (SPEC §10.2; worked example E11.)
- **Swaps with someone outside the household.** Cash in one hand, a bank transfer in the other —
  recorded as one atomic pair, so the household total provably does not move and the halves can
  never be orphaned. (SPEC §10.2; worked example E12.)
- **Other money in/out, always with a note.** Anything else across the household boundary, with a
  counterparty and a mandatory note saying what it was. Excluded from Insights by construction.
- **Move tab on the phones.** Quick entry gains a fourth tab — between your own pots, borrowing
  and repayments against a tracked debt, a swap, or other money — sharing the same forms as the
  Pots page, so thumb and keyboard take the same path. (SPEC §15.1.)
- **Archive for empty pots.** Pots with no records at all can be archived from Edit pot; anything
  with history is refused, loudly.

Also: E8 recomputed to the no-jar figures (£938.70 available, −£579.62 low); 21 new unit tests
(`tests/external-money.test.ts`, Zod boundary tests) and 3 new browser specs
(`e2e/external-money.spec.ts` + Move-tab test), whose first real run — CI's `browser` job on this
release's pull request — passed.

- **Version `0.2.0`** in `package.json`, `package-lock.json` (root `version` and `packages[""]`),
  `src/lib/version.ts` and `simple-finance.xml`.

## Image tags and digest

The publish workflow put these tags on one digest:

- `ghcr.io/dougalbob/simple-finance:v0.2.0`
- `ghcr.io/dougalbob/simple-finance:latest`
- `ghcr.io/dougalbob/simple-finance:sha-e2e813b`

Digest: `sha256:76b3c5bac7be9490f9f71d105048782df1d1aad05d7c231acd77287325f8cd38`.
Neither v0.1.8
(`sha256:da65d23eeeacb7b60f975fe40464fecc8e74f986834784752ab57c02b2feda35`) nor v0.1.9
(`sha256:7b7d053dd4e2451c2076747acbe7a27fb0da89bc5847d042707ec244707a6b4d`) was retagged, and the
v0.2.0 digest differs from both, so the new image really was published.

## Verification of the registry

`ghcr.io` is blocked in the agent sandbox (see `docs/SANDBOX.md` entry 6), so the tags could not be
inspected from there with `docker buildx imagetools`. They were verified two ways instead:

- the publish workflow's own `Verify the registry tags resolve` step concluded **success** — it fails
  unless every tag's registry digest equals the digest of the image it just built and smoke tested;
- `GET /users/dougalbob/packages/container/simple-finance/versions` over `api.github.com`, which is
  reachable, returned one version entry `sha256:76b3c5ba…` carrying exactly
  `["sha-e2e813b", "v0.2.0", "latest"]`, with `latest` moved off the v0.1.9 entry.

## Schema / data notes

- Migration `0005_external_money`: creates the `debts` and `external_movements` tables plus 4
  indexes. New tables only — no existing table, row or checkpoint is altered, and no data migration
  maps anything onto anyone.
- No change to the backup archive format (still format 2). The archive snapshots the database file,
  so the new tables ride along in the next backup automatically.
- The jar retirement touches seed, fixture and demo data only. Live pots are user data and are
  untouched — see step 5 under "What to do in Unraid".
- No new receipts, purchases or real financial data in code, tests or documentation.

## What is not in this release

- No changes to the published v0.1.9 image or tag.
- No formal lending: no interest, no repayment schedules, no credit agreements (SPEC §2 non-goals).
- No unrelated HANDOFF open items: manual acceptance on the real phones, phone camera formats
  (OQ9), attachment growth, email alerts (v2), PWA (post-v1) all stay open.
- `docs/RELEASE_PROCESS.md` is deliberately untouched.

## Version badge

Navigation should read **v0.2.0 · pre-release**.

## Release notes doc

This file: [`docs/RELEASE_NOTES_v0.2.0.md`](RELEASE_NOTES_v0.2.0.md).
