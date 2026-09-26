# Handoff: a same-day transfer recorded after a checkpoint now moves the inbound pot

Date: 2026-09-26. Branch: `arena/01a0df10-simple-finance`, from `main` @ `063ff5d` (v0.21.0 merge).

Natwest stayed on its checkpoint (−£443.65) after £1,500 was transferred in from Nationwide the same
day. Nationwide fell, correctly. Overview and Horizon both read the estimate, so both showed the
checkpoint. Expected: **£1,056.35**.

Cause: decision 98 absorbed every date-only credit that shared a checkpoint's date. Transfers are
always date-only (the form date defaults to today), so an inbound leg recorded after the count was
indistinguishable from one already inside it. Decision **165** refines that rule: a same-day credit
counts when `createdAt` is strictly after the checkpoint's `createdAt`. Recorded before the checkpoint,
it is still absorbed — the £180 bug (E13) stays fixed. Same-day debits still always count. No schema
change.

Wired through `recordIsAfterCheckpoint` (`src/lib/records/estimates.ts`) and `getMoneySnapshot`
(`src/lib/records/money-view.ts`), which is what Overview, Horizon and the pot watch all read. SPEC
§7.1, §10.2, §15.3 and E12/E13 updated. The All Transactions footnote and the swap blurb on Accounts
& Pots match the new rule.

## What a future session should know

- Do not go back to "absorb every same-day credit". That is the bug this sitting fixed.
- Do not count a same-day credit whose `createdAt` is missing or not after the checkpoint. That
  reopens E13.
- If the household counted money and *then* recorded the explaining credit, the estimate adds it.
  The correction is another checkpoint, or recording the credit before the count. Say so; don't
  special-case one pot.
- **Published as v0.21.1 on 2026-09-26.** Annotated tag `v0.21.1` points at merge commit `22a9901`
  (PR #75). GHCR `v0.21.1`, `latest` and `sha-22a9901` share
  `sha256:c9ada52917fed04c28ba828c585a92bcf566d7c3103580842f3d4de02077a506`, different from v0.21.0.
  v0.21.0 was not retagged. Unraid Force Update pulls `latest`. Facts are in
  [`RELEASE_NOTES_v0.21.1.md`](RELEASE_NOTES_v0.21.1.md).

---

# Handoff: Overview panels moved onto the pages that own them — v0.21.0

Date: 2026-09-26. Implementation branch: `arena/01a0de74-simple-finance`, starting at `2578acc`
(`main` after v0.20.0; merged as PR #72). Release preparation on
`arena/01a0de9d-simple-finance`, branched from that merge.

**Published as v0.21.0 on 2026-09-26.** Annotated tag `v0.21.0` points to PR #73's merge commit
`4b177a5`; GHCR's `v0.21.0`, `latest` and `sha-4b177a5` tags resolve to
`sha256:dec7f9a26eaa914b33f93e52717867fdf417075899bad6aed98966ff36ceb346`. Full release facts and
Unraid update instructions are in [`RELEASE_NOTES_v0.21.0.md`](RELEASE_NOTES_v0.21.0.md). The panel move
below is the whole release — no product code changed while preparing it.

Decision **164**: one codebase, two homes. Phone `/` is the till home; laptop `/overview` is the
dense dashboard. Duplicates left Overview and the phone dump; transfers now void on Accounts & Pots.

## What landed

- **Transfers:** review list + void + `?transfer=` / `#transfer-{id}` on `/pots` (same pattern as
  `?external=`). All Transactions links to `/pots?transfer=` (`src/lib/records/activity.ts`).
  Record remains Quick Entry → Move → Between pots. No void on All Transactions or Quick Entry.
- **Overview** no longer lists purchases, transfers, add-a-pot, or checkpoints. Money row,
  projection, Quick Entry, due this week, key dates, this month, vehicles stay.
- **Phone `/`:** available now → Quick Entry (till scroll unchanged) → payday projection → due this
  week → links to Charts, Purchases, Horizon. Recurring section, pots dump, recent-purchase table,
  key dates, add-pot and checkpoint cards are gone.
- **Phone drawer:** Daily = Quick Entry · Purchases · Horizon · Charts · Overview · Recurring.
  Everything else is under More. Desktop full bar unchanged. No tab bar.
- **Recurring `lg+`:** calendar left, compact projection figures under it; schedules panel
  height-matches the calendar card with an inner-scrolling list and Add a schedule pinned below;
  renewals under that. Phone stacks unclipped. `#schedule-{id}` scrolls inside the list
  (`ScrollHashIntoView`).

SPEC §15.1 / §15.2 / §15.3 / §23.4 updated where the UI was now wrong.

## Gates

`npm test`: **506 passed** · TypeScript clean · formatting clean · production build clean ·
Playwright: **78 passed** (two new specs: phone home is the till, not a dump; desktop bar still
lists every page). Browser ran using SANDBOX entry 8; the temporary local-browser config was
removed afterwards. Version metadata is v0.21.0. The published merge commit, tags and digest are recorded
in [`RELEASE_NOTES_v0.21.0.md`](RELEASE_NOTES_v0.21.0.md); back up before using Unraid Force Update.

## What a future session should know

1. **Canonical transfer URL is `/pots?transfer={id}#transfer-{id}`.** Mirror `linkedExternal` if
   you change the recent-list cap. Do not put void back on Overview, All Transactions, or Quick Entry.
2. **Purchases is the only purchase review surface** — fuel details and attachments live there (and
   on the supplier card), not on Overview.
3. **Checkpoints are still immutable.** Create on Quick Entry → Balance or Accounts & Pots; history
   is the per-pot timeline on `/pots`.
4. **Phone home is a till, not a dashboard.** Do not CSS-hide leftover laptop panels on `/`; do not
   add a five-tab app bar unless the household later wants it to feel like a bank app.
5. **Recurring laptop height-match** uses `lg:h-0 lg:min-h-full` on the schedules card so the grid
   row is sized by the calendar, then the list `overflow-y-auto`. Phone must not get that clip.
6. **The release is its own sitting** — done for v0.21.0 on `arena/01a0de9d-simple-finance`: five version
   places, notes, tag, registry check, Unraid. Never bolt it onto a product branch.

## Still to walk (one panel at a time) — deferred past v0.21.0

The v0.21.0 release sitting deliberately did **not** walk these; they wait on a later decision.

- Recurring: other panels (renewals copy, add forms) if needed after the layout pass
- Due this week / Key dates (Overview tiles; phone home keeps Due this week)
- This month so far / Vehicles
- Payday projection / Quick entry / Money row (stay; they *are* the two homes)

---

# Handoff: Monthly schedules can skip selected months — v0.20.0

Date: 2026-09-26. Implementation branch: `arena/01a0ddd0-simple-finance`, starting at `db9e020`
(`main` after v0.19.0 and its documentation merge).

**Published as v0.20.0 on 2026-09-26.** Annotated tag `v0.20.0` points to PR #70's merge commit
`2d4cb81`; GHCR's `v0.20.0`, `latest` and `sha-2d4cb81` tags resolve to
`sha256:1e0db60a775f85958342420926b327994bf90cd58d7564b85cfaaaf5c0a92de2`. Full release
facts and Unraid update instructions are in [`RELEASE_NOTES_v0.20.0.md`](RELEASE_NOTES_v0.20.0.md).

Monthly schedules can exclude selected calendar months every year.
For the ten-payment-year case, select February and March. The shared Add/Edit control is a nested
native details disclosure, **collapsed by default**, with Horizon's compact summary styling and native
marker. Only opening it reveals the twelve labelled checkboxes. Recurring and dedicated Income forms
share it; annual schedules do not show it. SPEC §11.1 and decision **163** describe the rules.

## Gates

`npm test`: **506 passed** · TypeScript clean · formatting clean · production build clean ·
Playwright: **76 passed**, including keyboard disclosure and checkbox operation, save/reload,
monthly-only visibility and a 390px viewport. Browser ran using SANDBOX entry 8; the temporary
local-browser config was removed afterwards. No new sandbox workaround was needed.

## What a future session should know

- Migration **0011_schedule_excluded_months** adds a JSON list of calendar month numbers, default `[]`.
  Existing schedules keep twelve payments; existing instances are untouched. Migration and older-backup
  restore tests pass. Take the usual backup before deploying a schema change.
- Action and domain validation both reject invalid/duplicate months and all-twelve exclusions. At least
  one payment month must remain. Annual schedules reject a non-empty list; switching to annual clears
  it on save. Valid lists are sorted, persisted and included in the existing full-row audit snapshots.
- Skip membership uses the **configured month**, before moving receipt dates off weekends. An August
  receipt may still land on July's final Friday when July is excluded. Instance-backed forecasts, due
  lists, conversion and calendars share this rule rather than implementing separate filters.
- Edits use the existing forward-regeneration path. Converted history and past due instances awaiting
  conversion remain intact. Only moving `activeFrom` earlier backfills (decisions 75/162 unchanged).
- `nextDueDateAfter` starts its bounded search at the later of the queried date and `activeFrom`, so a
  distant start followed by eleven skipped months still has an honest next-due date.
- Version metadata is v0.20.0. The published merge commit, tags and digest are recorded in
  `docs/RELEASE_NOTES_v0.20.0.md`; back up before using Unraid Force Update.

---

# Handoff: A schedule can start in the past — v0.19.0

Date: 2026-09-26. Branch: `arena/01a0dcf7-simple-finance` (from `main` @ `1363139`, the v0.18.0
post-release merge).

**Released as v0.19.0 on 2026-09-26.** The household filled up the car five days before the app was
stable enough to record in, and the direct debits that left inside that window belonged to schedules
created *after* it — so the app had no instance for those dates. Their only options were a hole in the
history or a hand-typed Purchase, and a Purchase is mislabelled money: All Transactions reads `PUR`
not `DD`, and the commitment chart and the projected figures then read the wrong past. The fix is the
schedule's own start date: **the Edit form can now move `activeFrom`, earlier or later, and moving it
earlier backfills the missed due dates as ordinary instances** — which convert into real,
schedule-tagged records. Recorded as decision **162** and SPEC **§11.1**; release facts (merge commit,
tag, digest) are stamped in [`docs/RELEASE_NOTES_v0.19.0.md`](RELEASE_NOTES_v0.19.0.md). The household
does two things in Unraid: back up, then Force Update.

## Gates at close

`npm test` **494** green · `npx tsc --noEmit` clean · `npm run format:check` clean · `next build`
clean · Playwright **75** green locally (SANDBOX entry 8; `playwright.local.config.ts` is a throwaway
overlay — recreate it from that entry, never commit it) and in CI on the merge commit.

## What a future session should know

1. **`activeFrom` is the one schedule field an edit may date in the past, and it is the only exception to
   "edits apply from the next instance".** `editSchedule` backfills *only* when the start genuinely
   moved earlier (`startMovedEarlier`), so decision 75's no-invented-past-cadence rule is intact for
   every other edit. If you are tempted to make `regenerateFromToday` backfill unconditionally, don't:
   a due-day change must not retroactively rewrite which dates the household believes in.
2. **Generation floor and retention floor are now two different things in `syncScheduleInstances`.**
   `lower` (max(`activeFrom`, lastConverted+1)) says where *new* dates start being generated; it is **not**
   a reason to delete an upcoming row. Past-dated upcoming rows are due dates awaiting conversion — the
   daily pass used to prune them as stale, which would have silently eaten a backfill before it ever
   became a record. That trap is the reason this release is a domain change and not just a form field.
3. **`editSchedule` returns `{ schedule, materializedInstances, backfilledInstances }`** (mirroring
   `createSchedule`), and the household's message is built from `backfilledInstances`. If a future edit
   path needs to report what it did, use that number rather than counting queries afterwards.
4. **`nextDueDateAfter` honours `activeFrom` now** — a period whose *configured* date precedes the start
   is not an expectation, mirroring `candidateForPeriod`. Keep that symmetry: the card's "Next due" and
   the materialised instance set must never disagree.
5. **The backfill window is bounded before anything is written** (`MAX_BACKFILL_SPAN_DAYS`, ~3 years,
   checked on create *and* edit). Instance materialisation is a single bounded window; say so in a
   sentence the household can act on rather than letting `dueDatesBetween` throw.
6. **The lazy due pass remains the only writer of records.** The edit action does not convert anything
   itself — `/transactions` (and every money page) runs the pass, so the backfilled record is there when
   it is looked for. Do not "helpfully" convert inside an action; SPEC §11.2's single writer is why a
   record can never be counted twice.

## Watch out for (carried forward, still true)

- **No migration was needed** — `active_from` has been a column since migration 0002. A feature that
  only needs a form field should not reach for the `drizzle` folder.
- **The e2e seed's pot order is not "Main account first" in the Add-schedule select.** A new browser test
  that asserts a row on `/transactions` must pick the pot by name, not trust the default (that cost this
  session one red run).
- **Never bump `APP_VERSION` while Playwright is running** — the backup spec reads it.
- **Generated files are generated.** Editing `src/app/themes.generated.css` or
  `src/lib/theme/catalogue.ts` by hand is reverted by the next build and caught by
  `tests/themes.test.ts` / `npm run themes:check`.
- **Tokens only.** `tests/colour-tokens.test.ts` is a grep-gate that reads prose too: a phrase like
  "sky-blue" in a `.ts` file trips `PALETTE_CLASS`. Colour is never the only signal (§16.7).
- **`purchaseLineSummary()` / `targetLabel()`** in `src/lib/records/targets.ts` are the one way to turn
  `{targetKind, targetId}` into words — do not write a sixth copy (v0.18.0).
- **Project order matters in Playwright** (`workers: 1`, `fullyParallel: false`, one shared
  `.e2e-data`): run the **whole** suite before believing a list assertion.
- SANDBOX entries 8 (local browser — how to run Playwright here), 9 (stale `next dev` SSR), 10/its
  sibling (a `node_modules` that is absent or *partially* restored — `npm ci --ignore-scripts` fixes
  both; this session started with `node_modules` missing entirely), 13 (GitHub connector drops), 14
  (Turbopack rejects a symlinked `node_modules`).
- `next build` flips `next-env.d.ts` — restore before committing.

---

# Handoff: The supplier card says who each purchase was for — v0.18.0

Date: 2026-09-26. Branch: `arena/01a0dcb6-simple-finance` (from `main` @ `9dc74e4`, the v0.17.0
post-release merge).

*Provenance for the block below — the v0.18.0 session, kept unchanged for context.*

**Released as v0.18.0 on 2026-09-26.** A household case the v0.17.0 release conversation turned up:
three mobile contracts with one carrier, one per person, modelled as **one supplier, three
schedules**. Every list in the app said who a payment was for except the supplier card's **Recent
purchases**, which showed `date · amount` — so the three contracts were told apart by amount alone.
Each row now reads `2026-09-24 · £28.99 · Mobile Phones (Robin)`. Recorded as decision **161** and
SPEC **§21.4**. Release facts (merge commit `ee2308e`, tag, digest
`sha256:8d8b822a…`) are stamped in
[`docs/RELEASE_NOTES_v0.18.0.md`](RELEASE_NOTES_v0.18.0.md); the version badge reads
`v0.18.0 · pre-release`. The household does two things in Unraid: back up, then Force Update.

## Gates at close

`npm test` **481** green · `npx tsc --noEmit` clean · `npm run format:check` clean · `next build`
clean · Playwright **74** green locally (SANDBOX entry 8; `playwright.local.config.ts` is a throwaway
overlay — recreate it from that entry, never commit it) and in CI on the merge commit.

## What a future session should know

1. **There is one target-label helper now — use it.** `src/lib/records/targets.ts` holds
   `targetNames()`, `targetLabel()` and `purchaseLineSummary()`: pure, no DB, no framework. Turning
   `{targetKind, targetId}` into `Alex` / `Vehicle A` / `household` had grown **four** copies
   (`activity.ts`, `purchases/page.tsx`, `contracts/page.tsx`, and the supplier card would have been
   the fifth). All four call it now. If a new page needs the label, import it — do not write a
   sixth.
2. **`purchaseLineSummary()` takes the category map as an argument on purpose.** That is how a wide
   table shows `Utilities / Mobile Phones (Matthew)` and a narrow card shows `Mobile Phones
   (Matthew)` without forking the `+N more` rule. Build the map the way the caller needs.
3. **The split rule is settled: first line, then `+N more`.** All Transactions has rendered it that
   way since v0.3.0 and the supplier card now matches. Don't introduce a third convention for a
   fifth list — the full split is always one click away on `/purchases`.
4. **`listPurchases` already returns the allocations.** The suppliers page had been calling
   `.map(({ purchase }) => …)` and discarding them. Before adding a query to a page, check whether
   the data is already in hand.

## Watch out for (carried forward, still true)

- **Generated files are generated.** Editing `src/app/themes.generated.css` or
  `src/lib/theme/catalogue.ts` by hand will be reverted by the next build and caught by
  `tests/themes.test.ts` / `npm run themes:check`.
- **Another palette is one row** in `scripts/themes/palettes.ts`, then `npm run themes:build`.
- **The theme blocks must stay unlayered**, and **`@theme static` is load-bearing** — the chart kit
  reads `var(--color-chart-…)` from inline styles, which Tailwind's scanner cannot see.
- **Tokens only.** `tests/colour-tokens.test.ts` is a grep-gate that reads prose too: a phrase like
  "sky-blue" in a `.ts` file trips `PALETTE_CLASS`. Colour is never the only signal (§16.7).
- **`@source not` excludes prose from Tailwind's scan** — keep the directive.
- **Tailwind resolves competing colour utilities by stylesheet order**, not class-attribute order
  (the void button); `e2e/desktop.spec.ts` guards it.
- **Screenshot determinism**: the seed's captions tick with wall-clock time ("just now" → "3 minutes
  ago") — normalise them before any pixel comparison.
- **Project order matters in Playwright** (`workers: 1`, `fullyParallel: false`, one shared
  `.e2e-data`): `mobile` runs before `desktop`, so a spec that writes a purchase can shift what a
  later project's "five most recent" list contains. Run the **whole** suite, not just your project,
  before believing a list assertion.
- SANDBOX entries 8 (local browser — how to run Playwright here), 9 (stale `next dev` SSR), 13
  (GitHub connector drops), 14 (Turbopack rejects a symlinked `node_modules`).
- **`node_modules` can come back *partially* restored** — not just absent. This session started with
  a `node_modules` directory present but `tsx` missing, so all 52 suites failed at import with
  `ERR_MODULE_NOT_FOUND` and looked like a broken checkout. `npm ci --ignore-scripts` fixed it
  (SANDBOX entry 10's sibling note, now widened).
- `next build` flips `next-env.d.ts` — restore before committing. Don't bump the version while
  Playwright is running (the backup spec reads `APP_VERSION`).

---

> Provenance: the brief below is the Phase-1/Phase-2 handoff this session executed. Phase 1 (v0.16.0)
> tokenised the scheme; Phase 2 (v0.17.0, above) shipped the themes and the Settings picker, and
> answered its three open questions — cookie (not an inline script), a per-device gallery in the
> existing Settings page, and per-theme browser chrome from `generateViewport()` with the manifest
> pinned to the default. It is kept unchanged for context.

---

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
