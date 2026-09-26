# Release notes — v0.17.0 (themes: fourteen palettes, light and dark)

**Published:** _pending_ (tag, Publish run and registry verification are stamped here at release).
**Merge commit:** _pending_
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.17.0` · `latest` · `sha-<merge short SHA>`
**Digest:** _pending_
**Version badge:** `v0.17.0 · pre-release`

## What changed

v0.16.0 moved every colour in the app into one block and promised that a theme would then be a
small, single-place change. This release is that promise, cashed: **28 themes — fourteen palettes,
each in a light and a dark form — and a picker in Settings.** Not one page, component or chart was
edited to make it possible (decision **160**, SPEC **§15.4**).

### Pick a theme in Settings → Appearance

- Near the bottom of the Settings page, every palette appears as two cards: **Light** and **Dark**.
  Thirteen palettes the household chose, plus **Classic** — the scheme the app has always worn, and
  still the default.
- Each card is a **real miniature of the app**, not a picture of one: the same components and the
  same tokens, wearing that theme. What you see on the card is exactly what the page will do.
- Tapping a card applies it immediately and saves it in the same gesture. The status line under the
  gallery says what was saved; if a save ever fails, the page goes back to what the server last knew.

### It is remembered per device, not per household

- The choice lives in a cookie on that device (`sf-theme`, one year) — **nothing is stored in the
  database**. The phone at the checkout can run dark while the laptop stays on paper, and neither
  changes anything for the other person.
- The server renders the chosen theme into the page itself, so a reload opens straight into it with
  **no flash** of the old colours. An old or unrecognised value simply falls back to Classic Light.
- The browser's own chrome (the address-bar tint on a phone) follows the theme too. The installed
  app icon's colours stay as they are: a manifest is read once when the app is installed.

### Nothing ships that cannot be read

- Every theme is derived from its five colours by a generator (`npm run themes:build`) which holds
  the existing scheme's own contrast ratios as floors — body text, muted captions, the till's ink,
  every warning and total, the chart axes — and refuses to build a theme that falls below them.
- The tests then re-measure the **shipped stylesheet**: all 28 themes, every floor, plus a rule that
  two colours the app keeps visibly apart today cannot merge in any theme. Dark themes get a dark
  label on bright buttons and a light one on dark surfaces, automatically.
- Colour is still never the only signal: the cards name their mode in words, the chosen one says
  "In use", and every warning, badge and chart keeps the wording and the table twin it already had.

### Also in this release

- **A 404 page that matches the app.** The framework's built-in "page not found" painted its own
  near-black text, which all but vanished on a dark theme. It is now an ordinary Simple Finance page.

## Schema and data

None. No schema change, no migration, no data change. The theme is a cookie; nothing about the
household's records, settings or backups is touched, and a restored backup does not change anybody's
theme.

## Updating in Unraid

1. **Take a backup first** (Settings → Backup, or your own copy of the appdata directory).
2. In Unraid, **Force Update** the Simple Finance container so it pulls `v0.17.0`.

You should see the version badge read `v0.17.0 · pre-release`, and a new **Appearance** section near
the bottom of Settings. Until someone picks a theme, everything looks exactly as it did.

## Release notes document

Full decision log: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) decision **160** (and **159**
for the tokenisation it rests on); spec: [`SPEC.md`](SPEC.md) §15.4.
