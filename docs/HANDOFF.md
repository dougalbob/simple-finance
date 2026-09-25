# Handoff: Horizon opens the day before payday, and the date applies itself (v0.13.0)

Date: 2026-09-25. Branch: `arena/01a0d8b1-simple-finance` (from `main` @ `7a2a3a4`, the v0.12.1 merge).

**Released as v0.13.0 on 2026-09-25.** Annotated tag `v0.13.0` is on merge commit `8fcc65b` (PR #54).
Digest `sha256:5264c114…084df0` is on `v0.13.0` / `latest` / `sha-8fcc65b`. Details are in
[`docs/RELEASE_NOTES_v0.13.0.md`](RELEASE_NOTES_v0.13.0.md), and the version badge reads
`v0.13.0 · pre-release`. The household does two things in Unraid: back up, then Force Update.

## What changed (decision 150)

- **Default date = the day before the next scheduled income.** The household said "income" means the
  **salary**, so only **receipt schedules** count. A debt's expected support never sets the default, even when
  it lands first. The payday window (§7.2) and the till figure (§7.7) still count it, on purpose, and a test
  pins the difference. New pure resolver **`src/lib/records/horizon-default.ts`** (`resolveHorizonThrough`);
  new export **`nextScheduledIncomeDate`** in `money-view.ts`, which shares one query with the private
  `nextExpectedIncome`. The clamp: income tomorrow ⇒ tomorrow; beyond 400 days ⇒ today + 400; no scheduled
  income ⇒ today + 35; a valid in-range `?through=` wins unchanged. The default also applies alongside other
  params (`?daytoday=0` alone still gets it).
- **A date change applies the look-ahead.** Form order is pots → Day-to-day → date → button. The client island
  **`src/components/horizon-look-ahead-form.tsx`** keeps the plain `GET /horizon` form and runs
  `requestSubmit()` on the date's `change`. It does not submit when the field is empty or invalid. Pots and
  Day-to-day do not apply on their own; the button handles those, and it is the whole path without
  JavaScript. `data-horizon-ready` marks hydration. The form dims while navigating, and a bfcache restore
  un-dims it.
- **Specs:** `tests/horizon-default.test.ts` (12). `e2e/horizon.spec.ts` now has 9 specs. The default-date
  spec reads the Income page's "Next payday" (same definition) instead of re-deriving dates. The
  seeded-scope spec now names `?through=+35` because the default window can be only a day or two long.

## Watch out for (learned this session)

- **The income project moves the seeded salary** (weekend probe) and adds a Car allowance on the 15th, so by
  the time horizon runs the "next payday" is not the 27th. Never hard-code it; read it from `/income`.
- **Date-input `fill()` now navigates.** Wait for `form[data-horizon-ready="true"]` first, or the change
  fires before hydration and nothing happens. Then assert the URL; do not click the button afterwards.
- A one-off spec file needs `horizon` in its name to be picked up by the `horizon` project's `testMatch`.

## Test state

`npm test`: 416 tests / 103 suites green. `format:check`, `tsc --noEmit` and `next build` are clean. Local
Playwright (SANDBOX entry 8 recipe, `playwright.local.config.ts` added to `.git/info/exclude`): **62 tests
green** (58 + 4 new horizon specs). CI's `browser` job is the gate.

## Open / deferred

- **Empty pot selection = every pot** is kept and now stated under the checkboxes. Asked the household
  whether "untick all" should mean *none* instead (needs a marker param, a §7.6 wording change and a spec).

- **The household's real phone is still the final check (148).** Ask for the same three views as the before
  screenshots (2026-09-25 10:38 / 10:39 / 10:41).
- **The Overview page logs a hydration warning** (`<p>` containing a `<details>`/`<form>` at
  `overview/page.tsx:305`) — carried over from v0.11.0, still out of scope, still worth fixing.
- UK gallons still assumed. Supplier-level documents are still deferred (OQ10).
- Home page mobile layout beyond the till is still the household's later call.
