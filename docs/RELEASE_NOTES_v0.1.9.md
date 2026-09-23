# Simple Finance v0.1.9

**Release date:** 2026-09-23
**Published:** pending — annotated tag `v0.1.9` on the merge commit, publish run to be confirmed.
`v0.1.9` / `latest` / `sha-<merge short SHA>` must all resolve to one digest. This line and the digest
below are completed by the follow-up "docs: complete RELEASE_NOTES_v0.1.9 publish metadata" pull
request, as they were for v0.1.7 and v0.1.8.
**Image digest:** pending — recorded after the publish workflow verifies the registry tags.
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
  workaround proven for each. `nodejs.org`, `cdn.playwright.dev`, `deb.debian.org` and
  `objects.githubusercontent.com` are unreachable; `registry.npmjs.org`, `api.github.com` and
  `codeload.github.com` are not. `npm ci --ignore-scripts` is enough because `better-sqlite3@13.0.3`
  ships a `prebuilds/linux-x64.node` for Node 22. The Node suite runs locally; Playwright does not, so
  CI's `browser` job is the evidence for browser specs. The file is append-only: a session that hits a
  new limit records it there before merging.
- **`AGENTS.md` — new "Working ethos — how to use the docs" section.** `docs/SPEC.md`,
  `docs/IMPLEMENTATION_PLAN.md` and `AGENT_APP_BLUEPRINT.md` are a guiding hand, not an unbreakable
  pact. A session is authorised to challenge the spec and propose an alternative, and should have that
  short conversation with the household before deviating rather than working around a doc silently.
  `docs/RELEASE_PROCESS.md` is the stated exception: strict, and owned end to end by the agent.
- **`docs/HANDOFF.md`** points at `docs/SANDBOX.md`, is brought current for this release, and carries
  the verified still-open list forward. Its "Still open" items were re-checked against the code this
  session rather than copied (see below).
- **Version `0.1.9`** in `package.json`, `package-lock.json` (root `version` and `packages[""]`),
  `src/lib/version.ts` and `simple-finance.xml`.

## Image tags and digest

The publish workflow puts these tags on one digest:

- `ghcr.io/dougalbob/simple-finance:v0.1.9`
- `ghcr.io/dougalbob/simple-finance:latest`
- `ghcr.io/dougalbob/simple-finance:sha-<merge short SHA>`

Digest: pending. The previous v0.1.8 digest was
`sha256:da65d23eeeacb7b60f975fe40464fecc8e74f986834784752ab57c02b2feda35`; it must not be retagged,
and the v0.1.9 digest must differ from it. Note that the image content does change this release —
`simple-finance.xml` and the version module are baked in — so an identical digest would mean the
release did not publish.

## Schema / data notes

- No migration. The database schema is unchanged from v0.1.8.
- No change to the backup archive format (still format 2).
- No new receipts, purchases or real financial data in code, tests or documentation. `docs/SANDBOX.md`
  records hostnames and build commands only.

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
