# Release notes — v0.11.0 (the till fits the phone, and fuel defaults)

**Published:** _stamped at release_
**Merge commit:** _stamped at release_
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.11.0` · `latest` · `sha-<merge short SHA>`
**Digest:** _stamped at release_
**Version badge:** `v0.11.0 · pre-release`

## What changed

Four things the household asked for on 2026-09-25 (decisions 143–148).

### 1. The page no longer wiggles sideways, and the black card fits

- **Why it wiggled:** the Purchase · Fuel · Balance · Move tabs could not
  shrink. On a narrow phone, or with larger text in Android's settings, they
  pushed the page wider than the screen, so the whole page could be nudged
  left and right. The tabs are now four equal boxes that always fit, and a
  couple of cards further down the home page had the same problem and were
  fixed too.
- **The cards stay still until you really swipe.** The two cards (the pot
  card and "Category & allocation") no longer scroll freely. They change on
  the **Next** button, on the dots, or on a clear sideways swipe. Scrolling up
  and down never moves them, and a slightly diagonal thumb does nothing.
- **Less padding on a phone.** The black card's border is thinner on a phone,
  so the white cards get more of the screen. Laptops look the same as before.
- A test now checks the home page never gets wider than the screen, on a
  320px phone and on a 360px phone with text at 130%.

### 2. No Save on the first card: a big "Next: category →" button instead

A supplier's remembered category is filled in on the second card. Saving from
the first card saved that category without you seeing it, and a new supplier
got no category at all. So:

- The first card ends with **Next: category →**. It slides to the second card
  and puts the cursor on Category.
- **Save purchase is only on the second card** (the right-hand column on a
  laptop).
- The keyboard's **Go/Enter** key on the first card never saves. In Supplier
  it moves to Amount, and in Amount it does the same as Next.
- **Add another** still takes you back to the first card, on Supplier.

### 3. Paid by and Date moved to the second card; Paid by is now tap buttons

The second card is now: Category → For → split lines → **+ Add split** →
**Paid by** → **Date** (a full-width row, "Today if blank") → **Save
purchase**. Paid by is a row of big buttons, one per person (with two people
it is two buttons). If a line's "For" was the payer's own default (their car,
or themselves), changing Paid by updates that line too. A line you pointed
somewhere else stays as it is.

### 4. Fuel

- **Supplier suggestions are fuel stations only.** The Fuel tab's supplier box
  now has the same suggestion list as purchases, but it only lists suppliers
  where you have bought fuel before, most recent first. A coffee shop never
  appears. You can still type a new name, and it joins the list after its
  first fill.
- **"Filled to full" now starts unticked.** Tick it only when the pump clicked
  off at full. This is the safer way round for mpg: if you forget to tick a
  real full tank, that stretch just runs on to the next full tank and the
  figure is still right. If you tick a part fill by mistake, the mpg comes out
  wrong. Insights now warns when a car has several fills in a row with none
  marked full ("mpg needs one").
- **The Fuel tab starts on your own car.** Before, Paid by and the vehicle
  always started on the first person, whoever was signed in. There is a new
  **Signs in as** setting (Settings → Household names, one per person). Once
  it is set, Paid by starts on whoever is holding the phone and Fuel starts on
  the car they own (the vehicle's Owner). The vehicle and Paid by are tap
  buttons now, so switching to the other car is one tap. After you tap a car,
  changing Paid by leaves the car alone.

## One thing to do after updating

Open **Settings → Household names** and choose each person's **Signs in as**
email (the list shows the Google sign-ins allowed into the app). Until you do,
the app starts on the first person, as it did before.

## Schema and data

**One small migration, `0010_people_email`, applied automatically on first
start.** It adds an optional, unique `email` column to people, for "Signs in
as". It starts empty for everyone, so nothing changes until you set it. No
existing record is touched. The email is stored only in your private database
on the server.

A backup taken on v0.10.0 (or earlier) restores on v0.11.0: the restore brings
it up to date before it goes live (decision 142). Fills already recorded keep
their "filled to full" value. Only new entries start unticked.

## Version badge

The app identifies as **v0.11.0 · pre-release**. The badge in the navigation
and on the home page should read exactly that after the update.

## How to update (Unraid)

1. **Back up first**: Settings → _Backup and restore_ → take a backup, and keep
   the downloaded archive somewhere other than the array.
2. In Unraid, open the Simple Finance container and press **Force Update** on the
   Docker tab (the `latest` tag now points at v0.11.0).
3. The version badge in the app should read **v0.11.0 · pre-release**.

Release notes: [`docs/RELEASE_NOTES_v0.11.0.md`](RELEASE_NOTES_v0.11.0.md)
