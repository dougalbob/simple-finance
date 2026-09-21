# Simple Finance — Session Handoff

**Session:** 7 (field-bug triage: receipt attachments, the void flow, container ownership) · **Date:** 2026-09-21
**Branch:** `arena/01a0c557-simple-finance` · **Base:** `main` @ `9f5d8b5` (v0.1.1, PR #10)
Supersedes the session 6 handoff, which is preserved in git history at `9f5d8b5`.

Read in this order: `AGENT_APP_BLUEPRINT.md` → `docs/SPEC.md` → `docs/IMPLEMENTATION_PLAN.md` → this file.

---

## 0. Read this before touching anything

**What cannot be verified in the Arena sandbox** (same limits as session 6, re-confirmed):

| Capability | Status here | Consequence |
| --- | --- | --- |
| `npm ci` | works with `--ignore-scripts` only | `better-sqlite3` cannot build: nodejs.org headers **and** GitHub release assets are both blocked |
| `npm test` (224 tests) | **cannot run** | every suite needs the native module; a machine that can build it is required |
| `next dev` / `next build` | **cannot run** | same reason |
| Playwright (`npm run test:e2e`) | **cannot run** | no browser binaries, download host blocked |
| Docker | **absent** | the entrypoint and the CI `docker` job cannot be exercised in-container |
| `npx tsc --noEmit` | **works** | run it |
| `npx prettier --check` | **works** | run it |
| Tailwind CSS compilation via `@tailwindcss/postcss` | **works** | useful for settling cascade questions with evidence (see §2.2) |

So: type-checking, formatting, shell-level reasoning and CSS generation are provable here; **database, HTTP and
browser behaviour are not**. CI is the evidence. Say so plainly in the PR description rather than implying more
was verified than was.

**Hard rule:** never commit, screenshot or fixture real receipts or household financial data (SPEC §19, §23.3).
Test attachments must be generated fictional bytes.

---

## 1. What the product owner reported, and what each item actually was

| # | Reported symptom | Verdict | Root cause | Status |
| --- | --- | --- | --- | --- |
| 1 | Attaching a receipt to a purchase failed with a permissions error; fixed by hand with `chown -R 99:100 /mnt/user/appdata/simple-finance/documents` | **Real bug** | `docker-entrypoint.sh` gated its recursive `chown` on the ownership of `$DATA_DIR` alone, and created `documents/` as root *before* that check | **Fixed here** (§2.3) |
| 2 | The purchase Edit panel offers no way to delete an attached document | **Real gap** — never implemented | No domain function, action, UI control or migration exists; the schema and every read path are already delete-aware | **Open — this is the next session's work item** (§3) |
| 3 | The second box in the void panel (red border) is unreadable: very pale background on hover with a white label | **Real bug**, worse than reported | `record-forms.tsx` layered `text-red-700` on top of `submitClass`'s `text-white`; Tailwind resolves that by stylesheet order, and `.text-white` is emitted later — so the label was white **at rest too** (white-on-white), not only on hover | **Fixed here** (§2.2) |
| 4 | Voiding with a reason filled in returns `Invalid input: expected number, received null` | **Real bug** | `voidPurchaseAction` read `formData.get('version')` while `VoidForm` posts `expectedVersion` → `null` → `z.number()` rejects | **Fixed here** (§2.1) |

Two extra findings from auditing the same code paths:

- **`voidTransferAction` had the identical field-name bug**, so voiding a transfer from Overview → recent
  transfers was broken as well. Fixed in the same edit; the product owner had not hit it yet.
- Nothing else in the codebase has this mismatch. Every other action/form pair was checked and agrees
  (`editPurchaseAction`↔`expectedVersion`, `saveSupplierContactAction`↔`expectedVersion`,
  cancel/edit schedule, edit renewal, edit pot, rename target, save category ↔`version`).

---

## 2. Fixed in this session — awaiting CI confirmation

### 2.1 Void form field contract (report #4)

`src/app/actions.ts` — `voidPurchaseAction` (line 1023) and `voidTransferAction` (line 1107) now read
`formData.get('expectedVersion')`, matching the hidden input `VoidForm` renders
(`src/components/record-forms.tsx` lines 387-388). A comment in both places records the contract.

Evidence captured in the sandbox, using the project's own schema and its own zod 4.6.5:

```
voidRecordEntrySchema.safeParse({ recordId: 12, expectedVersion: null, reason: 'duplicate entry above' })
→ success: false
→ issues[0] = { code: 'invalid_type', path: ['expectedVersion'],
                message: 'Invalid input: expected number, received null' }
```

Character-for-character the message the product owner saw. `voidPurchase` (`src/lib/records/purchases.ts:464`)
really does compare `current.version !== input.expectedVersion`, so the guard was never the problem — the value
never arrived.

Regression coverage added: a new test in `e2e/desktop.spec.ts` (*"a purchase can be voided, and the void control
stays legible"*) creates its own purchase, voids it through the UI and asserts the row comes back marked
`Voided` with its reason and `history kept`. It uses a throwaway purchase so the seeded rows the other specs
assert on are untouched and a CI retry starts clean.

### 2.2 Void button contrast (report #3)

`src/components/record-forms.tsx` — new self-contained `dangerSubmitClass` replaces
`` `${submitClass} … text-red-700` `` on the void submit button.

**The product owner chose the "quiet outline that inverts on hover" variant** (section 3 of the reproduction
page): red-700 label on white at rest with a red-300 border, inverting on hover to a saturated red-700
background with a white label.

```ts
const dangerSubmitClass =
  'rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:border-red-700 hover:bg-red-700 hover:text-white disabled:opacity-60';
```

Why the old markup could not work: Tailwind orders competing utilities by their position in the **generated
stylesheet**, not by the order in the `class` attribute. Compiling this repo's own `src/app/globals.css` with its
own `@tailwindcss/postcss` produced:

```
@layer utilities {
   914: .text-red-700 { … }
   950: .text-white   { … }        ← later, therefore the winner
  1017: @media (hover: hover) { .hover\:bg-red-50:hover { … } }
}
```

Measured contrast (Tailwind v4 oklch values converted to sRGB):

| Pair | Ratio | WCAG AA (4.5:1) |
| --- | --- | --- |
| white label on red-50 `#fef2f2` (old hover) | **1.09:1** | fail |
| white label on white (old resting state) | 1.00:1 | fail |
| red-700 `#c10007` label on white (new resting) | **6.42:1** | pass |
| white label on red-700 `#c10007` (new hover) | **6.42:1** | pass |
| white label on red-800 `#9f0712` | 8.36:1 | pass (AAA) |

After the change the compiled CSS puts `hover:border-red-700`, `hover:bg-red-700` and `hover:text-white` inside
`@media (hover: hover)`, after the base utilities, so all three win on hover; on a touch screen (no hover) the
button stays red-on-white, which is legible. The e2e test asserts exactly this with
`not.toHaveCSS('color', 'rgb(255, 255, 255)')` at rest and the inverse on hover.

The small "Void" toggle button (`record-forms.tsx:476`) never composed `submitClass`, which is why it was
always legible — leave it alone. It is the only other red control of this shape in the codebase; the audit of
every `submitClass`/`buttonClass` use found no other conflicts.

### 2.3 Container ownership alignment (report #1)

`docker-entrypoint.sh` — the ownership block was rewritten:

1. `owned_by_app <path>` / `take_ownership <path> [-R]` helpers.
2. Each path the server writes is checked and repaired **individually**: `$DATA_DIR`, `$DATA_DIR/documents`,
   `$DATA_DIR/logging`, then every `$DATA_DIR/*.sqlite*` (any name — `DATABASE_PATH` may be overridden in
   `/data/.env`). A root-owned database used to make the migration step fail and the container refuse to start.
3. A `find … \( ! -user $PUID -o ! -group $PGID \) -print -quit` sweep over `documents/` and `logging/` repairs
   stray root-owned **files** inside an otherwise correctly owned directory — those made the receipt viewer
   return 404. It stops at the first mismatch, and when nothing is wrong it does no work at all, so a normal
   restart stays silent and fast.
4. **`/data/.env` is deliberately excluded** from every recursive repair. It is the trusted, admin-owned
   configuration sourced as root at the top of the entrypoint (SPEC §18.1) and the application must never be
   able to write it. A root-owned `.env` is correct, not a fault to repair. This is why the sweep is scoped to
   `documents/` + `logging/` instead of `chown -R "$DATA_DIR"`.
5. A non-fatal writability probe (`gosu $RUN_AS touch …`) runs after migrations and logs an explicit warning
   plus the exact host-side `chown` command if `documents/` still cannot be written. Non-fatal on purpose:
   everything except uploads keeps working, and a probe that fails must never stop the household's app from
   starting.

Verified in the sandbox by running the **real script** (migration and start commands stubbed, `gosu` shimmed
with `setpriv`) against real uid 99 / gid 100 directory trees:

| Scenario | Before this fix | After |
| --- | --- | --- |
| A. `/data` already 99:100, `documents/` missing | `documents/` left root-owned → **EACCES** | repaired → write OK |
| B. `/data` root-owned (docker created the host dir) | worked | works |
| C. `documents/` left root-owned by an older root-running container | skipped → **EACCES** | repaired → write OK |
| D. stray root-owned receipt file inside a correct directory | invisible (viewer 404s) | detected and repaired → readable |
| E. `PUID=0` opt-out | root | unchanged (root) |
| F. ownership fine but `documents/` mode 0555 | silent failure at upload time | warning logged with the fix command |
| G. already unprivileged (no root) | unchanged | unchanged |
| H. root-owned `/data/.env` present | would have been chowned by a full-tree repair | **still root:root 0600** and still sourced |

`.github/workflows/ci.yml` — the `docker` job gained a third run (`sf-run3`) that reproduces scenario A/C with a
**bind mount**: a host directory whose root is already 99:100 with a root-owned `documents/`. It asserts
`stat -c %u:%g /data/documents` is `99:100` and that `docker exec -u 99:100 … touch` really succeeds. The
existing named-volume runs cannot catch this: a named volume inherits the image's already-correct `/data`
ownership, which is exactly why the bug reached production green.

### 2.4 Verification status of this session's changes

| Check | Run here | Result |
| --- | --- | --- |
| `npx tsc --noEmit` | yes | clean |
| `npx prettier --check` (changed files) | yes | clean |
| `sh -n docker-entrypoint.sh` | yes | clean |
| Entrypoint behaviour, scenarios A–H | yes (real script, stubbed migration/start, `setpriv` for `gosu`) | all pass |
| Tailwind cascade + contrast | yes (repo's own toolchain and palette) | as tabulated above |
| zod error reproduction | yes (repo's own schema, zod 4.6.5) | exact message reproduced |
| `.github/workflows/ci.yml` parses | yes (`js-yaml`) | clean |
| `npm test`, `next build`, Playwright, real Docker | **no — impossible in this sandbox** | **CI must confirm** |

---

## 3. OPEN WORK ITEM — delete an attached receipt (report #2)

### 3.1 What exists today

Nothing writes a deletion; everything already reads one:

| Piece | Where | Delete-aware already? |
| --- | --- | --- |
| `attachments.state`, `NOT NULL DEFAULT 'stored'`, **no CHECK constraint** | `src/lib/db/schema.ts:490`, `drizzle/0003_phase4b_documents.sql:5` | yes — `'deleted'` needs **no migration** |
| Viewer 404s any row whose state is not `stored` | `src/app/api/attachments/[fileKey]/route.ts:36` | yes |
| Backup ships only `stored` keys | `src/lib/backup/backup.ts:126` | yes |
| Restore verifies only documents referenced by `stored` rows | `src/lib/backup/restore.ts:343` | yes |
| Orphan report / `inspectDocuments` compare disk against `stored` keys | `src/lib/backup/backup.ts:151-163`, `207`, `258-283` | yes |
| Listing of a purchase's receipts filters `state = 'stored'` | `src/lib/records/attachments.ts:208` | yes |
| Delete domain function | — | **missing** |
| Delete server action | — | **missing** |
| Delete control in the UI | `src/components/attachment-form.tsx` renders chips + upload only | **missing** |

SPEC §15.2 only ever promised attachments "viewed and added", and plan OQ12 deferred pruning — so this is a
feature to add, not a regression to repair. `audit_entries.action` is free-form text
(`src/lib/audit.ts:12-35`), so no schema or type change is needed to audit it.

### 3.2 Recommended design

1. **Domain** — `deleteAttachment(db, { id, actor, now })` in `src/lib/records/attachments.ts`, next to
   `storeAttachment`, so the module stays the one attachment pipeline (plan decision 81):
   - load the row; a new `AttachmentNotFoundError` (or `AttachmentInputError`) if it is absent;
   - in **one transaction**: `UPDATE attachments SET state = 'deleted' WHERE id = ? AND state = 'stored'`
     (the `AND state = 'stored'` guard makes a double delete a no-op rather than a second audit entry), then
     `recordAudit(tx, { action: 'attachment.delete', entity: 'purchase', entityId: purchaseId,
     summary: 'Removed <originalName> (<size>, <mime>)', before: { fileKey, originalName, mime, sizeBytes,
     sha256 }, now })`. `entity: 'purchase'` + the purchase id is what makes it appear in that purchase's
     visible audit trail (`listAuditForEntity`).
   - **after the transaction commits**, `unlink` the file. Treat `ENOENT` as success; any other unlink failure
     must not roll back the database — the row is already `deleted`, and the leftover file then shows up in the
     orphan report, which is the designed safety net.
2. **Action** — `deleteAttachmentAction` in `src/app/actions.ts`, modelled on `uploadAttachmentAction`:
   `currentUserFromRequest()` guard, `numberOrNull(formData.get('attachmentId'))`, domain call,
   `revalidatePath('/purchases')`, `'/overview'`, `'/suppliers'` (all three render `AttachmentForm`), and a
   friendly message. Return `{ status: 'error', … }` for domain errors; do not rethrow raw `fs` errors (see §4).
3. **UI** — `src/components/attachment-form.tsx`. The chip is currently a single `<a>` wrapping everything;
   a `<button>` inside an `<a>` is invalid HTML and hydration-hostile, so restructure the chip as a container
   `<span>` holding the link (view/download) plus a small remove button with an accessible name that includes
   the file name, e.g. `Remove receipt <originalName>`. Keep it visually quiet and give it a confirmation step
   (`window.confirm` is acceptable here, or a two-click arm/disarm) — deletion is irreversible for the live
   installation.
4. **No migration needed.** If you want `deleted_at` / `deleted_by` columns for queryability, that is a new
   `drizzle/0004_*.sql`; the audit entry already carries actor and timestamp, so it is optional.

### 3.3 Backup and restore invariants that MUST still hold

The product owner's condition for this feature: *"we must not be left in a position where creating and
restoring backups is compromised in any way."* These are the invariants, and the failure mode of each:

1. **Never unlink before the state flip commits.** `createEncryptedBackup` fails closed when a `stored` row's
   file is missing — `BackupIncompleteError`, HTTP 409 (`src/lib/backup/backup.ts:190-198`). Unlinking first
   would break **every subsequent backup** if the process died in between. Order: commit `state='deleted'`,
   then unlink.
2. **Do unlink the file.** A `deleted` row whose bytes stay on disk is an orphan forever: it is listed in every
   archive's `manifest.json` orphan report (`backup.ts:151-163`, `207`) and in `inspectDocuments` on the
   Settings page (`backup.ts:258-283`). Silent, permanent noise that trains the household to ignore the report.
3. **A `deleted` row with no file must restore cleanly.** Restore only verifies documents referenced by
   `stored` rows (`restore.ts:343`), and an archive taken after a deletion simply carries fewer documents.
   Prove it with a test rather than by inspection.
4. **Deleted receipts are recoverable only from an older archive.** Restore preserves the previous documents
   directory as `.pre-restore-<stamp>` (`restore.ts:260-262`), and archives taken before the deletion still
   contain the file. That is the intended safety net — do not add "undelete".
5. **The key pattern and sha256 discipline are unchanged**: `FILE_KEY_PATTERN`, content sniffing and the 10 MB
   limit stay the single source of truth (`attachments.ts`). Deletion must not introduce a second path that
   builds or accepts a storage key.
6. **The viewer must 404** on a deleted attachment's URL, even though the row still exists — already true via
   `route.ts:36`; assert it.

### 3.4 Tests required

Unit (`tests/attachment-pipeline.test.ts` and the backup suites — these need `better-sqlite3`, so run them on a
machine that can build it):

- delete flips `state` to `deleted`, writes exactly one `attachment.delete` audit entry, and unlinks the file;
- deleting twice is a no-op (no second audit entry, no throw);
- deleting an unknown id raises the domain error;
- `listStoredAttachments` no longer returns it;
- **backup round-trip**: store → delete → `createEncryptedBackup` succeeds, the manifest lists no document for
  the deleted key and **no orphan** for it;
- **restore round-trip**: restore that archive into a clean installation, then assert success, that the row is
  still `deleted`, that its file is absent, and that `inspectDocuments` reports 0 missing and 0 orphans;
- an archive taken **before** the deletion still restores the file and the `stored` row (no cross-contamination).

Route/e2e:

- `GET /api/attachments/<deleted key>` → 404 (add to the existing attachment tests);
- Playwright: attach a **generated fictional** PNG, remove it, assert the chip disappears and the audit trail on
  the purchase shows the removal. `e2e/home.spec.ts` or a new `e2e/attachments.spec.ts` (remember
  `playwright.config.ts` runs one worker against one shared database, so create your own purchase).

### 3.5 Documentation to update with the feature

- `docs/SPEC.md` §23 (add §23.4 "Removal") and the §15.2 Purchases row ("viewed, added **and removed**");
- `docs/IMPLEMENTATION_PLAN.md`: a new numbered decision recording the soft-delete-then-unlink order and the
  backup invariants above, plus a note against OQ12 (this is user-initiated removal, still no automatic
  pruning);
- `docs/RELEASE_NOTES_v0.1.2.md` (new) with the Unraid upgrade steps;
- `README.md` if it lists attachment behaviour.

### 3.6 Acceptance criteria

- [ ] A receipt can be removed from the purchase row on Purchases, Overview and Suppliers.
- [ ] The removal is in the purchase's audit trail with actor and timestamp.
- [ ] The file is gone from `documents/`; no orphan appears in the next backup manifest or on Settings.
- [ ] The deleted attachment's URL returns 404.
- [ ] Backup **and** restore both succeed after a deletion, and the tests in §3.4 pass.
- [ ] An archive made before the deletion still restores that receipt.
- [ ] `npm test`, `npx tsc --noEmit`, `npm run format:check`, `npm run build` and `npm run test:e2e` are green
      in CI.

---

## 4. Smaller observations (not requested; decide deliberately, do not sneak them in)

1. **Refunds are not version-guarded.** `RefundForm` posts a hidden `expectedVersion`
   (`record-forms.tsx:345`) but `addRefundAction` never reads it and `refundEntrySchema` has no such field —
   `createRefund` (`src/lib/records/purchases.ts:268`) takes no `expectedVersion`. Either wire the guard up or
   delete the dead field; right now it looks guarded and is not.
2. **Opaque failure for filesystem errors.** `uploadAttachmentAction` (`src/app/actions.ts:231`) rethrows
   anything that is not an `AttachmentInputError`, so an `EACCES`/`EROFS` reaches the browser as a generic
   server-action error. A mapped message ("the receipts folder is not writable — check the container log")
   would have made report #1 self-diagnosing. The new entrypoint probe (§2.3) covers the log side.
3. **`logging/` is created but never written** by anything in `src/` or `scripts/`. Either use it or stop
   creating it; the entrypoint still repairs its ownership, which is harmless.
4. **`documents/` mode.** `attachments.ts:157` asks for `0o700`, but the entrypoint's `mkdir -p` runs first as
   root and leaves `0755`. Receipts are real financial data (SPEC §23.3). Tightening to `0700` would stop other
   host users reading them but could surprise someone browsing appdata over SMB — a product decision, not a
   bug fix. Left alone deliberately.
5. **`/data/.env` lives in a directory the app user owns**, so a compromised app process could rename or
   replace it even though the file itself is root-owned `0600`. Pre-existing and out of scope; noting it because
   §2.3 deliberately stopped short of "repairing" `.env` ownership.
6. **Release tag casing — confirmed, not theoretical.** The repository tag is `V0.1.1` (capital V) while
   `.github/workflows/publish.yml` triggers on `v*.*.*`, refuses anything that does not match
   `v[0-9]*.[0-9]*.[0-9]*`, and asserts `test "v${PKG_VERSION}" = "$VERSION"`. Checked against the registry:
   GHCR holds exactly **one** container version — `v0.1.0` / `latest` / `sha-d1f5320`, created
   2026-09-21T08:22:36Z — and there is no Publish workflow run for `V0.1.1`. **v0.1.1 was never published**, so
   the household's container was still running the v0.1.0 image and never received PR #10's `bodySizeLimit:
   '12mb'` fix for camera photos over 1 MB. v0.1.2 ships it for the first time. Always tag lower-case
   `vX.Y.Z`, and bump `package.json` **and** `src/lib/version.ts` together (`tests/version.test.ts` checks they
   agree).

---

## 5. State of play and next steps

**Done in this session, on this branch (PR A):**

1. The three fixes in §2, the CI bind-mount case and the e2e void test.
2. Release metadata: `package.json` and `src/lib/version.ts` bumped to `0.1.2` **together**
   (`tests/version.test.ts` asserts they agree), `docs/RELEASE_NOTES_v0.1.2.md` written, and the two places
   that still advertised v0.1.0 corrected — the Unraid template's `<Description>` and the README's status and
   version sections.
3. Release: lower-case annotated tag `v0.1.2`, which triggers `.github/workflows/publish.yml` to build, smoke
   test and push `v0.1.2`, `latest` and `sha-<short>` to GHCR; GitHub Release created from those notes. The
   product owner can then Force Update in Unraid.

**What to watch on PR A:** the CI `docker` job's new `sf-run3` bind-mount step and the `browser` job's new void
test. Those two runs are the *only* evidence that reports #1, #3 and #4 are genuinely closed, because neither
Docker nor a browser exists in the sandbox where they were written.

**Two release-hygiene notes:**

- Merge PR A with a **merge commit**, as PRs #9 and #10 were. A squash merge would leave the tagged commit out
  of `main`'s history and make the published `sha-<short>` tag untraceable to the branch.
- If review changes anything after the tag was pushed, cut **v0.1.3** rather than moving `v0.1.2`: a published
  tag must keep meaning exactly one image.

**Next session (PR B):** attachment deletion, specified in §3, on a machine where `npm test` can actually run.
Keep it separate from PR A — it is a feature with backup-integrity risk and must not ride along with three
small fixes.
