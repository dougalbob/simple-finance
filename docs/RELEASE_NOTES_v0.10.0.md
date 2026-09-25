# Release notes — v0.10.0 (payslips on income, fuel economy, and the till fixes)

**Published:** _to be stamped at publication._
**Merge commit:** _to be stamped at publication._
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.10.0` · `latest` · `sha-<merge short SHA>`
**Digest:** _to be stamped at publication — must differ from v0.9.0's `sha256:4384d7d2…d12aa809`._
**Version badge:** `v0.10.0 · pre-release`

## What changed

Three things the household asked for, and one safety fix found on the way
(restoring an older backup — see _Schema and data_).

### 1. The till fixes that went missing after v0.9.0

These were made straight after v0.9.0 but never reached GitHub (GitHub was
having an outage and the work was lost with its sandbox), so the v0.9.0 image
never had them. They are re-done here:

- **One tap on Save saves.** With the supplier suggestions showing, the first tap
  on Save used to close the list, the form jumped up under the finger, and the
  tap landed on nothing — so it took two taps. The list now fades out in place
  and the first tap saves.
- **Everything in Quick Entry is big enough to tap.** The tab buttons, the
  "+ Note" toggle, the chips and the split-line controls were still smaller than
  the 44px minimum. All of them are at least 44px tall now, and a test measures
  every one so a small one cannot creep back.
- **The purchase form opens with the cursor in Supplier.** It was meant to, but
  the form tried to focus before it was ready to listen, so the phone opened
  with nothing selected.

### 2. Payslips and other documents on income

Every entry in **Income → Income received** now has an **Attach payslip**
control, exactly like receipts on a purchase:

- As many documents per income entry as you need (PDF, PNG or JPEG, up to 10 MB
  each). They show as links on the entry and open privately in the browser.
- On a phone the picker offers files, photos or the camera — a payslip is as
  often a PDF from the employer's portal as a sheet of paper.
- A document can be removed later; the income entry stays, and the history
  records who removed it and when.
- They are in the backup and come back with a restore, like receipts.
- A voided income entry keeps its documents viewable but takes no new ones.

### 3. Fuel: litres, odometer, price per litre and mpg

- **At the pump (Quick Entry → Fuel)** there are two new boxes, **Litres** and
  **Odometer**, and a **Filled to full** tick (on by default — untick it for a
  part fill). **Both boxes are optional**: the amount is still the only thing you
  have to type. The price per litre appears as soon as the litres are in.
- **Later (Purchases or Overview)** every fuel purchase shows its details on its
  row — vehicle, litres, price per litre, miles, full tank or part fill — and
  **"Fuel details — add odometer & litres"** opens a small form to add or correct
  them.
- **After saving**, one sentence says what it worked out, for example
  _"Vehicle A: 41.2 mpg over 312 miles since the last full tank. 40.12 L at
  142.9p/L."_ — or why it cannot yet (a part fill waits for the next full tank;
  the first full tank is noted as the starting point; or which number is
  missing).
- **Insights → Fuel economy** shows, for each vehicle: the latest mpg, the last
  12 months' mpg and miles, the fuel cost per mile, the latest price per litre,
  any recent fills still missing their litres or odometer (each linked to its
  row on Purchases so it can be filled in), and the recent fills.

How it is worked out: mpg is measured from one **full tank** to the next, in
**UK gallons** (4.546 litres). Part fills in between add their litres and cost
to that stretch. If a reading is missing, or the odometer went down, that
stretch shows no mpg and says why rather than guessing; a figure outside 8–150
mpg is shown with "worth checking the readings". Only the fuel part of a
purchase counts, so a fuel-and-snacks split does not distort the price per
litre.

## Schema and data

**One migration, `0009_income_documents_fuel_details`, applied automatically on
first start.** It:

- rebuilds the `attachments` table so a document can belong to an income record
  as well as a purchase (exactly one of the two). Every existing receipt keeps
  its id, file and state — this was tested on a database shaped like v0.9.0's,
  and no file in the documents folder is touched;
- adds three optional columns to purchases: odometer miles, litres (stored in
  millilitres) and "filled to full". Existing purchases get no readings and the
  full-tank default, so nothing changes for them until details are added.

**Take the backup before updating** (below). A backup taken on v0.9.0 (or
earlier) restores on v0.10.0: the restore now brings an older backup up to date
before it goes live. Before this release, a restore from an older version left
the app short of the newer database columns until the container was restarted —
harmless so far, but it would have broken the pages after this migration. A
backup made by a **newer** version than the one running is now refused with a
plain message (update the app first), rather than restored into code that does
not understand it.

## Version badge

The app identifies as **v0.10.0 · pre-release** — the badge in the navigation and
on the home page should read exactly that after the update, and it is what the
acceptance suite asserts.

## How to update (Unraid)

1. **Back up first** — Settings → _Backup and restore_ → take a backup (or the
   nightly copy of the appdata folder), and keep the downloaded archive
   somewhere other than the array.
2. In Unraid, open the Simple Finance container and press **Force Update** on the
   Docker tab (the `latest` tag now points at v0.10.0).
3. The version badge in the app should read **v0.10.0 · pre-release**.

Release notes: [`docs/RELEASE_NOTES_v0.10.0.md`](RELEASE_NOTES_v0.10.0.md)
