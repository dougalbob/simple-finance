# Simple Finance — Implementation Plan

> **Reading note (2026-09-22):** `AGENT_APP_BLUEPRINT.md` supported the initial build through the first
> release. It is historical context, not required reading for ongoing work. The continuation point is
> `docs/HANDOFF.md`; the product spec is `docs/SPEC.md`. Citations of the blueprint below are records of
> how a decision was made, not a reading list.
>
> **Current:** v0.8.0 is the published image (`latest` = `sha-45a1ad0`, built from `main` @ `45a1ad0` on
> 2026-09-24). Merging does not publish; the image publishes only when the lower-case tag matches the
> version already in the tree it points at — see decision 91.

**Status:** v0.8.0 is the published image (`latest` = `sha-45a1ad0`, built from `main` @ `45a1ad0` on
2026-09-24). The app is now installable as a PWA (manifest + icons, no service worker, no offline access).
340 tests / 85 suites green. The release-blocking backup/restore capability from Phase 5 covers attachments, live in-place restore exists,
suppliers/interactions are audited domain operations, the container runs unprivileged, the Unraid template
and the GHCR publish workflow are written, and the Playwright acceptance suite is defined (it runs in CI —
this sandbox has no browser binaries and no access to the download host). **224 Node tests green** plus the
browser suite in `e2e/`, all local gates green. Phases 0–4b are merged to `main` (PRs #2–#8). Discovery
completed 2026-09-20.
This plan follows `AGENT_APP_BLUEPRINT.md` (the build contract) and `docs/SPEC.md` (the product spec).

> All names, amounts and dates in this document are fictional placeholders. Real values live only in the
> private installation's configuration and database. See the privacy notice in `docs/SPEC.md`.

## Session map (adopted by the product owner 2026-09-20 — decision 29; do not re-open phasing)

| Session | Scope | Status |
|---|---|---|
| 1 | Phase 0 + Phase 1 — bootstrap + thin vertical slice | Complete (PR #2) |
| 2 | Phase 2a — core money records: schema + pure domain modules, E1/E2/E4/E6/E7 | Complete (PR #3) |
| 3 | Phase 2b — mobile entry flows (Add Purchase / Add Fuel / Update Balance) + Playwright | Complete (build; browser tooling unavailable in this sandbox) |
| 4 | Phase 3 — schedules, estimate/projection engines, warnings, key-date alerts | Complete (build on session branch; docs in same PR) |
| 5 | Phase 4a — desktop pages + Insights v1 (first part) | Complete (build on session branch; docs in same PR) |
| 6 | Phase 4b — desktop pages + attachments (remainder) | Complete (PR #8) |
| 7 | Phase 5 — hardening & first release (v0.1.0) | Complete; published as v0.1.0, then patched as v0.1.2 |
| 8 | Post-release — remove an attached receipt (v0.1.3) | This change (decision 89). Not a new phase. |

> Phase 4a/4b boundary as delivered in Session 5: **4a** = Overview (dense dashboard), Purchases
> (filters + inline edit/refund/void), Recurring Payments (read-only month calendar + schedule/renewal
> edits), Accounts & Pots (edits + checkpoint history), Insights panels 1–4 (incl. the projection
> honesty loop), Settings (names, pots, category tree editor, projection figures, warning leads),
> version display in the nav. **4b** = Suppliers page, Contracts & Renewals page + its Overview panel,
> receipt/invoice attachments (SPEC §23), scenario E9.

## Project profile (blueprint §2)

| Field | Decision |
| --- | --- |
| Product | **Simple Finance** (`dougalbob/simple-finance`). Shared household spending tracker for two users, focused on available money, upcoming commitments and avoiding overdraft charges. Primary workflows: mobile quick entry (purchase/fuel/checkpoint), desktop review (purchases, schedules, pots, insights). |
| Scope | MVP = SPEC.md §2 "In scope (v1)". Non-goals: bank integration/reconciliation, credit cards, investments/valuations, offline mode, notifications, drag-drop calendar, fractional splits. Sensitive data: real household finances — fictional-only in repo. |
| Access | Cloudflare Tunnel + Access + Google sign-in; `jose` server-side JWT verification; allowlist of exactly two configured identities; full mutual visibility/editing with audit trail; no in-app roles. |
| Scheduling | Recurring DD/SO/income schedules with auto-conversion on due date; read-only month calendar view of instances; no drag-and-drop; business timezone **Europe/London**; date-only facts date-only; instants UTC. |
| Storage | SQLite via `better-sqlite3` + Drizzle ORM, checked-in migrations. Single instance, two users, low concurrency; optimistic concurrency on shared edits. **Attachment files** (receipt/invoice PNG/JPEG/PDF, SPEC §23) stored under the appdata `documents/` directory — expected volume modest (a few MB/month), included in backups. |
| Deployment | Repo `dougalbob/simple-finance` (public) → GitHub Actions → GHCR image → Unraid XML template. Internal port 3000; **choose a free host port at install time — do not copy the reference app's 3005**. Host data root **fixed by the product owner: `/mnt/user/appdata/simple-finance`** → container `/data`, containing the SQLite database (+WAL/SHM), `.env`, `documents/` and `logging/` (SPEC §18.1). Health endpoint with no records/diagnostics. |
| Recovery | Encrypted downloadable backup (AES-256-GCM, scrypt-derived key, versioned filename per blueprint §6 contract) **including `documents/` attachments with sha256 manifest verification**; excludes `.env` and `logging/` (separate recovery checklist for configuration). Tested restore into a clean isolated installation before real data is trusted. Recovery password never persisted. Restore staging on same filesystem (EXDEV lesson). Full contract: SPEC §18. |
| Delivery | Session branch per platform instructions (this discovery session: `arena/01a0c00b-simple-finance`). **Release authority: full delivery loop** — gates → PR → merge → annotated `vX.Y.Z` tag → GHCR publish verification → user Force Updates in Unraid + runs listed acceptance checks. Granted by the user 2026-09-20 for coding sessions following this handoff; recorded once, not re-asked per release. |
| Verification | Gates: `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`, `NEXT_TELEMETRY_DISABLED=1 npm run build`, `npm audit --omit=dev`; Playwright `npm run test:e2e` where browser tooling exists. Manual acceptance still required: real Cloudflare hostname sign-in, phone entry at a real till moment, Unraid install/Force Update, restore rehearsal. |

## Architecture summary

Blueprint defaults stand: TypeScript strict, Next.js App Router, React, Zod at server boundaries, semantic
HTML + Tailwind, Lucide/Radix as needed, Node test runner via `tsx`, Prettier, multi-stage Dockerfile,
tag-triggered publish workflow, Unraid template.

Domain rules live in small pure modules (estimate engine, projection engine, schedule lifecycle, split
validation, category tree), shared by UI hints, server validation, insights and tests. Money is integer pence
everywhere; per-period rounding, half-up, once (SPEC §7.3).

### Data model sketch (entities — v1)

- `pots` — id, label, kind (bank|cash), sort, overdraft_limit_pence?, warning_threshold_pence?, archived.
- `checkpoints` — id, pot_id, amount_pence, effective_at (UTC instant), entered_by, created_at. Immutable.
- `suppliers` — id, name, normalized_name, default_category_id (most-used, derived or cached),
  contact_phone?, contact_email?, website?, address?, notes? (contact card, SPEC §21).
- `supplier_references` — id, supplier_id, label, value (label→value pairs, e.g. policy/account numbers).
- `supplier_interactions` — id, supplier_id, occurred_at, channel (call|email|letter|in_person|other),
  summary, outcome?, follow_up_date?, related_purchase_id?, related_renewal_id?, created_by.
- `categories` — id, parent_id (null = parent; exactly two levels enforced), name, retired_at?, sort.
- `targets` — household (singleton), `people` (id, label), `vehicles` (id, label, owner_person_id).
- `purchases` — id, supplier_id?, pot_id, total_pence, occurred_at (timestamp), occurred_date (backdatable),
  paid_by_person_id, entered_by, note?, **schedule_instance_id? (non-null = the "from schedule" tag — the
  converted form of a schedule instance; also the self-heal back-reference)**, voided_at?, version
  (optimistic concurrency).
- `allocations` — id, purchase_id, amount_pence (signed: refunds negative), category_id (leaf),
  target_kind (household|person|vehicle), target_id?, refund_of_purchase_id?.
  Constraint: Σ allocations = purchase total (enforced in a transaction, tested).
- `refunds` — modelled as purchases with negative allocation amounts + `refund_of_purchase_id` link.
- `transfers` — id, from_pot_id, to_pot_id, amount_pence, occurred_at, entered_by, voided_at?, version.
- `debts` — id, counterparty (who, verbatim), direction (`we_owe`|`they_owe`, immutable), note?,
  created_by, version. Informal IOUs only — the outstanding balance is always derived from linked
  loan movements, never stored (SPEC §10.2). Renaming a debt updates the counterparty copy on its
  linked loan movements in the same transaction.
- `external_movements` — id, kind (`loan`|`swap`|`other`), direction (`in`|`out`, immutable),
  pot_id, amount_pence, occurred_at/occurred_date, counterparty, debt_id? (loans only, FK → debts),
  exchange_key? (swap legs only: one UUID shared by the pair), note? (required for `other`),
  entered_by, voided_at?, version. Money across the household boundary: in adds / out subtracts
  in the estimate engine like receipts and spending, never spending or income (SPEC §10.2).
- `schedules` — id, name, kind (dd|so|receipt), amount_pence, frequency (monthly|annual), due_day_of_month,
  **due_month (annual only — which month it falls in; NULL for monthly; DB-check enforced)**,
  pot_id, category_id? (leaf; NULL required for receipts), target_kind/target_id?, contract_ends_on?,
  active_from, active_until?, cancelled_at?, **cancelled_effective_on?** (instances from that date stop),
  version. (Phase 3 — decision 55.)
- `renewals` — id, label, supplier_id?, target_kind/target_id?, next_renewal_date, warn_days_before
  (default 21), repeats_annually, notes, advanced_from? (history of auto-advances), version (SPEC §22.2).
- `schedule_instances` — id, schedule_id, due_date, state (**upcoming|converted** — exactly one, enforced
  by a DB CHECK on the (state, link) pair), converted_record_kind (purchase|receipt), converted_record_id,
  converted_at, UNIQUE(schedule_id, due_date). Derived rows: re-derivable from the schedule, so deletion is
  the honest "instances stop existing" (SPEC §11.2).
- `receipts` — **own table (Phase 3 decision 55 / OQ5 resolved):** id, schedule_instance_id?, pot_id,
  amount_pence (>0), occurred_at/occurred_date, entered_by, note?, voided_at/by/reason?, version. Income has
  no category/target (SPEC §6), so it does not reuse `purchases`/`allocations`; the estimate engine treats
  it as +signed pence. This keeps one clean per-record shape while the estimate engine's per-pot sum stays
  transfer-invariant.
- `attachments` — id, purchase_id, file_key (server-generated under `documents/`), original_name, mime,
  size_bytes, sha256, state (pending|stored|failed|deleted), created_by, created_at (SPEC §23, §23.4).
  `deleted` is a soft-delete written by `deleteAttachment`; there is no CHECK on `state` and no extra
  migration.
- `settings` — typed string-key value store (Phase 3): `weekly_groceries_pence`,
  `monthly_fuel_pence:<vehicleId>` (SPEC §7.3), `renewal_warning_lead_days` +
  `contract_end_warning_lead_days` (default 21, SPEC §22); private runtime values, typed accessors in
  `src/lib/records/settings.ts`, empty string clears. (Household labels / payday-of-month config move to the
  Phase 4 Settings page when they become user-editable; the planning cycle's payday is currently derived from
  the earliest unconverted receipt instance — SPEC §11.3.)
- `audit_entries` — actor, action, entity, before/after summary, timestamp; written in the same transaction
  as the change (blueprint §3).

*Phase 3 design resolved (Session 4):* dedicated `receipts` table (not a signed-purchase reuse — OQ5), the
instance↔record back-references on both tables, `purchases.schedule_instance_id` for the "from schedule"
tag + crash self-heal, `due_month` for annual schedules, and `(pot_id, occurred_at)` / `(occurred_date)`
indexes for the estimate queries.

## Phased plan

**Phase 0 — Bootstrap.** Repo scaffold: package.json + lockfile, tsconfig strict, Next.js App Router, Tailwind,
Prettier, Node test runner via tsx, Drizzle + better-sqlite3 with migration tracking, `docker-entrypoint.sh`
skeleton, `.env.example` placeholders, CI-friendly scripts. Docs already exist (this set). *Exit: `npm ci`,
typecheck, format:check, test (trivial), build all green.*

**Phase 1 — Thin vertical slice (blueprint §2).** Authenticated access (`jose` verification of Access JWTs,
allowlist, fail-closed config, dev-identity behind dev flag) → one validated write (a pot + checkpoint) →
persistent read → container startup runs migrations → backup/restore skeleton exercised on the slice data.
*Exit: unauthorised/wrong-audience requests rejected in tests; checkpoint survives container recreate;
restore round-trip passes on an isolated copy.*

**Phase 2 — Core money records.** Pots, checkpoints (with effective-date rule), purchases + allocations with
exact-total constraint and remainder helper, split validation, category tree (seeded with SPEC §12, editable),
suppliers with memory + default chip, targets (household/people/vehicles), transfers, refunds, void/edit with
audit trail, optimistic concurrency, duplicate-entry notice. Mobile entry flows (Add Purchase / Add Fuel /
Update Balance) functional; supplier records include the contact card + reference pairs and the interaction
log (SPEC §21). *Exit: acceptance scenarios E1, E2, E4, E6, E7 (SPEC §17) pass as integration
tests plus a Playwright mobile-viewport run where tooling allows.*

**Phase 3 — Schedules, estimate and projection engines.** Schedules + instances with the upcoming→converted
lifecycle (unique-state enforcement), income schedules, estimate engine (SPEC §7.1, timestamp/date comparison
rules), projection engine (§7.2–7.3, period-level rounding), warning tiers (§8), pot-level transfer watch
(§7.5). Schedules gain frequency (monthly|annual) and optional contract end dates; renewal records and the
key-date alert engine (pure date arithmetic: warning windows, annual advance, "rolled / awaiting review" —
SPEC §22). *Exit: scenario E3 (counted exactly once at every instant — property-tested across the due-date
boundary), E5 (assume-cleared documented behaviour), E8 (projection arithmetic to the penny, tier selection,
DST + month/year boundary cases) all green.*

**Phase 4 — Desktop pages + Insights v1.** Overview (dense dashboard per SPEC §15.2), Purchases (filters,
inline edit), Recurring Payments (+ read-only month calendar view), Accounts & Pots, Insights (SPEC §16
panels 1–4), Settings (category tree editor, projection figures, thresholds, labels), **Suppliers page** and
**Contracts & Renewals page** with the Overview panel (SPEC §21–22), **receipt/invoice attachments**
(desktop picker, mobile camera capture, retroactive attach, authenticated viewer — SPEC §23), scenario E9.
Version display.
*Exit: desktop and mobile primary paths checked; calendar consistent with lists after schedule edits;
insights figures reconcile with the pure engines in tests.*
Session 5 delivered the first half (decisions 63–75); the calendar-consistency exit criterion is pinned by
`tests/recurring-calendar.test.ts` and the insights-reconciliation criterion by
`tests/insights-view.test.ts`.

**Phase 5 — Hardening & first release (v0.1.0).** Full backup/restore per blueprint §6 and SPEC §18
(encryption, filename contract incl. blob-download filename lesson, EXDEV staging, failure recovery,
wrong-password/corruption tests, **documents/attachments consistency and sha256 manifest verification**),
restore rehearsal into a clean isolated installation **covering records and attachments**, security review
against blueprint §4 checklist,
Dockerfile + GHCR workflow + Unraid XML template + first-install instructions, README brought to operating
truth, all gates + `npm audit --omit=dev`, PR → merge → tag → publish verification. *Exit: blueprint §12
"Definition of ready" checklist complete; user Force Updates and runs the listed acceptance checks
(real Cloudflare sign-in, a real till-moment mobile entry **including a camera receipt attachment**,
checkpoint + projection sanity, a renewal/contract-end alert inside its window, restore rehearsal evidence
covering attachments).

*Delivered in Session 6 (this session), with the decision numbers below:*

- **Backup format 2** — the WAL-safe snapshot plus every attachment the snapshot references, sha256 per
  file, an orphan report; refuses to build an archive that references a missing document (SPEC §18.2).
- **Restore** — accepts format 1 and 2, strict member allowlist (no traversal/absolute paths/extra members),
  per-file integrity, referenced-document verification, staged swap preserving both the previous database
  and the previous documents directory, rollback that never deletes the only recoverable copy (SPEC §18.4).
- **Live in-place restore** — `POST /api/restore` closes the process-wide handle, restores, reopens; the
  Settings panel carries the typed confirmation, the same-origin guard and a 512 MB bound.
- **Browser download path** — `Content-Disposition` filename carried into `anchor.download` with a tested
  fallback (the v0.2.21 lesson), plus an end-to-end Playwright case.
- **Container least privilege** — the entrypoint aligns `/data` ownership once and runs the server as
  PUID:PGID (Unraid 99:100); the CI and publish smoke tests assert the server is not root.
- **Unraid template + publish workflow** — `simple-finance.xml`, tag-triggered GHCR publication with a
  pre-push smoke test (health, unprivileged, database survives container recreation) and registry-digest
  verification.
- **Browser acceptance suite** — `e2e/` specs driven by real selectors (mobile till moment, desktop review,
  calendar consistency after a real due-day edit, backup download and restore through the UI); run in CI
  (`npm run test:e2e`), never claimed from markup rendering (blueprint §9).*

## Test strategy (domain-specific, on top of blueprint §9)

- Household-boundary money (`tests/external-money.test.ts`, 17 tests) is a first-class worked
  domain alongside E8: debt balances derive from movements (badges settled/void-only/settled),
  loan movements link to a live debt and render "settled", swaps are atomic net-zero pairs that
  survive DB round-trips, estimate ≡ Insights spending on the same fixture, `archivePot` refuses
  referenced pots. Followed by 4 Zod boundary tests (money-input caps, swap same-pot,
  archivePot naming) and e2e specs (`e2e/external-money.spec.ts` + a Move-tab test in
  `e2e/home.spec.ts`).


- Pure engine tests: estimate, projection, rounding, tier selection, schedule lifecycle state machine,
  split-total validation, category roll-ups.
- Integration tests on isolated databases: E1–E8 scenarios (SPEC §17) as named cases; checkpoint comparison
  precision rules (§7.1); void/edit audit trails; optimistic-concurrency conflict on shared edit; migration
  up-path.
- Date/time tests: Europe/London DST transitions, local-date rollover near UTC midnight, month/year/leap
  boundaries for due-day schedules (e.g. due day 31 in a 30-day month — rule: clamp to last day of month;
  confirm in Phase 3), payday window arithmetic.
- Auth tests: missing/invalid/wrong-issuer/wrong-audience/expired JWTs rejected on every protected entry
  point, including API routes and backup/restore.
- Key-date tests: renewal warning-window arithmetic (default 21 days, per-item overrides), annual advance
  including 29 February (OQ13 rule), contract-end alerts that never stop instances (property test across the
  end-date boundary), "rolled / awaiting review" state transitions.
- Attachment pipeline tests: content-sniffed MIME vs spoofed extension, size limit enforcement, failed upload
  leaves the purchase intact and retryable, orphan sweep reports without deleting, authenticated-only serving
  (no unauthenticated fetch), sha256 verification on restore, and user-initiated removal (decision 89):
  soft-delete then unlink, double-delete is a no-op, a deleted URL 404s, an unlink failure does not roll
  the row back, an unsafe key is not used as a path, and a pre-delete archive still restores the file while
  a post-delete archive has neither the document nor an orphan.
- Backup consistency tests: an archive can never reference a missing document; unreferenced documents are
  excluded and reported; `.env`/`logging/` provably absent from archives.
- Browser tests (Playwright where available): mobile-viewport entry flows, desktop table editing, calendar
  view consistency, backup download filename via the real client path.
- Never claim a browser run from markup rendering; distinguish harnesses honestly (blueprint §9).

## Decision log (all decisions dated 2026-09-20, discovery session with the product owner)

1. Pots: two joint bank accounts (Main "busy" account pays everything out; Salary account receives partner's
   monthly salary; manual transfers Salary→Main as needed) **plus cash tracked separately**: two personal
   wallets + shared jar (five pots total).
2. No credit cards in the household; out of scope.
3. Checkpoint figure = bank **current/ledger balance** (pending items not deducted).
4. Planning cycle: **payday-to-payday** for warnings/projection; **calendar month** for Insights reporting.
5. Headline figure = **household total across pots**, plus a separate pot-level "plan a transfer" watch on
   commitments due from the Main account.
6. Pending-at-checkpoint purchases: **assume cleared** (chosen twice, after the overstatement trade-off was
   explained and a tap-at-checkpoint compromise was offered). Documented limitation SPEC §7.4.
7. Recurring payments: **auto-convert to actual spending on due date**; amounts are fixed and user-maintained;
   no confirmation step; "from schedule" tag; edit/void for late/missed; cancellation with effective date.
8. Income: **fixed expected receipts in scope** (salary, known date, roughly fixed amount) feeding the
   projection. One-off income (a sale, a third-party refund, a gift) was deferred at the time and is
   **in scope from v0.4.0** (decisions 109–111).
9. Warnings: **two tiers** — heads-up below £0; main warning at a configured overdrawn threshold well inside
   the authorised overdraft limit (limit exists on the Main account only; real figures private).
10. Day-to-day projection: **configured figures** (weekly groceries; per-vehicle monthly fuel — spending is
    highly predictable: weekly shop within ~±£20) **+ Insights honesty loop** comparing recent actuals.
11. Attribution: **paid-by / entered-by / for-whom** kept distinct; defaults (shared→household, personal→payer,
    fuel→payer's vehicle) as visible one-tap-override chips; unobtrusive override to assign a purchase to the
    other person.
12. Vehicles: first-class **cost targets** — fuel, insurance, maintenance, road fund licence, parking; long-horizon
    per-vehicle totals; category × target as separate dimensions.
13. Splits: multiple allocation lines, each a whole-pence amount with exactly one target; **lines must total
    the payment exactly** (save disabled until matched; one-tap remainder helper). **No fractional/percentage
    splits between the two people** — couple activities are household allocations. No draft/incomplete splits.
14. Refunds: separate negative records, optionally linked; corrections via edit/void with retained audit
    history; transfers can never inflate spending.
15. Privacy between users: **full mutual visibility and editing** with audit trails; no in-app privacy walls.
16. Categories: **two-level parent/child tree approved as proposed** (SPEC §12); user-editable; retire
    preserves history; insights roll up to parent.
17. Connectivity: **online-only v1**; keep-on-screen + retry on reconnect; no offline queue or sensitive
    local caching.
18. Calendar: **read-only month view** of due instances on the Recurring Payments page; no drag-and-drop;
    explicit wording that in-app date changes never move bank instructions.
19. Notifications/reminders: **none in v1** (proposed; no objection = agreed per session convention).
20. Desktop: dense **Overview page only** as a single screen; all other subjects get their own menu pages —
    functionality is never sacrificed to save space. Mobile's main purpose is out-and-about quick entry;
    deep review happens on the laptop. Menu pages are not hidden on mobile (at least for now).
21. Release authority: **full delivery loop (blueprint option 1)** for the next coding session(s); this
    discovery session is explicitly **no-coding** — its deliverable is this spec handoff.
22. Privacy: public repo — all repo content fictional; real figures only in private installation config;
    `.gitignore` committed before any code (already on branch).

*Scope additions agreed later the same day (2026-09-20), after the initial handoff draft:*

23. Fixed-term contracts: DD/SO schedules carry an optional **contract end date** — informational with an
    ahead-of-time alert (configurable lead, default 21 days); **instances never auto-stop** because the app
    never assumes a bank instruction changed; past dates show as "rolled / awaiting review".
24. Renewals (house/car insurance etc.): dedicated **renewal records** — label, optional supplier link,
    optional vehicle/household target, next date, per-item warning lead (**default 21 days**), annual
    auto-advance; surfaced in an Overview panel and a Contracts & Renewals page. Schedules gain
    **frequency (monthly|annual)** so annual lump-sum premiums convert like any instance. Delivery channel
    **confirmed 2026-09-20: in-app for v1**; an optional **email alert channel is a recorded v2 roadmap
    item** (SMTP config, delivery-failure handling, tested delivery; scoped separately, not a v1 blocker).
25. Suppliers get **contact cards** (phone, email, website, address, label→value reference pairs such as
    policy numbers, notes) and an **interaction log** ("+ Create Interaction": channel, when, summary,
    optional outcome and follow-up date, optional links to a purchase/renewal), on a dedicated Suppliers
    page; both users see all; audited.
26. **Receipt/invoice attachments in scope for v1** (supersedes OQ6): PNG/JPEG/PDF, multiple per purchase,
    desktop file picker + mobile camera capture, retroactive attachment; purchase save never blocks on
    upload; stored under `documents/` with server-generated keys, content-sniffed MIME, sha256,
    authenticated private serving; included in backups with manifest verification (SPEC §18.2, §23).
27. **Data root fixed:** `/mnt/user/appdata/simple-finance` on the Unraid host → container `/data`,
    containing the SQLite files (+WAL/SHM), `.env`, `documents/`, `logging/`. `.env` and logs are excluded
    from backups; a separate recovery checklist covers configuration (SPEC §18.1).
28. Backup/restore contract made explicit in **SPEC §18** (previously only referenced via blueprint §6 in
    SPEC §2, this profile and Phase 5): contents/exclusions, consistency boundary for attachments,
    encryption + filename + blob-download lessons, restore staging/rollback rules, and the clean-installation
    rehearsal gate before real data is trusted.

*Session 1 (2026-09-20) — build decisions, recorded for future sessions:*

29. **Session map adopted** (table above): seven sessions; Phases 2 and 4 split into a/b. Recorded in this document at the product owner's instruction so no future session re-opens the phasing question. End-of-session documentation updates ride in the same PR as the code (user instruction 2026-09-20).
30. **Stack versions** (current, supported, mutually compatible; lockfile committed): Next.js 16.3.5, React 19.3.0, TypeScript **5.9.3** (deliberately not 7.x — the native-compiler line is newest but 5.9 is the known-Next-compatible choice; revisit later with a dedicated upgrade gate), Tailwind 4.3.3, drizzle-orm 0.45.2 + drizzle-kit 0.31.10, better-sqlite3 13.0.3, zod 4.6.5, jose 6.2.12, tar 7.5.22, Node 22 LTS.
31. **Drizzle sync-mode conventions** (discovered the hard way in Session 1; future sessions must follow): every query needs a terminal method — inserts use `.returning().get()` (single row) or `.run()` (no return); a bare `.values()`/`.returning()` is a no-op builder, not a query. Counts via `select({ value: count() }).from(t).all()`, not `$count()`. Recorded so Phase 2+ doesn't re-trip.
32. **Container strategy:** regular `next build` + `next start` (not standalone output) with the pruned production `node_modules` copied from the builder stage — robustness (native modules) over image size; optimisation candidate for Phase 5. Container runs as root for now (documented trade-off matching the reference app); Phase 5 security review to decide least-privilege execution.
33. **Auth configuration** (names in `.env.example`): `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_ALLOWED_EMAILS` (exactly two), optional `AUTH_CERTS_URL` (default `${issuer}/cdn-cgi/access/certs`), `AUTH_DEV_BYPASS` + `AUTH_DEV_IDENTITY_EMAIL`. The bypass is computed false whenever `NODE_ENV=production` — impossible to enable by flags alone. Verification restricts to RS256 and enforces issuer/audience/expiry/allowlist.
34. **Backup skeleton scope (Phase 1):** archive = tar.gz{db snapshot via `better-sqlite3 .backup()`, manifest.json} → AES-256-GCM (scrypt N=16384/r=8/p=1, fresh salt+nonce) with frame magic `SFBA` v1. Restore targets isolated directories only; live in-place restore (connection close, WAL/SHM, rollback, UI refresh) is Phase 5. Filename contract implemented and DST/midnight-tested; client blob-download tests land with the Phase 5 UI.
35. **Prettier excludes `*.md`** (`.prettierignore`): documentation is hand-authored, including the product owner's spec documents; markdown reformatting adds diff noise without value. (A `prettier --write .` reformatted the spec docs once in Session 1; reverted before commit — no spec content was lost.)
36. **Sandbox constraint (environmental, not a repo decision):** this sandbox blocks `nodejs.org`, so plain `npm ci` fails when npm's gypfile auto-build tries to compile `better-sqlite3` from source. `npm ci --ignore-scripts` works (the package bundles prebuilt binaries incl. linux-x64/node-22) and the suite verifies the native module — the blueprint §9 caveat is satisfied and recorded. Plain `npm ci` is proven in the CI `gates` job on GitHub Actions. Do not "fix" the repo for this; do not assume the constraint still holds in a future session — re-verify.

*Session 2 (2026-09-20) — Phase 2a build decisions:*

37. **Refund linkage on the purchase, not the line:** `purchases.refund_of_purchase_id` points at the original purchase (the plan's sketch placed it on allocations; the whole negative record links, so the column lives with the record). Every refund line must (category, target)-match an original line; cumulative active refunds are capped at the original total; a refund of a refund is rejected (that is just a purchase).
38. **Supplier category memory is derived, never cached:** count of non-void purchases per category; ties break towards most recent use, then lowest category id (stable, never arbitrary per query). The preselected chip can never go stale.
39. **Date-only money facts take effect at the end of the local date:** backdated purchases/transfers and date-only checkpoints share one rule (`endOfLocalDate`, Europe/London, DST-tested). `occurred_at` + `occurred_date` are stored together and consistency-checked when both are given.
40. **No mixed-sign splits:** purchase lines are all positive, refund lines all negative; a till discount reduces a line. Rejected with a message pointing at refunds (keeps SPEC §9.4 fraction-free).
41. **Void discipline:** voiding an original with active linked refunds is blocked — void the refunds first, explicitly, no cascades. Voided records are frozen: no edit, no second void.
42. **Optimistic concurrency via synchronous transactions:** a single-writer Node process running fully synchronous transaction bodies cannot interleave two transactions, so read-check-update inside one transaction is race-safe without a row-count assertion. Each domain module documents this assumption; it must be revisited if writers ever multiply.
43. **Uniqueness:** sibling category names and person/vehicle labels unique case-insensitively (domain-enforced); supplier `normalized_name` unique at the DB level with domain error mapping (race-safe).
44. **Retire is for child categories only** (parents stay while history points at them); edits that do not touch lines skip category re-validation, so fixing a typo never breaks on a category retired after the purchase.
45. **Duplicate-notice rule — OQ3 default shipped:** same pot + same total + (same non-null supplier OR a shared category) + created within [now−2h, now] + non-void; the newest match is returned, non-blocking.
46. **`paid_by` nullable in schema:** till entry always sets it; schedule conversions (Phase 3) may leave it null. The UI default (signed-in user) lands in Phase 2b/4 with the user→person mapping.
47. **Refunds default to the original's pot/supplier/payer** but may override each (a cash refund can differ from a card purchase); no same-pot enforcement.
48. **Phase-1 test maintenance:** fixed-date checkpoint tests now pass explicit `now` (future-dated records are rejected by the new validation); the `__drizzle_migrations` count assertion moved to 2 with migration 0001. People/vehicles/suppliers are never seeded (household data); categories are seeded (product content).

*Session 3 (2026-09-20) — Phase 2b build decisions:*

49. **Entry boundary shape:** Add Purchase submits integer-pence totals and a JSON split payload through a server action; Zod validates the parsed shape before the existing domain module enforces exact totals, live leaf categories and target existence. Add Fuel uses the same purchase path with the Fuel category and a vehicle target fixed server-side.
50. **Signed-in payer default:** until the Phase 4 Settings mapping exists, a visible paid-by chip is preselected from a person whose label appears in the signed-in email local part, falling back deterministically to the first person. The user can override it before save; schedule conversions may still use the nullable schema value later.
51. **Supplier entry ordering:** recent non-void supplier use is listed first, followed by alphabetical suppliers. Unknown typed names pass through the existing inline supplier creation path; near matches are a non-blocking client prompt, never an automatic merge.
52. **Quick-entry duplicate handling:** a duplicate notice is returned only after the save has succeeded. It links to the home review row and offers an explicit version-guarded void action; no duplicate is blocked and no record is deleted.
53. **Phase-2b setup:** people and vehicles remain unseeded household data. A small authenticated setup section is available on the home page so a fresh installation can create the labels needed by paid-by, personal and vehicle target chips; it is not a replacement for the Phase 4 Settings page.
54. **Browser harness status:** no Playwright package or browser is present in this sandbox. The mobile layout and single-flight guards are implemented, but no browser run is claimed; browser setup/real mobile acceptance remains an explicit Phase 5 gate.

*Session 4 (2026-09-20) — Phase 3 build decisions:*

55. **Phase 3 money-record shape (OQ5 resolved):** dedicated `receipts` table for income — NOT a reuse of
   `purchases`/`allocations`. Income has no category or target (SPEC §6), so forcing it through the
   exact-total split machinery would be a lie the schema would have to hide. `receipts` is a flat,
   positive-pence, pot-scoped money record (voidable, versioned, audited) that the estimate engine reads as
   +signed pence. Schedule↔record linking uses back-references on **both** sides:
   `purchases.schedule_instance_id` / `receipts.schedule_instance_id` (the "from schedule" tag) and
   `schedule_instances.converted_record_kind/_id` (history + self-heal). Migration `0002_phase3_schedules`
   adds schedules, schedule_instances, receipts, renewals, settings and the purchase back-reference column.
56. **Annual schedules need a due month:** a monthly-only `due_day_of_month` is ambiguous for annual
   schedules ("12 October every year" — which month?). `schedules.due_month` (1–12) is required for
   `frequency = annual` and NULL for monthly, enforced by the `schedules_due_month_rule` DB check. Annual
   due date = clamped `due_month`-`due_day` each year (29 Feb → 28 non-leap, OQ13).
57. **Conversion semantics (E3):** conversion is the local-midnight instant of the due date
   (`startOfLocalDate`, Europe/London — always exists). The converted record is an ordinary record:
   occurredAt = that midnight, occurredDate = the due date, single line = the schedule's amount/category/
   target, `paid_by` null, actor `system`, note `From schedule "name"`, created through `createPurchase` /
   `createReceipt` (so duplicate/void/edit/audit all work unchanged). The due pass is **lazy** — the app is
   not a cron daemon: every money read (`getMoneySnapshot`/`getProjectionView`/`getKeyDateAlerts`) first
   runs `ensureScheduleState` (materialize + convert due instances + advance due renewals). Conversion is
   idempotent and **self-healing**: each conversion first looks for a record already back-referencing the
   instance (crash between the two writes) and repairs the link instead of converting twice, so at no
   instant is a fact in two states and it is never subtracted twice (a converted record before a later
   checkpoint is excluded from that estimate — the E3 table, tested).
58. **Instance set = derived data:** `syncScheduleInstances` recomputes the desired upcoming set
   (due dates in `[max(active_from, day-after-last-converted), min(today+400d, active_until,
   cancelled_effective_on−1)]`), inserts missing (onConflictDoNothing) and deletes stale — deletion is the
   honest "instances stop existing" (SPEC §11.2); the schedule's own create/edit/cancel audits are the
   retained record. Edits apply from the next instance onward; converted history is never rewritten
   (SPEC §11.1). Cancellation = flag + effective date; instances from it stop existing, earlier ones remain
   history. Contract end dates are alert-only — instances never auto-stop (SPEC §22.1, tested).
59. **Comparison precision (E5 / SPEC §7.1):** a record is *after* a checkpoint ⇔ (timed) its instant is
   strictly after the checkpoint instant, or (date-only, recognised by the end-of-local-date marker) its
   local date is ≥ the checkpoint's local date — sharing the date counts as after, the conservative
   direction, self-correcting at the next checkpoint. Timed-vs-timed comparisons therefore never use dates.
60. **Projection reading (E8, penny-verified):** `days = payday − today` in whole local days; the configured
   day-to-day block (weekly groceries × days/7, per-vehicle monthly fuel × days/30, each rounded once at
   period level, integer half-up) is applied **pessimistically up front** — the low is computed as if all
   predictable spending lands before pay (exactly the E8 arithmetic). Commitments (unconverted dd/so
   instances) and receipts (unconverted receipt instances) apply on their due days; **within a day,
   outgoings apply before receipts** (still the conservative direction). `projected_low` = the minimum
   running value including the start; `payday` = the earliest unconverted receipt instance (today's dues are
   already converted, so it is strictly in the future); no receipt schedule → the view is null and the UI
   says exactly what is missing. (*Amended v0.5.0, decision 116:* the earliest debt expected inflow also
   wins the cycle, earliest against receipts. *Amended v0.6.0, decisions 118–119:* day-to-day is no longer
   smoothed pro-rata nor charged up front — each figure is a repeating **event** dated from the last actual
   shop/fill (the anchor-reset model, SPEC §7.3), which also ends the double-count after a recorded spend
   and makes the lowest point's date meaningful with day-to-day included.) Warnings (§8) against
   `projected_low`: below £0 → heads-up; at or beyond
   the most-protective configured pot threshold → warning. The pot watch (§7.5) excludes day-to-day by
   design.
61. **Renewal auto-advance is a full catch-up:** `advanceDueRenewals` steps repeating renewals one year at
   a time (each step audited, `advanced_from` history) until the date is in the future, so a late-created
   renewal converges in one pass; non-repeating renewals are left in place (key dates show them as past).
   29 Feb → 28 Feb in non-leap years (OQ13). Key-date windows are inclusive: an alert shows from exactly
   `leadDays` days before (E9's 21st-day boundary, tested).
62. **Phase 3 UI scope:** compact home panels — money estimate (household + per-pot, honest
    "not a bank balance" labels + last-checkpoint times), projection breakdown with tier banner, pot-watch
    nudges and a collapsible day-by-day table, due-this-week, key dates, and entry forms for
    schedules/renewals/projection figures (new server actions + Zod schemas following the Phase 2b
    conventions). The dense desktop pages (month calendar, Insights, Settings) remain Phase 4 per the
    session map — the mobile surface is the primary Phase 3 deliverable.
63. **Insights engine split (Session 5):** pure engine `src/lib/records/insights.ts` consumes flat typed
    rows (`SpendingLineInput`: occurredDate, categoryId, parent/child names, target kind/id, signed
    pence) — same shape the estimate engine uses, framework-free, integer pence only. DB assembly
    `src/lib/records/insights-view.ts` runs the lazy due pass first (converted schedule purchases are
    ordinary spending and belong in the month), then joins allocations ⋈ purchases (non-void) ⋈
    categories. **Transfers never reach the engine** (SPEC §10 — they move money between your own pots)
    and receipts never do (income is not spending); the join over `allocations` enforces both by
    construction. No arithmetic lives in the view layer, so the UI and the tests share one code path.
64. **Panel 1 months:** full calendar months; the current month carries an "in progress" flag while
    `today < last day of month` (DST-safe local dates). The Overview's "month so far" bars use a separate
    month-to-date summary (first of month → today) from the same view.
65. **Panel 2 attribution:** only lines with an explicit `person` target are attributed; **household
    allocations are never attributed to whoever happened to pay**; zero-activity people are still listed.
66. **Panel 3 window:** vehicle rolling 12 = first day of (current month − 11) → today, per vehicle,
    by child category (fuel/insurance/maintenance/road tax/parking); zero-activity vehicles listed.
67. **Panel 4 honesty loop (complete periods only):** groceries = last 8 complete Monday–Sunday weeks;
    fuel per vehicle = last 3 complete calendar months. Averages via `roundHalfUpDivide` (integer, once at
    period level); `drift = average − configured`, `null` when the figure is unconfigured. The partial
    current week/month never enters the average, so a 3-day week never mixes with a 7-day one (tested
    across the UK spring-forward, 2026-03-29).
68. **Pot edits (Settings):** `editPot` accepts label/kind/overdraft limit/warning threshold with the
    version guard + `pot.edit` audit; label collapses whitespace (≤60 chars); blank limit/threshold
    clears; **a threshold requires a limit and must sit at or below it** (`InvalidPotInputError`).
69. **Purchase filters (Purchases page):** `PurchaseFilters` gains `scheduleOnly` / `refundsOnly` /
    `voidedOnly` (isNotNull on `scheduleInstanceId` / `refundOfPurchaseId` / `voidedAt`); `voidedOnly`
    overrides the default voided exclusion. Line-level category/target filters match the purchase and
    return all its lines receipt-style.
70. **Recurring calendar is server-rendered from the instance list:** the month grid (Mon-first, 42
    cells, `?month=YYYY-MM`) renders exactly `listInstances(db, {from, through})` for the month window —
    one query, one row per cell — so the calendar and the lists below it are consistent **by
    construction**, not by synchronisation. Day details in `<details>`; each instance links to its
    schedule's edit form (`#schedule-edit-<id>`). The page states the read-only boundary in plain
    language: **app date changes never move bank instructions** — direct debits/standing orders are
    agreed with the bank; the app only changes which records it will make.
71. **Edit/refund/void forms:** `PurchaseEditForm` = full line replacement (line editor + hidden
    `linesJson` carrying integer pence; blank date/note = unchanged). `RefundForm` prefills the
    original's lines as **positive magnitudes**; `addRefundAction` flips the signs
    (`-total`, `-abs(line)`) before `createRefund` (decision 37's negative-purchase refund). A generic
    `VoidForm(recordId, expectedVersion, reason)` serves purchase and transfer rows with the same
    reason rules; voids never delete (decision 6).
72. **Revalidation + dynamism:** every new action revalidates `['/', '/overview', '/purchases',
    '/recurring', '/pots', '/insights', '/settings']`; all six new pages export
    `dynamic = 'force-dynamic'` (single-user household app — no caching of money figures).
73. **Settings sections:** household renames (person/vehicle, `renameTargetAction`), per-pot edit
    (68), the **category tree editor** (`categoryEntrySchema` ops add-parent/add-child/rename/retire,
    one shared `saveCategoryAction`; parents can't be retired while history points at them — retire
    children instead), `ProjectionSettingsForm` (slim props `{weeklyGroceriesPence, monthlyFuelPence}`,
    reused by home + recurring + settings), warning leads (`warningLeadsEntrySchema`, 0–365 days each),
    and the payday pointer (projection view's income schedule + link into Recurring).
74. **Overview density (SPEC §15.2):** money row + tier banner, projection panel with the
    "what's in this forecast" day-by-day `<details>` (shared component with the home page), due this
    week, key dates, month-to-date by-parent bars with last-month comparison, vehicle rolling-12, and
    the review list with inline edit/refund/void. Quick entry is embedded via the shared
    `buildEntryData(db, now)` (`src/lib/records/entry-view.ts`) — the mobile home and the desktop
    overview use one code path; the home page's inline builder was removed.
75. **Due-day edits move the next instance (Phase 3 bug fixed in Session 5):** the old
    `syncScheduleInstances` kept already-materialised upcoming instances, so changing a due day never
    reached any materialised instance — contradicting SPEC §11.1 "applies from the next instance
    onward". `editSchedule` now passes `{ regenerateFromToday: true }`: the upcoming set is regenerated
    from the schedule's **current** cadence starting today (no backfill of past dates under the new
    cadence — that would invent history). Creation and the daily pass keep history-based
    materialisation (an `activeFrom` in the past still yields its real, already-occurred instances).
    Regression: `tests/recurring-calendar.test.ts`.

*Session 6 (2026-09-21) — Phase 5 build decisions (hardening & first release):*

76. **Archive format 2 = snapshot + attachments + manifest.** `simple-finance-backup` format 2 carries
    `db.sqlite` (the supported WAL-safe `.backup()` snapshot), `manifest.json` and `documents/<key>` for every
    attachment the **snapshot** references in state `stored`. The document list, row counts and sha256 values
    are all read from the snapshot file, not from the live connection — that is the coordination point SPEC
    §18.2 asks for, so an archive can never describe a database state it does not contain. A file that the
    snapshot references but the disk has lost makes the backup **fail loudly** (`BackupIncompleteError`,
    HTTP 409) rather than produce an archive that only looks complete. Unreferenced files are reported in
    `manifest.documents.orphans` — never included, never deleted. The manifest cannot hash itself, so it is
    the one allowlisted member that is legitimately absent from `manifest.files` (see decision 81).
77. **Restore accepts formats 1 and 2 and verifies before it touches anything.** Order: authenticate
    (decrypt + GCM), extract through a strict member allowlist (`db.sqlite`, `manifest.json`,
    `documents/<uuid-like-key>`; directory entries ignored, everything else dropped), validate the manifest
    against the Zod schema, verify size + sha256 of every listed member, reject any extracted member the
    manifest does not list, `quick_check` the database plus expected-table probing, then verify that every
    `stored` attachment the restored database references is actually inside the archive. Only then does the
    swap happen.
78. **The swap is staged on the destination filesystem with rollback that keeps the old data.** Both the
    database (with its `-wal`/`-shm` sidecars) and the documents directory are renamed aside as
    `.pre-restore-<stamp>` before the replacement lands; if the replacement fails, the preserved copies are
    renamed back and any partially moved replacement is removed first, so the previous installation is
    complete again. Nothing is ever deleted on an error path. When the archive carries no documents the
    restored installation gets an empty documents directory rather than leftovers the restored database does
    not reference.
79. **Live restore closes the connection first and reopens it after.** `closeDbHandle()` → staged restore →
    `getDbHandle()` again, with a trivial read to prove the reopened handle is usable. If anything fails the
    handle is reopened against whatever is on disk (the restore layer preserved the previous data), so a
    failed restore leaves a working app. Archive-authentication failures (`BackupPasswordError`,
    `BackupFormatError`) are re-thrown unchanged so the route can say "wrong password" instead of "failed".
    `RestoreSummary.previousPreservedAs` gives the household the manual rollback path in writing.
80. **Route handlers guard themselves from the Request.** `/api/restore` and `/api/backup` call
    `getCurrentUser(request.headers, loadAppConfig())`, never the `next/headers` adapter (which throws
    outside a request scope, as the attachment route proved in this session's tests). Both POST handlers
    additionally require a same-origin request: `Sec-Fetch-Site: cross-site` is refused, `Origin: null` is
    refused, and a mismatched origin is refused (forwarded host allowed, which is how Cloudflare's tunnel
    presents the app). Server actions keep the framework's CSRF protection; route handlers do not get it for
    free, which is exactly why this is explicit.
81. **Attachment pipeline is one module.** `src/lib/records/attachments.ts` owns content sniffing
    (PDF `%PDF-`, JPEG `FF D8 FF`, the full PNG signature — extension and browser MIME are ignored),
    the 10 MB limit (plan OQ12), the strict server-generated key pattern
    (`uuid.{png|jpg|pdf}`), display-name sanitising (basename of a Windows-style path too; control
    characters, quotes, slashes and the Windows-reserved set replaced), storage writes with `wx`, the row +
    `attachment.store` audit entry in one transaction, and the read path used by the serving route. The
    upload action, the viewer, the backup engine and the restore path all import it, so they cannot drift.
    Rejected uploads write nothing at all — the purchase is untouched and a retry is a clean retry.
82. **A new archive password must be at least 12 characters; restoring accepts any non-empty password.**
    scrypt slows a brute-force attack, but it cannot rescue a one-character passphrase protecting the only
    copy of the household's data. The asymmetric rule keeps pre-Phase-5 archives recoverable. The typed
    destructive confirmation (`RESTORE`) is validated server-side too — the UI's confirmation is assistance,
    not authority — and uploads are bounded at 512 MB on the declared length *and* the received file.
83. **Download naming never depends on the browser's guess.** `filenameFromContentDisposition` supports the
    quoted and unquoted forms plus RFC 5987 `filename*=`, refuses anything that is not a plain file name
    (paths, traversal, control characters, >200 chars), and `chooseDownloadFilename` falls back to the
    versioned contract name generated locally in Europe/London. This is the v0.2.21 lesson implemented as a
    contract and tested at the layer that failed, with the end-to-end button path covered by
    `e2e/backup.spec.ts`.
84. **Supplier references and interactions became domain operations.** They were written straight into the
    tables by the form actions (no validation, no actor on the audit trail). Now
    `src/lib/records/fuel-economy.ts — v0.10.0 pure fuel maths: litres/odometer parsing, UK-gallon mpg full tank to
                                full tank, stretches and gaps, totals, the post-save sentence (decisions 139–141)
src/lib/records/fuel.ts       — v0.10.0 DB side of fuel: fills per vehicle, audited editFuelDetails, the Insights
                                view, row context for Purchases/Overview
src/components/fuel-details-form.tsx — v0.10.0 fuel summary + "Fuel details" editor on a fuel purchase row
src/lib/records/supplier-details.ts` owns them: trimmed and length-capped text, the five documented
    channels, `isValidLocalDate` on follow-up dates, `SupplierNotFoundError` for unknown suppliers, the
    supplier must exist, and `supplier.reference` / `supplier.interaction` audit entries written in the same
    transaction. `upcomingSupplierFollowUps(db, today)` is the query the Contracts page uses. The contact
    card gained an editor (version-guarded, `supplier.contact` audit) — it existed in the domain since
    Phase 2a but nothing called it.
85. **Container runs unprivileged by default (closes the Phase 5 security-review item, decision 32).** The
    image ships `gosu`; the entrypoint sources `/data/.env`, creates `documents/` and `logging/`, aligns
    `/data` ownership **once** (only when the root does not already match PUID/PGID — files the app writes
    itself need no fixing), fixes `/app/.next` so Next's runtime cache is writable, applies migrations as the
    unprivileged user, and `exec`s the server as `PUID:PGID` (Unraid defaults 99:100). `PUID=0` keeps the old
    root behaviour deliberately. Both the CI and the publish smoke tests assert `/proc/1/status` reports uid
    99, so the guarantee is tested rather than documented.
86. **Security review record (blueprint §4 checklist, Phase 5).** Every page and every API route verifies the
    Access assertion independently (`getCurrentUser`) — the attachment viewer, backup and restore included;
    the dev identity bypass is computed false whenever `NODE_ENV=production`; the public health endpoint
    returns `{status:'ok'}` and nothing else; both mutating route handlers have the same-origin guard
    (decision 80); money and document responses are `no-store`/`private, no-store`; production builds set
    `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: same-origin`,
    `same-origin` opener policy, `X-Robots-Tag: noindex` and HSTS (dev builds deliberately omit them so the
    operator's hosted preview is not framed-out); no secrets, real names or figures exist anywhere in the
    repository; `npm audit --omit=dev` reports 0 vulnerabilities (4 moderate remain in the dev-only
    drizzle-kit/esbuild chain — accepted, because the suggested "fix" downgrades drizzle-kit to 0.18.1).
87. **Playwright is a real, CI-executed gate now.** `playwright.config.ts` starts `scripts/e2e-server.mts`,
    which seeds a fictional household into a git-ignored `.e2e-data` directory through the domain modules and
    runs `next dev` on port 3100 with the dev identity bypass. Projects: `mobile` (Pixel 7) for the till
    moment, `desktop` for review, `backup` for the download/restore path. **This sandbox cannot install
    browser binaries** (the download host is blocked; no system browser either) — the suite therefore runs in
    the CI `browser` job, and no local browser run is claimed (decision 54 stands, now with a harness behind
    it). The calendar grid exposes `data-date` per cell so the acceptance run can assert that the month view
    and the instance list agree after a real due-day edit.
88. **Unraid template and publication.** `simple-finance.xml` (repo root, so Unraid's TemplateURL can point
    at `main`) maps `/data` → `/mnt/user/appdata/simple-finance`, defaults PUID/PGID to 99/100, documents a
    free host port (never inheriting 3005) and exposes `AUTH_*` as optional advanced variables that
    `/data/.env` overrides. The publish workflow is tag-triggered (`v*.*.*`, or a manual dispatch with the
    tag): it refuses non-semver refs, asserts `package.json` and `src/lib/version.ts` match the tag, builds
    and **smoke-tests before pushing** (health, uid 99, database created, database survives container
    recreation), then pushes `vX.Y.Z`, `latest` and `sha-<short>`, and finally verifies the registry manifest
    digest matches the built image. Merging a PR publishes nothing.

*Session 8 (2026-09-22) — post-release, remove an attached receipt (v0.1.3):*

89. **Removing a receipt is a soft-delete, then an unlink — never the other way around.**
    `deleteAttachment` in the shared attachment module (decision 81) loads the row by id (the client never
    supplies a storage key). In one transaction it sets `state = 'deleted'` only where `state = 'stored'`,
    then writes one `attachment.delete` audit on the purchase (`entity: 'purchase'`, the purchase id) with
    the file key, name, mime, size and sha256 in `before`, and the summary `Removed <name> (<size>, <mime>)`.
    A second delete matches zero rows and writes nothing. The file is unlinked only after that transaction
    commits. `ENOENT` is success; any other unlink error is logged and does not roll the row back — the
    leftover file is an orphan, which is the designed report, not a failed backup. Unlinking first would make
    every later backup fail closed (`BackupIncompleteError`) if the process died in between. No migration:
    `state` has no CHECK, and the audit entry already carries actor and timestamp. No undelete: an older
    archive is the only way back. The control is on Purchases, Overview and Suppliers (the three pages that
    render the receipt chip), a quiet two-click confirm, and the purchase's History list shows the audit
    line. A key that is not a safe storage key is never joined onto the documents directory. OQ12 is
    unchanged: this is user-initiated removal, not automatic pruning. v0.1.2 stays published as it was;
    this change is v0.1.3 and is tagged only after merge.

*Post-release follow-up (2026-09-22) — Quick Entry: Line 1 follows the amount (no phase, no version change):*

90. **A shop typed at the till fills split Line 1 until the household takes that line over.** Mobile entry had
    a step nobody wanted: type the amount, then retype it on Line 1 (or hunt for "Assign remaining") before
    Save would light up. `PurchaseForm` now mirrors the amount into Line 1 while the line is untouched. The
    takeover flag (`lineFollowsTotal`, true on mount) is cleared for good when the user edits the Line 1
    amount — that field's handler, **not** the shared `updateLine`, so category, "For"/target, supplier (and
    `selectSupplier`'s most-used-category write), pot, paid-by, date and note changes all keep the following —
    when they press "+ Add split" (the new line stays empty and Line 1 is neither cleared nor shrunk), or
    when Assign remaining writes Line 1. Removing an extra line does not resume it; only "Add another" does.
    `parsePence("8")` is already £8.00, so every valid intermediate keystroke mirrors (typing 8 then 5 ends at
    85.00 — nothing freezes on the first valid number) and a correction from 85 to 84.50 arrives too. A
    deleted or zero total clears the line; a half-typed "85." or a negative total leaves the last mirrored
    value and keeps Save disabled, because `balanced` already requires a positive parsed total. The rule is
    the pure `followedLineAmount` (`src/lib/records/quick-entry.ts`) over `penceInput`, now shared from
    `src/lib/money.ts`. Deliberately unchanged: no category control next to the supplier and the amount (the
    dropdown stays in "Split the payment", above Save), the `balanced` check and its exact-total rule,
    `assignRemainder`'s replace-not-add behaviour, the paid-by chip not retargeting existing lines, and every
    server action. No schema, migration, backup-format or version change. Coverage:
    `tests/quick-entry.test.ts` plus `penceInput` cases in `tests/money.test.ts` (Node, run green here), and
    seven mobile specs in `e2e/home.spec.ts` for the mirror, the keystroke sequence, the half-typed and
    deleted totals, the takeover, Add split and "Add another" — the flag is client state, so those need a
    browser and run in the CI `browser` job.

*Post-release follow-up (2026-09-22) — publishing v0.1.4 (no code change):*

91. **A release tag is a claim about the commit it points at, so cut it after the metadata bump lands.**
    v0.1.4's publication stalled until `v0.1.4` was re-cut on `7197666`: the first `v0.1.4` tag sat on the
    PR #13 merge (whose `package.json` still said `0.1.3`) and a `v0.1.5` tag sat on the metadata-bump merge
    (whose `package.json` says `0.1.4`). Both publish runs reached `Verify the version metadata matches the
    tag`, refused, and pushed nothing — which is the design: an image must not exist for a version the code
    disowns, and a half-published registry tag is worse than a refused run. `docs/HANDOFF.md` §5 now carries
    the two-command local pre-check and the ordered step list. Because neither refused tag had ever published
    an image, `v0.1.4` could be re-pointed and the unused `v0.1.5` release deleted; `v0.1.2` and `v0.1.3`
    have images on the registry and are never moved (the same rule that left `V0.1.1` in place). Publication
    is otherwise unchanged: `v*.*.*` tag push (or `workflow_dispatch` with a tag that exists), smoke test
    before push, then the release tag, `latest` and `sha-<short>` on one digest.

*Post-release follow-up (2026-09-22) — Purchases filters on a phone (v0.1.5):*

92. **Phone Purchases filters collapse; the fields stay inside the card.** The GET form is unchanged
    (same names, same query). On viewports below `sm` a full-width **Show filters** / **Hide filters**
    button is the only chrome until tapped; the panel starts collapsed unless any filter is already in the
    URL, in which case it starts open so an applied filter is not invisible. From `sm` up the toggle is
    hidden and the fields stay visible. From date and To date share one row (`grid-cols-2`); Pot, Supplier,
    Category and Paid by stay one per row (`col-span-2 sm:col-span-1`). Every control is
    `w-full min-w-0 max-w-full` so a native date or a long category label cannot overflow the rounded
    card. Client component `src/components/purchase-filter-form.tsx`. No schema, migration or backup-format
    change. Coverage: mobile `e2e/home.spec.ts` (collapse, same-row dates, in-card bounds, stays open after
    Apply) and desktop `e2e/desktop.spec.ts` (toggle hidden). Those run in CI; this sandbox has no browser.

*Post-release follow-up (2026-09-23) — money across the household boundary (unreleased):*

93. **The shared cash jar is replaced by one cash pot each, so handovers are tracked.** The users'
    real-world gap: John giving Janet £200 in cash had no honest home — a jar cannot say who held
    the notes. Seed, fixtures and E8 now carry four pots (Main, Salary, Alex's cash, Sam's cash);
    a handover is an ordinary internal transfer with a note, `household_available_now` unchanged.
    Retired legacy: the jar existed only in seed/fixture/demo data — no live install ever held cash
    history, so no data migration maps the jar onto anyone.
94. **Borrowing is loan movements plus a lender, never income.** A `debts` row tracks who and which
    way round; loan movements (`external_movements`, kind `loan`) move the pot estimate and the
    derived owed balance together. The Overview shows owed/owing beside "available now". No interest,
    no schedules — repayments simply reduce the balance, and a settled debt stays as history.
    Financial-text-fidelity decision (blueprint §6): a debt says "we owe £50.00", borrowing says
    "borrowed", never "income"; surfaces distinguish *reported* (checkpoints) from *recorded*
    (movements: money in/out) from *owed* (debts).
95. **A swap is an atomic net-zero pair, survivable leg by leg.** `createSwap` writes both legs in one
    transaction under one `exchange_key`, with two audits, and rejects same-pot pairs — the son's
    wages scenario can never half-record. Each leg keeps its own version for independent correction
    (voiding one leg leaves the other standing, honestly); kind, direction, debt link and exchange
    key are immutable, so a swap cannot quietly become borrowing.
96. **Miscellaneous boundary money needs a note, or it does not happen.** Kind `other` requires a
    note (Zod refuses the empty form) because an unexplained in/out is exactly the gap being
    closed. Excluded from Insights by construction — the Insights join is over `allocations`, and
    boundary money never has one.
97. **Entry lives in the moment, on both clients.** A fourth quick-entry tab (Move: pots, a debt,
a swap, or other) and matching sections on the Pots page share the same form components, so
thumb and keyboard take the same path. Pots gain `archivePot`, which refuses any pot a live
record still points at — archiving is a tidy-up for empties, never a deletion.
98. **The same-day comparison is sign-aware (v0.2.1, 2026-09-23).** v0.2.0 counted every
    date-only record sharing a checkpoint's date as *after*; safe for debits (understating
    self-corrects) but it double-counted same-day credits — swap in-legs, receipts, transfer-ins,
    refunds — and a same-day checkpoint could never self-correct, because the counted credit was
    already inside the counted balance (field report: a cash pot read £180.00 instead of £100.00;
    SPEC E13). The rejected alternative — flipping `>=` to `>` for everything — would have absorbed
    same-day *spending* after a checkpoint (overstating, and it lies about the bank pot). Rule now:
    same-day date-only credits are absorbed; same-day date-only debits still count. The known cost,
    accepted with the household: a same-day swap makes the household total read one leg LOW until
    the next checkpoint (the out-leg dips, the in-leg is absorbed) — no rule is both per-pot-safe
    and household-net-zero on the day, and low was chosen over high. Debits self-correct at the
    next later-dated checkpoint; live v0.2.0 data self-heals under the new rule, so no migration.
99. **A checkpoint refreshes every page it can move (v0.2.1, 2026-09-23).**
    `addCheckpointAction` — and six sibling actions — revalidated only `/`, so checkpointing from
    /pots or /overview left those pages stale until a manual reload. All server actions now use the
    shared `revalidatePages()` set, so the simple estimate figure (≈ £100.00) updates in place
    everywhere. An itemised "since the last checkpoint" breakdown was first added to the pot cards
    but withdrawn before the PR: the household confirmed the card should show the simple figure
    only — the estimate badge and the "Last reported" line are the display.
100. **Swaps are managed where they were made (v0.2.1, 2026-09-23).** The boundary list at the foot
    of /pots existed but the household never found it; the missing capabilities were edit (domain
    `editExternalMovement` existed without a surface) and an honest whole-pair correction. The
    "Swap with someone outside" section now lists recent pairs grouped by exchange key with the net
    total (green £0.00 balanced, amber "legs differ" when one leg was edited or voided alone, grey
    voided), per-leg edit and single-leg void under "Correct or void one leg", and a two-click
    "Void both legs" that voids the pair in one transaction with one shared reason (`voidSwap`,
    version-guarded per leg). Pot cards link to the list when they are involved in a pair.
101. **"All Transactions" is a projection, not a new record type (v0.3.0 line, 2026-09-23).** The
    household sketched a one-page, read-only view of all activity for one account or cash pot
    (purchases, direct debits, transfers, boundary money). It is a pure read over the four existing
    money families plus checkpoints: nothing is written, no add/edit/void is rendered, and every row
    links to the canonical form that keeps that behaviour. **No schema change is needed**, so the
    "breaking changes are acceptable" permission stays unspent. One pot target at a time (the
    household's position, not a pre-existing SPEC rule). SPEC §15.2 table row + new §15.3.
102. **The sketch's compact codes are kept; `POS`/`BYP` stay unallocated (household choice,
    2026-09-23).** Offered plain words ("Purchase", "Transfer in") against the sketch's codes, the
    household kept the codes. Purchases carry no payment channel, so `PUR` covers every purchase and
    **no channel field is added** — a fourth dimension on the busiest record in the app, typed at the
    till and read by one column, is not worth its cost. `SO` is split out from `DD` because a
    schedule's kind is recorded and schedules are never deleted, so a converted purchase's origin is
    always resolvable. `REF` marks refunds and `SW<`/`SW>` mark swap legs, following the sketch's
    angle-bracket idiom. `TX<`/`TX>` unify internal transfers and boundary `other` money (the cell
    shows the other pot's label or the counterparty), which is how the sketch reads.
103. **Income rows are deferred; `BAC` is reserved (household choice, 2026-09-23).** The sketch's
    `BAC` row ("Acme windows · Income: Janet") is not producible today: `receipts` has no
    source-name and no category column, `createReceipt` is called only by schedule conversion (there
    is no manual income entry), and `listReceipts` has no caller at all (no page lists income).
    Rendering that row would need schema, an entry form and a list — an income feature, not a
    display tweak, and one that reopens the income-analysis question §12/§16 deliberately excludes.
    Scheduled income will slot in later as `BAC`; meanwhile a one-off third-party credit is recorded
    as other money in (counterparty + mandatory note) and appears as `TX<`.
104. **Refunds are shown; voids are excluded silently (household choice, 2026-09-23).** "No
    refund machinery" is about the void/refund *UI*, not the rows: a refund is already a purchase
    with a negative total, so it projects as a green `REF` row with zero new machinery, and the
    estimate counts it (`signedPence = −totalPence`). Excluding refunds would make the page disagree
    with the pot for no gain. Voids stay excluded (`voided_at IS NULL`), and the page renders no
    count of them either.
105. **Every row links to a record the app can actually show (household choice, 2026-09-23).**
    Only purchases had a real destination: transfers live in a last-5 list on /overview, boundary
    money in a 20-row list on /pots, and none of those rows had an anchor. Chosen fix is the small
    one — stable row anchors (`purchase-{id}`, `transfer-{id}`, `external-{id}`) plus
    `?transfer={id}` / `?external={id}` parameters that force-render a referenced record when it
    falls outside the recent list, so a link can never land on a list that no longer contains it.
    A full transfers/income history was considered and rejected as a second feature area.
106. **The page's total is "movements shown", and checkpoints are divider rows (2026-09-23).** The
    window total cannot be labelled "estimate change": voided records are invisible here, and §7.1's
    sign-aware rule absorbs a date-only credit sharing a checkpoint's local date while counting a
    date-only debit — so the two differ even with no voids and refunds shown. Checkpoints therefore
    render as visually distinct divider rows carrying the **reported** figure (never a computed
    balance), which is the reconciliation aid the household wanted, and the total row states plainly
    what it is.
107. **One row per record, filtered on `occurred_date`, capped at 500, due pass still running
    (2026-09-23).** One row per record (never per allocation line) is what makes the amount column
    sum to the stated total; a split shows its first line and "+N more". Date filters use the local
    `occurred_date`, as every existing list does, so the window matches the sketch's start/end and
    never depends on an instant. The end date cannot be in the future because no record can be
    (§9.1). The date column renders `occurred_date` (decision 108 fixes the format): reusing
    `formatInstantLocal` would print `23:59` for every date-only record, a time that never happened.
    The lazy due pass runs as on every read page so today's direct debit appears; "read-only" means
    no user-facing writes.
108. **The date column is date-only `YYYY-MM-DD`, and purchases are `PUR` (household choice,
    2026-09-23, at build time).** Asked whether the sketch's dotted date should be per-page or
    app-wide, the household chose plain ISO with **no time at all** on this page; other pages keep
    their existing rendering, so this is not an app-wide change. On `PUR` vs `POS` the household
    left the call to the agent: `PUR` ships, because it cannot be misread as a payment channel, and
    `POS`/`BYP` stay reserved for the day a real channel field exists. Two corrections landed while
    building, both now in SPEC §15.3: (a) archived pots are **not** offered as targets — decision
    101 first said they should be, which was wrong, because `archivePot` refuses any pot with records
    at all, so an archived pot's activity is empty by construction and there is never history to
    strand; (b) a standing order with no supplier shows the **schedule's name** in the source cell
    rather than "Unknown supplier", which would be a dead end on a dense list.

109. **Income is a feature of its own, and `BAC` is rendered (household choice, 2026-09-23,
    v0.4.0).** Decision 103 deferred income rows because the app could not produce one: no manual
    entry, no source column, no list. The household answered the four questions that deferred it:
    build all three phases (entry, list, `BAC` rows); one free-text **source** field ("Sale of
    bicycle") rather than a payer list; a **dedicated Income page**; and (decision 112) always move
    a weekend payday to the Friday before. Migration `0006_income_source` adds the optional
    `receipts.source` column; `createReceipt`/`editReceipt` accept it; `addReceiptAction`,
    `editReceiptAction` and `voidReceiptAction` wrap the domain; `activity.ts` renders income as
    `BAC`. **No estimate, projection or insight code changed** — receipts were always +signed pence
    there, and insights stay blind to income (§12/§16). Insights still carry no income analysis:
    no income-vs-spending, no income categories (decision 103's reasoning stands).
110. **One-off income is a receipt with a `source`, not an external movement (household choice,
    2026-09-23).** The documented interim was other money in (`TX<`, counterparty + mandatory
    note). The household's own example — selling something they own, paid in cash or by bank
    transfer — is *income into a pot*, not money across the household boundary with a counterparty,
    and borrowing is the one thing that must never read as income. So: `receipts` gets one nullable
    free-text `source` (120 chars, trimmed, blank stored as NULL) for what or who it came from, and
    the note stays optional. A converted expected receipt leaves `source` NULL and reads its
    **schedule's current name** through the back-reference, so renaming a salary does not strand
    history. Income still has no category and no target (SPEC §6): it is not spending.
111. **Income lives on its own page, and is desktop-shaped (household choice, 2026-09-23).** "I
    would like the majority of income to be handled by a scheduled entry… I can handle any small
    edits on PC view, it is not subject I expect to be visiting from a mobile view." So `/income`
    joins the menu (between Recurring and Accounts & Pots) with three sections — scheduled income
    (add/edit/cancel in place, "applies from the next instance onward"), one-off income entry, and
    one list of everything received with inline edit/void — and **Quick Entry gains no income
    tab**: squeezing a record the household does not make at the till into the mobile panel would
    cost more than it returns. Deep-link contract is the decision-105 pattern: `receipt-{id}`
    anchors plus `?receipt={id}`.
112. **A weekend payday is expected on the previous Friday — always, for income only (OQ2
    resolved, household choice 2026-09-23).** Not a toggle: "always move salary income to the
    previous Friday if pay date falls on a weekend". Implemented once, where due dates are derived
    — `dueDateForPeriod` in `schedules.ts` — so instance materialization, the "next due date"
    every list shows, the calendar and the to-payday projection all agree, and an *upcoming*
    instance left on a weekend (materialized before this rule) is re-dated on the next sync while
    converted history is never rewritten. Two consequences are deliberate and documented in SPEC
    §11.3: a payday configured for the 1st can land in the previous month, so one calendar month
    can hold two instances; and **bank holidays are not handled** — the app has no holiday
    calendar and will not guess one, so a Friday bank holiday still expects the money that day and
    the receipt can be corrected by hand.
113. **The `BAC` row resolves its source, and links to the Income page (2026-09-23).** Source cell
    = `receipt.source` ?? the income schedule's name ?? "Income"; category `—` (income has none);
    direction always `in` (a receipt is a credit to its pot); the note as stored; a primary link to
    `/income?receipt={id}#receipt-{id}` and, for a converted receipt, the secondary
    `/recurring#schedule-{id}` link DD and SO rows already carry. Voided income is excluded here
    and shown struck through on the Income page, which is where its history lives.
114. **Horizon is its own page at `/horizon`, laptop-shaped (household choice, v0.5.0).** The
    household wanted "how far the money would go": pick a future date and see where every expected
    commitment and receipt would leave them, beyond the payday window. They chose a **dedicated
    page** named "Horizon" over another Overview mode — the same reasoning as Income (decision
    111): it is a sit-down surface, not a till-side one, so Quick Entry stays untouched and the
    menu gains **Horizon** after Recurring. All pots are selected by default and the household
    untick to scope it; day-to-day (groceries + fuel) is included by default and toggleable.
    Selection, through-date and the toggle persist in the URL (`?through=…&pots=…&daytoday=…`).
115. **The horizon reuses `projectToPayday` with `paydayDate = throughDate` (v0.5.0).** No second
    engine and no second arithmetic: the pure window walker already models
    `available + Σ receipts − Σ commitments − day-to-day`, tracks the running low and warns, and
    its final day's `runningPence` *is* "where we'd land". The horizon read model (in
    `money-view.ts`) filters the window to the selected pots, then delegates. The property test in
    `tests/horizon.test.ts` pins the hand identity — `available + receipts − commitments −
    day-to-day` equals the final per-day row — so the two read models can never disagree.
116. **Debt expected inflow is a pair-or-nothing expectation, never income (v0.5.0 feature 2).**
    Migration `0007_debt_expected_inflow` adds nullable `expected_inflow_amount_pence` and
    `expected_inflow_day_of_month` to `debts` (both set or both null — enforced at the boundary
    and again in the domain). `editDebt` persists the pair; `expectedInflowOccurrences` derives
    the dates with `incomeOccurrencesBetween` — month stepping, clamped (OQ1), weekend-shifted
    (`shiftIncomeOffWeekend`, decision 112's rule, numbered **decision 7** in the v0.5.0 notes) —
    and returns nothing when the derived balance is ≤ 0. It lands in the pot the most recent live
    loan movement targeted, flagged `expected`, and joins the payday window (§7.2) *earliest-wins*
    against receipts and the horizon window (§7.6). It is read-only: it never touches the estimate,
    the Income page, or `BAC` (§10.2, §11.3 hold).
117. **Horizon detail blocks collapse beyond 60 days (v0.5.0).** A look-ahead of up to 60 days is a
    sit-down read; beyond that the day-by-day table, the commitment list and the expected-money
    list start collapsed (`<details>` without `open`), one tap each — density without a
    spreadsheet. The lowest-point line stays visible at every window length, because a long healthy
    window can still dip hard mid-month and the projection must say so.
118. **Projected day-to-day spending is episodic, anchored on actual events (v0.6.0).** The
    household's real world: fill the Mercedes £55 on the 29th and it will not need fuel for
    ~3 weeks; the weekly shop happens on one day, then not again until the next. The v0.1-era
    smoothing (pro-rata the configured figures, charge the whole window's block up front) had two
    faults the household hit in live use: a recorded fill/shop was double-counted for its whole
    cooldown window (once in the estimate, once in the smoothed allowance), and every lowest point
    with day-to-day included read "today" — the up-front lump's artifact (the original smoothing
    decision is amended here). The replacement (SPEC §7.3 v0.6.0): each configured figure is the
    amount of a **repeating projected event** — groceries every 7 days, fuel every 30 days per
    vehicle — whose next date derives from the ledger (`last anchor + cadence`). `src/lib/records/
    day-to-day.ts` owns the anchors (a positive `Groceries > Weekly Shop` allocation for the week;
    a positive `Vehicle Running > Fuel` allocation targeted at the vehicle for each fill) and the
    event list; the events join the same pure engine as ordinary dated outgoings, so there is
    still no second arithmetic and the horizon/payday panel cannot disagree on shared days.
119. **Anchor-reset detail rules (v0.6.0, all agreed with the household).** Amount = the configured
    figure (stable budget, not last-actual — avoids whipsaw when one shop is small). Only
    `Weekly Shop` resets the groceries week — `Top-up Shops` are spending between shops. Each
    vehicle's fuel clock is its own; a `Fuel` line with no vehicle target anchors nothing. No
    history, or an overdue anchor ⇒ the next event is **tomorrow**, then the cadence resumes
    (pessimism — the projection may understate, never overstate). No weekend shifting. Voided or
    refunded purchases are no anchor. Events are household-level: pot scoping never filters them,
    and the §7.5 pot watch still excludes them. E8 (SPEC §17) is reworked end-to-end for the new
    arithmetic (low −£571.26 on the 25th, the cycle's last shop), and the horizon lowest point's
    date is meaningful again with day-to-day on.
120. **Expected support becomes a plan with a real start, a changeable day and an end (v0.7.0).**
    The household's real arrangement — £1,000 on the 10th for about five months while probate completes,
    then it stops — is what v0.5.0's pair-only expectation (decision 116) could not express, and the
    household's own acceptance list named the three gaps: a brand-new debt (no movements, balance £0)
    projected nothing at all, there was no way to end the arrangement, and a recorded Borrow left the
    same month's expectation sitting beside it. Migration `0008_debt_expected_inflow_until` adds nullable
    `expected_inflow_until_date` (additive `ALTER TABLE`, no backup-format change). `expectedInflowOccurrences`
    gains three rules: **settled stops** (movements exist and the derived balance is ≤ 0 ⇒ nothing —
    a debt with **no** movements is *not* settled and projects, so the first payment pre-projects);
    **until inclusive** (an occurrence whose configured date is past it does not count, so five payments
    end themselves); and **an answered month stops projecting** (a live money-in recorded from
    `OCCURRENCE_ANSWER_LEAD_DAYS = 2` before the occurrence's expected date — the weekend shift can bring
    it forward — up to the next occurrence *is* that month's money). `expectedInflowPotId` replaces
    `firstMovementPotOf`: the pot the most recent **live** movement travelled through, else the household
    default (the pot labelled `Main account`, else the first live pot), so a not-started debt's
    expectation still has an honest home and follows reality once the first Borrow is recorded. Edits stay
    forward-looking: `editDebt` persists day and until date under the existing version check, the audit
    line carries the new end date, and recorded movements are never rewritten. The cadence is unchanged
    (clamp OQ1, weekend shift decision 7), with one window refinement — an occurrence counts when its
    configured **or** its shifted date falls in `(after, through]` — so the first payment (Sat 10 Oct →
    Fri 9 Oct) is counted in a window ending on the Friday, and a configured 1st/2nd can shift back into
    the previous month's window.
121. **The expectation is visible on every surface it touches, and never counted as money (v0.7.0).**
    All Transactions renders it as `EXP<` rows (family `expected`) — green, dated the day the money is
    expected, badged `expected — not recorded yet`, linking to `/pots#debt-{id}` — **outside the totals**:
    `expectedRowCount` / `expectedInPence` carry them separately so the count line, the total row
    ("Expected support (N expectations, not counted)") and the footnote can all say so. The rows speak
    only for months **since the plan was set** (`plannedFrom` = the local date of the debt's last edit), so
    a late-September edit does not retrofit September, and they give way to the real `LN<` the moment that
    month's Borrow is recorded. The projection panel gains "Expected support in this forecast (N)" from the
    `expected`-flagged receipt lines; the Pots debt panel says whether the debt is *settled* or *expecting*
    (amount, day, end) and the edit form carries the day, the optional until date and a **"Fill the end
    date"** helper — `lastOccurrenceDate(dayOfMonth, fromDate, count)` returns the Nth clamped monthly
    occurrence after today (1–240 payments) — so "five payments" needs no calendar. Unchanged by design
    (decision 116 holds): never income, never an estimate move, never an insight, and the pot moves only
    when the Borrow is actually recorded.

*Session `arena/01a0d4f9-simple-finance` (2026-09-24) — PWA installability (v0.8.0):*

122. **PWA ships as manifest + icons, never a service worker (OQ7 resolved).** The household configured
    Cloudflare Access bypasses for the PWA asset paths and found them 404 — the files did not exist. The
    fix is a static `public/manifest.webmanifest` (not a Next route, which would sit behind Access), two
    PNG icons (192×192 and 512×512) and an `apple-touch-icon.png` (180×180), all derived from the existing
    `docs/assets/simple-finance-icon.svg` / `.png`. The manifest declares `name`, `short_name`, `start_url`,
    `scope`, `display: standalone`, `background_color` / `theme_color` `#0f172a`, and `purpose: any` on both
    icons. `layout.tsx` links the manifest, apple-touch icon and apple-web-app capable via the Next 16
    metadata API (`themeColor` in the `viewport` export, not the deprecated `metadata` field). **No service
    worker, no caching of pages or API responses, no offline queue** — SPEC §14's online-only rule stands
    unchanged. The household confirmed they do not want offline access.
123. **The Access bypass surface equals the files that exist.** The path-scoped Cloudflare Bypass → Everyone
    app should carry exactly four destinations: `/manifest.webmanifest`, `/icon-192.png`, `/icon-512.png`,
    `/apple-touch-icon.png`. The legacy `/sw.js` destination should be deleted — no service worker ships, and
    a public 404 is worse than no destination at all. Everything else remains behind the hostname-wide
    email-policy app.

*Session `arena/01a0d55f-simple-finance` (2026-09-24) — the phone-first till form and the "before income lands" figure (v0.9.0):*

124. **Two balance figures, not one (SPEC §7.7).** The household's objection is concrete: standing in Tesco
    with a "free to spend" £500 while a £600 mortgage leaves three days before payday is worse than no
    figure at all. Both facts therefore show together — the pot's **last reported checkpoint** (what the
    bank last said, with its age) and **what is left before income lands**: household available-now minus
    the commitments and projected day-to-day events due in `(today, next income]`. The figure deliberately
    **counts no income** — it is the dip, not the balance after payday; adding the salary back in would hide
    exactly the case the household raised. It is now a named concept rather than a derivation of §7.2: the
    projection panel's `projected_low` equals it when no other receipt lands in the window, and
    `tests/cycle-outlook.test.ts` pins that agreement so the till and the panel cannot drift.
125. **The per-pot version is the §7.5 pot watch, and cash stays silent.** Per pot the figure is
    `estimate(P) − commitments due from P in the window`, i.e. §7.5's transfer watch with the window taken
    to the next income instead of a named payday; it warns only when the pot itself goes short (the money
    may be in the other account, which is exactly what a transfer fixes). Projected day-to-day events are
    household-level and stay out of the per-pot figure, per §7.5's reasoning. A pot with no checkpoint, a
    household with no income schedule, and a cash pot all show nothing rather than a guess — "no window, no
    figure", null rather than zero.
126. **Where the figures live.** The Quick Entry purchase panel (headline + the selected pot's checkpoint
    and shortfall) and the pot cards on the home page and Overview. The rest of the home page stays as the
    household agreed; a dedicated mobile menu and mobile-specific hiding remain later decisions.
127. **Pot-first till form, with the default pot as a setting (SPEC §15.1).** The pot selector moves to the
    top of the form and the purchase form starts on `default_purchase_pot_id`, chosen in Settings. The old
    `pots.find(label === 'Main account') ?? pots[0]` guess is deleted: the household's real pot is not called
    "Main account", so the till form was opening on the first alphabetical cash pot. With nothing configured
    the form starts with **no pot selected** and the user picks one.
128. **Inline supplier typeahead replaces the `<datalist>`.** Recents-first when the field is empty, filtered
    case-insensitively as the user types, rendered as tappable rows under the field; tapping one fills the
    name, applies the remembered most-used category and moves focus to Amount. Ranking is pure
    (`rankSupplierMatches`, `nearestSupplierName` in `records/quick-entry.ts`) so it is unit-tested; the
    "did you mean" near-match prompt is unchanged. No library, no request.
129. **Swipe panels as progressive enhancement (mobile only).** Panel 1 records it (pot + figures, supplier,
    amount, paid-by, date, "+ Note", save); Panel 2 holds category, "For" and the split lines. On a phone
    they are a `scroll-snap-type: x mandatory` pair with dots and a hint; **Save is on both panels** so a
    purchase never needs a swipe. At `lg:` and up they are the previous two columns with no snapping. The
    secondary things the household asked for ride along: the "Split the payment" title becomes "Category &
    allocation", "Line 1 amount" is invisible when there is only one line (the amount mirrors the till
    figure, and the accessible name is unchanged), the note collapses behind "+ Note", focus order is
    supplier → amount → save, and "Add another" resets to Panel 1 on the supplier field.
130. **Contrast fix while in there.** Panel 1 of the purchase form (and the Fuel and Balance forms) sat
    directly on the dark quick-entry card with `text-slate-800` labels — dark grey on near-black, effectively
    unreadable. Every quick-entry panel is now a light card, and touch targets are at least 44px.

131. **The till announces when it is listening (SPEC §15.1).** The v0.9.0 form is bigger, and the acceptance
    suite started losing races it used to win: a tap on a tab before React hydrated switched nothing, and a
    value typed into a controlled input was wiped by the hydration render — the CI run failed four specs
    with `expected number, received null`, a dead tab and a frozen hint. The fix is in the product, not the
    test: the quick-entry section renders `data-till-ready="false"`, flips it to `true` when it mounts, and
    the tab strip and the forms are `inert` until then, so input that arrives too early is refused rather
    than swallowed. Locator *assertions* auto-wait; locator *actions* (and `pressSequentially` in
    particular — measured, it waits for neither `inert`, `disabled` nor `readonly`) do not, so the specs wait
    on the signal first (`e2e/support.ts` · `waitForTill`, 25 call sites).
132. **A purchase must name its pot.** Decision 127 removed the fallback, so "no pot selected" is a reachable
    state for the first time — and the server rejects a purchase without one, which surfaced as a raw
    `Invalid input: expected number, received null`. Save is now disabled until a pot is chosen and the panel
    says why ("Choose the pot this came out of — no default is set, so nothing is preselected"). The settings
    project ends by clearing the default on purpose, so specs that record a purchase after it name their pot
    themselves (`backup.spec.ts`).
133. **The browser suite can run in this sandbox (SANDBOX entry 8).** `cdn.playwright.dev` is blocked and
    `apt-get` cannot install `libnss3`, but `registry.npmjs.org` serves `@sparticuz/chromium`, which carries
    both a Chromium build and the AL2023 shared libraries in its tarball. With `LD_LIBRARY_PATH` pointed at
    the extracted libs, the real Playwright suite runs green locally (50 tests, ~2 minutes) through a
    throwaway config overlay. Sixteen CI minutes per guess became two local ones, which is how the failures
    above were diagnosed instead of guessed at.

134. **The acceptance suite's "today" is London's (v0.10.0).** Between 23:00 and 00:00 UTC in summer the seed
    wrote tomorrow's UTC date while the app showed London's today, and the date-sensitive specs failed for an
    hour a night. The seed now writes `toLocalDateString(now)`, the specs compute dates with
    `londonToday()`/`addDaysIso()` from `e2e/support.ts`, and the browser runs with
    `timezoneId: 'Europe/London'` — the one timezone the household lives in (SPEC §2). Re-done in session
    `arena/01a0d778-simple-finance`: the original post-v0.9.0 commits for 134–137 never reached GitHub
    (GitHub outage) and their sandbox was lost.
135. **One tap on Save saves, with the supplier suggestions open.** The typeahead closed on the supplier
    field's `blur`, so a tap on Save first collapsed the list, the page moved up under the finger, and the
    `click` landed on nothing — the household had to tap twice. A pointer-initiated blur now hides the list
    *in place* (`closing`: invisible, still taking its space) until the click has landed, then removes it;
    keyboard blur closes it at once as before. Mobile spec: one tap with the list open saves.
136. **Every Quick Entry control is at least 44px tall.** Decision 130 fixed the big ones; tab buttons, the
    "+ Note" toggle, chips and split-line controls were still 32–36px. One scoped rule (`.till-touch` in
    `globals.css`) sets `min-height: 44px` on every button, input, select, textarea and summary inside the till, and a
    mobile spec measures every visible control on every tab so a new small one fails the build.
137. **The purchase form starts on Supplier — once it can hear.** The `autoFocus` and the focus calls ran
    while the form was still `inert` (decision 131), so the focus was refused and the phone opened on
    nothing. Focus now moves to Supplier when `data-till-ready` flips to `true`, and again after "Add
    another" and a tab switch back to Purchase.
138. **Documents on income records use the attachments table (SPEC §23, v0.10.0).** The household wants a
    payslip (usually one page, sometimes several documents) on the income entry it belongs to. Migration
    `0009_income_documents_fuel_details` rebuilds `attachments` with `purchase_id` nullable, a new nullable
    `receipt_id` → `receipts`, and `CHECK attachments_one_owner` (exactly one of the two). Everything else is
    the existing pipeline unchanged — sniffed PNG/JPEG/PDF, 10 MB, opaque keys, soft-delete then unlink,
    audit (entity `receipt`), backup/restore (the archive stores rows and files, not owners) and the
    authenticated route. The rebuild keeps every id, key and state (tested on a v0.9.0-shaped database in
    `tests/migration-0009.test.ts`). The income upload control does not force the camera: a payslip is as
    often a PDF from a portal as paper. A voided income record keeps its documents viewable and takes no new
    ones. OQ10's "purchases only" is superseded for income; supplier-level documents stay deferred.
139. **Fuel details are optional and editable later (SPEC §15.1).** A fuel purchase can carry an odometer
    reading (whole miles), litres (stored as integer millilitres, so no floats in the database) and "Filled
    to full" (default on). The household was clear that neither number may be mandatory at the pump, so
    the till accepts blanks and Purchases/Overview show a "Fuel details — add odometer & litres" editor on
    every fuel row; the edit is versioned and audited (`purchase.fuel_details`). Cost per litre is never
    stored — it is `amount ÷ litres`, shown live as the litres are typed. A "fuel purchase" is a live,
    non-refund purchase whose Fuel-category lines all go to one vehicle; the fuel cost is those lines, so a
    split with a shop item does not inflate the price per litre.
140. **mpg is measured full tank to full tank, in UK gallons (SPEC §16.6).** A stretch runs from one full tank
    with an odometer reading to the next; part fills in between add their litres and their cost. mpg = miles
    ÷ (litres ÷ 4.54609). A stretch is left unmeasured — and says why — when the closing full tank has no
    odometer, when any fill in it lacks litres, or when the odometer did not go up; it is flagged (not
    hidden) when the answer is outside 8–150 mpg. Totals are ratios of sums, never averages of ratios.
    Insights shows per vehicle: the latest stretch, the last 12 months, fuel cost per mile, the latest price
    per litre, the fills missing details (linked to their Purchases row) and the recent fills. Pure maths in
    `records/fuel-economy.ts` (importable by client components), database side in `records/fuel.ts`.
141. **The save answers with the mpg.** After a fuel save — at the till or from Fuel details — one sentence
    says what happened: "Vehicle A: 41.2 mpg over 312 miles since the last full tank. 40.12 L at
    142.9p/L.", or a part fill waiting for the next full tank, or the first full tank noted, or what is
    missing. The same sentence (short form) sits on the Purchases/Overview row that closed the stretch.
142. **A restore brings an older backup up to the running schema, and refuses a newer one (SPEC §18.4).**
    Found while writing the v0.10.0 notes: in production only the container entrypoint runs migrations, at
    start-up, and a live restore reopens the database without a restart. Restoring an archive taken before
    a migration therefore came back without the newer columns until the next restart — harmless while
    migrations only added tables few pages read, but 0009 adds columns to `purchases`, which nearly every
    page reads. `restoreEncryptedBackup` now, on the staged copy and before the swap: refuses an archive
    whose newest applied migration is later than the newest one this build ships ("made by a newer
    version… update the app, then restore it"), otherwise applies the pending migrations exactly as the
    entrypoint would, re-runs the foreign-key and integrity checks, and folds the WAL into the file. A
    failure leaves the live data untouched. This is what §18.4's "validate … schema compatibility before
    touching live data" asked for; the checks before it were table-presence only. Tests: an archive made
    on the v0.9.0 schema restores as ten migrations with the new columns; one with a future migration is
    refused and the target keeps its data.

## Open questions (none block Phases 0–1; proposed defaults given)

| # | Question | Proposed default |
|---|---|---|
| OQ1 | Due-day clamping (day 29–31 in shorter months) | Clamp to last day of month; test leap years. |
| OQ2 | Income schedules: "shift to previous working day if weekend/bank holiday" toggle (salaries often pay on last working day)? | **Resolved 2026-09-23 (decision 112): always shift, no toggle, income schedules only, weekends only** — payday moves to the previous Friday; bank holidays are not handled because the app keeps no holiday calendar. |
| OQ3 | Duplicate-notice matching window & rule (currently ~2h, same pot+supplier/category+amount) | Ship as stated; tune after real use. |
| OQ4 | Checkpoint effective-date granularity (date-only backdating vs full timestamp) | Date-only backdating, boundary = end of local date; revisit if users want finer. |
| OQ5 | Receipts storage shape (own table vs signed purchase records) | **Resolved in Phase 3 (decision 55): dedicated `receipts` table** — income has no category/target (SPEC §6), so it does not reuse the split machinery; the estimate engine reads it as +signed pence. |
| OQ6 | ~~Receipt images / attachments~~ | **Resolved 2026-09-20 — in scope (decision 26, SPEC §23).** Residual sub-questions moved to OQ9–OQ12. |
| OQ7 | ~~PWA installability~~ | **Resolved v0.8.0 (decisions 122–123): manifest + icons shipped without a service worker; bypass surface equals the files that exist.** |
| OQ8 | Unraid host port | Pick a free port at first install; template documents it (never inherit 3005). |
| OQ9 | Phone camera formats: accept HEIC directly, or rely on browser JPEG capture? | v1 accepts PNG/JPEG/PDF; document the iPhone "Most Compatible"/JPEG camera setting; server-side HEIC conversion only if real devices demand it. |
| OQ10 | Supplier-level document attachments (e.g. a policy PDF not tied to a purchase)? | Defer; v1 attaches to purchases only. Renewals/suppliers hold references + notes meanwhile. **v0.10.0 (decision 138): income records take documents too (payslips); supplier-level documents stay deferred.** |
| OQ11 | Interaction follow-up dates surfaced in the key-dates panel — useful? | Include the optional field and panel display (proposed); no notifications either way. |
| OQ12 | Attachment size limit and retention guidance | 10 MB per file; README guidance on archive growth; no server-side pruning in v1. User-initiated removal of one receipt is decision 89 — still no automatic pruning. |
| OQ13 | 29 February renewal dates under annual advance | Land on 28 February in non-leap years; visible and editable. |

## Release history

- **Releases v0.1.0 → v0.6.0 are published** — each a lower-case annotated tag on its pull-request merge
  commit with its own digest; the notes file is the release record and earlier notes are never rewritten
  (`docs/RELEASE_NOTES_v0.1.0.md` … `docs/RELEASE_NOTES_v0.6.0.md`). Before v0.7.0, `latest` is the **v0.6.0**
  build (`b0379eb`, PR #36 merge, publish run `36006994819`, digest
  `sha256:e650c5f48e1e049d0865be8f889426630e4f8af21d40e7eaf9d4fc977ca2aa4e`). The bullets below record the
  build sessions that led to the first release — they are history, not the current state.
- **v0.7.0 — expected support with a real start, a changeable day and an end (session
  `arena/01a0d490-simple-finance`, from `main` @ `102570a`)**: migration
  `0008_debt_expected_inflow_until`; the expectation projects before the first Borrow, ends on its until
  date, stops when the debt is settled and moves its day forward-looking (decision 120), and it is visible
  as flagged `EXP<` rows on All Transactions, in the projection panel and on the debt panel (decision 121).
  SPEC §7.2/§7.6/§10.2/§15.3/§17 E11 amended; `npm test` **335 tests / 84 suites green**, format and
  typecheck clean, production build green. **Published 2026-09-24**: annotated tag `v0.7.0` on merge
  commit `0a82992` (PR #38), publish run `36042299282`, digest
  `sha256:3b1dcc809d876fa8c598c4471432d2e28c4617e63db7c6605b145e50d47fcb18` on `v0.7.0` / `latest` /
  `sha-0a82992` — one digest, different from v0.6.0's ([`docs/RELEASE_NOTES_v0.7.0.md`](RELEASE_NOTES_v0.7.0.md)).
- **v0.9.0 — the phone-first till form and the "before income lands" figure (session
  `arena/01a0d55f-simple-finance`, from `main` @ `2255607`)**: SPEC §7.7 added (two balance figures, no
  income counted, per-pot = §7.5's watch), §15.1 rewritten for the redesign, §15.2 Settings row gains the
  default pot. New: `getCycleOutlook`/`getDefaultPurchasePotId`/`setDefaultPurchasePotId`,
  `formatShortLocalDate`, `rankSupplierMatches`/`nearestSupplierName`, `components/pot-outlook.tsx`, the
  Quick Entry rewrite (pot-first, balances, typeahead, swipe panels, focus order, note collapse) and the
  Settings "Quick entry" section. Decisions **124–130**. Tests: `tests/cycle-outlook.test.ts` (6),
  typeahead ranking in `tests/quick-entry.test.ts`, the setting in `tests/settings-domain.test.ts`,
  `formatShortLocalDate` in `tests/time.test.ts`, and mobile/settings Playwright specs. `npm test`
  **357 tests / 90 suites green**, format, typecheck and production build clean. Second commit on the same
  branch: the till announces hydration readiness (`data-till-ready` + `inert`) and refuses to save without a
  pot, after the first `browser` job ran red (decisions 131–133); the browser suite was brought up inside the
  sandbox to diagnose it (SANDBOX entry 8), 50 tests green locally. **Published 2026-09-24**: annotated tag
  `v0.9.0` on merge commit `19e878c` (PR #43), publish run `36069116599`, digest
  `sha256:4384d7d2a4bd789580e733889616eb1d92ab8cd27403419bb73b3affd12aa809` on `v0.9.0` / `latest` /
  `sha-19e878c` — one digest, different from v0.8.0's ([`docs/RELEASE_NOTES_v0.9.0.md`](RELEASE_NOTES_v0.9.0.md)).
- **v0.10.0 — payslips on income, fuel economy, and the lost till fixes (session
  `arena/01a0d778-simple-finance`, from `main` @ `5cb28e3`)**: re-does decisions **134–137** (their
  post-v0.9.0 commits never reached GitHub) and adds **138–142**: migration
  `0009_income_documents_fuel_details` (attachments owned by a purchase *or* an income record; optional
  `odometer_miles`, `fuel_millilitres`, `fuel_full_tank` on purchases), documents on the Income page,
  litres/odometer/full-tank at the till and later on Purchases/Overview (`components/fuel-details-form.tsx`),
  the Insights Fuel economy panel, the post-save mpg sentence. New: `records/fuel-economy.ts`,
  `records/fuel.ts`, `tests/fuel-economy.test.ts`, `tests/migration-0009.test.ts`, income-document tests in
  `tests/attachment-pipeline.test.ts`, `e2e/fuel.spec.ts` (own project, before backup), payslip and till
  specs; the weekend-payday probe now needs a Friday after today; a restore upgrades an older archive to the
  running schema and refuses a newer one (decision 142). SPEC §15.1/§16.6/§18.4/§23 amended, mpg removed
  from out-of-scope. `npm test` **378 tests / 95 suites green**, format and typecheck clean, production
  build green, local Playwright **55 tests green** (SANDBOX entry 8). Publication recorded in
  [`docs/RELEASE_NOTES_v0.10.0.md`](RELEASE_NOTES_v0.10.0.md) and `docs/HANDOFF.md`.
- **v0.8.0 — installable PWA, no offline access (session `arena/01a0d4f9-simple-finance`, from `main` @ `837845a`)**:
  `public/manifest.webmanifest` (static file, not a Next route), `public/icon-192.png` (192×192),
  `public/icon-512.png` (512×512), `public/apple-touch-icon.png` (180×180), all derived from the existing
  icon SVG/PNG; `layout.tsx` metadata (manifest link, apple-touch icon, appleWebApp, themeColor via viewport);
  Dockerfile runtime stage gains `COPY --from=builder /app/public ./public` (the trap); Node test
  (`tests/pwa-manifest.test.ts`, 5 tests: manifest parses, required fields, icon files exist at declared pixel
  sizes, colours); Playwright spec (`e2e/pwa.spec.ts`: four paths return 200 with correct content types); CI
  docker job and publish workflow both smoke-test the four PWA paths. Decisions **122–123**, OQ7 resolved.
  SPEC §14 updated. `npm test` **340 tests / 85 suites green**, format and typecheck clean, production build
  green.
- **Pre-v0.1.0 history** (no tag, no image, no deployment existed yet): **Phase 0 + Phase 1 merged to `main` on
  2026-09-20 (PR #2, Session 1)** — application code now exists; CI runs gates and a Docker image build +
  container smoke test on every PR and push. **Phase 2a merged to `main` on 2026-09-20 (PR #3,
  Session 2)** — core money-record domain with E1/E2/E4/E6/E7 integration coverage, no UI yet. **Phase 2b
  mobile entry merged via PR #4 on 2026-09-20** — 111 tests green; browser tooling unavailable in the sandbox.
  **Phase 3 (Session 4) built on its session branch** — schedules + instances, income receipts, estimate and
  payday-projection engines, two-tier warnings, pot-level transfer watch, renewals + key-date alerts, home
  panels and entry forms; E3/E5/E8/E9 and DST boundary coverage; **154 tests green**, all gates green
  (`npm ci --ignore-scripts` in-sandbox; plain `npm ci` in CI), migration `0002_phase3_schedules`. No tag and
  no publish this session — **v0.1.0** remains the end-of-Phase-5 release.
- **Phase 4b merged 2026-09-21 (PR #8, Session 6 on branch `arena/01a0c181-simple-finance`)** — Suppliers
  page with references and the interaction log, Contracts & Renewals page, the `attachments` migration
  (`0003_phase4b_documents`) and the first upload/view path; 182 tests green.
- **Phase 5 built 2026-09-21 on branch `arena/01a0c193-simple-finance` (this session, commit `6dbeafe` plus
  the container/deployment work above it)** — backup format 2 with documents, verified restore and live
  in-place restore, the shared attachment pipeline, audited supplier operations, unprivileged container,
  Unraid template, GHCR publish workflow, Playwright acceptance suite. **224 Node tests green**, format and
  typecheck green, production build green, `npm audit --omit=dev` 0 vulnerabilities. **No tag and no
  publish yet**: the first release is still **v0.1.0**, to be tagged on the merged commit after the product
  owner's review, with the publish workflow verifying the GHCR image before the household Force Updates
  Unraid. **No browser run has been executed yet** — Playwright cannot install its browser in this sandbox
  (decision 87); the suite runs in the CI `browser` job and its result must be recorded before the tag.

## File map (current)

```
README.md                     — operating truth (Phase 0–4b merged, Phase 5 built; install, Cloudflare,
                                backup/restore, Unraid update, recovery checklist, gates, sandbox notes)
AGENT_APP_BLUEPRINT.md        — engineering/delivery contract (from Estate Organiser lessons; user-provided)
docs/SPEC.md                  — agreed product specification + worked fictional examples E1–E12
                                (E10–E12: cash handover, family loan, swap)
docs/IMPLEMENTATION_PLAN.md   — this file (now includes the session map)
docs/HANDOFF.md               — next-session continuation point (rewritten at each session end)
.gitignore                    — protects real data/secrets/backups from the public repo
package.json / package-lock.json — dependencies, scripts (gates), engines (node >=22)
tsconfig.json / next.config.ts / postcss.config.mjs / .prettierrc / .prettierignore
drizzle.config.ts             — drizzle-kit config (schema → ./drizzle)
drizzle/                      — checked-in SQL migrations (never edit an applied migration)
src/lib/version.ts            — single source of app version (kept aligned with package.json by test)
src/lib/config.ts             — env parsing; fail-closed auth completeness; dev-bypass computation
src/lib/money.ts              — integer-pence parsing/formatting (no float money, ever) + shared bounds
src/lib/time.ts               — Europe/London rendering + checkpoint age labels + local-date helpers (backdating)
src/lib/db/{client,migrate,schema}.ts — better-sqlite3 + Drizzle (WAL, FKs), migration runner, schema
src/lib/audit.ts              — in-transaction audit writer
src/lib/auth/{verify,current-user,next}.ts — jose JWT verification, fail-closed resolution, Next adapter
src/lib/records/pots.ts       — domain: create pot, add immutable checkpoint (effective-date rule), archive
                                empties only (post-release), reads
src/lib/records/{splits,categories,people,vehicles,suppliers,purchases,transfers,occurred,errors}.ts — Phase 2a
                              domain: exact-total splits, category tree, parties, money records, backdating, concurrency
src/lib/records/dates.ts      — Phase 3 pure local-calendar arithmetic (no instants): clamped due dates (OQ1/OQ13),
                                whole-day adds, leap years — DST-safe by construction
src/lib/records/estimates.ts  — Phase 3 pure estimate engine (SPEC §7.1): comparison-precision rule, per-pot + household sums
src/lib/records/projection.ts — Phase 3 pure payday-projection engine (SPEC §7.2–7.5, §8): pessimistic day-to-day block,
                                outgoings-before-receipts, two-tier selection, pot-level transfer watch
src/lib/records/keydates.ts   — Phase 3 pure key-date engine (SPEC §22): inclusive warning windows, today/rolled/past states
src/lib/records/{debts,external-movements}.ts — post-release domain: informal-IOU derived
                                balances; loan/swap/other movements, atomic swap pairs, boundary money rules
src/lib/records/{schedules,receipts,renewals,settings,money-view}.ts — Phase 3 domain + read-side assembly: schedule
                                lifecycle (sync/convert/self-heal), income records, renewal auto-advance, typed settings,
                                and the DB-backed money/projection/key-date views that run the lazy due pass first
src/lib/validation.ts         — Zod schemas at the server boundary, including Phase 2b entry payloads, Phase 3
                                schedule/cancel/renewal/settings payloads and Phase 4a edit/refund/void/transfer/
                                pot/category/rename/warning-lead payloads and post-release debt/external/
                                swap/archive payloads
src/lib/records/insights.ts   — Phase 4a pure Insights v1 engine (SPEC §16): month comparison, per-person
                                attribution, vehicle rolling-12, honesty loop (complete periods only)
src/lib/records/insights-view.ts — Phase 4a DB assembly for the four insight views (runs the lazy due pass;
                                transfers/receipts excluded by construction)
src/lib/records/entry-view.ts — shared QuickEntryData builder (mobile home + desktop overview, one code path)
src/lib/backup/crypto.ts      — AES-256-GCM + scrypt frame (`SFBA` v1), reviewed primitives only
src/lib/backup/filename.ts    — filename contract (Europe/London, same instant) + Content-Disposition parsing
                                and the local fallback name (v0.2.21 lesson)
src/lib/backup/backup.ts      — format 2 backup: snapshot + referenced documents + sha256 manifest, orphan
                                report, `inspectDocuments` (read-only health, never deletes)
src/lib/backup/restore.ts     — staged restore (formats 1 and 2): member allowlist, per-file integrity,
                                referenced-document verification, swap with rollback preserving both copies
src/lib/backup/live-restore.ts — close handle → restore → reopen (the in-place path the UI calls)
src/lib/backup/download.ts    — browser download path (client-only): header filename into anchor.download,
                                tested fallback; `chooseDownloadFilename` is unit-tested
src/lib/backup/policy.ts      — shared constants: 12-character create password, RESTORE word, 512 MB bound
src/lib/auth/origin.ts        — same-origin guard for mutating route handlers (blueprint §4.7)
src/lib/records/attachments.ts — the one attachment pipeline: content sniffing, 10 MB, key pattern, display-name
                                sanitising, store + audit, delete (soft-delete then unlink, decision 89),
                                read path (used by action, route, backup, restore)
src/lib/records/supplier-details.ts — reference pairs + interaction log as audited domain operations,
                                `upcomingSupplierFollowUps` for the contracts page
src/app/api/restore/route.ts  — live in-place restore endpoint (confirmed, bounded, same-origin, authenticated)
src/app/api/attachments/[fileKey]/route.ts — authenticated private serving (nosniff, no-store)
src/components/backup-panel.tsx — Settings backup & restore UI (download + typed-confirmation restore)
src/components/supplier-forms.tsx — contact card editor, reference form, interaction form
src/app/                      — layout + site nav (version badge), home page (mobile-first), unauthorized page,
                                server actions (incl. Phase 4a edit/refund/void/transfer/pot/category/rename/
                                warning-lead actions), and the Phase 4a pages: /overview, /purchases, /recurring
                                (month calendar), /pots, /insights, /settings — all force-dynamic
src/app/api/health/route.ts   — public health endpoint (no diagnostics)
src/app/api/backup/route.ts   — authenticated encrypted backup download (POST)
src/components/pot-forms.tsx  — client forms (Add pot / checkpoint)
src/components/quick-entry.tsx — mobile Add Purchase / Add Fuel / Update Balance, split helper, chips, duplicate notice
src/components/household-setup.tsx — authenticated initial people/vehicle labels (household data is never seeded)
src/components/recurring.tsx  — Phase 3 client forms: Add/Cancel schedule, Add renewal, projection figures
                                (slim props, decision 73)
src/components/record-forms.tsx — Phase 4a: line editor, PurchaseEditForm, RefundForm, generic VoidForm,
                                TransferForm, RecentEntryActions (edit/refund/void switcher)
src/components/schedule-forms.tsx — Phase 4a: ScheduleEditForm (composite target picker), RenewalEditForm
src/components/settings-forms.tsx — Phase 4a: TargetRenameForm, PotEditForm, CategoryTreeEditor, WarningLeadsForm
src/components/site-nav.tsx     — app chrome: menu pages + version badge (desktop AND mobile)
src/components/purchase-filter-form.tsx — Purchases GET filters; phone collapse + in-card layout (decision 92)
scripts/migrate.cjs           — production migration runner (entrypoint path)
scripts/e2e-server.mts        — Playwright webServer: isolated `.e2e-data` seed (fictional) + `next dev`
e2e/{home,desktop,backup,pwa}.spec.ts — browser acceptance specs (mobile till moment, desktop review incl. the
                                calendar-consistency check, backup download + UI restore, PWA asset 200s)
playwright.config.ts          — Playwright projects (mobile/desktop/backup) and the webServer wiring
docker-entrypoint.sh          — .env → dirs → one-time chown → migrations → exec server as PUID:PGID
Dockerfile                    — multi-stage production image (gosu, unprivileged default 99:100)
simple-finance.xml            — Unraid container template (appdata, free host port, PUID/PGID, AUTH_*)
public/manifest.webmanifest   — PWA manifest (static file, not a route; fetchable without Access credentials)
public/icon-192.png           — 192×192 app icon (derived from docs/assets/simple-finance-icon.svg)
public/icon-512.png           — 512×512 app icon
public/apple-touch-icon.png   — 180×180 apple touch icon
.github/workflows/ci.yml      — gates + browser acceptance + docker smoke (asserts uid 99, PWA assets)
.github/workflows/publish.yml — tag-triggered GHCR publication with pre-push smoke test and digest check
docs/assets/simple-finance-icon.{svg,png} — app/template icon (generated placeholder, fictional)
.env.example                  — placeholders incl. DOCUMENTS_DIR and the container PUID/PGID notes
.env.example                  — placeholder configuration (real values only in the private install)
tests/*.test.ts               — 340 regression tests: money, time (+ local dates), filename (DST/midnight), config, auth verify,
                                current-user fail-closed, db slice, backup/restore round-trip (3 migrations), route, migrate
                                script, version, splits, categories (SPEC §12 seed), parties (people/vehicles/suppliers),
                                purchases (E1/E2/E6/E7 + refunds/edit/void), transfers (E4 + edit/void), PWA manifest
tests/{dates,estimate,projection}.test.ts — Phase 3 pure-engine tests: local-date arithmetic + DST days (E3 sweep inputs),
                                comparison-precision rule (E5), E8 projection to the penny + tiers + pot watch
tests/schedule-lifecycle.test.ts — Phase 3 E3: 26th→30th counted-exactly-once timeline, crash self-heal, DST-midnight
                                conversions (2026-10-25 / 2026-03-29), cancel/edit/annual-month/leap/receipt conversion
tests/renewals.test.ts        — Phase 3 E9: inclusive 21-day window, annual auto-advance (audited, 29 Feb → 28 Feb),
                                contract-end alerts ("rolled / awaiting review"), version guard
tests/money-view.test.ts      — Phase 3 E8 end-to-end over the DB: estimates, payday selection, penny-exact projection,
                                due-this-week, settings round-trip
tests/entry-validation.test.ts — Phase 2b Zod boundary tests for split/purchase, fuel and checkpoint payloads
tests/insights.test.ts        — Phase 4a pure-engine tests: month boundaries (DST spring-forward), per-person
                                attribution (household never attributed), vehicle rolling-12 window, honesty-loop
                                complete weeks/months + half-up rounding
tests/insights-view.test.ts   — Phase 4a exit criterion: every insight figure reconciles with an independent
                                sum over listPurchases + categories; transfers asserted to have no effect;
                                converted schedule purchases counted exactly once
tests/recurring-calendar.test.ts — Phase 4a exit criterion: calendar/instance consistency after schedule
                                edits + cancellations (incl. due-day edit moving the next instance), month-end
                                clamping, grid construction
tests/settings-domain.test.ts — Phase 4a: pot edit rules (overdraft context, version guard), category tree
                                operations (retire/assign-block), target renames, warning leads
tests/fuel-economy.test.ts    — v0.10.0 fuel parsing, stretches/gaps, totals, sentences, audited edit + conflicts
tests/migration-0009.test.ts  — v0.10.0 upgrade of a v0.9.0-shaped database keeps every attachment and purchase
tests/household.ts            — isolated household fixture (pots, people, vehicles, category lookup) for Phase 2a+ tests
.github/workflows/ci.yml      — gates job + docker build/smoke job (PR + push to main)
```

## Known risks

- **Assume-cleared overstatement** (decision 6): bounded, self-correcting, documented; mitigate by visible
  checkpoint staleness and honest labelling — never by silent pessimism.
- **Projection drift**: configured figures going stale would weaken the warning; mitigated by the Insights
  honesty loop (SPEC §16.4).
- **Public repo exposure**: constant discipline — fictional data only, staged-diff review before publishing,
  demo paths isolated from production paths.
- **Two-user concurrency**: optimistic concurrency + audit trails implemented in Phase 2a for all money
  records; stale-form overwrites fail visibly (blueprint §3). The version guard assumes synchronous
  single-writer transactions (decision 42) — revisit if writers ever multiply.
- **Attachments are real financial data**: receipts/invoices expose genuine spending — the fictional-only
  repo rule extends to them (no real receipts in commits, screenshots, PRs, issues or demo data; demo
  attachments are generated fictional images; staged-diff review before publishing).
- **Backup archive growth** with photos: per-file size limits, honest README guidance on download cadence
  and archive size, no implied offsite automation.
- **Phone camera variability** (capture support, formats, HEIC): manual acceptance on the users' real
  devices is part of Phase 5 exit; OQ9 fallback documented. The attach control offers
  `capture="environment"` and accepts PNG/JPEG/PDF (OQ9 default).
- **Restore is a two-object swap, not one transaction** (decision 78): the database and the documents
  directory are renamed in sequence. Between the two renames a crash leaves the new database with the
  preserved documents directory — the app still starts, and the previous copies remain on disk under
  `.pre-restore-<stamp>` for a manual fix. Recovery instructions belong in the README (next session may
  extend them); the alternative (a copy-then-swap of everything) trades a rare, recoverable window for
  needing twice the disk.
- **First browser run is still owed**: the Playwright suite is written against real selectors and its
  server-rendered expectations were checked against a running dev server, but selectors can still drift
  from rendered behaviour. Until the CI `browser` job is green, no browser evidence exists (blueprint §9:
  never claim a browser run from markup rendering).
- **Missed in-app renewal alerts** if the app isn't opened inside a warning window: mitigated by the 4–5-day
  checkpoint cadence vs 21-day default lead; an email alert channel is a recorded v2 roadmap item
  (decision 24).
  never claim a browser run from markup rendering).
- **Missed in-app renewal alerts** if the app isn't opened inside a warning window: mitigated by the 4–5-day
  checkpoint cadence vs 21-day default lead; an email alert channel is a recorded v2 roadmap item
  (decision 24).
