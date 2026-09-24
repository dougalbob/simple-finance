# Release notes — v0.9.0 (the phone-first till form, and what is left before income lands)

**Published:** 2026-09-24.
**Merge commit:** PENDING (PR PENDING; short SHA PENDING)
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.9.0` · `latest` · `sha-PENDING`
**Digest:** `sha256:PENDING`

## What changed

Two things the household asked for directly.

### 1. A second balance figure: what is left before income lands

The household's objection was concrete. A "free to spend" figure built only on
the last checkpoint is dangerous: a £500 balance looks comfortable while a £600
mortgage is due three days before payday. So the entry panel now shows **two**
facts, always together:

- **Last reported checkpoint** — what the bank last said for that pot, with its
  age ("2 days ago") and the exact time it was reported. Nothing else. It is
  never called a bank balance.
- **Free to spend before income lands** — the household's available-now estimate
  minus every commitment (direct debits and standing orders) *and* the projected
  weekly shop / fuel events due before the next expected income. **Nothing coming
  in is counted**: this is the dip, not the balance after payday. In the
  household's own example it reads £500 − £600 = **−£100**, which is the truth
  they needed.

Under the headline the panel spells out the figures that make it up ("£600.00 of
bills and £45.00 of projected shopping & fuel leave before then"), the date the
money bottoms out, and the honesty line: it is a projection of the records in the
app, never a bank balance.

Per pot, the same arithmetic answers "is *this* account about to bounce": the
pot's estimate minus the bills due from that pot. It only speaks up when the pot
itself would go short ("Natwest would be £100.00 short before income lands —
Mortgage DD £600.00 on Sun 27 Sept"), which is the "plan a transfer" signal. Cash
pots show **no** balance at all — the household counts the notes.

Where it appears: the Quick Entry purchase panel, and beside each pot on the home
page's Pots & checkpoints cards and the Overview. The projection panel is
unchanged, and a test pins that its low point equals the till figure whenever no
other money arrives in the window — the two can never quietly disagree.

When there is no income schedule yet, or no checkpoint, there is no figure, and
the panel says exactly that instead of guessing.

### 2. The till form, rebuilt for a phone

- **Pot first.** The pot selector now leads the form, with the two figures under
  it. The pot the form starts on is a **setting** (Settings → Quick entry →
  "Default pot for purchases"). It used to be guessed by looking for a pot
  labelled "Main account" and falling back to the first pot in the list — which
  in the real installation is the wrong pot every single time. With no default
  chosen, the form starts with no pot selected and you pick one.
- **Swipe panels, with Save on both.** Panel 1 records it: pot and figures,
  supplier, amount, paid-by, date, "+ Note", Save. Panel 2 holds the category,
  the "For" target (household / person / vehicle as tappable chips) and any split
  lines. On a phone the two panels slide sideways with a hint and two dots; on a
  laptop they are the two columns they always were. **Neither panel needs the
  other**: Save is on both, so a purchase is never blocked behind a swipe.
- **Supplier typeahead.** Typing "cor" now filters the household's real suppliers
  in a list on the page and shows "InsurerCo" at the top, instead of opening a
  fiddly browser popup. Empty field = most recent suppliers first. Tapping a row
  fills the name, applies the supplier's remembered category and moves to
  Amount. The "Did you mean…?" prompt is unchanged.
- **Focus order at a till:** supplier → amount → save. The amount field no longer
  grabs focus on load; "Add another" returns to panel 1 on the supplier field.
- **Quieter labels:** "Split the payment" is now "Category & allocation" (every
  purchase uses that card, not just splits), "Line 1 amount" only appears when
  there is more than one line, and the note field waits behind "+ Note".
- **Legibility and touch:** the quick-entry panels are light cards (the purchase,
  fuel and balance forms had dark labels on the dark panel — effectively
  unreadable), and inputs and buttons are at least 44px tall.

Everything else is untouched: the home page's money section, projection, due this
week, key dates, schedules, pots and recent entries; the menu; the Fuel, Balance
and Move tabs' behaviour; the other pages.

## Schema and data

**None.** v0.9.0 adds no migration and changes no record. It reads the existing
tables and adds one setting (`default_purchase_pot_id`), which is empty until the
household chooses a pot in Settings. Existing checkpoints, purchases, schedules
and debts are all untouched.

## Version badge

The app identifies as **v0.9.0 · pre-release**.

## How to update (Unraid)

1. **Back up first** — Settings → *Backup and restore* → take a backup (or the
   nightly copy of the appdata folder), and keep the downloaded archive
   somewhere other than the array.
2. In Unraid, open the Simple Finance container and press **Force Update** on the
   Docker tab (the `latest` tag now points at v0.9.0).
3. The version badge in the app should read **v0.9.0 · pre-release**.

Release notes: [`docs/RELEASE_NOTES_v0.9.0.md`](RELEASE_NOTES_v0.9.0.md)
