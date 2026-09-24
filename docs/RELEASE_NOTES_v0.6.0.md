# Simple Finance v0.6.0

**Release date:** 2026-09-24
**Published:** pending — this block is completed at release (merge commit, tag, publish run, digest).
**Type:** feature release — **projected day-to-day spending becomes episodic** (the anchor-reset model,
SPEC §7.3 rewritten, decisions 118–119). Weekly shops and per-vehicle fills are projected as dated events
from when the household last recorded them, instead of a pro-rata allowance charged up front.
**No migration, no backup-format change.**
**Previous published image:** v0.5.0. Do not rewrite `docs/RELEASE_NOTES_v0.5.0.md` and do not retag
v0.5.0.

## What to do in Unraid

1. Docker → the Simple Finance container → **Force Update**. No schema change this time; a backup first
   (Settings → Backup & restore) is still the right habit before any update.
2. Start it and confirm the version badge in the navigation reads **v0.6.0 · pre-release**.

## What changed

**Day-to-day spending is now projected as dated events, anchored on what actually happened.** The
household's real world: the weekly shop happens on one day and not again until the next, and a £55 fill
resets the car's fuel clock for the month. The old smoothing never knew that — it charged a pro-rated
allowance across every window (pessimistically, all on day zero), so a recorded fill was counted twice for
its entire cooldown window, and every lowest point with day-to-day included read "today".

- **The weekly shop**: one projected event every **7 days**, amount = the configured figure in Settings.
  Anchor: the most recent purchase with a `Groceries > Weekly Shop` line. Top-up shops deliberately do
  not reset the week.
- **Each vehicle's fill**: one projected event every **30 days**, amount = the configured figure. Anchor:
  the most recent `Vehicle Running > Fuel` purchase line targeted at that vehicle — filling one car never
  resets the other's clock.
- **No history, or overdue** (no shop for more than a week): the next event is projected **tomorrow**, a
  deliberately pessimistic default. Voided or refunded purchases never anchor.
- **The knock-on everywhere**: fill up £55 on the 29th and the horizon carries **no** projected fuel for
  that car for the next 30 days — the double-count is gone. And the **lowest point's date is meaningful
  again**: it lands on a shop day, a fill day or a commitment day, not always "today".

**Visible surfaces:** the payday projection panel and the Horizon page each list the dated shops and
fills they are counting ("Projected shops and fills" / "Projected day-to-day spending"), and both
day-by-day tables gain a day-to-day column when it applies. The figures Settings asks for are unchanged
("the weekly shop, a typical fill"), only their meaning is sharper. The same pure engine drives both
read models — commitments, receipts and the new events share one arithmetic, so the payday panel and the
horizon can never disagree on shared days.

**SPEC** §7.2/§7.3/§7.6 and worked example E8 are amended end-to-end (E8's low is now −£571.26 on the
25th — the cycle's last weekly shop, just before salary), with the decision log recording the rules in
decisions **118–119**.

## Tests

- `npm test` — **323 tests across 81 suites** (was 311/80). New `tests/day-to-day.test.ts` (10) pins the
  anchor rules against the real ledger: weekly-shop resets, top-ups ignored, overdue ⇒ tomorrow,
  per-vehicle fuel clocks, voided purchases are no anchor, window edges, and an end-to-end "fresh fill
  pushes the horizon's projected fuel out by a month". `tests/projection.test.ts` and
  `tests/money-view.test.ts` carry the reworked E8 to the penny; `tests/horizon.test.ts` now reproduces
  the window arithmetic with anchored shops and fills.
- The whole browser acceptance job runs in CI's `browser` job, which the agent sandbox cannot run (no
  browser there — `docs/SANDBOX.md` entry 2); the Horizon project gains assertions for the projected
  day-to-day block.
- `npm run format:check`, `npm run typecheck`, `npm run build` and `npm audit --omit=dev` all clean.

## Version badge

Navigation should read **v0.6.0 · pre-release**.

## Release notes doc

This file: [`docs/RELEASE_NOTES_v0.6.0.md`](RELEASE_NOTES_v0.6.0.md).
