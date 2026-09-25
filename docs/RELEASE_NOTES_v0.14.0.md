# Release notes — v0.14.0 (Charts: the money, drawn)

**Published:** _pending — completed at publication._
**Merge commit:** _pending_
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.14.0` · `latest` · `sha-<merge short SHA>`
**Digest:** _pending_
**Version badge:** `v0.14.0 · pre-release`

## What changed

A new page, **Charts** (`/charts`), linked from the navigation and from a card on the home page below the
till. Four questions, four pictures, and the exact numbers underneath each one. Insights keeps its tables
and Overview keeps its projection panel — the charts read the same records, so the three always agree.

### A. Where the balance goes, today to a month ahead

The household total — every pot, day-to-day spending included — from today to one month out, drawn as a
step area. Today's point is your own reported figure plus what has been recorded since; every later point
is projected from the schedules and the day-to-day model.

- **Zero is always on the chart**, with room either side, because the honest question is how close you come
  to it. Below zero is a tinted region, not a line that stops at the axis.
- **The overdraft limit** is a dashed line when the chart reaches that far down; when it does not, the
  caption says so in words ("the £800.00 of overdraft room is off the bottom of this chart") rather than
  showing a legend for a line that is not there.
- **The lowest point is labelled** on the drawing and stated in the sentence above it — amount and date,
  never clipped: _"Projected to go £1,831.27 below zero on Fri 9 Oct. That is past the £800.00 overdraft
  limit from Mon 28 Sept."_
- Income days are ticked along the axis. A laptop also gets the three biggest outgoing days and a
  day-by-day list of exactly what lands.

### B. Is the weekly shop creeping up?

Monday-to-Sunday weeks of everything under **Groceries** — 12 weeks on a phone, 26 on a laptop — with two
reference lines: the weekly figure you configured, and the trailing 8-week average.

- **A week with no shop is a zero week, not a missing one.** Skipping empty weeks would flatter the
  average, which is the opposite of the point.
- The week you are living in is drawn hatched and never counts towards the average — the same rule the
  Insights honesty loop uses, and the same figure.

### C. Hers, his, household

Stacked monthly bars of discretionary spending — 6 months on a phone, 12 on a laptop — one bar segment per
person, plus a **Household** segment.

- Attribution is **"For: person"** (who the spending was for), never "Paid by" (whose card was used).
- **Household-marked spending is never split** between the two of you. A joint takeaway or a shared
  subscription is its own segment, and the caption says so.
- The scope is everything under **Personal** and **Entertainment & Eating Out** as the category tree stands
  today, so a child category you add is included the day you create it.
- Chips filter to one person or another; the choice lives in the URL, so a filtered chart can be
  bookmarked or sent.

### D. Are the direct debits coming down?

Monthly bars of your **fixed commitments**, over a list of categories you control.

- "Direct debit" is not a field on a purchase, so **Settings → Fixed commitments** is now the definition: a
  checkbox list of child categories grouped by parent. Tick Insurance and Road Tax, leave Fuel alone.
- Until you save a list, the chart tracks the categories your own direct debits and standing orders already
  use, and tells you that is what it is doing.
- A **schedule-converted only** toggle narrows the chart to purchases the app converted from a schedule —
  true DD/SOs, with hand-typed bills left out.

### Things every chart does

- **Says its verdict in words** above the drawing, and carries the same sentence as the chart's
  accessible label.
- **Shows the exact numbers** in a table under _"Show the numbers"_ — copyable, keyboard reachable, and
  working with JavaScript switched off.
- **States whether the figures are reported or projected**, as a badge and in the caption.
- **Never uses colour as the only signal**: every series is named in a legend and in the table, and an
  in-progress week or month is hatched as well as labelled.
- **Links to the purchases behind it.** Clicking a bar (or its link in the table) opens `/purchases`
  filtered to that period and those categories. Those filters match the **purchase**, so a matched purchase
  comes back with all of its lines, receipt-style — a split shop appears whole, not as the single line that
  matched. The page says so underneath.
- **Fits a phone.** Each chart is drawn twice, 320px wide and 720px wide, and the browser picks; the page
  does not pan sideways at 320px, or at 360px with text at 130%.

### Smaller changes that came with it

- **Purchases filters** now accept a repeated `categoryId`, expand a parent category to its children, and
  accept `targetKind=household` — which is what makes the chart drill-downs possible. Every existing link
  behaves exactly as before. The filter form gained a "<Parent> / all children" option per parent.
- **Settings** gained the _Fixed commitments (the direct-debit chart)_ section described above, saved with
  the usual audit entry.

## Schema and data

**No schema changes and no database migrations.** The one new setting, `commitment_category_ids`, lives in
the existing key/value settings table and is written through the ordinary audited path. Databases, settings
and backups from v0.13.1 (or earlier) work untouched, and nothing on the new page writes anything except
that one Settings form.

## Checks

`npm test` 459 tests / 111 suites green (43 new: 26 over the pure chart resolvers and geometry, 17
reconciling every chart figure against an independent sum over the recorded purchases). Formatting,
TypeScript and the production build clean. Playwright 70 tests green locally across every project,
including 7 new charts specs at 320px, 360px with 130% text, and 1400px.

## Version badge

The app identifies as **v0.14.0 · pre-release**. The badge in the navigation and on the home page reads
`v0.14.0 · pre-release` after updating.

## How to update (Unraid)

1. **Back up first**: Settings → _Backup and restore_ → take a backup, and keep the downloaded archive
   somewhere other than the array.
2. In Unraid, open the Simple Finance container and click **Force Update** on the Docker tab (the `latest`
   tag points at v0.14.0).
3. Verify the version badge reads **v0.14.0 · pre-release**.
4. Open **Charts** on the phone: check the four charts draw, that the page does not pan sideways, and that
   _"Show the numbers"_ under each one matches what you see. Then open **Settings → Fixed commitments** and
   tick the categories that really are bills — the direct-debit chart uses that list.

Release notes: [`docs/RELEASE_NOTES_v0.14.0.md`](RELEASE_NOTES_v0.14.0.md)
