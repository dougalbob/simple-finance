# Release notes — v0.12.0 (collapsible supplier cards and mobile menu drawer)

**Published:** 2026-09-25 (tag pushed 11:47 UTC, image verified in the registry 11:50 UTC).
**Merge commit:** `da1555186fb357221b8181f22c8160cc119e0968` (PR #49; short SHA `da15551`)
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.12.0` · `latest` · `sha-da15551`
**Digest:** `sha256:153efbad7e8147721dfa99ef81b22649720f619b444af5cfd5a812696bdd4c32`, one digest for all
three tags, different from v0.11.0's `sha256:6f39143d…` (verified through
`/users/dougalbob/packages/container/simple-finance/versions` after Publish run `36131371166` passed).
**Version badge:** `v0.12.0 · pre-release`

## What changed

Two UI enhancements agreed with the household on 2026-09-25:

### 1. Collapsible supplier cards (accordion) on desktop and mobile

As the supplier list grows, the full contact details, reference pairs, interaction logs, and purchase histories take up significant vertical height.

- **Default collapsed row:** Each supplier card displays a compact row showing the **Supplier name** (e.g. `ALDI`) on the left and a **Down chevron icon** on the right.
- **One-tap expand / collapse:** Tapping the supplier row or chevron expands the card and changes the icon to an **Up chevron**. Tapping it again collapses the card back down.
- **Subsections organized inside:** When expanded, all details are shown cleanly below a subtle divider:
  - Contact information (clickable `tel:` and `mailto:` links, website, address, notes) and contact card edit form.
  - Reference pairs (policy numbers, customer IDs, etc.) and reference creation form.
  - Interaction log (history entries with timestamps, actors, follow-ups, and interaction form).
  - Recent purchases (amounts, dates, void indicators, and receipt attachment management).
- **Search filter and expand/collapse all:** A quick filter search box (`Filter suppliers…`) at the top narrows down suppliers instantly, and **Expand all / Collapse all** buttons toggle all cards at once.
- **Deep linking:** Visiting `/suppliers#supplier-<id>` or using the "Supplier card" link from Recurring payments automatically expands the relevant card on load.

### 2. Independent mobile menu drawer (saving ~20% of the screen)

- **The problem:** With 11 navigation links, the desktop horizontal navigation wrapped into 4–5 rows on phone screens. Because it was sticky, it consumed roughly 25% of the mobile viewport, pushing the till forms and balances down.
- **Compact single-row mobile top bar:** On mobile (`< lg`), the header is now a slim ~50px top bar with a 44px **hamburger menu icon (`☰`)** and the app title, immediately recovering ~130px of vertical screen space.
- **Left slide-out drawer:** Tapping the hamburger button (or swiping from the left edge) opens a slide-out drawer over a dimmed backdrop.
- **Edge-swipe touch gesture:** Swiping right from the extreme left edge of the screen (`< 30px` from the edge) opens the drawer. Swipes anywhere else on the screen do not trigger the drawer, ensuring **zero conflict with the Quick Entry till's card-switching swipe gestures**.
- **Easy dismissal:** Swiping left on the drawer, tapping the backdrop, tapping the `X` button, pressing `Escape`, or tapping any navigation link closes the drawer.
- **Grouped categories:** Navigation links in the drawer are organized into *Daily & Transactions*, *Planning & Accounts*, and *Reference & System* with comfortable 44px+ touch targets.
- **Laptop view unchanged:** Wide laptop and desktop screens (`lg:` and up) keep the full horizontal navigation bar across the top.

## Schema and data

**No schema changes and no database migrations.** v0.12.0 is purely a UI and UX upgrade. Existing databases, settings, and backups from v0.11.0 (or earlier) work without any migration or modification.

## Version badge

The app identifies as **v0.12.0 · pre-release**. The badge in the navigation and on the home page reads `v0.12.0 · pre-release` after updating.

## How to update (Unraid)

1. **Back up first**: Settings → _Backup and restore_ → take a backup, and keep the downloaded archive somewhere other than the array.
2. In Unraid, open the Simple Finance container and click **Force Update** on the Docker tab (the `latest` tag points at v0.12.0).
3. Verify the version badge reads **v0.12.0 · pre-release**.

Release notes: [`docs/RELEASE_NOTES_v0.12.0.md`](RELEASE_NOTES_v0.12.0.md)
