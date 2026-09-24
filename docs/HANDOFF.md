# Handoff — the phone-first till form and the "before income lands" figure (v0.9.0)

Date: 2026-09-24. Branch: `arena/01a0d55f-simple-finance` (from `main` @ `2255607`, post-v0.8.0 and its
release).

**This session redesigned the mobile Quick Entry experience and added the second balance figure the
household asked for.** The household's question was: a "free to spend" figure based only on the last
checkpoint is dangerous — standing in Tesco with £500 showing and a £600 mortgage leaving three days before
payday tells you nothing about the bounce. Agreed answer (decisions 124–126): show **two** facts, the last
reported checkpoint (with its age) **and** what is left before income lands, the latter counting **no
incoming money at all**. New SPEC §7.7.

## What changed

- **SPEC §7.7 (new)** — "What is left before income lands (the till figure)":
  `free_to_spend = household_available_now − commitments due in (today, next income] − projected day-to-day
  events in the same window`; per pot it is §7.5's pot watch with that window. §15.1 rewritten for the till
  redesign; §15.2's Settings row gained the default pot.
- **`src/lib/records/money-view.ts`** — `getCycleOutlook(db, now, snapshot?)` (+ `CycleOutlook`,
  `CycleOutlookPot`) and two extracted helpers the projection panel now shares, so the panel and the till
  read the window through one code path: `nextExpectedIncome` (the §7.2 payday selection) and
  `windowLines` (commitments/receipts inside a window). `getProjectionView` behaviour is unchanged —
  340 tests stayed green through the refactor.
- **`src/lib/records/entry-view.ts`** — `buildEntryData` puts the reported checkpoint (amount, age,
  absolute time — rendered server-side so hydration cannot disagree), the estimate, the pot's
  `spendablePence`/`shortfallPence`/`dueBeforeIncome`, and the household `cycle` outlook into
  `QuickEntryData`.
- **`src/lib/records/settings.ts`** — `default_purchase_pot_id` with `getDefaultPurchasePotId` /
  `setDefaultPurchasePotId` (validated against live pots; audited like every other setting).
- **`src/lib/records/quick-entry.ts`** — the typeahead's pure half: `normalizeSupplierQuery`,
  `rankSupplierMatches`, `nearestSupplierName` (+ the moved `editDistance`).
- **`src/lib/time.ts`** — `formatShortLocalDate` ('2026-09-30' → "Wed 30 Sept").
- **`src/components/quick-entry.tsx`** — the purchase form rebuilt (see the decisions 127–130 list): pot
  first, both balance figures, inline supplier typeahead, swipe panels with Save on both, focus order
  supplier → amount → save, "Line 1 amount" label only when there is more than one line, note behind
  "+ Note", "Add another" resets to panel 1 on the supplier field. Fuel and Balance forms moved onto light
  cards (**they were dark-on-dark before** — see below), and every input/button is ≥44px tall.
- **`src/components/pot-outlook.tsx` (new)** — the shared "before income lands" lines for the home page pot
  cards and the Overview mini-balances.
- **`src/app/settings/page.tsx` + `settings-forms.tsx` + `actions.ts`** — a "Quick entry" section with the
  **Default pot for purchases** dropdown and `saveDefaultPurchasePotAction`.
- **`scripts/e2e-server.mts`** — the fictional seed now sets a default pot, so the specs prove the form
  honours it.
- **Tests** — `tests/cycle-outlook.test.ts` (6 tests, including the "the till figure equals the projection
  panel's low" cross-check), typeahead ranking in `tests/quick-entry.test.ts`, the setting in
  `tests/settings-domain.test.ts`, `formatShortLocalDate` in `tests/time.test.ts`; Playwright: four new
  mobile specs in `e2e/home.spec.ts`, a new settings spec, and `.first()` on the now-duplicated Save button
  in `home`/`desktop`/`attachments`/`backup`.
- **Decisions 124–133** in `docs/IMPLEMENTATION_PLAN.md`; **v0.9.0** in all five version places (code,
  lockfile, badge, Unraid template, release notes).
- **`e2e/support.ts` (new)** — `waitForTill(page)`: every spec that drives the till waits for
  `[data-till-ready="true"]` first (25 call sites). See the watch-outs below.

## Watch out for (learned this session)

- **The two figures must not be conflated.** `free_to_spend` counts **no** income; the projection panel's
  `projected_low` counts the income but lands on the same dip when nothing else arrives in the window.
  `tests/cycle-outlook.test.ts` pins that equality — if a future change makes the till figure disagree with
  the panel, that test is the tripwire, not a coincidence.
- **Null is not zero.** No income schedule → no window → `freeToSpendPence`/`spendablePence` are `null` and
  the UI says what is missing. Do not "fix" this by defaulting to the available-now figure; that is the
  bug the household reported.
- **The Quick Entry panel used to be dark-on-dark.** `PurchaseForm`/`FuelForm`/`BalanceForm` set
  `text-slate-900`/`text-slate-800` labels while sitting on `bg-slate-900`, so the field labels were
  effectively invisible. Every panel is a white card now. If you add a form to Quick Entry, put it on a
  light card.
- **Save is deliberately duplicated** (one button per swipe panel), so Playwright locators need `.first()`
  — `getByRole('button', { name: 'Save purchase' })` alone is a strict-mode violation. The status/duplicate
  message is rendered once, outside the panels, for the same reason.
- **The accessible name of the mirrored amount is still "Line 1 amount"** (`aria-label`), even though the
  visible label hides the "Line 1" when only one line exists. That is intentional: the e2e
  specs and screen readers keep working while the visible panel stays quiet.
- **Scroll-snap is enhancement only.** Panel 2 is reachable by tab and by keyboard; Playwright's `fill()`
  scrolls the container itself, so specs may hop panels without asserting it.
- **The till must be hydrated before a spec touches it, and it now says so.** The form renders
  `data-till-ready="false"`, flips it to `true` on mount, and the tab strip and forms are `inert` until
  then. Locator *actions* do not auto-wait for hydration (assertions do), which is what cost four `browser`
  job failures: a tab tap that switched nothing, a keystroke wiped by the hydration render, and a save that
  reached the server with an empty amount (`Invalid input: expected number, received null`). If you add a
  spec that records anything from Quick Entry, call `waitForTill(page)` after `page.goto('/')`.
- **A purchase must name a pot.** With the default cleared there is no preselected pot, Save stays off and
  the panel says why; the server refuses a pot-less purchase. Spec order matters here: the `settings`
  project ends by clearing the default on purpose, so any spec after it that records a purchase selects its
  pot itself (`e2e/backup.spec.ts`).

## Test state

`npm test` — **357 tests, all green, 90 suites** (was 340/85). `npm run format:check`, `npx tsc --noEmit`
and `npm run build` are clean.

**The browser suite now runs in this sandbox too** — 50 tests, every project, green in ~2 minutes
(`docs/SANDBOX.md` entry 8: `@sparticuz/chromium` from the npm registry, its AL2023 libs on
`LD_LIBRARY_PATH`, a throwaway `playwright.local.config.ts` overlay). That is how the four CI failures above
were diagnosed rather than guessed at; entry 2 is now marked as partly superseded. CI's `browser` job is
still the acceptance gate — locally the seed, the Playwright version and the emulated phone are ours, not
the household's.

## Open / deferred (not forgotten)

- **The swipe physics have only been driven by emulation.** The panels, the dots and the scroll-snap
  behaviour pass under Playwright's Pixel 7 profile (locally and in CI) — but a real thumb on a real phone is
  still the household's verdict, and emulation cannot tell us how the keyboard covers the form. If the panels
  feel wrong, the CSS is one class list to change.
- **Dot indicators** shipped (the handoff's open decision): two dots plus a hint line, mobile only.
- **"Add another" resets to Panel 1 and focuses the supplier** — implemented as probably-yes.
- **Home page mobile layout is still untouched** (the money section, projection, due-this-week, schedules,
  pots, recent entries all as they were) — the household decides later what to hide on a phone.
- **The Cloudflare Access app** still wants its PWA paths intact (v0.8.0 note); nothing here changes that.
