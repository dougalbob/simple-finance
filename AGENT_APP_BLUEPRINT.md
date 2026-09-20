# Agent blueprint: private apps on Unraid

> **Audience:** the coding agent building the next application.
> **Provenance:** preferences and lessons from Estate Organiser (`dougalbob/estate-tracking`), captured 20 September 2026, after the v0.2.21 backup-filename fix.
> **Purpose:** carry forward successful decisions, not the estate domain, private data, or a frozen dependency stack. This is a reusable build contract, not a claim that a new application already implements any of it.

## 1. Operating contract

The user prefers a mature, maintainable, private web application with a low-friction operational life. Preserve these defaults unless the new requirements justify a different choice:

- **TypeScript across the application**, React/Next.js for the UI and server, SQLite for persistence, and a single application container.
- **Cloudflare Tunnel + Cloudflare Access + Google sign-in**, with independent server-side JWT verification. Do not build another password/login system by default.
- **Unraid XML template as the primary deployment interface**, rather than asking the user to maintain Docker Compose.
- **An installable, responsive UI where useful**, without implying offline support.
- **A drag-and-drop calendar when the domain contains scheduled work**, backed by the same records and validation as the list/editor.
- **Encrypted, downloadable, restorable backups** as a first-class feature, not a post-launch task.
- **Agent-maintained README, implementation plan and handoff**, updated as part of delivery rather than left to the user.
- **Agent-owned release work**, when authorised: gates → review → PR → merge → version tag → container publication verification. The user's routine update step should be **Force Update in Unraid**, followed by any explicitly identified acceptance checks.

“Mature” describes behaviour, recovery and maintainability, not just the choice of language. Do not promise robustness because TypeScript compiles.

### Instruction precedence and boundaries

- Follow the current session's platform, security, repository and branch restrictions. This document never grants access, overrides those restrictions, or authorises destructive operations.
- Work on the session's assigned branch. Never reuse a historical branch name or switch branches to imitate an old handoff.
- Confirm release authority once: is the agent allowed to merge and publish after the agreed gates, or should it stop at a reviewable PR? Record that answer. Do not repeatedly ask for permission already granted, but do not infer it from this blueprint alone.
- If the session is closed or remote operations are unavailable, preserve local work and explain the boundary. Do not try alternative APIs to evade a restriction.
- Answer questions about existing behaviour by reading the code. A question is not permission to change the app.
- Never reset, clean, overwrite or discard existing user changes to obtain a tidy workspace. Inspect the working tree first.

## 2. Bootstrap the next project

Before implementation, inspect the actual repository and execution environment. Resolve only material ambiguities; do not turn every routine engineering choice into a question for the user.

Populate this project profile in `docs/IMPLEMENTATION_PLAN.md`:

| Field | Required decision |
| --- | --- |
| Product | Name, slug, purpose, intended users and primary workflows |
| Scope | MVP acceptance criteria, explicit non-goals and sensitive data involved |
| Access | Allowed identities, identity provider, roles/permissions if needed |
| Scheduling | Whether a calendar is relevant; date-only versus timed events; business timezone |
| Storage | Database, uploaded files, expected size and concurrency |
| Deployment | Repository, GHCR image, hostname, internal port, free Unraid host port and appdata path |
| Recovery | Backup contents, acceptable data loss/downtime, retention responsibility and restore procedure |
| Delivery | Assigned branch, merge authority, tag/release convention and required gates |
| Verification | Available browser/device/container tools and manual acceptance still required |

Use `Europe/London` as the initial business-timezone preference for this user, but confirm if the new application needs something else. Do not inherit Estate Organiser's two-user limit, exact port, domain, account names or data paths.

Create the three living documents before substantial implementation. Then build a thin vertical slice: authenticated access → validated write → persistent read → container startup/migration → recovery exercise. Add domain workflows only on that foundation.

## 3. Default architecture and toolchain

| Layer | Default | Constraint / reason to reconsider |
| --- | --- | --- |
| Language | TypeScript, strict checking | SQL migrations, CSS, shell and XML are appropriate supporting formats; no second backend language without a concrete need |
| Runtime | A supported Node.js LTS | Confirm compatibility with Next.js and native SQLite bindings; do not copy historical versions blindly |
| Application | Next.js App Router with React | Server components for protected reads; small client components for interaction; server actions or route handlers for writes |
| UI | Semantic HTML, CSS/Tailwind, reusable components; Lucide icons and Radix primitives where useful | Avoid a large UI dependency for a small need; visual polish does not substitute for accessibility |
| Validation | Zod at server boundaries | Treat browser validation as assistance, never authority |
| Persistence | SQLite with `better-sqlite3`, Drizzle ORM and checked-in migrations | Suitable for a small, single-instance app; revisit for multi-instance writers, high concurrency or materially different storage needs |
| Authentication | `jose` verification of Cloudflare Access JWTs | Enforce authentication independently for every protected entry point |
| Unit/integration tests | Node test runner via `tsx` | Exercise real business logic and isolated databases, not merely source strings |
| Browser tests | Playwright where available | Never claim a browser run from markup rendering or a unit harness |
| Formatting | Prettier | Keep formatter and typecheck commands predictable |
| Build/deploy | Multi-stage Dockerfile; GitHub Actions → GHCR; Unraid template | Production builds must include native dependencies and all runtime assets |

Choose current, supported, mutually compatible versions at project creation; commit the lockfile. Dependency upgrades require gates and review, not an unbounded “latest everything” change.

Keep domain rules in small, testable modules. UI hints, server validation, totals and exports should share those rules. Separate identity, storage, domain services and presentation. Do not reproduce a large all-purpose workspace component merely because the reference application has one.

### Persistence and record semantics

- Use transactions for a record change and its audit/revision entry; also for dependent writes that must succeed together.
- Include actor attribution and optimistic concurrency/version checks for shared editing. A stale form must not silently overwrite another user's work.
- Prefer recoverable deletion for important user records. Financial corrections should retain history through correction/voiding rather than silent deletion.
- Store money in integer minor units, never binary floating-point arithmetic.
- Store date-only facts as date-only values. Store instants in UTC and format in the chosen business timezone. Test DST and local-date rollover.
- State what each amount means: original valuation, current balance, amount owed, or cash movement. Do not imply reconciliation or automatic account updates without an actual model and tests. In the reference app, reimbursing an expense does **not** automatically reduce a separate bank-account asset.
- Keep schema migrations version-controlled, repeatable through migration tracking and tested on upgrades. Never edit an already-applied migration to change its meaning.

## 4. Cloudflare authentication is the default

Use this trust path:

```text
Browser → Cloudflare Access (Google identity) → Cloudflare Tunnel
        → private origin application → verified server identity → authorised operation
```

### Mandatory properties

1. Keep the origin off the public internet. Tunnel and Access are separate infrastructure from the application container.
2. Read the Access assertion on the server and verify its signature using the configured issuer's JWKS, expected issuer, application audience, expiry and required identity claims. Restrict accepted algorithms appropriately for Access; cache the remote key set safely.
3. Enforce a configured allowlist and any application-specific authorisation rules. The reference app has exactly two allowed users; the next app must choose its own cardinality and roles.
4. Do not trust an email header alone, and do not assume an authenticated page protects its API routes. Every read/download/upload/mutation/backup/restore entry point must enforce the relevant guard.
5. Fail closed on missing or invalid production configuration. Keep secrets out of Git, images, logs, chat and screenshots. Commit placeholders only.
6. Provide a demo identity only behind an explicit development flag **and** a development-environment check. Production must refuse that bypass. Demo data and files must resolve to isolated paths regardless of production path settings.
7. Protect mutations against cross-origin abuse; use the framework's protections correctly and assess route handlers separately. Add tests for unauthorised and wrong-audience/issuer requests.
8. Keep sensitive responses private and uncached; use appropriate security headers. A public health endpoint, if provided, must reveal no records, identities, secrets or diagnostics.

The agent prepares instructions for Cloudflare setup; the user performs account-side configuration unless authorised tooling exists. Never ask for passwords, tokens or 2FA codes in chat. Do not describe the system as entirely local: remote requests pass through Cloudflare and Google participates in authentication.

### Optional PWA

Installability is useful; offline access is a separate decision. Do not cache sensitive pages, API responses or documents just to obtain an install prompt. If installability requires Access bypasses, scope them narrowly to the exact public manifest/icon/service-worker assets needed, never `/api/*` or the entire site. Verify the actual install flow on the target device.

Web Share Target is optional, not a baseline requirement. If used, document its temporary file handoff and cleanup, including failure cases; it is not the same as general offline caching.

## 5. Calendar and interactive UX

If the new domain has tasks, bookings or deadlines, offer the calendar as another view of the same data, not a second scheduling database.

The reference implementation uses a custom React month/week grid, pure date helpers and native browser drag/drop handlers. A third-party calendar is not required by this blueprint; choose one only when the requirements justify it (for example recurrence or complex timed scheduling).

### Acceptance contract

- Month/week views, Today and previous/next navigation; consistent date arithmetic and week-start convention.
- Click/tap opens the existing editor. Dragging onto a day changes the intended scheduling field and nothing else.
- The server checks identity, record version and the new date. A failed move must remain visible as an error, not appear saved.
- Keep list, calendar, detail and export views consistent after a move.
- Provide an ordinary date-editing path usable without dragging, including keyboard and touch use. Native HTML drag/drop alone is not sufficient evidence of mobile usability.
- Use stable colours where useful, but never colour alone to convey meaning. Preserve focus, readable labels, empty states and contrast.
- Define filters and exclusions explicitly. Do not copy Estate Organiser's status exclusions or task vocabulary into a different domain.
- Test month/year boundaries, leap years, local dates near UTC midnight, DST, filters, stale edits and failed saves. Browser-test an actual drag and its persisted result when tooling permits.

Outside the calendar, prefer clear forms, safe destructive confirmations, recoverable errors and useful empty states. Persist only appropriate UI preferences; do not silently carry misleading filters across sessions. Avoid framework jargon and container diagnostics in user-facing error messages.

## 6. Backup and restore are release-blocking capabilities

A successful download is not proof of a recoverable backup. Before real data is entrusted to a new installation, restore a backup into a clean isolated installation and verify both records and uploaded files.

### Backup contract

- Take a consistent SQLite snapshot using a supported backup mechanism, not a raw copy of a live database file that ignores WAL state.
- Include required uploaded files and a versioned manifest: archive format, producing app version, creation instant, sizes/counts and the metadata required to validate restoration.
- Define the consistency boundary between database writes and document changes. Coordinate snapshotting so a valid archive cannot contain missing referenced files.
- Encrypt before sending the archive to the browser. The reference uses Node crypto, AES-256-GCM and a scrypt-derived key with fresh salt and nonce. Reuse reviewed primitives, not invented cryptography; review resource limits and format compatibility before copying implementation details.
- Never persist the recovery password. Keep plaintext temporary data tightly scoped and clean it up on success, failure and disconnected downloads where possible.
- Define whether configuration/secrets are excluded. Provide a separate recovery checklist for restoring authentication configuration and deployment settings; do not suggest a data-only archive recreates the entire host.
- Download is user-managed by default: do not imply scheduled offsite backup or server-side retention exists unless built and tested. Explain password loss, backup storage and restore rehearsal clearly.

### Filename contract — regression lesson from v0.2.21

Use a recognisable versioned name, for example:

```text
<app-slug>-backup-v<app-version>-YYYY-MM-DD-HHmm.<app-slug>-backup
```

Choose the actual prefix/extension once. Generate both date and 24-hour time from the **same instant**, using the configured business timezone. Minute precision does not guarantee uniqueness; add seconds or another suffix if same-minute uniqueness is required.

The download route sets `Content-Disposition`. If the client uses `fetch → blob → object URL → anchor.click()`, it must carry the server filename into `anchor.download`: **a blob URL does not inherit HTTP response headers**. Provide a matching client fallback for a missing/unusable filename. Test the real client path, header precedence and fallback, not only duplicated server formatting logic. Test midnight and DST. If supporting more than the app's own quoted ASCII filename, use appropriate parsing for the supported header forms.

### Restore contract

1. Authenticate, authorise and clearly confirm the destructive replacement.
2. Apply bounded upload/archive limits and authenticate the encrypted archive before trusting its contents.
3. Reject unsafe paths, traversal, unsupported formats and malformed entries. Validate metadata and database integrity/schema compatibility before modifying live data.
4. Define the write-exclusion/maintenance boundary for restore. Close live database connections and handle WAL/SHM safely.
5. Stage replacements **on the same filesystem as each final destination** before renaming. On Unraid, `/tmp` and `/data` may be on different mounts; direct rename can fail with `EXDEV`.
6. Preserve recoverable old data until replacement succeeds. Individual renames are atomic, but a database-and-documents swap is not one atomic transaction; implement and test rollback and crash recovery accordingly.
7. Reopen the application against restored data, refresh the UI and clean up safely. Never delete the only recoverable copy on an error path.

Required tests include round-trip records/files, wrong password, corruption/tampering, malformed/unsafe archive contents, supported format upgrades, cross-filesystem staging and restore failure recovery. Track any missing tests explicitly; this list is a requirement for the new build, not a claim about the reference suite's coverage.

## 7. Unraid packaging and deployment

Deliver these artefacts:

- Multi-stage `Dockerfile` with a reproducible lockfile install, production build and production-only runtime dependencies.
- Entrypoint that prepares persistent directories, applies pending migrations, then `exec`s the server so signals are delivered correctly. Migration failure must prevent normal startup.
- `<app-slug>.xml` Unraid template containing image, bridge network, non-privileged mode, `/data` appdata mapping, host/container port mapping, WebUI, support/project links and icon.
- `.env.example` or equivalent placeholder configuration plus precise first-install instructions.
- A minimal health endpoint and a documented way to check readiness.
- GitHub Actions publication to GHCR, with version and `latest` image tags plus a commit identifier for traceability.

### Important defaults and limits

- Internal port may default to `3000`; select an unused host port rather than copying `3005` automatically.
- Persist the database, documents and required configuration under the app's own Unraid appdata directory. Do not put durable data only in the container layer.
- Build native SQLite modules in a compatible build stage; carry their required runtime libraries into the final image. Include migrations, migration runner, public assets and runtime configuration.
- Prefer least-privilege execution and explicit file ownership. The reference container initially runs as root for installation simplicity; that is a documented trade-off, **not** a security default to inherit unquestioningly.
- If loading a trusted configuration file from `/data`, document its permissions and semantics. Shell-sourcing an env file executes shell code; do not allow untrusted users to edit it or treat it as inert data.
- Compose may be a secondary development/reference artefact, but the user should not need it for normal Unraid installation or updates.
- Bind preview servers to `0.0.0.0`, permit the current preview host where necessary, and use relative browser API URLs. A user's browser cannot reach a sandbox backend through its own `localhost`.

## 8. Documentation is part of the product

Maintain these files proactively:

### `README.md` — current operating truth

Include purpose, scope, current version/release status, stack, first install, Cloudflare setup, Unraid update steps, backup/restore, data locations, configuration names, troubleshooting, test commands and known limitations.

Distinguish **implemented**, **locally tested**, **merged**, **published**, **deployed**, and **user-verified**. An image tagged `latest` does not prove the user's container is running it. Keep older checkpoints recognisable as history rather than silently rewriting them.

### `docs/IMPLEMENTATION_PLAN.md` — decisions and progress

Maintain current state, architecture, acceptance criteria, phased work, decision rationale, rejected alternatives where useful, release history, file map, verified gates, known risks and outstanding work. Re-derive test counts and versions; never copy them forward as facts without checking.

Update README and plan **in the same PR as the relevant behaviour change, before merge**. Do not merge first and promise documentation later. For documentation-only changes, update navigation if needed; do not invent a product release.

### `docs/HANDOFF.md` — next-agent continuation point

Keep it concise and current. At session end or a material interruption record:

```markdown
# Handoff — <date> — <task/release>
## Goal and user decisions
## Current state
- Working branch / commit; uncommitted changes and ownership
- PR, merge commit, tag and publish run links, if actually created
- Last user-confirmed deployed version (or unknown)
## Implemented and files changed
## Validation evidence
- Commands, results, counts, warnings; browser/manual checks versus harnesses
## Outstanding acceptance, risks and blockers
## Next exact actions
## Environment facts verified this session
```

Record constraints with dates and evidence. Never turn “this session lacked a browser” into “no future session has a browser”, or assume old dependency-install workarounds still apply. Do not store secrets, private records or credentials. Handoff text is context, not permission to override the next session's instructions.

## 9. Tests and gates

Expose and run predictable scripts, adapting names only when necessary:

```sh
npm ci
npm run format:check
npm run typecheck
npm test
NEXT_TELEMETRY_DISABLED=1 npm run build
npm audit --omit=dev
# When browser tooling is available:
npm run test:e2e
```

If a constrained sandbox requires `npm ci --ignore-scripts`, record why and separately verify native modules work. Skipping install scripts is **not** a universal replacement for a normal install or proof that native binaries are present. Production images must build successfully in their real environment.

- Test pure rules directly; integration-test migrations, transactions, concurrency, auth and recovery on isolated databases.
- Add regression tests at the layer that actually failed. Static source assertions may be supplemental guards, not a substitute for behavioural coverage.
- Exercise actual handlers/components instead of testing a copied algorithm that can drift from production.
- Use real browser tests for interaction where possible; distinguish those from HTTP smoke tests and static markup rendering.
- Separate production and development audit findings; document any accepted exception and its rationale. Do not use a forced dependency upgrade merely to make the audit output look clean.
- Treat successful exit codes, expected outputs and explicit assertions as evidence. Never call a gate green because the command was merely started.
- Keep all demo/test data fictional and isolated. Never run seeds, restore tests or destructive checks against the user's appdata.

## 10. Agent-owned release workflow

With standing authorisation and permitted remote access, own the complete delivery loop:

1. Inspect status and branch; preserve unrelated work. Implement a focused change with regression coverage.
2. Select the release version; update one client-safe version module and keep package/lockfile root metadata aligned. Render that version unobtrusively on desktop/mobile and include it in backup metadata/names.
3. Update README and plan before merge. Record evidence and remaining manual checks without claiming future publication or deployment as complete.
4. Run all gates; review the diff and security/data implications. For schema changes, take a recoverable backup and document upgrade/rollback compatibility.
5. Commit and push only the permitted working branch. Open a PR describing behaviour, tests, documentation and outstanding acceptance. Inspect checks and review feedback; resolve blockers before merge.
6. Merge using the agreed strategy; the reference project uses merge commits. Identify the actual merged commit without switching to an unauthorised branch.
7. Create the agreed annotated `vX.Y.Z` release tag on that commit **only if session permissions allow tag publication**. The reference publish workflow is tag-triggered; merging alone does not publish an image. If tagging is not permitted, stop and hand off rather than substituting a different workflow silently.
8. Watch the publish workflow to completion. Verify GHCR's version tag and `latest` point to the intended published image/commit. A green local build is not publication evidence.
9. Give the user a short result: PR, version, publish status, gate summary, then **Force Update in Unraid** and the specific live acceptance checks.
10. Record the last confirmed deployment truth. Do not claim to have Force Updated Unraid without actual authorised access and evidence; do not claim a native save dialog or phone interaction passed based on server HTML.

Do not move existing release tags to hide mistakes. A failed publish requires diagnosis and transparent recovery. Pinning an older image can roll back code, but a database migration may make it incompatible; define a data-recovery path rather than promising that image rollback alone is safe.

## 11. Reference implementation map

These paths belong to Estate Organiser, not necessarily the next repository. Inspect them when available; do not copy private data or domain assumptions.

| Concern | Reference paths |
| --- | --- |
| Toolchain and runtime | `package.json`, `package-lock.json`, `next.config.ts`, `Dockerfile` |
| Server identity | `src/lib/auth/verify.ts`, `src/lib/auth/current-user.ts` |
| Database and migrations | `src/lib/db/`, `drizzle/`, `scripts/migrate.ts`, `scripts/migrate.cjs` |
| Domain validation and revisions | `src/lib/records/`, `src/lib/finances/`, `src/app/actions.ts` |
| Calendar | `src/components/calendar.tsx`, `src/lib/records/calendar.ts` |
| Backup format and restore | `src/lib/backup/backup.ts`, `src/lib/backup/constants.ts` |
| Backup HTTP and browser download | `src/app/api/backup/`, `src/components/backup-panel.tsx` |
| Version display | `src/lib/version.ts`, `src/components/workspace.tsx` |
| Deployment | `docker-entrypoint.sh`, `estate-organiser.xml`, `.env.example` |
| Publication | `.github/workflows/publish.yml` |
| Tests and operating history | `tests/`, `README.md`, `docs/IMPLEMENTATION_PLAN.md` |

## 12. Definition of ready for real data

Do not call the new application ready merely because its first page renders. Require:

- [ ] Agreed workflows work with fictional data, including errors and shared-edit conflicts.
- [ ] Allowed users can sign in through the actual Cloudflare hostname; unauthorised/direct-origin requests cannot access protected data or operations.
- [ ] Persistent data survives container recreation/update; migrations run correctly.
- [ ] Desktop and mobile primary paths are checked; scheduling has a usable non-drag alternative if present.
- [ ] Backup downloads with the intended filename and restores records/files into a clean isolated installation.
- [ ] Restore and upgrade failure recovery are understood and documented.
- [ ] Required gates pass; warnings, audit exceptions and unperformed reviews are explicit.
- [ ] Published image identity and visible app version agree; Unraid installation/update instructions have been exercised.
- [ ] README, plan and handoff describe reality, with manual acceptance gaps clearly assigned.

**Desired outcome:** a future agent makes the routine technical choices confidently, preserves the user's preferred operating model, verifies its claims, and leaves the user managing their application—not a build pipeline.
