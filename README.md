# Simple Finance

A private, self-hosted household spending app for **two people watching money carefully** — everyday
purchases, direct debits and standing orders, cash and bank pots, and an honest answer to *"will we be OK
by payday?"* Built for a single household behind Cloudflare Access, deployed to Unraid.

## Current status

**Stage: specification agreed — no application code yet** (as of 2026-09-20).

Nothing is implemented, published or deployed. This repository currently contains the agreed product
specification and delivery plan produced by a structured discovery session with the product owner.

| Document | Purpose |
|---|---|
| [`AGENT_APP_BLUEPRINT.md`](AGENT_APP_BLUEPRINT.md) | Engineering & delivery contract carried forward from a previous successful app (stack, auth, backup/restore, Unraid packaging, release workflow). |
| [`docs/SPEC.md`](docs/SPEC.md) | The product specification: money model (pots, balance checkpoints, estimates, payday projection, warnings), purchases/splits/attribution, schedules, category tree, UX (mobile quick entry, dense desktop pages, read-only commitments calendar), Insights, and worked fictional examples E1–E8. |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Project profile, architecture and data-model sketch, phased build plan (Phases 0–5) with exit criteria, test strategy, dated decision log, open questions. |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Continuation point for the next agent session: current state, constraints, next exact actions. |

## What the app will be (and won't be)

- **Will:** fast mobile entry at the till (supplier memory, splits, visible one-tap defaults); user-reported
  balance checkpoints per pot; recurring payments that auto-convert on their due date; household estimate and
  payday-to-payday projection with calm two-tier overdraft warnings; per-vehicle running costs; personal-vs-
  personal and month-vs-month insights; supplier contact cards (phone/email/policy references) with an
  interaction log for calls and emails; fixed-term contract end dates and insurance renewal alerts (default
  21 days' warning); receipt/invoice attachments (file upload or phone camera); dense, functional desktop
  review pages; encrypted, restore-rehearsed backups covering the database and documents.
- **Won't:** connect to any bank, import statements, reconcile transactions, ask for bank credentials, track
  investments or vehicle valuations, work offline, or send notifications (all explicit v1 non-goals —
  see `docs/SPEC.md` §2).

## Planned stack

TypeScript · Next.js (App Router) · SQLite (`better-sqlite3` + Drizzle, checked-in migrations) · Zod ·
Cloudflare Tunnel + Access (Google identity, server-side JWT verification via `jose`) · Docker → GHCR →
Unraid template. Full contract in `AGENT_APP_BLUEPRINT.md`.

All runtime data lives in one host directory — `/mnt/user/appdata/simple-finance` (container `/data`):
the SQLite database, `.env` configuration, `documents/` (receipt/invoice attachments) and `logging/`.
Backups cover the database and documents, exclude `.env` and logs, and must pass a clean-installation
restore rehearsal before real data is trusted — `docs/SPEC.md` §18.

## Privacy — this repository is public

No real personal financial data may ever appear in commits, PRs, issues, screenshots, logs, fixtures, seed
files or release artefacts. Every name, amount, date and threshold in the documentation and future demo data
is a **fictional placeholder**; the real household's data exists only in its private installation, and
`.gitignore` keeps databases, backups, receipts, uploads, exports and `.env` files out of version control.
See `docs/SPEC.md` §19.

## Version

No releases yet. First planned release: **v0.1.0** at the end of Phase 5 (see the implementation plan).
