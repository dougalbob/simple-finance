# Handoff: Colour tokens (Phase 1 of 2) — themes made cheap

**Start from `main`.** Work on your own Arena session branch; no release until the household asks.

## The ask (household, 2026-09-25)

The colour scheme must be arranged so that **adding a new theme is a small, single-place change —
not an app-wide edit in every page**. Split across two sessions:

1. **This session (Phase 1):** tokenise the existing single scheme. **Zero visual change.** No new theme.
2. **Next session (Phase 2):** first extra theme (probably dark) + Settings toggle, as the proof
   that a theme is one token block and nothing else.

**Provenance — record it this time:** the requirement is NOT in SPEC.md or AGENT_APP_BLUEPRINT.md
(searched 2026-09-25; only PWA `theme_color` metadata and the "colour is never the only signal"
rules exist). Phase 1 writes it down: **decision 159** — _colour lives in one token block; a theme
only redefines tokens_ — plus a short Appearance paragraph in SPEC §15.

## Current state (measured 2026-09-25)

- `globals.css`: no design tokens — just `@import 'tailwindcss'` + the `.till-touch` rule (decision
  136, do not disturb).
- **1,107** palette utility classes across **35** `.tsx` files (top: `text-slate-500` ×226,
  `text-slate-600` ×165, `border-slate-200` ×89).
- Hex literals in three places: `layout.tsx` (`#0f172a`), `public/manifest.webmanifest`, and
  `charts/chart-primitives.tsx` (**11 chart-palette hexes**).
- Zero `dark:` variants. The till is dark **by design** (`bg-slate-900 text-white`) — becomes the
  token pair `--color-till` / `--color-till-ink`.

## Session A (Phase 1) — scope

Definition of done: **pixel-identical rendering, all gates green, colours in one place, no palette
literals left in components.**

1. Tailwind v4 `@theme` token layer in `globals.css` (canvas, surface, surface-muted, border,
   border-strong, ink, ink-soft, ink-muted, accent, till, till-ink, positive, warning, danger,
   chart-1…n) — keep today's distinctions distinct (slate-500 ≠ slate-600).
2. Mechanical 1:1 migration of the 35 files through a **fixed mapping table**, recorded in
   decision 159. Acceptance = no rendering change, not naming purity.
3. Chart hexes → `var(--color-chart-…)` (CSS vars work in SVG). All SPEC §16.7 colour rules
   survive: colour never the only signal, legend + table twin.
4. `themeColor` + manifest keep single literals with comments (CSS vars can't reach them);
   document the limitation for Phase 2.
5. Recommended: a unit-test "grep gate" that fails on raw palette classes/hexes outside a small
   allowlist, so pages can't reintroduce app-wide colour.
6. Docs: decision 159, SPEC Appearance paragraph, rewrite this handoff for Phase 2.

**Out of scope (session B):** second theme, `[data-theme]`, Settings toggle, `dark:` variants,
`prefers-color-scheme`. Phase 1 is done when the app looks exactly as before.

**Gates:** format, tsc, npm test (461), next build, full Playwright (71) via SANDBOX entry 8;
before/after screenshots at 320px / 412px / 1400px compared — look at the pictures, charts
especially.

## Session B (Phase 2) — the session after

- One theme block redefining the same `--color-*` names — nothing else changes.
- Settings toggle (key/value table, audited), applied via `<html data-theme>` before first paint
  (inline script; SSR needs a cookie — decide and record).
- e2e: switch theme, assert a computed colour changed, till + chart specs still green; PWA
  themeColor story documented.

## Watch out for (carried forward)

- SANDBOX entries 8 (local browser), 9 (stale `next dev` SSR), 13 (GitHub connector drops).
- `next build` flips `next-env.d.ts` — restore before committing. Commit the AGENTS.md
  Next.js-rules block `next dev` re-adds.
- Don't bump the version while Playwright is running (backup spec reads `APP_VERSION`).

---

> **Received in-session 2026-09-25** (session `arena/01a0da84-simple-finance`): the brief above is
> reproduced verbatim from the household's message — the previous session could not push it. The
> v0.15.0 handoff it was written against follows below, unchanged.
>
> **Re-measured in this session, before any edit** (same day, same tree @ `b364f18`): **1,315** palette
> utility occurrences (the brief's 1,107 under-counts because it excludes `bg-white`/`text-white` and
> variant-prefixed spellings such as `hover:bg-slate-50`) across **95 distinct class spellings** in the
> same **35 `.tsx` files**; `chart-primitives.tsx` carries **10 distinct hexes + `#ffffff`** in
> `CHART_COLOURS` plus two `rgba()` tints, and `step-area-chart.tsx` repeats the `#ffffff` halo. Also
> present and missed by the brief: `bg-indigo-700` / `border-indigo-200` on the supplier card.

---

# Handoff: Charts — the money, drawn (v0.14.0)

Date: 2026-09-25. Branch: `arena/01a0d991-simple-finance` (from `main` @ `c50cfa7`, the v0.13.1 merge).

**Released as v0.14.0 on 2026-09-25.** Release facts (merge commit, tag, digest) are stamped in
[`docs/RELEASE_NOTES_v0.14.0.md`](RELEASE_NOTES_v0.14.0.md); the version badge reads
`v0.14.0 · pre-release`. The household does two things in Unraid: back up, then Force Update.

**Released as v0.15.0 on 2026-09-25** (decision 158; badge reads `v0.15.0 · pre-release`). On a phone
the home page now **opens at the till** — a mount-time `scrollIntoView` in `QuickEntry`
(`openAtTillOnMobile`, home page only), anchored by `#quick-entry` / `scroll-mt-16`, with the mobile
drawer's **Quick Entry (Till)** link carrying `/#quick-entry`. It supersedes decision 151's "the page
does not scroll itself" clause only; nothing takes focus, so 151's keyboard-quiet rule (and its e2e
assertions) still stand. SPEC §15.1 records it, `e2e/home.spec.ts` guards it (fresh open + drawer
path). Release facts (merge commit `439eea4`, digest, tags) are stamped in
[`docs/RELEASE_NOTES_v0.15.0.md`](RELEASE_NOTES_v0.15.0.md); the full Playwright suite was green (71
tests) on the tagged tree.

## What changed (decisions 152–157)

The household asked for data visualisation and answered the three open questions themselves: **hand-rolled
SVG** (no chart library), the page is called **Charts**, and the scope is **all four charts plus the
settings key** in one release.

- **`/charts`** (`src/app/charts/page.tsx`) — four sections, each rendered twice: a 320px figure for a
  phone (`lg:hidden`) and a 720px one for a laptop (`hidden lg:block`). Linked from the nav between
  Insights and Settings, and from a card on the home page **below** the till.
  - **A. Forecast** — household total, today → one month, from `getHorizonProjectionView(db, +1 month, [],
    true)`. Zero always on the axis; below zero tinted; the overdraft line only when the domain reaches it
    (otherwise a caption sentence, decision 152); lowest point labelled; income days ticked.
  - **B. Groceries** — Mon–Sun weeks (12/26) against the configured figure and the trailing 8-week
    average. An empty week is a zero week; the current week is hatched and never averaged.
  - **C. Personal** — stacked months (6/12) by **"For: person"**; Household is its own segment and is
    never split; scope from the **live** tree (decision 154). Chips are links: `?who=person:3,household`.
  - **D. Fixed commitments** — monthly bars over `commitment_category_ids` (decision 156), with a
    `?scheduleOnly=1` toggle reading `purchases.scheduleInstanceId`.
- **Chart kit** (`src/components/charts/`, decision 155) — `ChartFigure` (verdict sentence, badge, caption,
  table twin), `chart-primitives` (gridlines, sub-zero band, reference lines, band labels), `scale.ts`
  (domain/ticks/geometry), `StepAreaChart`, `BarChart`, `StackedBarChart`. Server components only.
- **Pure resolvers** in `src/lib/records/chart-series.ts` (integer pence, no DB, no framework) with DB
  assembly in `src/lib/records/charts-view.ts`.
- **Settings** — `commitment_category_ids` in the existing key/value table:
  `getCommitmentCategoryIds`/`setCommitmentCategoryIds` in `settings.ts`,
  `saveCommitmentCategoriesAction` in `actions.ts`, `CommitmentCategoriesForm` in `settings-forms.tsx`,
  section `#commitment-categories` on `/settings`. **No schema change, no migration.**
- **`/purchases`** (decision 157) — repeatable `categoryId`, parent→children expansion,
  `targetKind=household`, and a "<Parent> / all children" option in the filter form.

## Watch out for (learned this session)

- **A controlled select before hydration is a silent black hole (proven 2026-09-25).** The merge's
  `browser` job flaked on `desktop.spec.ts`'s vehicle picker: `selectOption` landed before
  `PurchaseFilterForm` hydrated, React state stayed empty and the dependent Target select never
  populated — DOM and state visibly disagreed (a delayed-JS probe reproduces it on demand). The form
  now carries the decision-131 signal (`data-filters-ready` + `inert`), `waitForFilters` lives in
  `e2e/support.ts`, and the spec's fixture name is unique per retry. Any client island with controlled
  inputs needs the same signal before a test drives it — check the next form you touch.
- **`getDbHandle()` compared a raw path with a resolved one.** With a relative `DATA_DIR`/
  `DATABASE_PATH` the identity check never matched, so every call closed and reopened the handle and
  `/settings` (the only double caller) 500'd mid-render with "The database connection is not open".
  Fixed in the v0.14.0 stamp (`path.resolve` on both sides · `tests/db-handle.test.ts`) — but still
  start the dev preview with absolute paths (`DATA_DIR=$PWD/…`). SANDBOX entry 12.
- **The Arena GitHub connector drops mid-session.** Reconnect windows (batch the remote work, toggle on
  request, verify, report completed steps on any 401) are now standard practice for every release —
  read SANDBOX entry 13 before touching GitHub in a release session.

- **The screenshots found what the assertions could not.** Headless Chromium (SANDBOX entry 8) rendered
  `/charts` at 1400px and 320px, and reading the PNGs back caught two real defects no locator would have:
  the groceries reference labels printed on top of each other (fixed by alternating start/end and a white
  `paintOrder` halo), and the forecast legend named an overdraft line that was off the chart (fixed by
  drawing the legend entry only when the domain reaches the limit). Look at the picture before shipping a
  picture.
- **A second `next dev` in the same directory exits 1** with "Another next dev server is already running"
  after printing `✓ Ready` — Next 16 guards the project directory, not the port. SANDBOX entry 12.
- **A throwaway database is the cheapest way to see a state the seed cannot produce.** `cp -r .e2e-data
  /tmp/low-data`, add a checkpoint and a fat schedule with the repo's own domain functions, point one dev
  server at it — that is how the below-zero forecast (tint, overdraft line, "£1,831.27 below zero"
  headline) was verified in a browser without touching the seeded specs.
- **The e2e seed now carries history** (about six months of weekly shops, a year of discretionary spending
  and monthly bills). Every row is dated **≥ 10 days before today** and the new supplier names avoid
  `corner` and `insurer`, which `e2e/home.spec.ts:410-413` matches on. Keep both rules if you extend it.
- **Don't bump the version while the Playwright suite is running** — the backup spec derives its filename
  regex from `APP_VERSION` (unchanged advice from v0.13.1).
- `next build` still flips `next-env.d.ts`; `git checkout -- next-env.d.ts` before committing.

## Test state

`npm test`: **459 tests / 111 suites green** (43 new). The v0.14.0 stamp adds `tests/db-handle.test.ts`
(the `getDbHandle` identity check with a relative path) and `waitForFilters` in `e2e/support.ts` —
**461 tests / 112 suites** green after it, Playwright still **70 tests green** with the hardened filter
form. `format:check`, `tsc --noEmit`, `next build` and
`npm audit --omit=dev` clean. Local Playwright (SANDBOX entry 8 recipe, `playwright.local.config.ts`,
git-excluded): **70 tests green** across every project, including the new `charts` project (7 specs). CI's
`browser` job is the gate and went green on the PR and on the `main` merge commit.

## Open / deferred

- **Printing or exporting a chart** was explicitly out of scope this session, as were email/alert channels,
  bank feeds and card-level merchant data. Ask before adding any of them.
- **The tracked-commitment list can go stale**: a category the household adds later is not tracked until
  someone ticks it. A future session could nudge with "your schedules now use categories this chart does not
  track" — the data for it is already there (`scheduleCommitmentCategoryIds` vs the saved set).
- **Empty pot selection = every pot** on Horizon is kept and stated under the checkboxes. Still waiting on
  whether "untick all" should mean *none* (marker param + §7.6 wording + spec).
- **The household's real phone is still the final check (decision 148).** After they Force Update, ask them
  to open `/charts` on the phone: four charts, no sideways pan, and "Show the numbers" agreeing with each
  drawing.
- Overview hydration warning (`<p>` wrapping `<details>`/`<form>` at `overview/page.tsx:305`) — still out of
  scope.
- UK gallons; supplier-level documents (OQ10); home-page mobile layout beyond the till.
