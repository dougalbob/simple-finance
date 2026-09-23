# Simple Finance v0.1.9

**Release date:** 2026-09-23
**Published:** yes — annotated tag `v0.1.9` on merge commit `9393a85`, publish run
[35821794221](https://github.com/dougalbob/simple-finance/actions/runs/35821794221) green. `v0.1.9` / `latest` /
`sha-9393a85` all resolve to one digest. Force Update now brings this release.
**Image digest:** `sha256:7b7d053dd4e2451c2076747acbe7a27fb0da89bc5847d042707ec244707a6b4d`.
**Type:** documentation and agent-guidance only. No application behaviour change, no schema change,
no migration, no data change.
**Previous published image:** v0.1.8. Do not rewrite `docs/RELEASE_NOTES_v0.1.8.md` and do not retag v0.1.8.

## What to do in Unraid

1. Take a backup first (Settings → Backup & restore). There is no migration in this release, but a
   current archive is always the right starting point before a Force Update.
2. Docker → the Simple Finance container → **Force Update**. This pulls
   `ghcr.io/dougalbob/simple-finance:latest` after v0.1.9 is published.
3. Start it and read the log. Expect no migration step this time, then
   `starting Simple Finance on port 3000 as 99:100`.
4. Confirm the version badge in the navigation reads **v0.1.9 · pre-release**.

There is nothing new to try in the interface. This release changes how the app is worked on, not how
it behaves. If the badge reads v0.1.9 and your data looks as you left it, the update succeeded.

## What changed

Documentation carried over from the v0.1.8 session, which could not ride in that pull request because
it was written after the merge. Nothing in `src/` changed except the version string.

- **`docs/SANDBOX.md` (new).** Field notes on the build sandbox: which hosts are blocked, and the
  workaround proven for each. `nodejs.org`, `cdn.playwright.dev`, `deb.debian.org`,
  `objects.githubusercontent.com`, `ghcr.io` and the Azure blob host behind GitHub Actions logs are
  unreachable; `registry.npmjs.org`, `api.github.com` and `codeload.github.com` are not.
  `npm ci --ignore-scripts` is enough because `better-sqlite3@13.0.3` ships a
  `prebuilds/linux-x64.node` for Node 22. The Node suite runs locally; Playwright does not, so CI's
  `browser` job is the evidence for browser specs. The file is append-only: a session that hits a new
  limit records it there before merging.
- **`AGENTS.md` — new "Working ethos — how to use the docs" section.** `docs/SPEC.md`,
  `docs/IMPLEMENTATION_PLAN.md` and `AGENT_APP_BLUEPRINT.md` are a guiding hand, not an unbreakable
  pact. A session is authorised to challenge the spec and propose an alternative, and should have that
  short conversation with the household before deviating rather than working around a doc silently.
  `docs/RELEASE_PROCESS.md` is the stated exception: strict, and owned end to end by the agent.
- **`docs/HANDOFF.md`** points at `docs/SANDBOX.md`, supersedes the stale v0.1.5 header, and carries
  the still-open list forward re-verified against the code rather than copied.
- **Version `0.1.9`** in `package.json`, `package-lock.json` (root `version` and `packages[""]`),
  `src/lib/version.ts` and `simple-finance.xml`.

## Image tags and digest

The publish workflow put these tags on one digest:

- `ghcr.io/dougalbob/simple-finance:v0.1.9`
- `ghcr.io/dougalbob/simple-finance:latest`
- `ghcr.io/dougalbob/simple-finance:sha-9393a85`

Digest: `sha256:7b7d053dd4e2451c2076747acbe7a27fb0da89bc5847d042707ec244707a6b4d`.
The previous v0.1.8 digest was
`sha256:da65d23eeeacb7b60f975fe40464fecc8e74f986834784752ab57c02b2feda35`; it was not retagged, and
the v0.1.9 digest differs from it, so the new image really was published. The image content does
change this release — `simple-finance.xml` and the version module are baked in — which is why an
identical digest would have meant the release did not publish.

## Verification of the registry

`ghcr.io` is blocked in the agent sandbox (see `docs/SANDBOX.md` entry 6), so the tags could not be
inspected from there with `docker buildx imagetools`. They were verified two ways instead:

- the publish workflow's own `Verify the registry tags resolve` step concluded **success** — it fails
  unless every tag's registry digest equals the digest of the image it just built and smoke tested;
- `GET /users/dougalbob/packages/container/simple-finance/versions` over `api.github.com`, which is
  reachable, returned one version entry `sha256:7b7d053d…` carrying exactly
  `["sha-9393a85", "v0.1.9", "latest"]`, with `latest` moved off the v0.1.8 entry.

## Schema / data notes

- No migration. The database schema is unchanged from v0.1.8.
- No change to the backup archive format (still format 2).
- No new receipts, purchases or real financial data in code, tests or documentation.
  `docs/SANDBOX.md` records hostnames, build commands and digests only.

## What is not in this release

- No changes to the published v0.1.8 image or tag.
- No application behaviour change of any kind.
- No unrelated HANDOFF open items. All four were re-verified as still open this session and stay open:
  the refund version guard, upload error handling, `logging/` having no writer, and the `documents/`
  mode. `docs/RELEASE_PROCESS.md` is deliberately untouched.

## Version badge

Navigation should read **v0.1.9 · pre-release**.

## Release notes doc

This file: [`docs/RELEASE_NOTES_v0.1.9.md`](RELEASE_NOTES_v0.1.9.md).
