# Release and GitHub delivery process

**Standing default.** This is how every Simple Finance release is delivered, agreed with the
household after v0.1.7. It applies to all future releases unless the household changes it
explicitly.

**The agent owns the whole process.** The household should never have to merge a pull request,
create a tag, publish an image or open a GitHub release by hand. The household states when they
want the next release — or the agent asks at a sensible milestone — and the agent takes it from
there to a published image. At the end the household is asked to do exactly two things in Unraid:
take a backup, then Force Update.

## 1. Version

Bump the version consistently in all five places. `tests/version.test.ts` checks the first three
against each other, so a partial bump fails CI rather than shipping a mismatch.

- `package.json`
- `package-lock.json` (root `version` and `packages[""]`)
- `src/lib/version.ts` (`APP_VERSION` — the version badge in the navigation reads from here)
- `simple-finance.xml` (the Unraid template description)
- the release notes document, `docs/RELEASE_NOTES_vX.Y.Z.md`

## 2. Branch, pull request, merge

1. Commit the implementation on the Arena session branch.
2. Push that branch and open the pull request against `main`.
3. Merge with a **merge commit, never squash**. The repository allows all three merge methods, so
   pass the method explicitly rather than accepting a default: `gh pr merge --merge`.
4. Wait for all pull request checks to pass before merging — `gates` (format, types, tests, build,
   audit), `browser` (Playwright acceptance) and `docker` (image build and entrypoint smoke).
5. After merging, wait for the CI checks on the resulting `main` merge commit to pass too.

## 3. Tag and publish

6. Create an **annotated, lower-case** tag — `vX.Y.Z` — on that exact merge commit.
7. Push the tag. The Publish workflow is tag-triggered (`on: push: tags: 'v*.*.*'`); merging a
   pull request publishes nothing on its own.
8. Wait for the Publish workflow to complete successfully. It builds, smoke tests and only then
   pushes, so a broken image cannot reach the registry just because a tag exists.

Never retag a published release and never rewrite an earlier `docs/RELEASE_NOTES_vX.Y.Z.md`.
`latest` moves forward; history stays put.

## 4. Verify the registry

9. Confirm GHCR carries all three tags for the release:
   - `ghcr.io/dougalbob/simple-finance:vX.Y.Z`
   - `ghcr.io/dougalbob/simple-finance:latest`
   - `ghcr.io/dougalbob/simple-finance:sha-<merge short SHA>`
10. Confirm all three resolve to **one digest**, and that the digest **differs** from the previous
    published release. A digest equal to the previous release means the new code was not published.

## 5. Release notes

Complete `docs/RELEASE_NOTES_vX.Y.Z.md` before creating the GitHub release. It must carry:

- published date;
- the merge commit and its short SHA;
- the image tags;
- the exact `sha256` digest;
- what changed;
- schema and data caveats (state plainly when there are none);
- a link to the release notes document;
- Unraid backup instructions;
- Unraid Force Update instructions;
- the version badge text the household should see.

## 6. GitHub release and handover

11. Create the GitHub release and mark it **Latest**.
12. Tell the household only this: take a backup, then Force Update in Unraid.

## Scope discipline

A release carries the work that session agreed on. Unrelated open items from
[`HANDOFF.md`](HANDOFF.md) stay out unless the household expands the scope, and the four version
files stay in step with each other.

## Worked example

v0.1.7 — schedule ↔ canonical supplier link. Annotated tag `v0.1.7` on merge commit `14b9a6d`;
`v0.1.7` / `latest` / `sha-14b9a6d` all resolved to
`sha256:890271632e63dba2e1badf26c68068c3c85dc7c223e18d2864e754f03b7f2d9c`. Notes:
[`RELEASE_NOTES_v0.1.7.md`](RELEASE_NOTES_v0.1.7.md).
