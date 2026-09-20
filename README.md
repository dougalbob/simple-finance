# Simple Finance

A private, self-hosted household spending app for **two people watching money carefully** — everyday
purchases, direct debits and standing orders, cash and bank pots, and an honest answer to *\"will we be OK
by payday?\"* Built for a single household behind Cloudflare Access, deployed to Unraid.

## Current status

**Stage: Phase 0 + Phase 1 + Phase 2a + Phase 2b + Phase 3 complete (Sessions 1–4; Phases 1–2b merged
via PR #4) — core money records, mobile quick-entry, schedules with auto-conversion, the estimate and
payday-projection engines and the two-tier warnings are running; no release published yet.** Phases 4–5
(desktop pages, Insights, attachments, hardening/v0.1.0) remain planned and sequenced — see the
**session map** in `docs/IMPLEMENTATION_PLAN.md`.

| Implemented & merged | Status |
|---|---|
| Toolchain scaffold (TS strict, Next.js 16 App Router, Tailwind 4, Drizzle + better-sqlite3, checked-in migrations, Prettier, node:test via tsx) | ✅ locally tested, gates green in CI |
| Auth: `jose` verification of Cloudflare Access JWTs, two-identity allowlist, fail-closed config, dev-only identity bypass (production never honours it) | ✅ unit/integration tested incl. wrong-issuer/audience/expired/key/allowlist |
| Vertical slice: create pots, record immutable balance checkpoints, persistent read (home page), audit trail written in-transaction | ✅ integration tested on isolated databases |
| Encrypted backup skeleton (WAL-safe snapshot, versioned manifest + sha256, AES-256-GCM + scrypt, filename contract) + restore into isolated targets | ✅ round-trip, wrong-password, tamper & truncation tested |
| Container: multi-stage Dockerfile, entrypoint (dirs → `.env` → migrations → exec), public `/api/health`, healthcheck | ✅ entrypoint simulate passed locally; image build + container smoke tested in CI |
| Unauthorised / wrong-audience requests rejected on pages and API routes | ✅ tested at unit and live-server level |
| Core money records (Phase 2a): people, vehicles, category tree seeded per SPEC §12, suppliers + contact cards, purchases with exact-total splits, refunds as linked negatives, transfers, void/edit with audit + optimistic concurrency, checkpoint effective-date rule | ✅ integration tested incl. E1, E2, E4, E6, E7 on isolated databases (111 tests total including Phase 2b boundary tests) |
| Mobile entry (Phase 2b): Add Purchase with exact splits/remainder helper, Add Fuel, Update Balance with date-only backdating, supplier recents/inline add/near-duplicate prompt, derived category memory chip, visible pot/paid-by/target defaults, non-blocking duplicate review/void, single in-flight submission guard | ✅ server actions use Zod + domain validation; production build green |
| Money engines (Phase 3): per-pot + household "available now" estimates with the conservative date-only comparison rule; payday-to-payday projection with period-level half-up day-to-day figures, outgoings-before-receipts ordering, two-tier warnings and the pot-level "plan a transfer" watch; schedules (DD/SO/income) with unique upcoming→converted instances, lazy midnight conversion that self-heals across crashes, clamp-to-month-end due days, effective-date cancellation; renewals with per-item leads and annual auto-advance (29 Feb → 28 Feb); key-date alerts incl. contract ends ("rolled / awaiting review") | ✅ pure engines + domain tested to the penny incl. E3, E5, E8, E9 and DST sweeps (2026-10-25 / 2026-03-29); home page shows money, projection, due-this-week, key dates and entry forms (154 tests total) |

**Not yet built (per plan):** desktop pages (dense Recurring Payments month calendar, Insights,
Settings), Insights + the projection honesty loop, attachments, live in-place restore, GHCR publication,
Unraid template. Nothing has been deployed; the first release will be **v0.1.0** at the end of Phase 5.
The home page now shows the money estimate and payday projection alongside the mobile-first entry flows;
both are clearly labelled as estimates/projections — never a bank balance, never a bank connection.

| Document | Purpose |
|---|---|
| [`AGENT_APP_BLUEPRINT.md`](AGENT_APP_BLUEPRINT.md) | Engineering & delivery contract (stack, auth, backup/restore, Unraid packaging, release workflow). |
| [`docs/SPEC.md`](docs/SPEC.md) | The product specification (money model, purchases/splits, schedules, categories, UX, Insights, §18 backup, §21–23, examples E1–E9). |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Project profile, architecture, **session map**, phased plan with exit criteria, test strategy, decision log, open questions. |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Continuation point for the next agent session. |

## What the app will be (and won't be)

- **Will:** fast mobile entry at the till (supplier memory, splits, visible one-tap defaults); user-reported
  balance checkpoints per pot; recurring payments that auto-convert on their due date; household estimate and
  payday-to-payday projection with calm two-tier overdraft warnings; per-vehicle running costs; personal-vs-
  personal and month-vs-month insights; supplier contact cards with an interaction log; fixed-term contract
  end dates and insurance renewal alerts (default 21 days); receipt/invoice attachments; dense, functional
  desktop review pages; encrypted, restore-rehearsed backups covering the database and documents.
- **Won't:** connect to any bank, import statements, reconcile transactions, ask for bank credentials, track
  investments or vehicle valuations, work offline, or send notifications (all explicit v1 non-goals —
  see `docs/SPEC.md` §2).

## Stack (as built)

TypeScript (strict) · Next.js 16 App Router · React 19 · SQLite (`better-sqlite3` + Drizzle, checked-in
migrations under `drizzle/`) · Zod at server boundaries · Tailwind CSS 4 · Cloudflare Tunnel + Access
(Google identity, server-side JWT verification via `jose`) · Node test runner via `tsx` · Prettier ·
multi-stage Dockerfile → GHCR → Unraid template (publication workflow lands with v0.1.0).

All runtime data lives in one host directory — `/mnt/user/appdata/simple-finance` (container `/data`):
the SQLite database (+WAL/SHM), `.env` configuration, `documents/` (attachments, Phase 4) and `logging/`.
Backups cover the database (and later documents), exclude `.env` and logs, and must pass a clean-installation
restore rehearsal before real data is trusted — `docs/SPEC.md` §18.

## Running locally

```sh
npm ci            # full toolchain (see note below in constrained sandboxes)
npm run dev       # http://localhost:3000
```

Local development needs no Cloudflare setup: set `AUTH_DEV_BYPASS=true` and
`AUTH_DEV_IDENTITY_EMAIL=dev@example.com` (in `.env`, git-ignored — see `.env.example`). The bypass is
computed to be impossible in production (`NODE_ENV=production` refuses it regardless of flags). Data lands
in `./data` (git-ignored). Alternatively, configure real Access values (`AUTH_ISSUER`, `AUTH_AUDIENCE`,
`AUTH_ALLOWED_EMAILS`) and front the dev server with your tunnel.

Gates (same commands CI runs):

```sh
npm run format:check
npm run typecheck
npm test                              # 154 tests (Phase 1 + 2a domain + 2b boundary + Phase 3 engines/lifecycle)
NEXT_TELEMETRY_DISABLED=1 npm run build
npm audit --omit=dev                  # 0 vulnerabilities at time of writing
npm run db:migrate                    # apply migrations explicitly (dev does it automatically)
```

> **Constrained-sandbox note:** if `nodejs.org` is unreachable, plain `npm ci` fails when npm's gypfile
> auto-build tries to compile `better-sqlite3` from source (it needs Node headers from nodejs.org).
> `npm ci --ignore-scripts` works — the package bundles prebuilt binaries — and the test suite verifies
> the native module. Plain `npm ci` is exercised in CI (`.github/workflows/ci.yml`) where network is
> unrestricted. Recorded per blueprint §9.

## Privacy — this repository is public

No real personal financial data may ever appear in commits, PRs, issues, screenshots, logs, fixtures, seed
files or release artefacts. Every name, amount, date and threshold in the documentation and demo data is a
**fictional placeholder**; the real household's data exists only in its private installation, and
`.gitignore` keeps databases, backups, receipts, uploads, exports and `.env` files out of version control.
See `docs/SPEC.md` §19.

## Version

**v0.1.0 (pre-release, unreleased).** No image published, no deployment. First planned release: **v0.1.0**
at the end of Phase 5. The running app displays its version unobtrusively in the footer.
