# Handoff: the till opens with nothing focused (v0.13.1)

Date: 2026-09-25. Branch: `arena/01a0d93c-simple-finance` (from `main` @ `2df45db`, the v0.13.0 merge).

**Released as v0.13.1 on 2026-09-25.** Annotated tag `v0.13.1` is on merge commit `a8827b7` (PR #56).
Digest `sha256:cced2519…02bea4` is on `v0.13.1` / `latest` / `sha-a8827b7`. Details are in
[`docs/RELEASE_NOTES_v0.13.1.md`](RELEASE_NOTES_v0.13.1.md), and the version badge reads
`v0.13.1 · pre-release`. The household does two things in Unraid: back up, then Force Update.

## What changed (decision 151)

The household opened the home page on the real phone after Force Updating to v0.13.0 and sent two
screenshots: the till autofocused **Supplier**, the keyboard rose, and the **Purchase / Fuel / Balance /
Move** tab strip scrolled off the top of the screen. Measured on the page before the fix: `scrollY` 1342,
tab strip at `y=-35` — entirely above an 839px viewport. Their words: *"It is not necessary for any control
on the form to get focus when it opens — the user can make that decision by tapping whatever control they
want to change."*

The rule now: **no field is focused as a side-effect of the till becoming ready, or of a type tab becoming
visible.**

- `src/components/quick-entry.tsx`: dropped the `ready` → `supplierRef.focus()` effect from `PurchaseForm`
  (and the `ready` prop, which existed only to feed it). The wrapper's `inert={!ready}` guard is untouched —
  the till still refuses input it cannot act on, and `data-till-ready` is still the specs' signal.
- Same file: removed `autoFocus` from the **Fuel amount** and the **Balance amount** — both stole focus as
  their tab appeared, with the same keyboard-and-scroll cost.
- Universal, not phone-only: desktop has room, so autofocus cost it nothing there, and one rule is simpler
  than a media query's worth of exceptions.
- **Kept, on purpose:** every focus move that answers something the household did — tapping a supplier
  suggestion (→ Amount), Enter in Supplier (→ Amount), **Next: category →** (→ Category, including
  `pendingFocus` after the panel switch), **+ Note** (→ the note it just opened), **Add another** (→
  Supplier on card 1). Enter still never saves from card 1.
- **SPEC §15.1**: the "lands on the supplier once it is ready" sentence is replaced by two bullets — nothing
  focused on open (with the reason), and the focus order *once the household is typing*. The v0.10.0 line
  lower down now says v0.13.1 reverses it. **Decision 151** in [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## Watch out for (learned this session)

- **Two specs were checked to fail against the pre-fix component.** That is the only proof they guard
  anything: `git show HEAD:src/components/quick-entry.tsx > src/components/quick-entry.tsx`, run the two
  specs (they catch `supplierName` and then `amount` focused by themselves), then restore. A focus assertion
  that passes either way is decoration.
- **Playwright has no on-screen-keyboard signal.** The household-visible proxies used instead: the active
  element is not `input`/`select`/`textarea`, and `window.scrollY === 0` after `waitForTill`. The tab
  strip's own box is asserted *after* `scrollIntoView`, because on a Pixel 7 the till starts ~1300px down the
  page — the household scrolls to it, it is not in the first viewport.
- **Don't bump the version while the suite is running.** The backup spec derives its filename regex from
  `APP_VERSION`, so a mid-run bump reds it against a server that still has the old module loaded.
- `e2e/home.spec.ts` has a shared `expectNoFieldFocused(page)` helper — a **tab button the household just
  tapped keeps its own focus**, which is right; only a text field focused unprompted is the bug.

## Test state

`npm test`: 416 tests / 103 suites green. `format:check`, `tsc --noEmit` and `next build` clean. Local
Playwright (SANDBOX entry 8 recipe, `playwright.local.config.ts`, git-excluded): **63 tests green** (62
before + 2 new mobile specs − 1 replaced). CI's `browser` job is the gate — and it went green on the PR
(run `36158432999`, 3m08s) and again on the `main` merge commit (run `36158820173`), so the two new
mobile specs have now run in CI's own Chromium as well as locally.

## Open / deferred

- **Empty pot selection = every pot** on Horizon is kept and stated under the checkboxes. Still waiting on
  whether "untick all" should mean *none* (marker param + §7.6 wording + spec).
- **The household's real phone is still the final check (148).** This change is itself phone-driven: after
  they Force Update, ask them to open the home page once and confirm the tabs stay put with the keyboard
  down — the same three views as the 2026-09-25 10:38 / 10:39 / 10:41 screenshots.
- **Data visualisation** — the household asked to talk through ideas for charts/graphs in the app; nothing
  designed or committed yet, see the note at the end of this session.
- Overview hydration warning (`<p>` wrapping `<details>`/`<form>` at `overview/page.tsx:305`) — still out of
  scope.
- UK gallons; supplier-level documents (OQ10); home-page mobile layout beyond the till.
