# Simple Finance — Implementation Plan

**Status:** specification agreed; **no application code exists yet**. Discovery completed 2026-09-20.
This plan follows `AGENT_APP_BLUEPRINT.md` (the build contract) and `docs/SPEC.md` (the product spec).

> All names, amounts and dates in this document are fictional placeholders. Real values live only in the
> private installation's configuration and database. See the privacy notice in `docs/SPEC.md`.

## Project profile (blueprint §2)

| Field | Decision |
| --- | --- |
| Product | **Simple Finance** (`dougalbob/simple-finance`). Shared household spending tracker for two users, focused on available money, upcoming commitments and avoiding overdraft charges. Primary workflows: mobile quick entry (purchase/fuel/checkpoint), desktop review (purchases, schedules, pots, insights). |
| Scope | MVP = SPEC.md §2 "In scope (v1)". Non-goals: bank integration/reconciliation, credit cards, investments/valuations, offline mode, notifications, drag-drop calendar, fractional splits. Sensitive data: real household finances — fictional-only in repo. |
| Access | Cloudflare Tunnel + Access + Google sign-in; `jose` server-side JWT verification; allowlist of exactly two configured identities; full mutual visibility/editing with audit trail; no in-app roles. |
| Scheduling | Recurring DD/SO/income schedules with auto-conversion on due date; read-only month calendar view of instances; no drag-and-drop; business timezone **Europe/London**; date-only facts date-only; instants UTC. |
| Storage | SQLite via `better-sqlite3` + Drizzle ORM, checked-in migrations. No uploaded files in v1 (no receipt images — revisit later if ever wanted). Single instance, two users, low concurrency; optimistic concurrency on shared edits. |
| Deployment | Repo `dougalbob/simple-finance` (public) → GitHub Actions → GHCR image → Unraid XML template. Internal port 3000; **choose a free host port at install time — do not copy the reference app's 3005**. Appdata under the app's own Unraid directory (`/data` mapping). Health endpoint with no records/diagnostics. |
| Recovery | Encrypted downloadable backup (AES-256-GCM, scrypt-derived key, versioned filename per blueprint §6 contract) + tested restore into a clean isolated installation before real data is trusted. Recovery password never persisted. Restore staging on same filesystem (EXDEV lesson). |
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
- `suppliers` — id, name, normalized_name, default_category_id (most-used, derived or cached).
- `categories` — id, parent_id (null = parent; exactly two levels enforced), name, retired_at?, sort.
- `targets` — household (singleton), `people` (id, label), `vehicles` (id, label, owner_person_id).
- `purchases` — id, supplier_id?, pot_id, total_pence, occurred_at (timestamp), occurred_date (backdatable),
  paid_by_person_id, entered_by, note?, voided_at?, version (optimistic concurrency).
- `allocations` — id, purchase_id, amount_pence (signed: refunds negative), category_id (leaf),
  target_kind (household|person|vehicle), target_id?, refund_of_purchase_id?.
  Constraint: Σ allocations = purchase total (enforced in a transaction, tested).
- `refunds` — modelled as purchases with negative allocation amounts + `refund_of_purchase_id` link.
- `transfers` — id, from_pot_id, to_pot_id, amount_pence, occurred_at, entered_by, voided_at?, version.
- `schedules` — id, name, kind (dd|so|receipt), amount_pence, due_day_of_month, pot_id, category_id?,
  target_kind/target_id?, active_from, active_until?, cancelled_at?, version.
- `schedule_instances` — id, schedule_id, due_date, state (**upcoming|converted** — exactly one, unique per
  schedule+date), converted_record_id? (purchase/receipt), UNIQUE(schedule_id, due_date).
- `receipts` — income records from receipt schedules (or reuse purchases table with a sign/kind flag —
  decide in Phase 3 design note; keep one money-record abstraction if it stays clean).
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
Update Balance) functional. *Exit: acceptance scenarios E1, E2, E4, E6, E7 (SPEC §17) pass as integration
tests plus a Playwright mobile-viewport run where tooling allows.*

**Phase 3 — Schedules, estimate and projection engines.** Schedules + instances with the upcoming→converted
lifecycle (unique-state enforcement), income schedules, estimate engine (SPEC §7.1, timestamp/date comparison
rules), projection engine (§7.2–7.3, period-level rounding), warning tiers (§8), pot-level transfer watch
(§7.5). *Exit: scenario E3 (counted exactly once at every instant — property-tested across the due-date
boundary), E5 (assume-cleared documented behaviour), E8 (projection arithmetic to the penny, tier selection,
DST + month/year boundary cases) all green.*

**Phase 4 — Desktop pages + Insights v1.** Overview (dense dashboard per SPEC §15.2), Purchases (filters,
inline edit), Recurring Payments (+ read-only month calendar view), Accounts & Pots, Insights (SPEC §16
panels 1–4), Settings (category tree editor, projection figures, thresholds, labels). Version display.
*Exit: desktop and mobile primary paths checked; calendar consistent with lists after schedule edits;
insights figures reconcile with the pure engines in tests.*

**Phase 5 — Hardening & first release (v0.1.0).** Full backup/restore per blueprint §6 (encryption, filename
contract incl. blob-download filename lesson, EXDEV staging, failure recovery, wrong-password/corruption
tests), restore rehearsal into a clean isolated installation, security review against blueprint §4 checklist,
Dockerfile + GHCR workflow + Unraid XML template + first-install instructions, README brought to operating
truth, all gates + `npm audit --omit=dev`, PR → merge → tag → publish verification. *Exit: blueprint §12
"Definition of ready" checklist complete; user Force Updates and runs the listed acceptance checks
(real Cloudflare sign-in, a real till-moment mobile entry, checkpoint + projection sanity, restore
rehearsal evidence).*

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

## Open questions (none block Phases 0–1; proposed defaults given)

| # | Question | Proposed default |
|---|---|---|
| OQ1 | Due-day clamping (day 29–31 in shorter months) | Clamp to last day of month; test leap years. |
| OQ2 | Income schedules: "shift to previous working day if weekend/bank holiday" toggle (salaries often pay on last working day)? | Add toggle for receipt schedules only; DDs/SOs use configured date as-is. |
| OQ3 | Duplicate-notice matching window & rule (currently ~2h, same pot+supplier/category+amount) | Ship as stated; tune after real use. |
| OQ4 | Checkpoint effective-date granularity (date-only backdating vs full timestamp) | Date-only backdating, boundary = end of local date; revisit if users want finer. |
| OQ5 | Receipts storage shape (own table vs signed purchase records) | Decide in Phase 3 design; prefer one clean money-record abstraction. |
| OQ6 | Receipt images / attachments | Out of scope v1; note as possible future (would add file storage + backup implications). |
| OQ7 | PWA installability | Post-v1 evaluation; never with offline caching of financial data or broad Access bypasses. |
| OQ8 | Unraid host port | Pick a free port at first install; template documents it (never inherit 3005). |

## Release history

- None yet. No application code, no image, no deployment. First planned release: **v0.1.0** at end of Phase 5.

## File map (current)

```
README.md                     — operating truth (currently: spec-stage status)
AGENT_APP_BLUEPRINT.md        — engineering/delivery contract (from Estate Organiser lessons; user-provided)
docs/SPEC.md                  — agreed product specification + worked fictional examples
docs/IMPLEMENTATION_PLAN.md   — this file
docs/HANDOFF.md               — next-session continuation point
.gitignore                    — protects real data/secrets/backups from the public repo
```

## Known risks

- **Assume-cleared overstatement** (decision 6): bounded, self-correcting, documented; mitigate by visible
  checkpoint staleness and honest labelling — never by silent pessimism.
- **Projection drift**: configured figures going stale would weaken the warning; mitigated by the Insights
  honesty loop (SPEC §16.4).
- **Public repo exposure**: constant discipline — fictional data only, staged-diff review before publishing,
  demo paths isolated from production paths.
- **Two-user concurrency**: optimistic concurrency + audit trails from Phase 2; stale-form overwrites must
  fail visibly (blueprint §3).
