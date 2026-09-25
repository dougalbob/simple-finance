# Handoff: Colour tokens — Phase 2 of 2 (add the first theme)

Date: 2026-09-25. Branch: `arena/01a0da84-simple-finance` (from `main` @ `b364f18`, the v0.15.0 merge).

**Phase 1 is done.** The whole colour scheme now lives in one Tailwind v4 `@theme static` block in
`src/app/globals.css` (decision **159**, SPEC **§15.4**). The 35 `.tsx` files and the chart kit use
token names only; no palette class or colour literal remains in `src` outside the PWA `themeColor`
(`layout.tsx`). Rendering is **pixel-identical**: 39 screenshots (13 pages × 320/412/1400) of `main`'s
`src` vs the tokenised `src`, on the same seeded data, differ by **0 pixels** (only the elapsed-time
caption was normalised — see "Watch out for"). Gates at Phase-1 close: `npm test` **466** green
(461 + the new `tests/colour-tokens.test.ts` grep-gate), `tsc`, `format:check`, `next build` and the
full Playwright suite **71** green (SANDBOX entry 8).

## The household's requirement (recorded as decision 159 — it was never in the spec before)

> The colour scheme must be arranged so that **adding a new theme is a small, single-place change —
> not an app-wide edit in every page**.

Phase 1 wrote it down (SPEC §15.4 + decision 159) and built the precondition. **Phase 2 (this session)
is the proof**: ship one theme — a block that re-declares the same `--color-*` names under a selector,
e.g. `<html data-theme="dark">` — and a Settings toggle. Nothing else may change.

## What a theme touches (and only this)

- **One block.** Re-declare whichever of the existing `--color-*` tokens change, under the theme
  selector. Semantic names (`canvas`, `surface`, `ink`, `border`, `till`, `accent`, `positive`,
  `warning`, `danger`, `negative`, `note`, `chart-…`) are all in `globals.css` — read decision 159's
  table for what each maps to. Do **not** add new palette classes to pages; the grep-gate will fail.
- **The till stays legible.** `--color-till`/`--color-till-ink` is the by-design-dark surface and its
  ink, shared today by the till, the primary buttons and the active dark pills. A dark theme will want
  to split or invert it — do that **in the token block**, not in the pages. `ink-ghost` (slate-300) is
  used both on the till (quick-entry ×3) and once on a white card (supplier-card.tsx:349); if the two
  need to diverge, split into a `till-ink-soft` token (four sites).
- **Contrast rules stand.** "Colour is never the only signal" (§16.7) and the void-button legibility
  e2e (`e2e/desktop.spec.ts`, asserts the danger label inverts correctly) must stay green.

## Open Phase-2 decisions (record whichever you choose)

1. **Apply before first paint.** To avoid a flash of the wrong theme, set `<html data-theme>` before
   paint. SSR has no DOM, so you need the choice in a cookie that the layout reads server-side (an
   inline `<head>` script that reads the cookie works for the pre-hydration paint). Decide and record
   cookie-vs-inline-script.
2. **Settings toggle.** Add a key/value setting (audited, like the others in `settings.ts`) e.g.
   `theme`. Wire a toggle in `settings-forms.tsx` + a server action in `actions.ts`.
3. **PWA chrome.** `themeColor`/manifest are read before any stylesheet, so they cannot be a variable.
   Either add the `media` form of `themeColor` for dark, or accept the light chrome; document the
   choice (SPEC §15.4 already flags it).

## Watch out for (carried forward)

- **Screenshot determinism (learned this session).** The seed's captions tick with wall-clock time
  ("just now" → "3 minutes ago") and are the *only* thing that differs between two runs of an
  unchanged tree. To pixel-compare, re-seed and normalise those captions (`just now` / `N units ago`)
  before the shot; then a diff means a real change. With that, main-vs-tokens was 0 px.
- **`@theme static` is load-bearing.** The chart kit references `var(--color-chart-…)` from TSX inline
  styles, which Tailwind's scanner does not see; `static` keeps those variables from being
  tree-shaken. Don't "tidy" it away.
- **`@source not` excludes prose from Tailwind's scan.** The scanner reads markdown and comments; the
  mapping tables in decision 159 would otherwise generate palette utilities. Keep the directive.
- **Tailwind resolves competing colour utilities by stylesheet order**, not class-attribute order
  (the void button). `.text-till-ink` is emitted after `.text-danger` — verified again post-tokenise;
  the e2e guards it.
- SANDBOX entries 8 (local browser), 9 (stale `next dev` SSR), 13 (GitHub connector drops),
  14 (Turbopack rejects a symlinked `node_modules`).
- `next build` flips `next-env.d.ts` — restore before committing. Don't bump the version while
  Playwright is running (backup spec reads `APP_VERSION`).

---

> Provenance: the Phase-1 brief from the household (2026-09-25) could not be pushed by the previous
> session; it was reproduced in `arena/01a0da84-simple-finance`, executed as Phase 1, and its
> requirement recorded as **decision 159** / SPEC **§15.4**. The v0.15.0 handoff that Phase 1 was
> written against follows below, unchanged.

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
