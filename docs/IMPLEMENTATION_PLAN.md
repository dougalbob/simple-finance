# Simple Finance — Implementation Plan

**Status:** Phase 0 + Phase 1 + Phase 2a + Phase 2b complete (Sessions 1–3; Phase 2b build is complete on the
current session branch). PRs #2 and #3 merged 2026-09-20; this session adds the mobile entry surface. Discovery
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
| 4 | Phase 3 — schedules, estimate/projection engines, warnings, key-date alerts | Next |
| 5 | Phase 4a — desktop pages + Insights v1 (first part) | Planned |
| 6 | Phase 4b — desktop pages + attachments (remainder) | Planned |
| 7 | Phase 5 — hardening & first release (v0.1.0) | Planned |

> The Phase 4a/4b boundary above is the working split; confirm the exact page allocation with the product
> owner when Session 5 starts rather than re-opening the seven-session shape.

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
  paid_by_person_id, entered_by, note?, voided_at?, version (optimistic concurrency).
- `allocations` — id, purchase_id, amount_pence (signed: refunds negative), category_id (leaf),
  target_kind (household|person|vehicle), target_id?, refund_of_purchase_id?.
  Constraint: Σ allocations = purchase total (enforced in a transaction, tested).
- `refunds` — modelled as purchases with negative allocation amounts + `refund_of_purchase_id` link.
- `transfers` — id, from_pot_id, to_pot_id, amount_pence, occurred_at, entered_by, voided_at?, version.
- `schedules` — id, name, kind (dd|so|receipt), amount_pence, frequency (monthly|annual), due_day_of_month,
  pot_id, category_id?, target_kind/target_id?, contract_ends_on?, active_from, active_until?,
  cancelled_at?, version.
- `renewals` — id, label, supplier_id?, target_kind/target_id?, renewal_date, warn_days_before (default 21),
  repeats_annually, notes, advanced_from? (history of auto-advances), version (SPEC §22.2).
- `schedule_instances` — id, schedule_id, due_date, state (**upcoming|converted** — exactly one, unique per
  schedule+date), converted_record_id? (purchase/receipt), UNIQUE(schedule_id, due_date).
- `receipts` — income records from receipt schedules (or reuse purchases table with a sign/kind flag —
  decide in Phase 3 design note; keep one money-record abstraction if it stays clean).
- `attachments` — id, purchase_id, file_key (server-generated under `documents/`), original_name, mime,
  size_bytes, sha256, state (pending|stored|failed), created_by, created_at (SPEC §23).
- `settings` — household labels, payday config, projection figures (weekly groceries, per-vehicle monthly
  fuel), tier thresholds, UI prefs. Private runtime values.
- `audit_entries` — actor, action, entity, before/after summary, timestamp; written in the same transaction
  as the change (blueprint §3).

Schema decisions to finalise at Phase 3 design: single money-records table vs purchases+receipts; index
shape for estimate queries (pot_id, effective-time ordering).

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
covering attachments).*

## Test strategy (domain-specific, on top of blueprint §9)

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
  (no unauthenticated fetch), sha256 verification on restore.
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
   projection.
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

## Open questions (none block Phases 0–1; proposed defaults given)

| # | Question | Proposed default |
|---|---|---|
| OQ1 | Due-day clamping (day 29–31 in shorter months) | Clamp to last day of month; test leap years. |
| OQ2 | Income schedules: "shift to previous working day if weekend/bank holiday" toggle (salaries often pay on last working day)? | Add toggle for receipt schedules only; DDs/SOs use configured date as-is. |
| OQ3 | Duplicate-notice matching window & rule (currently ~2h, same pot+supplier/category+amount) | Ship as stated; tune after real use. |
| OQ4 | Checkpoint effective-date granularity (date-only backdating vs full timestamp) | Date-only backdating, boundary = end of local date; revisit if users want finer. |
| OQ5 | Receipts storage shape (own table vs signed purchase records) | Decide in Phase 3 design; prefer one clean money-record abstraction. |
| OQ6 | ~~Receipt images / attachments~~ | **Resolved 2026-09-20 — in scope (decision 26, SPEC §23).** Residual sub-questions moved to OQ9–OQ12. |
| OQ7 | PWA installability | Post-v1 evaluation; never with offline caching of financial data or broad Access bypasses. |
| OQ8 | Unraid host port | Pick a free port at first install; template documents it (never inherit 3005). |
| OQ9 | Phone camera formats: accept HEIC directly, or rely on browser JPEG capture? | v1 accepts PNG/JPEG/PDF; document the iPhone "Most Compatible"/JPEG camera setting; server-side HEIC conversion only if real devices demand it. |
| OQ10 | Supplier-level document attachments (e.g. a policy PDF not tied to a purchase)? | Defer; v1 attaches to purchases only. Renewals/suppliers hold references + notes meanwhile. |
| OQ11 | Interaction follow-up dates surfaced in the key-dates panel — useful? | Include the optional field and panel display (proposed); no notifications either way. |
| OQ12 | Attachment size limit and retention guidance | 10 MB per file; README guidance on archive growth; no server-side pruning in v1. |
| OQ13 | 29 February renewal dates under annual advance | Land on 28 February in non-leap years; visible and editable. |

## Release history

- No versioned releases yet (no tag, no image, no deployment). **Phase 0 + Phase 1 merged to `main` on
  2026-09-20 (PR #2, Session 1)** — application code now exists; CI runs gates and a Docker image build +
  container smoke test on every PR and push. **Phase 2a merged to `main` on 2026-09-20 (PR #3,
  Session 2)** — core money-record domain with E1/E2/E4/E6/E7 integration coverage, no UI yet. First
  planned release: **v0.1.0** at end of Phase 5.

## File map (current)

```
README.md                     — operating truth (Phase 0+1 status, local run, gates, sandbox note)
AGENT_APP_BLUEPRINT.md        — engineering/delivery contract (from Estate Organiser lessons; user-provided)
docs/SPEC.md                  — agreed product specification + worked fictional examples E1–E9
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
src/lib/records/pots.ts       — domain: create pot, add immutable checkpoint (effective-date rule), reads
src/lib/records/{splits,categories,people,vehicles,suppliers,purchases,transfers,occurred,errors}.ts — Phase 2a
                              domain: exact-total splits, category tree, parties, money records, backdating, concurrency
src/lib/validation.ts         — Zod schemas at the server boundary, including Phase 2b entry payloads
src/lib/backup/{crypto,filename,backup,restore}.ts — encryption framing, filename contract, backup, isolated restore
src/app/                      — layout, home page (quick entry + review), unauthorized page, server actions
src/app/api/health/route.ts   — public health endpoint (no diagnostics)
src/app/api/backup/route.ts   — authenticated encrypted backup download (POST)
src/components/pot-forms.tsx  — client forms (Add pot / checkpoint)
src/components/quick-entry.tsx — mobile Add Purchase / Add Fuel / Update Balance, split helper, chips, duplicate notice
src/components/household-setup.tsx — authenticated initial people/vehicle labels (household data is never seeded)
scripts/migrate.cjs           — production migration runner (entrypoint path)
docker-entrypoint.sh          — dirs → trusted .env → migrations → exec next start
Dockerfile                    — multi-stage production image
.env.example                  — placeholder configuration (real values only in the private install)
tests/*.test.ts               — 111 regression tests: money, time (+ local dates), filename (DST/midnight), config, auth verify,
                                current-user fail-closed, db slice, backup/restore round-trip, route, migrate script, version,
                                splits, categories (SPEC §12 seed), parties (people/vehicles/suppliers),
                                purchases (E1/E2/E6/E7 + refunds/edit/void), transfers (E4 + edit/void)
tests/entry-validation.test.ts — Phase 2b Zod boundary tests for split/purchase, fuel and checkpoint payloads
tests/household.ts            — isolated household fixture (pots, people, vehicles, category lookup) for Phase 2a tests
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
  devices is part of Phase 5 exit; OQ9 fallback documented.
- **Missed in-app renewal alerts** if the app isn't opened inside a warning window: mitigated by the 4–5-day
  checkpoint cadence vs 21-day default lead; an email alert channel is a recorded v2 roadmap item
  (decision 24).
