# Simple Finance v0.1.2

**Release date:** 2026-09-21
**Type:** patch. Four bug fixes, no schema change, no migration, no configuration change.
**Previous published image:** v0.1.0.

> **Why there is no v0.1.1 image.** The `V0.1.1` tag was created with a capital `V`. The publish workflow
> triggers only on `v*.*.*` and asserts `test "v${PKG_VERSION}" = "$VERSION"`, so it never ran and nothing was
> pushed to GHCR — the registry held a single version (`v0.1.0` / `latest` / `sha-d1f5320`) until this release.
> v0.1.2 therefore also ships the v0.1.1 fix below for the first time.

## What to do in Unraid

1. Optional but cheap insurance: take a backup first (Settings → Backup & restore). No migration runs in this
   release, so nothing is rewritten — but a current archive is always the right starting point.
2. Docker → the Simple Finance container → **Force Update** (pulls `ghcr.io/dougalbob/simple-finance:latest`).
3. Start it and read the log. Expect the migration step, then `starting Simple Finance on port 3000 as 99:100`.
   - `[entrypoint] taking ownership of …` lines mean the container repaired folder ownership on the way past —
     normal on a first start after this update, and silent on later starts.
   - A `WARNING: … is not writable by 99:100` line means it could not; run the `chown` the warning prints.
4. Confirm the version badge in the navigation reads **v0.1.2 · pre-release**.
5. If you already ran `chown -R 99:100 /mnt/user/appdata/simple-finance/documents` by hand, nothing changes for
   you — that fix was correct. This release makes it unnecessary on the next reinstall, restore or fresh host.

## What is fixed

- **Receipt uploads failed with a permissions error on Unraid.** The entrypoint decided whether to repair
  ownership by looking only at the mount root, so a bind-mounted appdata folder that was already `99:100` left
  `documents/` root-owned (created by the entrypoint's own `mkdir`, or left behind by an older container that
  ran as root) and the first upload died with `EACCES`. Every path the app writes is now checked and repaired
  individually — `documents/`, `logging/`, the database and its WAL sidecars — plus a sweep for stray
  root-owned *files* inside those folders, which used to make an existing receipt 404. `/data/.env` is
  deliberately excluded: it is the admin-owned configuration and the application must never be able to write
  it. A start-up probe now logs an explicit warning and the exact host-side `chown` if `documents/` still
  cannot be written.
- **Camera photos over 1 MB failed with a 500** (fixed in code for v0.1.1, shipped in an image for the first
  time here). Next.js's default 1 MB server-action body limit rejected real phone photos before the attachment
  pipeline's own 10 MB rule could answer politely; the limit is now 12 MB.
- **Voiding never worked.** The void form posts `expectedVersion` while both void actions read `version`, so
  the version guard received `null` and every attempt — purchase *and* transfer — returned
  `Invalid input: expected number, received null` no matter what reason was typed.
- **The void button was unreadable.** It layered `text-red-700` over the shared submit style's `text-white`;
  Tailwind resolves competing utilities by their order in the generated stylesheet, not the class attribute, so
  the label was white on white at rest and white on `red-50` (1.09:1) on hover. It is now a self-contained
  style: red label on white at rest, inverting to a saturated red background with a white label on hover
  (6.42:1, WCAG AA), and legible on a touch screen where hover never applies.

## What is not in this release

- **No way to remove an attached receipt.** The gap is real and confirmed; the schema, viewer, backup and
  restore paths are already delete-aware, but the write half was not built. It is fully specified in
  [`docs/HANDOFF.md`](HANDOFF.md) §3 for the next session, including the ordering rule that protects backups.
- No new features, no schema change, no change to the backup archive format (still format 2), no change to
  `/data/.env` handling, the Unraid template's paths or the Cloudflare Access configuration.

## Known limitations (stated honestly)

- The three UI/container fixes are covered by a new browser test (void flow and button contrast) and a new CI
  container run (bind-mount ownership), both executed by CI rather than by the installation.
- `documents/` ends up mode `0755` while the attachment pipeline asks for `0700`; tightening it is a product
  decision (host access versus confidentiality) and was deliberately left alone.
- `logging/` is created and its ownership repaired, but nothing in the application writes to it yet.
- Refunds post an `expectedVersion` field that no action reads, so refunds are not version-guarded. Recorded in
  [`docs/HANDOFF.md`](HANDOFF.md) §4.
