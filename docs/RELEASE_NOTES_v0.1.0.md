# Simple Finance v0.1.0

**Release date:** pending the merge of the Phase 5 session branch and the tag.
**Type:** first release. Everything below is new; there is no upgrade path to document because there is no
previous version.

## What to do in Unraid

1. Take a backup first (Settings → Backup) if the container already holds data you care about — the database
   migrations run automatically on start and there is no downgrade path.
2. Docker → the Simple Finance container → **Force Update** (or pull `ghcr.io/dougalbob/simple-finance:latest`).
3. Start the container and check the log shows the migrations step completing, then the server listening.
4. Open the app and confirm the version badge in the navigation reads **v0.1.0**.

If the container already exists from an earlier manual install, the template values (appdata path `/data`,
`PUID`/`PGID` 99/100) must match what you used before; if you previously ran it as root, the entrypoint now
aligns `/data` ownership once and then drops privileges, so a first start after the update may take slightly
longer than subsequent ones.

## What is in it

- **Till-moment mobile entry** — supplier with remembered category, exact-total splits, paid-by, backdating,
  duplicate warning (saved, not blocked).
- **Reported checkpoints** with honest labelling — never presented as a bank balance; cash balances are
  counted amounts.
- **Schedules with automatic conversion** — monthly and annual, income receipts, self-healing instance
  sync, read-only month calendar that matches the instance lists.
- **Estimate + payday projection** — pessimistic day-to-day block, outgoings before receipts, two-tier
  warnings, pot-level transfer watch, explicit "unreported pots are not estimated".
- **Key dates** — renewals (with rolling/annual advance), contract ends, two warning leads, and the
  follow-ups you promised on supplier interactions.
- **Suppliers** — contact cards with label→value references (tap-to-call on mobile) and an audited
  interaction log.
- **Receipts and invoices** — PNG/JPEG/PDF attachments up to 10 MB, stored under `/data/documents`, served
  privately (authenticated, uncached, `nosniff`), integrity-checked by sha256.
- **Encrypted backups that include attachments** — format 2 archives (`db.sqlite`, `manifest.json`,
  `documents/…`) with per-file hashes and an orphan report; the password is never stored.
- **Verified restore** — allowlist, hashes, `quick_check`, referenced-document verification *before* any
  swap; previous database and documents preserved as `.pre-restore-<stamp>`; live in-place restore from
  Settings with a typed `RESTORE` confirmation.
- **Least-privilege container** — runs as `PUID:PGID` (Unraid 99/100) after a one-time ownership alignment.
- **CI and release automation** — gates + browser acceptance on every PR; tag-triggered GHCR publication
  with a pre-push smoke test (health, unprivileged, database survives container recreation) and a registry
  digest check.

## What is deliberately not in it

- No bank connection, no statement import, no money movement, no notifications, no telemetry, no
  third-party services.
- No HEIC conversion (the capture path asks phones for JPEG), no supplier-specific attachments, no email
  alerts — all recorded as roadmap items in `docs/IMPLEMENTATION_PLAN.md`.
- No scheduled offsite backup: taking archives off the box and keeping the password somewhere else is a
  household habit, not a feature.

## Known limitations (stated honestly)

- The browser acceptance suite is executed by CI, not by the installation; the household's own acceptance
  pass in `docs/HANDOFF.md` §3 step 4 is the real-device evidence.
- The restore swap is two renames (database, then documents), not one atomic operation; an interruption
  between them leaves a startable app with recoverable copies on disk. The README's recovery checklist
  covers it, and the app never deletes the last recoverable copy on an error path.
- Four moderate advisories remain in the dev-only drizzle-kit/esbuild chain; the production dependency set
  reports 0 vulnerabilities.
