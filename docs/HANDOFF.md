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
- **Decisions 124–130** in `docs/IMPLEMENTATION_PLAN.md`; **v0.9.0** in the four version places.

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

## Test state

`npm test` — **357 tests, all green, 90 suites** (was 340/85). `npm run format:check`, `npx tsc --noEmit`
and `npm run build` are clean. Playwright cannot run in this sandbox (`docs/SANDBOX.md` entry 2) — CI's
`browser` job is the proof. The new/changed specs: `e2e/home.spec.ts` (four new mobile specs plus the
label/heading updates), `e2e/settings.spec.ts` (default pot moves the till form, then clears), and the
`.first()` fixes elsewhere.

## Open / deferred (not forgotten)

- **The swipe physics themselves are only proven by CI.** No browser exists in the sandbox, so the
  scroll-snap behaviour, the dots and the above-the-fold layout on a real phone are CI's evidence plus the
  household's own eyes. If the panels feel wrong, the CSS is one class list to change.
- **Dot indicators** shipped (the handoff's open decision): two dots plus a hint line, mobile only.
- **"Add another" resets to Panel 1 and focuses the supplier** — implemented as probably-yes.
- **Home page mobile layout is still untouched** (the money section, projection, due-this-week, schedules,
  pots, recent entries all as they were) — the household decides later what to hide on a phone.
- **The Cloudflare Access app** still wants its PWA paths intact (v0.8.0 note); nothing here changes that.
