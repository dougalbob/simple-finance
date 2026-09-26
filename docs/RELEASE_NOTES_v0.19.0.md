# Release notes — v0.19.0 (a schedule can start in the past, so the payments the app missed get recorded properly)

**Published:** 2026-09-26 (tag pushed, Publish run passed, image verified in the registry).
**Merge commit:** _to be stamped after the merge_
**Image tags:** `ghcr.io/dougalbob/simple-finance:v0.19.0` · `latest` · `sha-<merge short SHA>`
**Digest:** _to be stamped after publish_
**Version badge:** `v0.19.0 · pre-release`

## Why this release exists

You filled up the car five days before the app was in a state you were happy to start recording in.
The direct debits that left the account inside that window belonged to schedules you set up **after**
the fact, so the app had no instance for those dates and no record of the money.

The two ways to close that gap were both bad:

- **Leave the hole** — the history stops making sense, and the projected figures read the wrong past.
- **Type them in as purchases** — and the app then believes they *are* purchases: All Transactions
  codes them `PUR` instead of `DD`, the fixed-commitment chart stops counting them, and nothing links
  them back to the schedule that pays them.

Creating a schedule with an "Active from" in the past already worked (you tested it) — that materialises
the real instances and converts them. What was missing was that **the start date could not be changed
afterwards**. Now it can.

## What changed

**The schedule card's Edit form has a start date.** Recurring payments → _your schedule_ → Edit schedule
→ "Active from — the day this arrangement actually started". Move it earlier and save.

- **Every due date between the new start and today becomes an ordinary instance**, which then converts
  like any other — so the missed collection lands as a schedule-tagged **direct debit** (or standing
  order, or expected receipt: all three kinds take it), dated the day the money left, linked to the
  schedule, visible on All Transactions with the `DD` code.
- **It reaches backwards past records the app had already converted.** If the schedule had been running
  in the app for a month and you move its start back three months, all three missing months are added.
  A date the app already holds is skipped, never duplicated and never rewritten.
- **The save tells you what it did**: "…so one payment the app had not been told about is now expected,
  and it will be recorded as its own 'from schedule' entry", or two, or three — or the ordinary "applies
  from the next instance" message when you changed something else.
- **The card now shows the start date** (`active from 2026-09-21`) so you can see what you are changing,
  and the save button reads **Save changes** because it no longer only affects the next instance.
- **Moving it later is allowed too**: upcoming instances before the new date are dropped. Anything
  already converted stays — history is corrected the way it always is, by editing or voiding the record.

### What it deliberately does not do

- **It never rewrites a converted record.** Your existing purchases and receipts are untouched, amounts,
  dates and all.
- **It does not touch a bank instruction.** As everywhere in this app, changing a date changes what the
  app expects — nothing more.
- **It does not tidy up a purchase you already typed in.** If you recorded one of those payments by hand
  first, **void that purchase** (with a reason) before backdating: the backfill adds its own record and
  never merges with yours, so leaving both would double the day.
- **Other edits still never invent a past instance.** Change the amount or the due day with the start
  date left alone and the change applies from the next instance, exactly as before.
- **Backfilled instances take the amount you saved with them.** If you change the amount *and* the start
  date in one save, the backfilled records carry the new amount — the form says so. If the bank actually
  took a different figure, correct that one record afterwards.
- **There is a limit to how far back it will go** — about three years, which is the window the app
  materialises instances for. A start date beyond it is refused with a sentence naming the earliest date
  that works, rather than failing quietly.

## How to use it for the fuel-and-direct-debits week

1. Recurring payments → the schedule for each direct debit that left in that window → **Edit schedule**.
2. Set **Active from** to a date before the payment went out, and save. Read the message: it names how
   many payments the app has just been told about.
3. Open **All Transactions** for the pot. The due pass runs there, so the records are already listed —
   as `DD`, dated the day the bank took the money, linking back to the schedule.
4. Add the fuel fill itself as an ordinary backdated purchase (Purchases, or the till with its date
   changed) — that was always supported, and now the debits around it no longer have to be faked.
5. If an amount differed from the schedule, open that one record and correct it. The schedule keeps its
   own figure for the future.

## Under the bonnet

One field, one rule, and two rules in the instance sync that had to be separated for the backfill to
survive at all. The sync had a single lower bound doing double duty as "where to start generating
instances" and "what is allowed to exist" — so an edit that reached back could not generate the past, and
the daily pass deleted past-dated upcoming rows as stale **before they could convert**. Generating is now
floored as it was; *retention* is not. A past-dated upcoming row is a due date waiting for its
conversion, not junk. `editSchedule` returns the number of backfilled instances alongside the schedule, so
the message is the domain's own count rather than a guess; `nextDueDateAfter` now honours the start date,
so a schedule starting in the future cannot advertise a next-due date that will never convert.

No migration and no schema change: `active_from` has been a column since migration 0002.

## Schema and data

**None.** No schema change, no migration, no rewrite of any existing record, setting or backup. The only
records this creates are the ones you ask for by moving a start date.

## Gates

`npm test` **494** green (481 + 10 schedule-start-date cases + 3 boundary-schema cases) · `npx tsc
--noEmit` clean · `npm run format:check` clean · `next build` clean · Playwright **75** green locally and
in CI on the merge commit.

## Updating in Unraid

1. **Take a backup first** (Settings → Backup, or your own copy of the appdata directory).
2. In Unraid, **Force Update** the Simple Finance container so it pulls `v0.19.0`.

You should see the version badge read `v0.19.0 · pre-release`. Open **Recurring payments**, expand a
schedule's Edit form, and the start date should be there — with `active from …` printed on the card line
itself.
