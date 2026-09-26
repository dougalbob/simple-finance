# Release notes — v0.18.0 (a supplier card says who each purchase was for)

**Published:** 2026-09-26 (tag pushed, Publish run `36230210060` passed, image verified in the registry).
**Merge commit:** `ee2308ee21619b7d456e9ff5381a58f6d0070b0c` (PR #66; short SHA `ee2308e`)
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.18.0` · `latest` · `sha-ee2308e`
**Digest:** `sha256:8d8b822afe5ac115b605ffa825d43584262a8b5425ddb13f918dd66549977fb5`, one digest for
all three tags, different from v0.17.0's `sha256:bd5aef91…` (verified through the publish workflow's
`Verify the registry tags resolve` step and `/users/dougalbob/packages/container/simple-finance/versions`).
**Version badge:** `v0.18.0 · pre-release`

## What changed

A small fix to a real household case. Three mobile contracts with one carrier — one each — are best
recorded as **one supplier with three schedules** ("Vodafone — Duncan", "— Cara", "— Matthew"), each
with its own person, due day and contract end date. The app handles that well everywhere except one
place: the supplier card's **Recent purchases** list showed only `date · amount`, so on Vodafone's
card the three contracts could only be told apart **by price**.

Each row now names the payment as well as dating it:

```
2026-10-25 · £28.99 · Mobile Phones (Matthew)
2026-10-23 · £15.99 · Mobile Phones (Cara)
2026-10-22 · £34.50 · Mobile Phones (Duncan)
```

- **Who it was for is in words** — the person, the vehicle, or `household`. Never a colour or an
  icon on its own, which is the rule the rest of the app already follows.
- **It matches the lists you already read.** All Transactions has shown
  `Utilities / Mobile Phones (Matthew)` for a long time, and Insights and Charts split by person.
  The supplier card was the last list that did not.
- **A purchase split across two people or a car** shows the first line and counts the rest —
  `Weekly Shop (household) +1 more` — exactly as All Transactions does. The full split is one click
  away on Purchases.
- **The card stays narrow.** It shows the child category (`Mobile Phones`), not the full
  `Utilities / Mobile Phones`: the supplier already tells you the rest, and two cards sit side by
  side on a laptop.
- Receipts, the attach control and the struck-through styling on a voided purchase are unchanged.

### Under the bonnet

Turning "this line was for person 3" into "Cara" had quietly grown **four** separate copies of the
same small function, on four different pages. They are now one shared helper
(`src/lib/records/targets.ts`), used by All Transactions, Purchases, Contracts & Renewals and the
supplier card — so the next page that needs it cannot invent a fifth spelling. The refactor changed
no behaviour: the existing 478 tests stayed green across it before anything new was added.

The page also did not need a new database query. It was already loading each purchase's lines and
throwing them away; it now reads what it had.

## Schema and data

None. No schema change, no migration, no data change. Nothing about the household's records,
settings or backups is touched, and no existing record is rewritten.

## Updating in Unraid

1. **Take a backup first** (Settings → Backup, or your own copy of the appdata directory).
2. In Unraid, **Force Update** the Simple Finance container so it pulls `v0.18.0`.

You should see the version badge read `v0.18.0 · pre-release`. Open **Suppliers**, expand a supplier
you buy from for more than one person, and the Recent purchases list should now say who each one was
for.

## Release notes document

Full decision log: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) decision **161**; spec:
[`SPEC.md`](SPEC.md) §21.4.
