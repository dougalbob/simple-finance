# Handoff: the till fits the phone, and fuel defaults (v0.11.0)

Date: 2026-09-25. Branch: `arena/01a0d807-simple-finance` (from `main` @ `d3ff42e`, the v0.10.0 merge).

**Released as v0.11.0 on 2026-09-25.** Annotated tag `v0.11.0` is on merge commit `625ef62` (PR #47).
Digest `sha256:6f39143d…10077f` is on `v0.11.0` / `latest` / `sha-625ef62`. Details are in
[`docs/RELEASE_NOTES_v0.11.0.md`](RELEASE_NOTES_v0.11.0.md), and the version badge reads
`v0.11.0 · pre-release`. The household does two things in Unraid: back up, then Force Update. After
updating they set **Settings → Household names → Signs in as** for each person.

## What changed (decisions 143–148)

- **No sideways page (143).** The Quick Entry tab strip is a shrinkable `grid-cols-4`, the Move sub-tabs a
  2×2/4 grid, and the headline wraps. The section has `overflow-x: clip`, and on a phone the black card is
  `p-2`. Two home-page `grid` wrappers gained `grid-cols-1`: their implicit `auto` tracks grew to the widest
  input.
- **Explicit card switching (143).** The native scroll-snap container is gone. The track moves by
  `translateX` inside a clipped viewport with `touch-action: pan-y`. It switches on Next, the dots, or a
  touch swipe of ≥50px that is ≥1.5× more sideways than down. The hidden card is `inert`, and `lg:` keeps
  two static columns (`useWideLayout`). `data-active-panel` on `[data-panel-track]` is the spec hook.
- **Next instead of Save on card 1 (144).** Save is only on card 2. Enter on card 1 is intercepted
  (Supplier → Amount, else Next). `canSave` is now `saveBlocked`.
- **Card 2 order and chips (145).** Category → For → lines → "+ Add split" → Paid by (`ChipGroup`) → Date →
  Save. `ChipGroup` = radios as pills in a `radiogroup`. `ChipSelect` is renamed `SelectField` (the pot
  stays a select). The Fuel supplier uses `SupplierTypeahead` over `QuickEntryData.fuelSuppliers`
  (`listFuelSupplierIds`).
- **Signed-in defaults (146).** Migration `0010_people_email` adds `people.email` (nullable, unique).
  Settings has a per-person "Signs in as" select (`signInEmailChoices`, `setPersonEmail`, audit
  `person.email`), and vehicle cards show their Owner. `buildEntryData(db, now, user.email)` uses the pure
  `entryDefaults`. The Fuel vehicle follows Paid by until a vehicle is tapped.
- **Full tank off by default (147)** and the Insights nudge `fillsWithoutFullTank` (≥3 fills with none
  full).
- **Docs:** SPEC §15.1 (rewritten), §15.2 Settings row, §16.6; decisions 143–148; v0.11.0 in all five places.

## Watch out for (learned this session)

- **Emulation with default text is not enough.** Android font/display size broke a layout that looked fine
  at 360–412px. Keep testing at 320px and at 360px with `html{font-size:130%}`. Never put `nowrap` on
  anything unbounded, and give grids explicit `grid-cols-1` (not the implicit `auto` track).
- **The hidden till card is `inert`.** Specs must switch cards before acting on the other card's fields
  (`showPanel` in `e2e/home.spec.ts`). Assertions still see off-screen elements; actions do not work on them.
  Desktop projects (1400px) see both columns and need nothing.
- **Swipes in specs** use CDP `Input.dispatchTouchEvent` (the `drag` helper). Scroll the start point to the
  middle of the screen first, or the sticky nav eats the touch.
- **Chips in specs:** click the pill's `<label>` inside `getByRole('radiogroup', { name })`, then assert the
  radio `toBeChecked()` (the `pickChip` helper).
- **Turbopack stale SSR (SANDBOX entry 9)** bit again while taking screenshots: `rm -rf .next` and restart.
- **The Overview page logs a hydration warning** (`<p>` containing a `<details>`/`<form>` at
  `overview/page.tsx:305`). It was there before this release and is out of scope here, but worth fixing
  soon.

## Test state

`npm test`: all green (new `tests/entry-defaults.test.ts`; the fuel-economy nudge test; restore counts
eleven migrations). `format:check`, `tsc --noEmit` and `build` are clean. Local Playwright (SANDBOX entry
8): all 58 tests passed across every project. The swipe test failed once in the first full run (the start
point was under the sticky nav). It was fixed, and the mobile project then passed twice in a row. CI's
`browser` job is the gate.

## Open / deferred

- **The household's real phone is the final check (148).** Ask for the same three views as the before
  screenshots (2026-09-25 10:38 / 10:39 / 10:41).
- UK gallons still assumed. Supplier-level documents are still deferred (OQ10).
- Home page mobile layout beyond the till is still the household's later call.
