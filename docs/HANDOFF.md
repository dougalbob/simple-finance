# Handoff — Episodic day-to-day projection (v0.6.0)

Date: 2026-09-24. Branch: `arena/01a0d31b-simple-finance` (from `main` @ `7b9fb0f`, post-v0.5.0 and its
notes-completion PR #35).

**This session re-grounds projected day-to-day spending in reality (SPEC §7.3 rewritten, decisions
118–119).** It grew out of two household bug reports on the v0.5.0 Horizon page, both traced to the same
root: day-to-day was a pro-rated allowance charged up front, so (a) a recorded £55 fill was double-counted
for its whole cooldown window — once in the estimate, once in the smoothed allowance — and (b) every
lowest point with "Include groceries & fuel" read "today", the up-front lump's artifact. Both reports were
answered with evidence first, then the household approved the spec-level fix. Read
[`docs/SPEC.md`](SPEC.md) §7.2, §7.3, §7.6 and §17 E8 (all amended), and
[`docs/IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) decisions **118–119**.

## What changed

- **Anchor-reset model** — each configured figure (Settings → Projection figures) is now the amount of a
  repeating **projected event**, whose next date comes from the ledger: groceries every **7 days** from the
  last `Groceries > Weekly Shop` line; fuel every **30 days per vehicle** from the last
  `Vehicle Running > Fuel` line targeted at that vehicle. No history or overdue ⇒ next event **tomorrow**
  (pessimism). Top-ups never reset the week; one car's fill never resets the other; voided/refunded
  purchases are no anchor; no weekend shifting.
- `src/lib/records/day-to-day.ts` **(new)** — `lastWeeklyShopDate`, `lastFuelDatesByVehicle`,
  `projectDayToDayEvents`, `splitDayToDayEvents`. Pure queries + date arithmetic, no writes.
- `src/lib/records/projection.ts` — the engine takes `projectedGroceries` / `projectedFuel` event lists
  (was `weeklyGroceriesPence` / `monthlyFuelPence`) and applies each event on its due day **like any other
  outgoing, before the day's receipts**. No up-front lump; `base = availableNowPence`. `ProjectionDay`
  gains `dayToDayPence`. `landPenceOf` and the hand identity (`available + receipts − commitments −
  day-to-day`) still hold on the final day.
- `src/lib/records/money-view.ts` — both read models build events via `projectDayToDayEvents` and expose
  `dayToDayEvents` for display. The horizon passes no events when day-to-day is toggled off ("Bills only"
  unchanged). `getConfiguredDayToDay` and `periodProjectionPence` are gone (the pro-rata helper had no
  remaining caller).
- UI — `projection-panel.tsx` lists "Projected shops and fills" and gains a day-to-day column in the
  day-by-day table; `horizon/page.tsx` gains the "Projected day-to-day spending" details block (same
  60-day open rule), the same table column, and the scope card shows the day-to-day total; Settings copy
  explains the figures are the size of one shop/fill and when each next event is projected from.
- **E8 reworked end-to-end** (SPEC §17): anchors E1's Tesco run (27th) + fills on the 12th (A) and 8th
  (B); day-to-day £360 groceries + £135 fuel = £495; low **−£571.26 on the 25th** (the cycle's last shop),
  tier warning, pot watch unchanged −£666.08. `tests/projection.test.ts`, `tests/money-view.test.ts` and
  `tests/horizon.test.ts` all carry the new arithmetic to the penny.

## Watch out for (learned this session)

- **Do not touch estimates, receipts or insights** — same rule as the income session. The anchor queries
  read purchases/allocations only (positive, non-voided allocations; vehicle-targeted for fuel). Insights'
  honesty loop and `roundHalfUpDivide` are untouched.
- The events are **household-level**: pot scoping on the horizon must not filter them (same treatment the
  configured figures had), and the §7.5 pot watch still excludes them — engine callers build potWatches
  from commitments only.
- Within a day, projected events apply **before receipts** — a shop due on payday clears before the salary,
  exactly like a DD (pinned in `tests/projection.test.ts`).
- The horizon e2e seed (`scripts/e2e-server.mts`) records a Weekly Shop purchase ~3h before "now" and a
  Vehicle A fuel line, so `/horizon` has real anchors in CI; vehicle B falls back to tomorrow-cadence.

## Test state

`npm test` — **323 tests, all green, 81 suites** (was 311/80). New `tests/day-to-day.test.ts` (10) covers
the anchor rules end to end. `npm run format:check`, `npx tsc --noEmit` clean. Playwright cannot run in
this sandbox (`docs/SANDBOX.md` entry 2) — CI's `browser` job is the proof for the horizon additions.

## Open / deferred (not forgotten)

- **Bank holidays** remain unhandled (decision 112; support-payment expectation unaffected).
- Cadence learning (deriving the 3-week rhythm from observed fill gaps instead of the fixed 7/30-day
  cadences) is a deliberate non-goal for now — discussed and deferred at design time; the fixed cadence is
  the explainable rule, and the honesty loop keeps drift visible.
- A token-small purchase categorised as Weekly Shop still resets the week (any amount counts, by design —
  record top-ups as Top-up Shops). If that becomes untidy in practice, a threshold is a fresh decision.
- **Running balance** on All Transactions is still deferred (SPEC §15.3); **income analysis** stays out
  (decision 103).
