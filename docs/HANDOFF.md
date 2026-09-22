# Simple Finance — Session Handoff

**Session:** 8 (remove an attached receipt) · **Date:** 2026-09-22
**Branch:** `arena/01a0c7c1-simple-finance` · **Base:** `main` @ `bc054c6` (v0.1.2, PR #11)
Supersedes the session 7 handoff. That file, with the post-merge corrections, is preserved in git history at `eb81c17`. The original session 7 text is at `bc054c6`.

Read `docs/SPEC.md` for the product, and this file before changing the app. `docs/IMPLEMENTATION_PLAN.md` is the decision log — read the decisions that touch the area you are changing, especially decision 89. `AGENT_APP_BLUEPRINT.md` supported the initial build through the first release; it is historical context, **not required reading**. Do not send a later session back to it first.

---

## 0. Read this before touching anything

This sandbox **can** run the Node suite. `npm ci --ignore-scripts` is enough: the `better-sqlite3` package ships a linux-x64 / Node 22 prebuild, and `node -e` against `:memory:` returned a row. A from-source rebuild was not needed and was not attempted. Session 7's "cannot run `npm test`" note was true of that sandbox, not of this one. Re-check rather than copy it forward.

| Capability | Status here | Consequence |
| --- | --- | --- |
| `npm test` | **ran** | 230 tests, 64 suites, all passed |
| `npx tsc --noEmit` | **ran** | clean |
| `npx prettier --check .` | **ran** | clean (markdown is excluded) |
| `npm run build` | **ran** | compiled (Next.js 16.3.5); see §2 |
| Playwright (`npm run test:e2e`) | **not run** | Playwright 1.63 is installed; no Chromium binary and no system browser. CI's `browser` job is the evidence |
| Docker | **absent** | the image is unchanged except the version string in `simple-finance.xml` |

**Hard rule:** never commit, screenshot or fixture real receipts or household financial data (SPEC §19, §23.3). Test attachments are generated fictional bytes. The new e2e spec uses a 1×1 PNG buffer, not a photograph.

**Do not retag v0.1.2.** That release is published. This feature is v0.1.3. `docs/RELEASE_NOTES_v0.1.2.md` was not rewritten. Tag only after merge, lower-case `v0.1.3`, merge commit not squash (session 7 §5). Merging does not publish.

---

## 1. What this session did

Receipt removal, the open item in the session 7 handoff §3. Decision 89.

- `deleteAttachment` in `src/lib/records/attachments.ts`, next to `storeAttachment`. Unknown id throws `AttachmentNotFoundError`. One transaction sets `state = 'deleted'` only where `state = 'stored'`, then writes one `attachment.delete` audit on the purchase (`entity: 'purchase'`, the purchase id, summary `Removed <name> (<size>, <mime>)`, `before` holds file key, name, mime, size and sha256). A second delete matches nothing: no second audit, no second unlink.
- The file is unlinked only after that commit. `ENOENT` is success. Any other unlink error is logged and does not roll the row back — the leftover file is an orphan, which is the designed report. An unsafe storage key is never joined onto the documents directory.
- `deleteAttachmentAction` follows `uploadAttachmentAction`: auth, `numberOrNull(attachmentId)`, friendly errors, no rethrown `fs` errors. Revalidates `/purchases`, `/overview` and `/suppliers`. Upload now revalidates `/suppliers` too — the same three pages render the form. That is the existing contract, not a sneak from §4.
- The chip is a `<span>` holding the view link, plus a quiet control named `Remove receipt <originalName>`. Confirmation is two clicks (`Confirm remove receipt <name>`), not `window.confirm`. No button inside an anchor.
- Overview's recent purchases render `AttachmentForm`. Purchases shows a History disclosure from `listAuditForEntity`, formatted with `formatInstantLocal`.
- No migration. `attachments.state` has no CHECK.
- Version `0.1.3` in `package.json`, `src/lib/version.ts` and `simple-finance.xml`. Release notes: `docs/RELEASE_NOTES_v0.1.3.md`.

---

## 2. Verification

| Check | Run here | Result |
| --- | --- | --- |
| `npm test` | yes | 230 passed, 64 suites, 0 failed |
| `npx tsc --noEmit` | yes | clean |
| `npx prettier --check .` | yes | clean |
| `npm run build` | yes | compiled (Next.js 16.3.5, Turbopack); the build's own TypeScript pass finished clean |
| `npm run test:e2e` | no | no browser binary |

The new coverage is in `tests/attachment-pipeline.test.ts` (state flip, audit, double-delete, ENOENT, unlink failure leaves the row deleted, unsafe key does not escape the documents directory, deleted URL 404) and `tests/backup-documents.test.ts` (archive before deletion still restores the file and the `stored` row; archive after deletion has no document member, no orphan, `skippedUnstored` 1, and restores a `deleted` row with a clean `inspectDocuments`).

`e2e/attachments.spec.ts` is its own Playwright project (`attachments`). `testMatch` is per-project, so a new spec file is invisible to `mobile` / `desktop` / `backup`. It creates its own purchase and attaches a generated PNG, because `backup.spec.ts` restores over the shared database. CI has not run it yet.

---

## 3. What is not open

Receipt removal is implemented. Do not treat session 7 §3 as current work. The invariants that must keep holding, if anyone touches this path again:

1. Never unlink before the state flip commits. A `stored` row whose file is missing makes `createEncryptedBackup` fail closed.
2. Do unlink after. A deleted row with bytes left on disk is an orphan on every later Settings report.
3. No undelete. An older archive is the way back.
4. Do not add a second path that builds or accepts a storage key.
5. The viewer must 404 a deleted key. It does, because it serves only `stored`.

---

## 4. Still open — not done, do not sneak them in

These were recorded in session 7 and were left alone on purpose.

1. **Refunds are not version-guarded.** `RefundForm` posts `expectedVersion`; `addRefundAction` never reads it.
2. **Upload still rethrows non-domain errors.** `deleteAttachmentAction` returns a friendly message instead. `uploadAttachmentAction` still rethrows anything that is not `AttachmentInputError`, so an `EACCES` can leave the attach button pending with no message.
3. **`logging/` is created and its ownership repaired, but nothing in the app writes to it.**
4. **`documents/` mode.** The pipeline asks for `0700`; the entrypoint's `mkdir -p` leaves `0755`. A product decision, not a bug fix.
5. **`/data/.env` lives in a directory the app user owns.** Pre-existing. A compromised process could replace the file even though the file itself is root-owned `0600`.
6. **Tag casing.** Always lower-case `vX.Y.Z`. The capital-V `V0.1.1` tag never published. Do not move a published tag.

---

## 5. How to release v0.1.3

Not tagged. Not published. The published image is still v0.1.2 until the product owner merges and tags.

1. Review the diff. No real receipts, no household figures.
2. Merge with a **merge commit**. A squash would make a later `sha-<short>` image tag untraceable.
3. Wait for CI on `main`: gates, browser (the new `attachments` project must be in that run), docker.
4. Annotated tag `v0.1.3` on the merged commit. The publish workflow refuses a capital `V` and refuses a tag that does not match `package.json`.
5. Confirm GHCR has `v0.1.3`, `latest` and `sha-<short>` on one digest.
6. The household Force Updates in Unraid and follows `docs/RELEASE_NOTES_v0.1.3.md`. Take a backup first. Removing a receipt afterwards cannot be undone except from an older archive.

If review changes the code after the tag is pushed, cut v0.1.4. Do not move `v0.1.3`, and do not move `v0.1.2`.
