# Simple Finance — Product Specification

**Status:** agreed with the product owner in discovery, 2026-09-20. This is the authoritative product spec.
**Companion documents:** `docs/HANDOFF.md` (session continuation point — read this first for ongoing work), `docs/IMPLEMENTATION_PLAN.md` (profile, data model, phases, decision log, open questions). `AGENT_APP_BLUEPRINT.md` is the engineering contract from the initial build through the first release; it is historical context, not required reading for later changes.

> **Privacy notice — applies to this entire repository.**
> Every name, person, amount, date, account and threshold in this document is a **fictional placeholder**.
> The real household's names, balances, income figures, overdraft limit and warning thresholds exist only in the
> private installation's runtime configuration and database, which `.gitignore` keeps out of version control.
> No real personal financial data may ever appear in commits, PRs, issues, screenshots, logs, fixtures, seed
> files, demo data or release artefacts. Demo/seed data lives in tracked source paths and is fictional by rule.

---

## 1. Product purpose

Simple Finance is a private, shared household spending tool for **two people who need to watch money carefully
to avoid overdraft charges**. It answers four questions:

1. What have we spent, and on what?
2. What money do we have available now?
3. Which regular payments still need to come out?
4. How are we doing this month, and when do we need to be careful?

It is **not** a wealth-management, investment, budgeting-enforcement or bank-reconciliation product. The users
record everyday purchases (shops/POS, online, cash) alongside direct debits and standing orders, and
periodically tell the app **"this is how much we have at this moment"** (a *balance checkpoint*). The app never
connects to a bank and never asks for bank credentials.

**Honesty rule:** the app never presents a misleadingly reassuring figure. Money the user reported and money the
app calculated are always visually and verbally distinct. There is no "safe to spend" promise — only
*"available now (our estimate from your checkpoints)"* and *"projected low before payday (projection)"*, each
with its inputs inspectable.

## 2. Scope and non-goals

### In scope (v1)

- Four money pots: two joint bank accounts and two personal cash pots (one each), each
  with user-reported balance checkpoints. (The original shared jar was retired: one pot each
  makes a cash handover a visible transfer instead of an unexplained move.)
- Fast mobile purchase entry with splits, supplier memory, category tree, attribution defaults and overrides.
- Recurring payment schedules (direct debits, standing orders) and expected income (salary) that
  auto-convert to actual records on their due dates, plus **one-off income** recorded by hand — a
  sale paid in cash or by bank transfer, a third-party refund, a gift (§11.3).
- Transfers between pots as a first-class record type that never inflates spending, plus
  informal debts and money across the household boundary — borrowing and repayments, swaps
  with someone outside the household, and anything else with a note — that moves estimates
  honestly without ever counting as spending or income (§10).
- Household estimate, payday-to-payday projection, and a two-tier warning system anchored on an authorised
  overdraft facility.
- Insights: month comparisons, personal-vs-personal spending, per-vehicle running costs, projection feedback.
- Dense desktop overview plus dedicated menu pages; mobile focused on quick entry.
- Supplier contact cards (phone, email, website, label→value reference pairs such as policy numbers) and a
  per-supplier interaction log for calls/emails (§21).
- Fixed-term **contract end dates** on DD/SO schedules and **renewal dates** (house/car insurance etc.) with
  configurable ahead-of-time warnings, default 21 days (§22).
- **Receipt/invoice attachments** on purchases: .png/.jpg/.pdf uploads from desktop, camera capture on
  mobile, retroactive attachment (§23).
- A single fixed data root on the Unraid host — `/mnt/user/appdata/simple-finance` (database, `.env`,
  `documents/`, `logging/`) — with encrypted, user-managed, restore-rehearsed backups (§18).
- Encrypted backup/restore, Cloudflare Access auth, Unraid deployment — per `AGENT_APP_BLUEPRINT.md`.

### Explicit non-goals (v1)

- Bank integration of any kind: no statement import, no line-by-line reconciliation, no open banking, no
  bank credentials ever requested.
- Credit cards (the household does not use them; the pot model could accommodate them later, but no
  card-specific behaviour is built).
- Investments, asset tracking, vehicle **valuation**, trip/business mileage logs, maintenance reminders.
  (Vehicles are tracked as **running-cost targets**; since v0.10.0 a fuel purchase may also carry litres
  and an odometer reading so the app can show mpg — §13, §16.6 — and nothing more.)
- Offline operation or offline caching of financial data (see §14).
- Notifications, reminders, emails (see §14; deferred, not forgotten).
- Drag-and-drop calendar scheduling; the calendar is a read-only view (§13).
- Fractional/percentage splits of one allocation between the two people (§9.4).
- Budget enforcement, multi-household, multi-currency, public/sharing features.
- Formal lending: interest, repayment schedules and credit agreements. Debts are informal
  IOUs only — who, which way round, and what is still owed.
- Privacy walls between the two users (§4).

## 3. People, personas and privacy

- Exactly **two allowed users**, enforced by a Cloudflare Access allowlist configured privately at install time.
- Full mutual visibility and editing: both users see and may correct **everything**, including each other's
  personal purchases. "Personal" is a reporting dimension, not a secret.
- Every record carries an audit trail: who created it, who changed it, what changed, when. Corrections are
  edits or voids with retained history — never silent deletion (blueprint §3).
- In this document and all demo data, the fictional personas are **Alex** and **Sam**. Sam is employed with a
  monthly salary; Alex is not currently working. Real identities are configured in the private installation.

## 4. Pots (tracked money containers)

The household's shape (names are user-configurable labels):

| Pot | Type | Role |
|---|---|---|
| Main account | Bank (joint) | The "busy" account: **everything out** — all direct debits, standing orders, POS and online purchases. Has an authorised overdraft facility. Checkpointed by the users roughly every 4–5 days. |
| Salary account | Bank (joint) | Receives Sam's monthly salary. Source of manual transfers into the Main account. |
| Alex's cash | Cash | Personal cash — one pot each, so a handover is a visible transfer. |
| Sam's cash | Cash | Personal cash — one pot each, so a handover is a visible transfer. |

Rules:

- Every pot has independent checkpoints and an independent estimate (§6–§7).
- **Overdraft configuration is per-pot.** In this household only the Main account has an authorised overdraft
  (a configurable limit figure, used for context/display) and a configurable **warning threshold** (§8).
- Cash pots are checkpointed whenever the users count them ("as-needed"); the UI shows each pot's
  *last updated* age so staleness is always visible, never hidden.
- Transfers between pots (§10) are expected and routine (Salary → Main "as we need to"). The app **never**
  assumes a transfer happens; transfers are only real when the user records them.

## 5. Balance checkpoints

A checkpoint is the user saying: *"this is how much is in this pot at this moment."*

- The figure entered is the bank's **current/ledger balance** — the number that does **not** have pending items
  deducted. (Agreed decision; consequences in §7.4.) For cash pots it is the counted amount.
- Effective instant defaults to *now*. An optional **effective date** (date-only, today or earlier) supports
  delayed entry — e.g. you checked the bank last night and are entering it this morning. A date-only checkpoint
  takes effect at the **end of that local date** (Europe/London).
- Checkpoints are immutable history: entering a new one never edits or deletes an old one, and never deletes
  any spending record.
- **Pending-at-checkpoint rule (agreed decision, chosen twice with the trade-off explained):** purchases dated
  before a checkpoint's effective instant are **assumed to be included** in the reported balance ("assume
  cleared"). No pending-marking admin, no automatic safe window. Documented limitation in §7.4.

## 6. Record types

| Type | Sign | Counts as spending? | Notes |
|---|---|---|---|
| Purchase | positive | Yes | One or more allocation lines (§9). |
| Refund | negative | Yes (nets off) | Own record, optionally linked to the original purchase; same category/target as what it refunds. |
| Transfer | n/a | **No** | Pot-to-pot movement; two-sided; excluded from all spending insights (§10). |
| External movement | in / out | **No** | Money across the household boundary (borrowing/repayment, swap leg, other); moves estimates, never spending or income (§10.2). |
| Debt | n/a | No | Informal IOU (who, which way round); its balance derives from linked loan movements (§10.2). |
| Expected receipt (income) | positive | No (income) | Generated by income schedules (§11) or recorded by hand (§11.3). Carries an optional free-text **source** (what or who it came from); no category, no target. |
| Checkpoint | n/a | No | User-reported balance (§5). |

All money is stored as **integer pence**. No binary floating-point arithmetic on money, ever (blueprint §3).
Pro-rata projections round once, at the period level, half-up to the nearest penny (§7.3).

## 7. Estimates and the payday projection

Two distinct, clearly-labelled numbers. Neither is ever called a bank balance. v0.5.0 adds a third,
clearly-labelled view — the **horizon** (§7.6) — built from the same two ingredients.

### 7.1 Available now (estimate), per pot

For pot P with latest checkpoint C (amount, effective instant t):

```
estimate(P) = C.amount
            − Σ signed spending on P whose effective instant is after t
            − Σ transfers out of P after t
            + Σ transfers into P after t
            + Σ external money in to P after t
            − Σ external money out of P after t
```

*Signed spending*: purchases add, refunds subtract (so a refund increases the estimate).
Schedule-generated records are ordinary spending records and appear here once converted (§11).
External movements move the estimate like receipts (in) and spending (out) — the household
total genuinely moves, because the money really entered or left (unlike an internal transfer).

**household_available_now = Σ estimate(P) over all pots.** This is the headline figure. Because it sums pots,
internal transfers can never distort it.

Comparison precision: where both a record and a checkpoint carry times of day, compare by timestamp (mobile
entry auto-timestamps). Where a record is date-only and shares the checkpoint's date, the direction is
decided by the record's **sign** (amended v0.2.1):

- a date-only *credit* (money into the pot — a receipt, transfer-in, refund, external money in, or the
  in-leg of a swap) counts as *absorbed*: the checkpointed balance plausibly already includes it, and a
  same-day checkpoint can never confirm it arrived, so counting it would leave the estimate permanently
  high until the next checkpoint (the v0.2.0 field report — the "£180" bug, E13);
- a date-only *debit* (money out of the pot) counts as *after*: a missed same-day debit only dips the
  estimate low, and it self-corrects at the next (later-dated) checkpoint.

The asymmetry is deliberate: the estimate may read **low** for a day (a same-day swap shows its out-leg
and absorbs its in-leg), but it never reads **high** on the day of a same-day checkpoint.

### 7.2 Projected low before payday (projection)

The planning cycle is **payday-to-payday**: from Sam's salary date to the next one (configured day-of-month;
fictional example: the 26th). Insights additionally report by **calendar month** — both are views over the
same date-stamped records.

```
days = payday − today   (whole days, local date arithmetic)
projection starts from household_available_now and applies, day by day until payday inclusive:
  + expected receipts due that day        (income schedules not yet converted, and a debt's expected support, §10.2)
  − expected commitments due that day     (DD/SO schedule instances not yet converted)
  − projected day-to-day events due that day (see 7.3)
projected_low = the minimum running value within the window
```

`projected_low` normally occurs just before salary lands. The projection **includes** expected income; it is
not a spending-only forecast.

**A shifted expectation belongs to the window it lands in (v0.7.0).** A debt's expected support counts while
**either** its configured day-of-month **or** the Friday it shifts to (§11.3, decision 7) falls inside the
window — so a payment configured for Saturday the 10th dates Friday the 9th and counts in the window that
ends on Friday the 9th, rather than vanishing because its configured day sat one day outside. Nothing else
about the cadence changes: the crossing date shown is the shifted one, and the recorded Borrow is still
recorded on whichever day it actually lands.

### 7.3 Projected day-to-day spending as episodic events (anchor-reset) — v0.6.0

The household's day-to-day spending is highly predictable in **amount** (weekly food shop varies by roughly
±£20; per-vehicle fuel is predictable monthly) but it is **episodic in timing**: the weekly shop happens on one
day and not again until the next, and a £55 fill resets the car's fuel clock for the month. So the projection
uses **user-configured figures**, set privately in Settings, as the **amount of a repeating projected event**,
and derives each next event's **date from the ledger** (the "anchor-reset" rule, decisions 118–119):

- `weekly_groceries` → the **weekly shop**: one projected event every **7 days**, amount = the configured
  figure. Anchor: the most recent non-voided purchase with a positive allocation to `Groceries > Weekly Shop`.
  Top-up shops deliberately do **not** reset the week — they are spending *between* shops, and the tree keeps
  a separate category for them. The shop's recorded amount does not matter; if it happened, it counts.
- `monthly_fuel[vehicle]` → that vehicle's **fill**: one projected event every **30 days**, amount = the
  configured figure. Anchor: the most recent non-voided purchase with a positive `Vehicle Running > Fuel`
  allocation **targeted at that vehicle**. Fuel anchors are per car: filling one never resets the other.

The next event after an anchor is `anchor + cadence`; it repeats at the cadence while inside the window.
**No history, or overdue** (anchor + cadence already in the past — e.g. no shop recorded for 10 days): the
next event is projected **tomorrow**, then the cadence resumes. The projection may understate, never
overstate — an unknown shop is nearer than a known one. No weekend shifting: shops and fills happen on any
day. A voided purchase is no anchor; a refunded one neither (only positive allocations count).

An actual event therefore **suppresses projected spending for its cooldown window** and is never counted
twice: the £55 fill is inside the estimate the moment it is recorded, and the next projected fill for that
car is a month away — the window between carries no fuel projection at all. (The pre-v0.6.0 model smoothed
the figures pro-rata over the window and charged them up front; the recorded fill was then double-counted —
once in the estimate, once in the smoothed allowance — for the whole cadence window, and every lowest point
carried today's date.)

The events join the projection engine as ordinary expected outgoings with due dates (§7.2): within a day they
apply before receipts, like commitments. Two consequences the household can see: the **lowest point's date is
meaningful with day-to-day included** (it lands on a shop day, a fill day, or a commitment day — not always
"today"), and the projection panel/horizon list the dated events they are counting, so the inputs stay
visible. Events are household-level: pot scoping on the horizon does not filter them, and the §7.5 pot watch
still excludes them.

**Honesty loop:** Insights show recent actuals (e.g. last 4–8 weeks of Groceries and per-vehicle Fuel) against
these configured figures, so drift is visible and the config can be corrected. The projection panel lists
exactly which events it is counting and when — nothing invisible.

### 7.4 Documented limitation of "assume cleared" (accepted by the users)

A purchase made shortly **before** a checkpoint may still be pending at the bank and therefore *not* included
in the reported ledger balance — but the app assumes it is included and does not subtract it. The estimate can
therefore **overstate** available money by whatever was pending at checkpoint time (typically small, typically
1–3 days of card purchases), until the next checkpoint resets everything. The users chose this deliberately
(over an automatic safe window or tap-at-checkpoint marking) to keep admin at zero. The UI does not hide the
mechanism: the projection panel shows the last checkpoint time per pot, so staleness is visible. **The app
never claims precision it does not have.**

### 7.5 Pot-level "plan a transfer" watch (distinct from household warnings)

The household projection can look healthy while the Main account alone cannot cover the commitments due from
it — because the money is sitting in the Salary account and transfers are manual. So, separately:

```
pot_watch(P) = estimate(P) − Σ expected commitments due from P between now and payday
```

If `pot_watch(P) < 0`, the Overview shows a distinct, non-alarming **"plan a transfer"** notice naming the pot,
the shortfall and the earliest due commitment (fictional example: *"Main account is projected £666.08 short of
the DDs due from it before payday — Mortgage and Council Tax leave on the 1st; Salary account holds £520.00."*).
This is a planning nudge, not an overdraft warning; the pot-level watch deliberately excludes day-to-day
projection (groceries/fuel vary by pot and payment method and would muddy a transfer-planning signal).

### 7.6 Horizon (how far the money would go) — v0.5.0

The payday projection answers "will we reach payday without dipping below zero?" The **horizon** answers a
different question: **"if we only paid what is already expected, where would we land on date D — and how low
would we go on the way?"** It is the same arithmetic as §7.2 with the window freed from the payday: the user
picks any date up to 400 days ahead, and the engine runs to that date instead of to the next salary. The
field **opens on the day before the next scheduled income** (v0.13.0, decision 150), so the out-of-the-box view
answers *"where would we land the day before the salary lands?"*.

```days = throughDate − today             (whole days, local date arithmetic, today < throughDate ≤ today + 400)
where_we'd_land = household_available_now
                  + Σ expected receipts due in (today, throughDate]   (income, and expected debt inflows)
                  − Σ expected commitments due in (today, throughDate] (DD/SO instances)
                  − projected day-to-day events due in (today, throughDate]   (§7.3; toggleable, on by default)
```

- **Headline:** "Free to spend up to {throughDate}" — `where_we'd_land` — with the context line "Where we'd
  land on {throughDate}". With day-to-day excluded the page relabels itself "Free to spend on **bills** up
  to {throughDate}" so the figure is never mistaken for the full answer.
- **The lowest point always shows**, with its date and the §8 tier, whatever the window: a long window can
  look healthy at both ends and still dip hard in the middle (the DDs leave on the 1st), and the projection
  must say so rather than hide it in the headline. With day-to-day included the low lands on dated shop/fill
  events too (v0.6.0, §7.3), so the date stays meaningful — before the anchor-reset model every lowest point
  with day-to-day on read "today", the up-front lump's artifact.
- **Debt expected inflow joins this window** (and §7.2's) as expected money, flagged `expected` in the lists —
  a labelled expectation, never received income (§10.2). It lands on the debt's day-of-month, clamped like a
  schedule (OQ1) and moved off a weekend onto the previous Friday like income (§11.3, decision 7), and it
  counts in the window when either the configured day or the shifted date falls inside it (v0.7.0). From
  v0.7.0 the expectation also has a **start and an end**: occurrences project strictly after today and through
  the optional **until date** inclusive, and only for months the expectation has actually been planned for —
  a day-of-month or until-date edit is forward-looking (§10.2). A debt that has been **settled** — movements
  recorded and the balance brought to zero or below — expects nothing, while a debt with no movements yet is
  *not* settled and projects from the day the plan was set (fixing the v0.5.0 gap where a brand-new debt, £0
  and no movements, projected nothing at all).
- **The default date (v0.13.0, decision 150).** With no `?through=` (whatever else is in the URL), the date is
  **the day before the next scheduled income** — the earliest upcoming instance of a *receipt schedule*,
  already moved off a weekend (§11.3). Only scheduled income counts: a debt's expected support is borrowed
  money, never income (§10.2), so it never sets the default, even when it lands first. This deliberately
  differs from the payday window (§7.2) and the till figure (§7.7), which do count the support. The default is
  clamped into the selectable window: income **tomorrow** ⇒ tomorrow (the income day itself, so that window
  includes the salary — preferred to jumping to five weeks); income **beyond 400 days** ⇒ today + 400. With
  **no scheduled income at all** the long-standing default stands: five weeks ahead (today + 35). An explicit
  `?through=` that is valid and in range is always used as named. An annual-only income makes the default a
  long window, so the detail blocks start collapsed (> 60 days) — honest, if heavier.
- **Form order and applying (v0.13.0, decision 150).** The form reads top to bottom: **pots → Day-to-day →
  "Look ahead to" date → "Look ahead" button**. Changing the **date** applies the look-ahead itself (the form
  submits on the date's `change`), carrying the pots and Day-to-day chosen above it. Pots and Day-to-day do
  **not** apply on their own — the button is their explicit control, and the whole path without JavaScript.
  Clearing the date, or an invalid/out-of-range date, never submits (HTML validation still applies).
- **Every pot is selected by default**; the household untick to scope the projection. A debt's expected
  inflow counts only while the pot its loan movements actually go through is selected.
- **Search-params persistence:** the through date, pot selection and day-to-day toggle ride in the URL
  (`?through=…&pots=…&daytoday=…`), so a look-ahead can be shared and survives a refresh. The chosen date is
  clamped to the window on load, exactly as the transaction window clamps its dates. An empty pot selection
  means *every* pot, so unticking every pot and applying counts every pot again (the page says so under the
  checkboxes).
- **Detail blocks** (commitments, expected money in with the `expected` flag, day-by-day table) stay
  `<details open>` for windows of 60 days or less and start collapsed beyond that, so the honest inputs are
  one tap away without the page turning into a spreadsheet.
- The honesty line carries over from §7.4: it is a projection of the records already in the app, never a bank
  forecast, and *expected support is an expectation of borrowed money — it is owed, never income, and it lands
  only if it is actually borrowed and recorded.*

### 7.7 What is left before income lands (the till figure) — v0.9.0

A checkpoint answers *"what did the bank last say?"*. It does not answer *"will this card still work
tomorrow?"*, and the two differ exactly when it matters: a healthy balance with the mortgage leaving three
days before payday. The household asked for that second number beside the first, at the till and on the
review screens. It is the same arithmetic as §7.5, with the window taken to the next expected income
instead of a named payday.

```
free_to_spend = household_available_now (§7.1)
                − Σ expected commitments due in (today, next income]        (DD/SO instances, §11)
                − Σ projected day-to-day events due in (today, next income] (§7.3)

pot_spendable(P) = estimate(P) − Σ commitments due from P in the same window   (= §7.5's pot watch)
```

- **It counts no income.** This is the *dip*: everything already expected to leave, before the money lands.
  Adding the next receipt back in would turn "£500 with a £600 mortgage pending" into a comfortable picture
  and hide precisely the risk the household asked to see. It is not a forecast of the balance after payday —
  that is what §7.2's end-of-window figure and §7.6's horizon are for.
- **The next income is whichever comes first:** an income schedule's next instance or a debt's expected
  support (§7.2's payday selection, §10.2 — an expectation, labelled as one).
- **The household figure includes projected day-to-day events** (§7.3) because the weekly shop and the fill
  will really happen. **The per-pot figure does not** — groceries vary by pot and payment method, and a
  pot-scoped number is a transfer-planning signal (§7.5's reasoning, unchanged).
- **The per-pot figure is `pot_watch`** (§7.5) with this window: shown as a shortfall when the pot cannot
  cover the bills due from it, quiet context otherwise. It is the answer to "is *this* account about to
  bounce", beside the household answer to "are we about to bounce".
- **Shown at the till and on review:** the Quick Entry purchase panel (household headline plus the selected
  pot's checkpoint and its shortfall when there is one) and the pot cards on the home page and Overview. The
  projection panel (§7.2) is unchanged; its `projected_low` equals this figure whenever no other receipt
  lands inside the window (pinned by `tests/cycle-outlook.test.ts`), so the two surfaces cannot drift.
- **No window, no figure.** No income schedule (or no checkpoint) means the figure does not exist, and the
  UI says exactly what is missing rather than guessing or showing a zero. `free_to_spend` is null, never 0.
- **The checkpoint stays the reported figure.** This is read-only context in the entry form, never an edited
  balance (§5), and it is never called a bank balance. **Cash pots show no balance at all** — the household
  counts the notes (§15.1).

## 8. Warnings (two tiers)

Evaluated against `projected_low` (§7.2), household-wide:

| Tier | Condition | Presentation |
|---|---|---|
| Heads-up | `projected_low < £0` | Calm, distinct colour **and** label: "Projected to dip below zero before payday." |
| Warning | `projected_low ≤ −warning_threshold` | Stronger (still calm) colour and label: "Projected to be more than £W overdrawn before payday." |

- `warning_threshold` is a private per-installation config on the Main account's overdraft context. In the
  users' real installation it is set well inside their authorised limit (real figures never appear in this
  repo; fictional example: threshold £250 against an authorised limit of £800).
- The authorised limit itself is stored for context and shown alongside warnings so the distance to the limit
  is visible; crossing £0 is tier 1, the configured threshold is tier 2. No third tier in v1.
- Colours are never the only signal (blueprint §5 accessibility rule).

## 9. Purchases, splits and attribution

### 9.1 The purchase record

Fields: supplier (optional free text if unknown), **total amount** (integer pence), pot, date (defaults today;
backdatable) + auto timestamp, **paid_by** (defaults to the signed-in user; overridable), **entered_by**
(audit), one-or-more allocation lines, optional note.

Three distinct concepts are **never conflated** (handoff rule):

- **entered_by** — who typed the record (audit only).
- **paid_by** — who paid at the till / whose card or cash it was.
- **for_whom (target)** — on each allocation line: `household`, a `person`, or a `vehicle`.

### 9.2 Category and target defaults — visible, one-tap, never hidden

- The supplier's **most-used category** is preselected as a visible chip; one tap changes it. Supplier never
  forces a category: Tesco may preselect Groceries while Fuel, Household Goods or Personal/Clothing are one
  tap away.
- Target defaults: shared-type categories (Groceries, Utilities, Housing, Entertainment & Eating Out…) →
  `household`; personal-type categories (Personal/*) → the **payer**; Fuel and Vehicle Running → the **payer's
  own vehicle**. Every default renders as a small chip ("for: household ▾", "for: Vehicle A ▾", "paid by: me ▾")
  that opens the override — including assigning a personal purchase **to the other person** (Alex buying
  clothes for Sam lands as Sam's personal spending, one tap, no interrogation).
- Defaults are rules the users can see and correct; the app never guesses silently.

### 9.3 Splits

A payment can split into multiple allocation lines, each with its own amount, category (child) and target.
Fictional example — one Tesco payment of £63.47:

| Line | Amount | Category | Target |
|---|---|---|---|
| 1 | £41.98 | Groceries / Weekly Shop | household |
| 2 | £21.49 | Personal / Clothing & Shoes | Sam *(override from default Alex — bought for Sam)* |

- **Lines must total the payment exactly.** The save control stays disabled until they match; a one-tap
  *"assign remaining £X to…"* helper makes matching effortless. Amounts are whole pence, so "exactly" is
  always achievable — no rounding residue, no unallocated bucket.
- No draft/incomplete split records: a purchase is complete or it doesn't exist. Mid-entry abandonment loses
  nothing that was saved; the on-screen form survives brief connectivity loss (§14).
- Every allocation line has exactly **one** target.

### 9.4 No fractional sharing between the two people (agreed)

Couple activities — dining out, cinema, family holidays — are simply **household** allocations. There is no
"split evenly between us" line type, no percentages, no stored fractional ownership. If a genuinely
half-and-half personal case ever arises, the users record two explicit lines. This keeps every record
refundable, editable and analysable without fraction arithmetic. (The users reviewed the cinema-ticket
scenario and confirmed household-level granularity is all they need.)

### 9.5 Refunds and corrections

- A **refund** is its own negative record in the same category/target as the original, optionally linked to it
  (partial refunds are just a smaller negative amount). Refunds net off in insights and increase the pot
  estimate (§7.1).
- A **mistake** is corrected by edit (audit-logged) or **void** (retained, marked void, excluded from totals).
  Nothing is silently deleted. A purchase record is never deleted. Removing a receipt (§23.4) is a
  deliberate, audited removal of that file — not a silent deletion of the purchase, and not an undelete.
- A **duplicate** (e.g. both users recorded the same purchase) is resolved by voiding one copy — see §9.6.

### 9.6 Duplicate-entry protection (light-touch)

If a user saves a record with the same pot, supplier (or category) and amount as one saved by either user
within the last ~2 hours, a **non-blocking** notice appears: "Sam recorded a matching entry 20 minutes ago —
is this a duplicate?" with a one-tap link to review/void. It never blocks a legitimate second purchase
(two identical coffees are legal); it just makes the common accident visible immediately rather than at
month end.

## 10. Transfers and money across the household boundary

### 10.1 Transfers between the household's own pots

- Dedicated record type: from-pot, to-pot, amount, date/time, entered_by. Not spending, not income; excluded
  from every spending insight and from `projected_low`'s day-to-day figures; included in per-pot estimates
  (§7.1) so moving money can never look like losing or gaining money.
- The app never auto-creates transfers. Salary lands in the Salary account; moving it to Main is the users'
  decision, recorded when they do it (§7.5 nudges them when it matters).
- Cash between the two people is a transfer too: with one cash pot each (§4), John handing Janet £200 is
  recorded as John's cash → Janet's cash with a note — never an unexplained move absorbed by the next
  checkpoint.

### 10.2 Money across the household boundary (debts, swaps, other)

Borrowing, swaps with family, and anything else that is neither salary nor spending — the app's closed
world of §10.1 cannot represent these, so they get their own honest boxes:

- **Debts (informal IOUs).** A debt records who the money is owed to or by (`Mum`, `our son`) and which
  way round (`we_owe` / `they_owe`), plus an optional note. Its outstanding balance is always **derived**
  from the linked loan movements — never stored — so it cannot drift: for `we_owe`, borrowed minus
  repaid; for `they_owe`, lent minus repaid-to-us. Voided movements never count. No interest, no
  schedules: repayments simply reduce the balance, and a settled debt stays as history.
- **Expected inflow — a plan with a start, a changeable day and an end (v0.5.0; planned from v0.7.0 on).**
  Because the money that would settle a debt is often dependable (Mum's £1,000 each 12th, while the loan
  runs), a debt may carry a **read-only expectation**: an amount, a day-of-month and an optional **until
  date**. It feeds only the projections (§7.2, §7.6) and the `EXP<` rows on All Transactions (§15.3) as
  *expected* money — never the estimate, the Income page, All Transactions' `BAC` rows or any insight. It
  follows the income cadence: clamped to the month (OQ1) and moved off a weekend onto the Friday before
  (decision 7). The plan runs **strictly after today and through the until date inclusive** (no until date
  means "until you say otherwise"), so a five-payment arrangement ends itself: once the until date has
  passed, nothing projects from the next month.
  **A settled debt expects nothing** — settled meaning movements exist and the balance has been brought to
  zero (or below). A debt with **no movements yet** is *not* settled: it is exactly the debt the expectation
  was planned for, and it projects from the day the expectation was set. A month that has already been
  answered by a live loan movement is never projected twice: a money-in recorded from up to two days before
  an occurrence's expected date (the weekend shift can bring it forward) and before the next occurrence
  simply *is* that month's money. Recording the real Borrow is therefore what silences the expectation — not
  a manual tidy-up — and if the parents are late one month the panel is late with them rather than moving
  the pot on a promise (§7.1).
  **Edits are forward-looking.** Moving the day from the 10th to the 13th, or changing or clearing the until
  date, changes only what is still expected; recorded movements are immutable history. The expectation is a
  **plan, not a promise**: no month is flagged late, and stopping the arrangement is an edit (or the until
  date passing). The actual deposit is still a Borrow movement; the expectation is a label, never received
  income.
- **Borrowing and repayments (loan movements).** Money in linked to a `we_owe` debt is borrowing: it
  raises the pot estimate **and** the owed balance together, and the Overview shows the owed figure
  **beside** "available now" — borrowed money is never income. Money out against the same debt is a
  repayment: it lowers the estimate and the balance, and is never spending. (Lending mirrors this on a
  `they_owe` debt.) Loan movements always link to a debt and carry the debt's name.
- **Swaps.** Cash in one hand and a bank transfer in the other (the son's wages scenario): the two legs
  are created **atomically as one pair** sharing an exchange key — the same amount into one pot and out
  of another — so no money crosses the boundary and the halves can never be orphaned. On a later date
  the pair is net zero against `household_available_now`; on the same day as a timed checkpoint the
  estimate may read one leg low until the next checkpoint absorbs the in-leg — the safe direction
  (§7.1, E13). Pairs are managed where they were made: the Pots page lists each pair with its net
  total, per-leg edit, single-leg void (an honest correction) and one-step void-of-both-legs. Each leg
  stays an independent correctable record afterwards: voiding one leg leaves the other visible as the
  survivor, honestly, rather than cascading. Swaps never touch spending or income.
- **Other money in/out.** Anything else across the boundary, with a counterparty and **always a note
  saying what it was** — the note is what keeps miscellaneous money honest.
- Estimates, checkpoints, Insights: external money in adds like a receipt and money out subtracts like
  spending (§7.1); checkpoint assume-cleared applies (§5); Insights exclude external movements by
  construction (the join is over allocations). A checkpoint absorbs an estimate — it never absorbs a
  debt: what is owed survives every checkpoint.
- Correction discipline mirrors transfers: kind, direction, debt link and exchange key are immutable
  (a repayment does not become borrowing); voiding keeps history. To fix those, void and re-record —
  for a swap, void both legs and record it anew.

## 11. Recurring payments (DD/SO) and expected income

### 11.1 Schedules

A schedule carries: name (fictional example: "Energy Co direct debit"), kind (direct debit | standing order |
expected receipt), amount (**fixed**, user-maintained), **frequency (monthly | annual)**, due day-of-month,
pot, category (child) + target (e.g. Vehicle Running/Insurance → Vehicle A; Utilities/Energy → household),
an optional **contract end date** (§22.1 — informational + alert only; instances never auto-stop because of
it), active from/until.

The users' direct debits are fixed amounts; when one changes, they update the schedule and it applies **from
the next instance onward** — historical instances are never rewritten.

### 11.2 Lifecycle — auto-conversion, no double counting

Each schedule instance exists in **exactly one state at any moment**, enforced in code and covered by tests:

```
UPCOMING (expected commitment)          → due date arrives (local midnight) →
CONVERTED (actual record, tagged "from schedule")
```

- While UPCOMING, the instance reduces `projected_low` as an expected commitment (§7.2) and appears in
  "due this week"/calendar views. It is **not** in the estimate.
- On its due date it auto-converts into an ordinary record: spending (DD/SO) or receipt (income). Now it is in
  the pot estimate like any purchase (§7.1) and **no longer** counted as an upcoming commitment. One instance,
  one state, counted once.
- Converted records carry a quiet **"from schedule"** tag (transparency without admin) and are fully
  editable/voidable like any record.
- **Late or missed payment:** the converted record is simply edited (new date) or voided (never happened).
  The schedule itself can be ended with a cancellation effective date; instances after that date stop
  existing, instances before it are history.
- **Weekends/bank holidays:** v1 uses the configured due date as-is (UK banks shift collection dates
  themselves; the assume-cleared checkpoint cycle absorbs small timing slop). A per-schedule
  "shift to previous working day if weekend/bank holiday" toggle is proposed for income schedules
  (salaries commonly pay on the last working day) — flagged as an open question in the plan; no automatic
  shifting for DDs/SOs, and nothing in the UI implies that changing a date in the app changes a bank
  instruction. It does not; the app only ever changes its own expectation.

### 11.3 Income: expected receipts and one-off money

**Scheduled income.** Sam's salary is a schedule of kind *expected receipt*: fixed amount, monthly, due into
the Salary account on the configured payday. It enters `projected_low` as a receipt (§7.2) and converts to an
actual receipt record on the day, exactly mirroring §11.2. The payday that defines the planning cycle is this
schedule's due date.

**Payday never waits for the weekend.** When an income schedule's configured day falls on a **Saturday or
Sunday**, the money is expected on the **previous Friday** — that is when it actually lands. The rule applies
to income schedules only: a direct debit or standing order leaves on the date the household configured. A
shifted payday can therefore fall in the previous month (a salary configured for the 1st pays on the last
Friday of the month before), and one calendar month can hold two paydays. Bank holidays are **not** handled —
the app keeps no holiday calendar and will not guess one, so a Good Friday payday still expects the money on
that day; the receipt can be corrected by hand.

**One-off income.** Anything that arrives once is recorded by hand on the Income page (§15.2): the bicycle
sold for cash, the bank transfer from a buyer, a refund from a third party, a gift, a one-off job. Cash or
bank transfer is simply which pot it landed in. Each record is an amount, a pot, a date, an optional
**source** ("Sale of bicycle") and an optional note — and nothing else: income carries no category and no
target because it is not spending, and it never enters an insight (§12, §16).

Income records raise their pot's estimate like any other credit (§7.1) and appear in All Transactions as
`BAC` (§15.3). Borrowed money is never income (§10.2). Income *analysis* — income-versus-spending, a category
breakdown of receipts — remains out of scope.

**Scheduled income will slot**

## 12. Categories — two-level tree (approved 2026-09-20)

- **Allocations always land on a child (leaf) category.** Insights roll up to the parent ("Housing cost £X")
  with drill-down to children ("…Council Tax £Y, DIY £Z"). Exactly two levels — a third would slow till-time
  entry.
- The tree is user-editable in Settings: add/rename parents and children; **retiring** a child prevents new
  assignments but preserves history. Schedules also reference a child category + target.

Initial tree:

| Parent | Children |
|---|---|
| Housing | Mortgage/Rent · Council Tax · Buildings & Contents Insurance · DIY & Improvements · Gardening |
| Utilities | Energy · Water · Broadband · Mobile Phones |
| Groceries | Weekly Shop · Top-up Shops |
| Household Goods | Cleaning & Consumables · Homeware & Furnishings · Appliances |
| Vehicle Running | Fuel · Insurance · Maintenance & Repairs · Road Tax · Parking & Tolls |
| Personal | Clothing & Shoes · Health & Toiletries · Hair & Grooming · Hobbies |
| Entertainment & Eating Out | Dining Out & Takeaways · Cinema & Events · Holidays & Day Trips · Subscriptions & Streaming |
| Gifts & Donations | Gifts · Charity |
| Other | Uncategorised — anything here shows in a visible "needs filing" list so it cannot quietly rot |

Category (what it was) and target (who/what it was for) are **separate dimensions**: Fuel is a category;
*Vehicle A* is the target. That separation is what makes "everything Vehicle A cost us this year" one honest
query instead of a duplicated tree per car.

## 13. Vehicles

- Two vehicles (fictional labels: Vehicle A — Alex's; Vehicle B — Sam's), each a first-class **target**.
- Vehicle running costs in scope: fuel, insurance, maintenance & repairs, road fund licence, parking & tolls —
  anything allocated to the vehicle, including schedules (the insurance DD targets Vehicle A directly).
- Reporting answers *"what is Vehicle A costing us per month / rolling 12-month, in total"* — not "£75 on fuel
  this week". A vehicle has an owner for reporting roll-ups (owner totals = their personal totals + their
  vehicle totals, shown separately, never merged silently). Shared use needs no special handling: costs stay
  with the vehicle regardless of who paid or drove.
- **Fuel economy (v0.10.0, household request).** A fuel purchase may carry the odometer reading, the litres
  bought and whether the tank was filled to full. Both numbers are optional when the fuel is recorded and can
  be added later; from them the app works out the price per litre, mpg and fuel cost per mile (§15.1, §16.6).
- Out of scope: valuation, depreciation, trip or business mileage logs, maintenance reminders.

## 14. Connectivity, PWA, notifications

- **Online-only** (agreed). Entry requires a signal; if connectivity drops mid-entry, the app **keeps
  the half-typed record on screen** and retries the save on reconnection (single in-flight submission guard —
  no duplicate posts on flaky networks). No offline queue, no sensitive financial data cached on the device,
  no service-worker caching of pages or API responses.
- Receipt photos/uploads need connectivity like everything else (§23): the purchase save **never waits on an
  attachment**; uploads are retryable and can be added days later. The phone's own gallery is the temporary
  store for a photo taken without signal — the app keeps no offline queue of its own.
- **Installability shipped in v0.8.0** as a web app manifest (`public/manifest.webmanifest`) and icons
  (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) — no service worker, no caching, no offline
  queue. The manifest is a static file in `public/` so it is fetchable without credentials; a Next route
  would sit behind Cloudflare Access. The manifest and icon paths are bypassed at the Cloudflare Access
  level (path-scoped Bypass → Everyone policy); every other URL remains behind the email-policy app.
  SPEC §14's online-only rule stands unchanged; the household confirmed they do not want offline access.
- **No notifications/reminders** (agreed). Warnings live inside the app. An optional email alert
  channel for renewals/contract ends is a recorded **v2 roadmap item** (§22.3) — not a v1 blocker.

## 15. UX

### 15.1 Mobile — the "walking out of Tesco" tool

Purpose: fast, accurate entry at the till. It does not get into the weeds; review lives on the desktop.
All pages remain reachable on mobile (nothing hidden) — they are simply not the mobile design focus.

Home = four big actions:

1. **Add Purchase (redesigned v0.9.0, re-laid out v0.11.0)**. Two cards.
   - **Card 1, record it:** pot first, then the two balance figures (§7.7): the pot's **last
     reported checkpoint** with its age (bank pots only; cash shows nothing), the household **"free to
     spend before income lands"** headline, and the pot's own shortfall warning when the bills leaving it
     outrun it. Then supplier (typeahead: recents first, filtered as you type, inline rows, no browser
     popup; tapping a suggestion fills the name, applies the remembered category and moves to Amount) →
     amount → "+ Note" collapsed out of the way → a full-width **Next: category →** button. **There is no
     Save on card 1** (v0.11.0): the supplier's remembered category is only shown on card 2, and it must
     be seen before it is saved.
   - **Card 2, Category & allocation:** category → "For" (household / person / vehicle) → split lines →
     "+ Add split" → **Paid by** (one tap-button per person, radio semantics) → **Date** (full width,
     "Today if blank") → **Save purchase** (enabled only when the lines total exactly; remainder helper
     available) → confirmation with "Add another", which returns to card 1 on the supplier field.
     Changing Paid by re-targets any line still on the old payer's default (their car, themselves);
     lines pointed elsewhere by hand stay put.
   - **Focus at the till (v0.13.1, decision 151): nothing is focused when the page opens.** The till used
     to land on the supplier as soon as it was ready; on a real phone that raised the on-screen keyboard,
     the browser scrolled the focused field above it, and the Purchase / Fuel / Balance / Move tab strip
     went off the top of the screen with it. The household decides what to fill in by tapping it, so no
     field is focused as a side-effect of **the till becoming ready** or of **a type tab becoming
     visible** — Fuel and Balance open with nothing focused too. The card's first paint still shows the
     type tabs, the pot, the payday shortfall warning and the free-to-spend figure; the keyboard stays
     down.
   - **The phone opens at the till (decision 158, superseding 151's "the page does not scroll itself"
     clause; 151's focus rule stands unchanged).** The card sits ~1300px down the page behind the
     household total and the projection, so a phone opened at `/` landed on "Shared household ledger" and
     the household had to scroll to record a purchase — the one thing the phone is for. Now a mount-time
     **scroll, never a focus** (`scrollIntoView`, no `focus()` anywhere in the move) parks the card's top
     just below the sticky header (`scroll-mt-16` clears the 56px bar) so the type tabs are the first
     thing on screen, keyboard down. It is the phone layout only (`< lg`); a laptop still opens at the
     top. The mobile drawer's **Quick Entry (Till)** link carries `/#quick-entry`, so tapping it lands on
     the till even when the page is already open.
   - **Focus order once the household is typing:** supplier → amount → Next → category. Focus moves only
     as the answer to something they did: tapping a suggestion moves to Amount, Enter in Supplier moves to
     Amount, Next moves to the category, "+ Note" focuses the note it just opened, and "Add another"
     returns to Supplier on card 1. The keyboard's Enter/Go never saves from card 1: in Supplier it moves
     to Amount, in Amount (or the note) it is Next.
   - **Card switching (mobile only, v0.11.0):** the cards sit side by side in a clipped viewport and move
     with a short `translateX` slide. They are not a native scroll container. They switch on **Next**, the
     **dots**, or a deliberate swipe (≥50px sideways, clearly more sideways than down). Vertical scrolling
     never moves them (`touch-action: pan-y`), and the hidden card is `inert`. On a laptop (`lg:` and up)
     they are two static columns.
   - **Payer default:** Paid by starts on the person linked to the signed-in email (§15.2 "Signs in as"),
     else the first person.
   - The default pot is **a setting**, not a guess from a pot's label (§15.2 Settings). With none configured
     the form starts with no pot selected, and Save stays off until one is chosen — a purchase has to name
     the pot it came out of, and the server refuses one that does not.
   - **The till says whether it is listening.** The form is a client island: before React hydrates it, a tap
     switches nothing and a keystroke typed into a controlled input is wiped by the hydration render. So the
     section carries `data-till-ready` (false in the server-rendered HTML, true once mounted) and the tab
     strip and forms are `inert` until then, refusing input instead of silently swallowing it. The acceptance
     suite waits on that signal (`e2e/support.ts` · `waitForTill`) before it drives the till; assertions
     auto-wait, keystrokes do not.
2. **Add Fuel**: prefills the payer (the signed-in person, via "Signs in as"; else the first person), the
   pot default, category Fuel (fixed), and the vehicle = **that person's own vehicle** (its Owner; else
   the first vehicle). Vehicle and Paid by are tap-buttons, so the other car is one tap. Until a vehicle
   is tapped it follows Paid by. Once tapped, a Paid by change leaves it alone. The **amount is the only
   required typing**.
   - **Supplier (v0.11.0):** the same inline typeahead as purchases, fed **only suppliers with a previous
     fuel purchase** (the §16.6 definition), most recent fill first; "Did you mean" compares against those
     only. A new name can be typed and becomes a fuel supplier from its first fill.
   - **Litres and odometer (v0.10.0), both optional.** Two more boxes — litres from the pump or receipt,
     miles from the dashboard — and a **Filled to full** tick, **off by default** (v0.11.0; tick it when
     the pump clicked off at full). The price per litre is shown as the litres are typed (amount ÷ litres;
     never stored). Anything left blank can be added later from the purchase's row on Purchases or Overview
     ("Fuel details — add odometer & litres"); that edit is versioned and audited like any other, and shows
     the stored tick.
   - **The save answers with the mpg:** one sentence under the form — e.g. "Vehicle A: 41.2 mpg over 312
     miles since the last full tank. 40.12 L at 142.9p/L." — or, when mpg cannot be worked out yet, why
     (part fill: worked out at the next full tank; first full tank noted; a reading or litres missing).
3. **Update Balance** — pick pot (defaults to least-recently-updated), enter figure, save. Optional effective
   date. Two fields in the common case.
4. **Move Money** — between the household's own pots (a cash handover included), borrowing and
   repayments against a tracked debt, a swap with someone outside the household, or other money
   in/out with a note. Recorded in the moment, like everything else here.

Supplier memory: suppliers are remembered after first use; a supplier stores the most-used category as the
preselected (always visible, always changeable) chip. Near-duplicate supplier names prompt lightly at add
time ("Did you mean: Tesco?"). The suggestion list is rendered into the page (v0.9.0), because the
browser's native `<datalist>` popup is fiddly on a phone and different on every device.

Layout rule at the till (v0.9.0, tightened v0.11.0): a phone screen with the keyboard open is roughly half
a screen, so the critical fields and Next fit in it; inputs and buttons are at least 44px tall; and **the
page never becomes wider than the screen**, at 320px or at 360px with 130% text (Android's font and display
size settings). The tab strip is a four-column grid that shrinks, nothing unbounded is `nowrap`, the Quick
Entry section clips (`overflow-x: clip`) as a safety net, and on a phone the black card's padding is `p-2`.
A mobile test asserts `scrollWidth <= clientWidth` on every tab and both cards.

Till details fixed in v0.10.0: **one tap on Save saves** even with the supplier suggestions open (the list
no longer collapses under the finger); **every** control inside Quick Entry — tabs, chips, toggles, split
controls — is at least 44px tall, and a mobile test measures them; and the purchase form used to open with
the cursor in **Supplier**, once the till was ready to listen. **v0.13.1 reverses that last one**
(decision 151): on a real phone the keyboard it raised scrolled the type tabs off the screen, so the till
now opens with nothing focused and the household taps the field they want.

### 15.2 Desktop — the "sit down and review" tool

Dense and efficient: useful information per screen, minimal scrolling — but **density never sacrifices
functionality** (agreed correction to the original one-screen proposal). Readable text, real click targets,
clear grouping; dense is not cramped, and this is not a spreadsheet with tiny targets.

Menu pages:

| Page | Contents |
|---|---|
| **Overview** | The one genuinely dense single screen: household available-now + per-pot mini-balances inline + "last checkpoint" times + the owed/owing figures beside the total; warning banner when a tier is active; to-payday projection panel (payday date, expected receipts, commitments due, projected day-to-day events, projected low) with "what's in this forecast" expansions including the dated shops/fills list and a debt's expected support when one is in the window (v0.7.0); pot-level "plan a transfer" notice (§7.5); due-this-week commitments; **contracts & renewals inside their warning windows (§22.3)**; compact recent-entries list with inline edit and receipt attach/remove (§23.4); month-to-date by parent category with small bars. Quick-add always visible. |
| **Purchases** | Full history table; filters by date range, supplier, category, target, pot, person, tag (on a phone the filter card collapses behind **Show filters**, starts open if any filter is already applied, and From/To date share a row); inline editing; refund/void/correct with audit trail visible; split editing with the same exact-total rule; **receipt/invoice attachments (§23)** viewed, added and removed from the purchase row, with the audit line (who, when) in that row's History. |
| **All Transactions** | Read-only activity for one selected pot over a date window: every movement that touched it (purchases, direct debits and standing orders, transfers, borrowing and repayments, swaps, other money, **income**), one signed amount column (green in / red out relative to that pot), the original record's note, checkpoint dividers, a debt's expected support as flagged `EXP<` rows outside the totals (v0.7.0), and a link from every row to that record's canonical form. No add, edit or void on the page (§15.3). |
| **Recurring Payments** | The DD/SO/income schedule list (amount, frequency, due day, category, target, pot, next instance, state, contract end date where set); edit/cancel with effective dates; history of converted instances; **read-only month calendar view** of due instances (below). |
| **Horizon** | "How far the money would go" (§7.6): pick a date up to 400 days ahead (opens on the day before the next scheduled income; a date change applies itself, v0.13.0), scope by pot (all selected by default) and toggle day-to-day; the free-to-spend headline, the always-shown lowest point with its date and tier, and detail blocks for the commitments, expected money in (debts' expected support flagged `expected`), the projected day-to-day events (dated shops/fills, v0.6.0) and the day-by-day table. Same engine as the payday projection; laptop-shaped by the household's choice. |
| **Income** | Money coming in: the scheduled income (salary) that converts itself, editable in place from the next instance onward; one-off income recorded by hand with an optional source; and one list of everything received — scheduled and one-off together, with inline correction, void and the retained history. Income is desktop-shaped by the household's choice: it is not a till-side task, so nothing here is squeezed into the mobile quick-entry panel. |
| **Suppliers** | Supplier list + detail: contact card (phone, email, website, address, label→value reference pairs such as policy numbers, notes), interaction log with "+ Create Interaction", linked purchases (§21), including removing a receipt from a linked purchase (§23.4). Tap-to-call on mobile. |
| **Contracts & Renewals** | Key dates: renewal records with per-item warning leads and annual advance; schedules' contract end dates; everything inside its warning window first, sorted by date; history of past renewals (§22). |
| **Accounts & Pots** | Per-pot checkpoint timeline and current estimates; transfer records; staleness of every pot; overdraft context (limit, threshold) for the Main account; informal debts with derived balances and an optional expected-support plan (amount, day-of-month, until date — editable forward-looking, v0.7.0); borrow/repay/swap/other entry and history; archiving for empty pots. |
| **Insights** | §16 panels. |
| **Settings** | Household labels; pots; category-tree editor; projection figures; thresholds; payday/income config; default warning lead for renewals/contract ends; **the default pot for purchases** (v0.9.0 — an explicit choice, never a guess from a pot's label); **"Signs in as"** per person (v0.11.0 — which allowlisted `AUTH_ALLOWED_EMAILS` sign-in is that person; drives the till's Paid by and Fuel vehicle defaults; audited, unique, stored only in the private database); each vehicle's Owner shown. (Suppliers live on their own page.) All private numbers live here at runtime — never in the repo. |

**Calendar (agreed: read-only month view).** A month grid on Recurring Payments showing due DD/SO instances and
expected receipts — another view of the same schedule data, never a second database. Clicking a day shows that
day's instances and opens the ordinary schedule editor. **No drag-and-drop**, and the UI states plainly that
changing a date in the app changes only the app's expectation, never a bank instruction.

**Version display:** the app version is visible unobtrusively on desktop and mobile (blueprint §1).

### 15.3 All Transactions — read-only activity for one pot (v0.3.0 line; household sketch 2026-09-23)

One page, one pot at a time: every movement that touched the selected pot inside a date window, in
one dense table — purchases, direct debits and standing orders, transfers, money across the
household boundary, and income (`BAC`). It is a **pure projection of existing records** — it stores nothing, renders no
forms, and every row links to the canonical record that owns the add/edit/void behaviour and the
retained history. (One derived exception since v0.7.0: a debt's expected support renders as a flagged
`EXP<` row that is not a record at all — it links to the debt, not to a form.) It is not statement import and not bank reconciliation, both of which remain
non-goals (§2): the rows are the household's own records, not a bank's lines.

**Filters.** A target selector (the household's live pots; the default is the pot labelled
`Main account`, else the first pot) and a start/end date pair compared against each record's local
`occurred_date` — never against an instant. Quick picks: **last 30 days** (the default), **since last
checkpoint** (that pot's most recent checkpoint's effective date; a never-checkpointed pot falls
back to 30 days and says so) and **this month**. The end date cannot be in the future, because no
record can be (§9.1). The list caps at the newest 500 rows and says so, rather than truncating
silently.

Archived pots are not offered, and that strands no history: a pot can only be archived when it has
no records at all — no checkpoints, purchases, transfers, receipts, external movements or schedules
(§4) — so an archived pot's activity view is empty by construction.

**Columns.** Date · Type · Source · Category · Amount · Notes. The date column is **date-only,
`YYYY-MM-DD`** (household choice, 2026-09-23): a record entered without a time carries the
end-of-local-date marker as its instant, so printing that instant would show a `23:59` that never
happened. Other pages keep their existing date rendering; this is not an app-wide change.

There is **one row per record, never one per allocation line**, so the amount column always sums to
the stated total. A split purchase shows its first allocation line and "+N more"; the whole split is
behind the row's link. The amount column is single and coloured by sign: **green = money into the
selected pot, red = money out**, so one pot→pot transfer is automatically green on one side and red
on the other with no data change anywhere.

| Code | Record | Source cell | Category cell | Notes cell |
|---|---|---|---|---|
| `PUR` | `purchases`, manual entry | supplier name | allocation: `Parent / Child (Target)` | `purchase.note` |
| `REF` | `purchases` with `refund_of_purchase_id` set — a credit, shown green | supplier name | as above | `purchase.note` |
| `DD` | purchase converted from a schedule of kind `dd` | the schedule's supplier | the schedule's category + target | `purchase.note` (`From schedule "…"`) |
| `SO` | purchase converted from a schedule of kind `so` | the schedule's supplier; a standing order may have none (§11.1), in which case the schedule's own name is shown | as above | `purchase.note` |
| `TX<` `TX>` | `transfers` (internal) and `external_movements` kind `other` | the other pot's label, or the counterparty | — | `note` (mandatory for `other`, §10.2) |
| `LN<` `LN>` | `external_movements` kind `loan` | the counterparty (the debt's name) | — | `note` |
| `EXP<` | *derived, not a record*: a debt's expected support due that day (§10.2, v0.7.0), always money in | the counterparty (the debt's name) | — | `expected — not recorded yet` badge; the row links to `/pots#debt-{id}`, not to a form |
| `SW<` `SW>` | `external_movements` kind `swap`, one row per leg on the pot it touched | the counterparty | — | `note`, plus a `swap (paired, £X with <pot>)` badge |
| `BAC` | `receipts` (income) — a one-off entry, or a receipt converted from an income schedule | `receipt.source`, else the income schedule's name, else "Income" | — (income has no category) | `receipt.note` (`From schedule "…"` when converted) |

`POS` and `BYP` from the household sketch stay unallocated: purchases carry no payment channel and
no channel field is added for this page (§9.1's three concepts are entered-by, paid-by and
for-whom; a fourth, typed at the till and read by one column, is not worth its cost). Income is
rendered as `BAC` (v0.4.0): one-off income is recorded on the Income page rather than as other money
in, so a third-party credit reads as income, and a converted salary reads as income too, named by
the schedule that produced it. Borrowed money still appears as `LN<` — it is never income (§10.2).

**Expected support rows are flagged, never counted (v0.7.0).** A debt's expected inflow (§10.2) is the one
thing on this page that is **not a record**: it renders as a green `EXP<` row dated the day the money is
expected, badged `expected — not recorded yet` and linking to the debt on the Pots page, so the plan is
visible in the same list as the money that has actually moved — on the due date itself, which is when the
household needs to record the borrowing, and for the days that follow while the window still covers it. It is
deliberately outside the totals: the count line above the table and the total row both say how many
expectations were shown and what they come to ("≈"), and the footnote spells out that they are not counted,
because nothing has moved and the estimate has not changed. Each row **gives way to the real thing**: once
the Borrow for that month is recorded, the `LN<` row takes its place and the expectation stops projecting
that month (§10.2). Expected rows speak only for months **since the plan was set** — an expectation added in
late September does not retro-fit a September row — and they render in date order with everything else. The
window still cannot reach into the future (§9.1), so a payment due next month is not listed here yet: the
projections (§7.2, §7.6) are what show the plan ahead, while this page shows the money that moved — or was
expected to move — on the days the window covers.

**Voided records are excluded** (`voided_at IS NULL` on every family) and no void or history
machinery is rendered; corrections happen on the canonical page behind the link. **Refunds are
shown** as green `REF` rows: a refund is already just a purchase with a negative total and the
estimate counts it (§7.1), so hiding it would make this page disagree with the pot for no gain.

**Checkpoints render as divider rows** inside the window — effective date, the reported figure and
the note — visually distinct from transactions, excluded from the total, and labelled *reported*,
never *balance*.

**The total row reads "movements shown", not "estimate change".** It is the sum of the rows above,
and it can legitimately differ from the movement in the pot's estimate: voided records are invisible
here, and §7.1's sign-aware rule absorbs a date-only credit that shares a checkpoint's local date
while counting a date-only debit. The page says so rather than implying an equality it cannot keep.

**Deep links.** Each row links to its record's canonical form: purchases to
`/purchases?potId&from&to#purchase-{id}`; `DD`/`SO` rows additionally to `/recurring#schedule-{id}`;
internal transfers to `/overview?transfer={id}#transfer-{id}`; boundary money (other, loan, swap
legs) to `/pots?external={id}#external-{id}`, swaps also under `/pots#swaps`; income to
`/income?receipt={id}#receipt-{id}`. Those anchors and the
`?transfer=` / `?external=` parameters exist so that a linked record lying outside a page's recent
list is still rendered and findable, instead of the link landing on a list that no longer contains
it.

**Running balance is not shown** (deferred, not rejected): every pot balance is checkpoint-based, so
any running figure is relative to the last checkpoint only — and on a checkpoint's own day §7.1
makes even that ambiguous.

**The lazy due pass still runs** on this page as on every read page (§11.2), so a direct debit that
came due today appears. "Read-only" means no user-facing writes: no form on this page can create,
edit or void anything.

### 15.4 Appearance — colour lives in one place, so a theme is cheap (Phase 1, 2026-09-25)

The household's standing requirement (recorded as decision **159**): the colour scheme must be
arranged so that **adding a new theme is a small, single-place change — not an app-wide edit in
every page**. Phase 1 (this release) delivers the precondition only: it tokenises the existing
single scheme with **zero visual change**. No theme, no toggle, no `dark:` variants, no
`prefers-color-scheme` — those are Phase 2.

- **One block.** Every colour is a custom property in a single Tailwind v4 `@theme` block in
  `src/app/globals.css` (semantic names for the neutral spine — `canvas`, `surface`, `border`,
  `ink`, `till` — and ramp numbers for the chromatic families `accent`, `positive`, `warning`,
  `danger`, `negative`, `note`, `chart-…`). A page or the chart kit never names a palette colour;
  `tests/colour-tokens.test.ts` fails the build if a raw palette class or a colour literal sneaks
  back into `src` (the one allowed literal is the PWA `themeColor`, §14).
- **A theme redefines tokens, nothing else.** Because no component knows what any colour *is*, a
  Phase-2 theme is one block that re-declares the same `--color-*` names under a selector (e.g.
  `<html data-theme="dark">`). Nothing else changes. Today's distinctions stay distinct
  (`ink-muted` ≠ `ink-soft`), so a theme cannot accidentally collapse two greys.
- **The till is dark by design.** `--color-till` / `--color-till-ink` is the one darkest surface and
  its ink, shared today by the till, the primary buttons and the active dark pills; a theme may split
  it later, in the token block, not in the pages.
- **Charts read tokens** as `var(--color-chart-…)` through inline styles (SPEC §16.7), so every rule
  there — colour never the only signal, legend plus table twin, hatched in-progress period — is
  untouched by the token pass and survives any theme.
- **Known limitation carried to Phase 2:** the PWA `theme_color` / manifest colour (§14) is consumed
  before any stylesheet is parsed, so it cannot be a CSS variable. Phase 1 pins the three literals to
  the `--color-till` colour and checks they agree; Phase 2 must decide the chrome colour per theme
  (e.g. the `media` form of `themeColor`) or accept the light-theme chrome.

## 16. Insights (initial scope — small and useful)

1. **Month vs previous month** — total spending and by parent category (calendar months), with child
   drill-down.
2. **Personal comparison** — each person's for-person allocations (e.g. Clothing, Hobbies), side by side,
   per month. Household allocations are **never** attributed to whoever happened to pay.
3. **Vehicle running costs** — per vehicle: monthly totals and rolling 12-month, by child category
   (fuel/insurance/maintenance/road tax/parking).
4. **Projection feedback (honesty loop)** — configured weekly grocery and per-vehicle monthly fuel figures vs
   recent actuals (last 4–8 weeks), so drift is visible and fixable.
5. **To-payday projection strip** — lives on Overview (§15.2) with the two warning tiers and the pot-level
   transfer watch.
6. **Fuel economy (v0.10.0, §16.6)** — per vehicle mpg and fuel cost per mile from the litres and odometer
   readings recorded with fuel purchases.
7. **Charts (v0.14.0, §16.7)** — the same figures drawn, on their own page at `/charts`: the month ahead,
   the weekly shop, personal spending and the fixed commitments. Insights keeps the tables; the two always
   agree, because they read the same records.

### 16.6 Fuel economy — how mpg is worked out (v0.10.0)

- **Full tank to full tank, UK gallons.** A stretch starts at a full tank with an odometer reading and ends
  at the next full tank. Part fills in between add their litres and cost to the stretch. mpg = miles ÷
  (litres ÷ 4.54609); fuel cost per mile = the stretch's fuel cost ÷ its miles.
- **Honest gaps.** A stretch is not measured — and the app says why — when its closing full tank has no
  odometer reading, when any fill in it has no litres, or when the odometer did not go up. A result below
  8 or above 150 mpg is shown with "worth checking the readings", not hidden.
- **Only fuel counts.** A fuel purchase is one whose Fuel lines all go to a single vehicle; its fuel cost is
  those lines only, so a split with a shop item does not distort the price per litre. Refunds and voided
  purchases are ignored.
- **"Filled to full" is off by default (v0.11.0).** A forgotten tick on a genuine full tank only lengthens
  a stretch — its litres roll into the next full tank, so the figure stays right — whereas a mistaken tick on
  a part fill produces a wrong mpg. When a vehicle's last three or more fills have none marked full,
  Insights says "no full tank marked in the last N fills — mpg needs one".
- **Insights shows, per vehicle:** the latest measured stretch; the last 12 months (total miles ÷ total
  gallons — a ratio of totals, never an average of averages); fuel cost per mile; the latest price per litre;
  recent fills missing litres (or, on a full tank, the odometer), each linked to its Purchases row; and the
  recent fills.

### 16.7 Charts — the four drawings, and the rules they all keep (v0.14.0)

`/charts` answers four questions with four pictures. Every figure on it is the same arithmetic the tables
on `/insights` use, over the same records, so the two can never disagree.

**A. Where the balance goes, today to a month ahead.** A step area of the **household total** (every pot,
day-to-day included) from today to one month out, from the same projection engine as Overview and Horizon.
Today's point is the household's own reported figure plus recorded activity; every later point is
projected. The y-axis **always includes zero**, with room on both sides: going below zero is a place on the
chart, tinted, not a line that clips at the axis. The overdraft limit is a dashed line when the chart
reaches that far down and a sentence in the caption when it does not. The lowest point is labelled on the
drawing, income days are ticked along the axis, and the verdict sentence states the amount and the date —
"Projected to go £1,831.27 below zero on Fri 9 Oct. That is past the £800.00 overdraft limit from Mon 28
Sept." A laptop also gets the three biggest outgoing days and a day-by-day breakdown of what lands.

**B. Is the weekly shop creeping up?** Bars for Monday–Sunday weeks of everything under the Groceries
parent — 12 weeks on a phone, 26 on a laptop — against two reference lines: the configured weekly figure
and the trailing 8-week average. **A week with no shop is a zero week, not a missing one**; anything else
would flatter the average. The week being lived is drawn hatched and never counts towards the average,
which is the honesty loop's rule (§16.4) and its exact figure.

**C. Hers, his, household.** Stacked monthly bars of discretionary spending — 6 months on a phone, 12 on a
laptop — split into one series per person plus a Household series. Attribution is **"For: person"**, the
allocation's target, never "Paid by": whose card was used says nothing about whose spending it was.
Household-marked spending (a joint takeaway, a shared subscription) is its own bar and is **never split**
between people. The scope is the parents *Personal* and *Entertainment & Eating Out*, resolved from the
live category tree rather than a fixed list of children, so a child added under Personal is in scope the
day it is created. Chips filter the chart by person; the choice lives in the URL.

**D. Are the direct debits coming down?** Monthly bars of the household's **tracked fixed commitments**.
"Direct debit" is not a field on a purchase, so the definition is an explicit list of child categories,
ticked in Settings (`commitment_category_ids`) — Insurance and Road Tax, say, but not Fuel, which is why
the list is by child and not by parent. Until something is saved, the chart tracks the categories the
household's own direct debits and standing orders already use, and says so. A **schedule-converted only**
toggle narrows the chart to purchases the app converted from a schedule (`purchases.scheduleInstanceId`) —
true DD/SOs, no hand-typed bills.

**Rules every chart keeps.**

- **Hand-rolled SVG, server-rendered** (`src/components/charts/`), no chart library and no client
  JavaScript: the drawing is in the first paint on a phone, with nothing to hydrate.
- **A verdict sentence above the drawing**, and the same sentence as the SVG's `aria-label`; the SVG is one
  `role="img"` to a screen reader.
- **A table twin under `<details>`** for every chart — the same numbers, exact, copyable, keyboard
  reachable, working without JavaScript.
- **Reported vs projected is always stated**, as a badge and in words.
- **Colour is never the only signal**: every series is named in a legend and in the table twin, and an
  in-progress period is hatched as well as labelled.
- **Drill-down is a real link.** A bar wraps an `<a>` at `/purchases?from=…&to=…&categoryId=…` (the same
  link is repeated in the table twin, which is the keyboard path), so it can be opened in a new tab or sent
  to the other person. Those filters match the **purchase**, and a matched purchase comes back with all of
  its lines, receipt-style — so a split shop appears whole, not as the single line that matched. The page
  says so.
- **Responsive by `viewBox` and two variants**: a 320px-wide drawing for a phone, a 720px one for a laptop,
  chosen by CSS. Neither pans the page sideways at 320px, or at 360px with 130% text.

Later candidates (explicitly **not** v1): supplier top-N, category trends over many months, cash-vs-card
mix, seasonal comparisons.

## 17. Worked examples (all figures fictional)

Personas: Alex and Sam. Pots as §4. Config (fictional): payday = 26th; salary £2,150.00 monthly into Salary
account; `weekly_groceries` £90.00; `monthly_fuel` Vehicle A £75.00, Vehicle B £60.00; authorised overdraft
limit on Main £800.00; warning threshold £250.00. Schedules (fictional): Energy DD £84.55 due 28th (Main,
Utilities/Energy, household); Mortgage DD £685.00 due 1st; Council Tax DD £178.42 due 1st; Broadband DD
£42.00 due 3rd; Mobile DD £24.99 due 10th (all Main).

### E1 — Mixed Tesco receipt (mobile acceptance scenario)

Saturday the 27th, 14:10. Alex walks out of Tesco, one card payment **£63.47** from Main. Entry: supplier
"Tesco" (remembered; Groceries chip preselected) → amount 63.47 → **Split**: line 1 Groceries/Weekly Shop
£41.98 target *household* (default chip, untouched); line 2 — Alex taps Personal/Clothing & Shoes; the target
chip defaults to *Alex* (payer) but the clothes are Sam's, so Alex taps it once → *Sam*. Lines total £63.47 =
payment total → save enabled. Paid-by Alex (default), entered-by Alex (audit). Insight effect: £41.98 to
household Groceries; £21.49 to **Sam's** personal Clothing total — not Alex's.

### E2 — Fuel stop (mobile acceptance scenario)

Alex fills **Vehicle A**, £58.20. Home → Add Fuel: payer Alex, target *Vehicle A*, category Vehicle
Running/Fuel, pot Main — all prefilled as visible chips; Alex types 58.20 and saves. Two taps plus digits.
(If Alex had filled Sam's Vehicle B, one tap flips the vehicle chip — the cost still belongs to Vehicle B.)
Since v0.10.0 Alex may also type **40.12** litres and the odometer **52,622**, tick left on "Filled to full";
the last full tank was at 52,310 miles, so the save answers "Vehicle A: 35.4 mpg over 312 miles since the
last full tank. 40.12 L at 145.1p/L." Left blank, the purchase saves exactly as before and the numbers can
be added from Purchases later.

### E3 — Direct debit lifecycle: counted exactly once

Energy DD £84.55, due the 28th, from Main.

| When | Instance state | Where the £84.55 appears |
|---|---|---|
| 26th (before due) | UPCOMING | Projection only: reduces `projected_low`; listed in due-this-week. Not in the estimate. |
| 28th (due date, local midnight) | CONVERTED | Ordinary spending record dated 28th, tagged "from schedule", pot Main. Now inside `estimate(Main)` (checkpoint predates it). Removed from UPCOMING lists the same moment. |
| 30th, Alex checkpoints Main at £412.35 (ledger now includes it) | history | Record dated **before** the new checkpoint → excluded from the fresh estimate (already inside the reported balance). Still in history and insights. |

At no instant is the instance in two states; at no checkpoint is it subtracted twice. If the bank is late or
the DD is cancelled, the converted record is edited/voided (audit trail) and the schedule ended with an
effective date — future instances stop; past ones remain history.

### E4 — Transfer between pots

25th: the users move **£400.00** Salary → Main to cover the 1st's mortgage. Recorded as a transfer:
`estimate(Salary)` −£400, `estimate(Main)` +£400, `household_available_now` **unchanged**. No spending
insight, no category, no effect on `projected_low`'s day-to-day figures. Transfers can never inflate spending.

### E5 — The assume-cleared limitation (honest walkthrough)

Saturday 21st, 16:00: Sam buys £45.99 at a supermarket (card, Main). Sunday 22nd, 17:00: Alex checkpoints Main
at **£412.35** — the bank's *ledger* balance, which does **not** yet include Saturday's still-pending £45.99.
The app assumes pre-checkpoint purchases are included, so it reports available = £412.35. Truth at the bank:
once the purchase clears, £366.36. **The estimate overstates by £45.99 until the next checkpoint.** Agreed and
documented (§5, §7.4): zero admin, self-correcting, bounded by whatever was pending at checkpoint time. The
UI never claims the estimate is bank-verified; "last checkpoint Sun 17:00" is always visible.

### E6 — Backdated entry is absorbed, never double-subtracted

Wednesday 25th: Alex remembers a Tuesday 24th purchase of £12.50 and backdates it. Latest Main checkpoint:
Sunday 22nd 17:00 → the record is *after* the checkpoint → subtracted from the estimate (correct — the bank
has taken or will take it). Later, Alex checkpoints again on Wednesday evening; the bank ledger now includes
the £12.50, and the record predates the new checkpoint → excluded from the fresh estimate. Counted exactly
once at every stage.

### E7 — Both users record the same purchase

14:10 Alex saves the Tesco £63.47 (E1). 14:31 Sam, not knowing, saves Tesco £63.47 from Main. On save, Sam
sees the non-blocking notice: "Alex recorded a matching entry 21 minutes ago — is this a duplicate?" Sam taps
through, confirms, and voids their copy. The voided record remains in the audit trail; totals unaffected.
Had it been two genuinely identical purchases, Sam would simply dismiss the notice.

### E8 — To-payday projection with warning tiers (forecast acceptance scenario)

Friday 27th, 20:00. Checkpoints: Main £412.35 (26th 18:05) − E1's £63.47 recorded since = **£348.88**;
Salary £520.00 (26th); Alex's cash £41.20; Sam's cash £28.62.
`household_available_now` = **£938.70**. Next payday: the 26th → `days = 29`.

Outgoings in window:
- Commitments due: Energy £84.55 (28th) + Mortgage £685.00 (1st) + Council Tax £178.42 (1st) + Broadband
  £42.00 (3rd) + Mobile £24.99 (10th) = **£1,014.96**
- Projected day-to-day events (§7.3, v0.6.0): the last Weekly Shop is E1's Tesco run, **today** (the 27th),
  so shops are projected every 7 days from it — 4th, 11th, 18th, 25th — **4 × £90.00 = £360.00**. The last
  fills: Vehicle A £75.00 on the 12th → next fill **12 October**; Vehicle B £60.00 on the 8th → **8 October**
  — **£135.00** between them. Total day-to-day: **£495.00**.

Receipts in window: salary **£2,150.00** on the 26th.

```
running low, day by day: 938.70 → 854.15 (28th, Energy) → −9.27 (1st) → −51.27 (3rd)
  → −141.27 (4th, weekly shop) → −201.27 (8th, fuel B) → −226.26 (10th, Mobile)
  → −316.26 (11th, shop) → −391.26 (12th, fuel A) → −481.26 (18th, shop)
  → −571.26 (25th, the cycle's last shop) → +2,150.00 lands on the 26th → £1,578.74
projected_low = −£571.26 on the 25th   (the last weekly shop of the cycle, just before salary)
```

Tier check: −£571.26 ≤ −£250.00 → **Tier 2 Warning**: "Projected to be more than £250 overdrawn before
payday." (Had it fallen between £0 and −£250, only the Tier 1 heads-up would show.) The panel expands to list
every input: five commitments, salary, and the six dated day-to-day events with their amounts — nothing
invisible.

Pot-level transfer watch (§7.5): `pot_watch(Main)` = £348.88 − £1,014.96 = **−£666.08** → distinct notice:
"Main account is projected £666.08 short of the DDs due from it before payday — Mortgage and Council Tax leave
on the 1st; Salary account holds £520.00." The household warning and the transfer nudge are separate signals
with separate remedies.

### E9 — Contract ends, renewals and key-date alerts (fictional)

- **Renewal:** "Vehicle A insurance — InsurerCo", renewal date 12 October, warning lead 21 days (default),
  repeats annually, target Vehicle A, supplier InsurerCo (contact card holds the policy-number reference and
  phone number). From **21 September** the Overview panel shows: *"Vehicle A insurance renews in 21 days —
  check quotes before it auto-renews"* — one tap to InsurerCo's contact card (tap-to-call on mobile) and one
  more to "+ Create Interaction" to log the call while it's fresh. On 12 October the renewal advances to
  12 October next year automatically (visible, editable; 29 February handling per plan OQ13). If the premium
  is paid by annual lump, that is simply a schedule with `frequency = annual` converting on the day (§11.2) —
  the alert and the money are separate, complementary things and never double-counted.
- **Contract end:** the Broadband DD (£42.00 monthly) carries `contract_ends_on = 3 November`. From
  13 October (21-day lead, configurable) the panel shows: *"Broadband contract ends 3 November — time to
  shop around."* **The DD instances never auto-stop**: the schedule keeps forecasting £42.00 until the users
  edit or cancel it after renegotiating, because UK fixed-term deals typically roll onto monthly and the app
  never assumes a bank instruction changed. A past end date displays as "rolled / awaiting review" — a quiet,
  honest state, not a silent deletion.

### E10 — Cash handover between the two people (transfer acceptance scenario)

Sam has £500 in personal cash; Alex has £50. Alex asks Sam for £200 towards a coat, and Sam hands
over the notes. Alex records a transfer there and then (Move → Between pots): Sam's cash → Alex's
cash, £200, note "coat money". `estimate(Sam's cash)` −£200, `estimate(Alex's cash)` +£200,
`household_available_now` **unchanged**, no spending insight touched — and the next morning the
history says exactly why both pots moved. Alex then buys the coat and logs it as
Personal/Clothing & Shoes against Alex's cash, which is the spending.

### E11 — A family loan, borrowed and repaid (debt acceptance scenario)

A family member lends the household £1,000 in cash to help cover direct debits until spring. The
users track a debt ("Mum", we owe) and record borrowing of £1,000 into Alex's cash. The pot
estimate rises £1,000 **and** the Overview shows "Owe others £1,000" beside "available now" — the
money is spendable and the owing is visible, in the same glance, never labelled as income. Paying
the cash into Main is an ordinary internal transfer (Alex's cash → Main, £1,000). Months later a
repayment of £250 from Main lowers the estimate and the owed balance together — never spending —
until the debt reads "settled" and stays as history.

**Expected inflow — planned, changed and stopped (v0.5.0; live plan from v0.7.0).** The household also sets
Mum's debt to *expect £1,000 support on the 12th* — the money she reliably sends while the loan is live —
and, because the arrangement runs for a known stretch, an **until date** of 10 February, its last payment.
The estimate does not move, the Income page shows nothing new, and no `BAC` row appears: an expectation is not
a receipt, and the pot never moves on a promise. The projection (§7.2) and the horizon (§7.6) do show it,
flagged `expected`: money in on the 12th (or the Friday before when the 12th is a weekend), into Alex's cash,
one occurrence a month through the until date inclusive — and nothing from March. On All Transactions (§15.3)
an `EXP<` row appears on the due date, flagged `expected — not recorded yet` and outside the totals, as the
nudge to record the Borrow; it gives way to the real `LN<` the moment that month's money is recorded. If the
parents move the payment to the 13th, the household edits the day and only what is still expected moves —
months already recorded stay exactly as they were, and the next occurrence is the 13th. A month that goes by
unrecorded is not treated as late: the next one still projects, because the expectation is a plan, not a
promise. And a debt that has **never had a movement** is not settled — it is the very debt this arrangement
exists for, so it projects from the day the expectation was set; once it *is* settled (movements recorded,
balance at zero) it expects nothing at all.

### E12 — Cash for a bank transfer (swap acceptance scenario)

Their son is paid £120 in cash and hands it over; the household transfers £120 from Main to his
bank account. One action (Move → Swap): money in £120 to Alex's cash, money out £120 from Main,
counterparty "our son", recorded as an atomic pair. Both pot estimates move in opposite directions by
£120; on a later date `household_available_now` is unchanged, and if the swap and a checkpoint land on
the same day the total may read £120 low until the next checkpoint (E13 — the safe direction).
Insights see nothing — no phantom income, no phantom spending. If the cash never arrives, the pair can
be voided in one step with a shared reason, or one leg voided alone, leaving the other visible as the
survivor rather than vanishing by cascade.

### E13 — Same-day swap, same-day checkpoint (v0.2.1 acceptance scenario)

Alex's cash is checkpointed at £20.00 on the 22nd. On the 23rd the son's wages arrive: a swap of
£80.00, recorded date-only (in-leg into Alex's cash, out-leg from Main).

1. 22nd, 10:00 checkpoint £20.00 → Alex's cash estimate **£20.00**.
2. 23rd swap in £80.00 (later date than the 22nd's checkpoint) → **£100.00** (£20 + £80).
3. 23rd, 12:00 the cash is counted and checkpointed at £100.00 — the count already includes the £80
   in hand → estimate **£100.00**, not £180.00 (the v0.2.0 bug: the date-only credit shared the
   checkpoint's date and was counted again).
4. 23rd, 18:00 a second £100.00 checkpoint → still **£100.00** — no same-day checkpoint could ever
   confirm the credit under the old rule, so the estimate stayed wrong all day.
5. 24th, 09:00 a £100.00 checkpoint → **£100.00**, as it always was.

The out-leg sits in Main: with Main uncheckpointed it produces no estimate (a pot without a checkpoint
has no estimate — no phantom number is invented). Had Main been checkpointed at 12:00 on the 23rd, the
out-leg (a same-day debit) counts against it and Main reads £80 low until Main's next checkpoint — the
safe direction, self-correcting, while the in-leg is absorbed. Acceptance: steps read
2000 / 10000 / 10000 / 10000 / 10000 pence; live v0.2.0 data self-heals under the new rule — no
migration.

## 18. Backup, restore and data locations

Backup/restore has been in scope since day one (§2, README, plan Phase 5) under the `AGENT_APP_BLUEPRINT.md`
§6 contract. This section pins it to Simple Finance specifically, including the documents directory
introduced by attachments (§23).

### 18.1 Data locations (fixed by the product owner)

Host path on Unraid: **`/mnt/user/appdata/simple-finance`**, mapped to container **`/data`**:

```text
/mnt/user/appdata/simple-finance/        →  /data/
  simple-finance.sqlite (+ -wal / -shm)       database (SQLite, WAL mode)
  .env                                        runtime configuration/secrets (root-owned, 0600)
  documents/                                  receipt/invoice attachments (§23)
  logging/                                    application logs
```

- The entrypoint prepares any missing directories with sane permissions, applies pending migrations, then
  `exec`s the server (blueprint §7). Migration failure prevents normal startup.
- `.env` semantics per blueprint §7: shell-sourcing an env file executes shell code — it is a trusted,
  admin-only file, never editable by untrusted users, never committed to Git, never copied into the image
  build context, and **never included in backup archives**. A separate recovery checklist in the README
  covers recreating configuration; a data-only archive does not recreate the host (blueprint §6).
- The database and `documents/` are the durable user data; nothing durable lives only in the container layer.
- `.gitignore` mirrors these runtime paths so a stray development copy can never reach this public repo.

### 18.2 Backup contents and exclusions

- A consistent SQLite snapshot via the supported backup mechanism (WAL-safe, not a raw file copy), **plus**
  every `documents/` file referenced by the database, **plus** a versioned manifest: archive format,
  producing app version, creation instant (Europe/London, generated from the same instant as the filename),
  file counts/sizes, per-document sha256 hashes, and the metadata needed to validate restoration.
- **Excluded:** `.env` and any secrets; `logging/`.
- Consistency boundary: an attachment is referenceable only in `stored` state after its file is fully written
  (§23.3); backup coordinates the database snapshot with document enumeration so a valid archive can never
  reference a missing file. Orphan files (present but unreferenced) are reported, never silently included or
  silently deleted. (As built, Phase 5 reads the document list from the snapshot itself and fails the backup
  — HTTP 409 — if the snapshot references a file the disk has lost; `manifest.documents.orphans` reports the
  reverse case.)
- A receipt the household has removed (§23.4) is no longer `stored`. A later archive does not include that
  file and does not list it as an orphan once the file has been unlinked. An archive taken **before** the
  removal still contains the receipt — that older archive is the only way back. Removal never changes the
  archive format, and it never unlinks the file before the database has recorded the removal: the other
  order would make the next backup fail closed if the process died in between.
- Archive layout (format 2, as built): the encrypted stream wraps a tar holding exactly `db.sqlite` (the
  WAL-safe snapshot), `manifest.json`, and `documents/<fileKey>` for each `stored` attachment the snapshot
  references. `manifest.json` records `formatVersion`, the producing version, the creation instant, row
  counts, the document summary and `files[]` with per-file byte length and sha256 — it holds hashes of every
  member except itself. Format 1 (a bare encrypted database, no documents) remains restorable; format 1 with
  a manifest that references attachments is refused rather than restored incompletely.

### 18.3 Encryption, filename, download

- Encrypted before the archive reaches the browser: AES-256-GCM with a scrypt-derived key, fresh salt and
  nonce per archive (reviewed primitives per blueprint §6). The recovery password is **never persisted**;
  losing it loses the archive — stated plainly in the UI and README.
- Filename contract: `simple-finance-backup-v<app-version>-YYYY-MM-DD-HHmmss.simple-finance-backup`, date and
  time from one instant in Europe/London (seconds included so two archives taken in the same minute cannot
  collide on disk). The client-side blob download must carry the server filename into `anchor.download`
  (the blueprint's v0.2.21 regression lesson) with a fallback; the real client path is tested, including
  midnight and DST.
- Downloads are user-managed: **no implied scheduled offsite backup and no server-side retention.** The
  README explains how often to take archives, where to keep them, and what password loss means.

### 18.4 Restore

Authenticate and authorise; explicit destructive-replacement confirmation; bounded upload limits;
authenticate the encrypted archive before trusting contents; reject unsafe paths, traversal and unsupported
formats; validate manifest, document hashes and schema compatibility **before** touching live data; stage
replacements **on the same filesystem as each destination** (EXDEV lesson — `/tmp` and `/data` may differ on
Unraid); preserve recoverable old data until the replacement fully succeeds; the database-and-documents swap
is not one atomic transaction, so rollback and crash recovery are implemented and tested; reopen the
application against restored data, refresh the UI, and never delete the only recoverable copy on an error
path.

**Schema compatibility, as built (v0.10.0).** The live app is migrated by the container at start-up and a
live restore does not restart it, so the restore settles the schema itself, on the staged copy, before the
swap: a backup made by a **newer** version (it has a migration this version does not ship) is refused with
"update the app, then restore it"; a backup from an **older** version has the pending migrations applied
exactly as a container start would, then its integrity and foreign keys are checked again. Either way a
failure leaves the live data as it was.

### 18.5 Rehearsal requirement

Before real household data is entrusted to an installation, a backup must be restored into a **clean isolated
installation** and verified — records *and* attachments (blueprint §12). Rehearsals never run against the
live household installation.

## 19. Security and repository privacy (binding rules)

- Cloudflare Tunnel + Access + Google sign-in, server-side JWT verification via `jose`, allowlist of exactly
  two identities configured privately; every route (pages, APIs, backup/restore) independently guarded; fail
  closed; demo identity only behind dev flag **and** dev-environment check (blueprint §4).
- Public repository: fictional data only, everywhere (§ privacy notice). Real databases, backups, receipts,
  uploads, exports and `.env` files are ignored by `.gitignore` and stored only under the installation's
  appdata. Demo/seed data lives in tracked source paths, is fictional, and resolves to isolated paths.
- No bank credentials are ever requested, stored or referenced; the product has no bank integration.
- Staged diffs and generated artefacts are reviewed for sensitive content before publishing (handoff §7).
- Destructive tests and restore rehearsals run against isolated installations, never the live household data.

## 20. Agreed decisions vs open questions

The complete dated decision log lives in `docs/IMPLEMENTATION_PLAN.md` (§ Decision log). Open questions
(e.g. income-schedule working-day shift toggle, dedupe window length, checkpoint effective-date granularity,
camera file formats, attachment size limits, the 29 February renewal rule) are listed there; **none block
Phase 0–1** and each has a proposed default.

## 21. Suppliers: contact cards and interactions

Suppliers grow beyond autocomplete: each has an optional **contact card** and an **interaction log**, on a
dedicated Suppliers page (desktop-first; fully reachable on mobile — this is review territory, per §15).

### 21.1 Contact card

Optional fields: phone, email, website, postal address, free-form notes, plus **label→value reference pairs**
(fictional examples: "Policy Number — Vehicle A" → "ABC123"; "Account Number" → "XYZ789"). Purpose: when
something goes wrong, the number or policy reference is in the app — tap-to-call on mobile — instead of being
dug out of paperwork. Contact cards are visible to both users (§3 full mutual visibility) and audited on
change like every record.

### 21.2 Interactions

**"+ Create Interaction"** on any supplier: date/time (defaults now), channel (call / email / letter /
in person / other), summary of what was said or sent, optional outcome, optional **follow-up date** (surfaces
in the Contracts & renewals panel so promises don't evaporate; no notification — decision 19), optional link
to a related purchase or renewal. `recorded_by` is audited; both users see and add interactions.

### 21.2a Deep links to a supplier card (v0.12.1)

A schedule on Recurring Payments, a fixed-term contract end and a follow-up row on Contracts & Renewals
each paint a link that names the supplier it came from — `/suppliers?supplierId=<id>`. The Suppliers page
opens on that supplier: the card is expanded, the "Filter suppliers" box holds its name, and the card is
scrolled into view under the sticky header. Clearing the filter leaves the card open and shows the rest of
the list beside it. `?q=` (a name search) and `#supplier-<id>` / `#<supplier name>` are accepted too, an
identity the household no longer holds falls back to the plain list rather than naming a wrong card, and a
plain `/suppliers` visit is unchanged.

### 21.3 Privacy

Contact details, policy numbers and interaction summaries are real personal data: they live only in the
private installation. Repository demos and tests use fictional suppliers ("InsurerCo", "BroadbandCo") with
invented numbers, and screenshots are reviewed before publishing (§19).

## 22. Contract ends, renewals and key-date alerts

Two kinds of dates the household must not miss, united in one Overview panel and one page (§15.2), but
modelled separately because they behave differently.

### 22.1 Fixed-term contract end dates (on schedules)

Any DD/SO schedule may carry an optional **contract end date**. Semantics:

- **Informational plus alert — never an auto-stop.** As the date approaches (configurable lead, default
  21 days) the panel shows "time to shop around". Instances keep generating and forecasting past the end
  date until the users edit or cancel the schedule, because fixed-term deals commonly roll onto monthly and
  the app never assumes a bank instruction changed.
- A past end date displays as **"rolled / awaiting review"** — a quiet, honest state.

### 22.2 Renewal dates (their own records)

A **renewal** carries: label, optional supplier link, optional target (a vehicle or household), next renewal
date, **warning lead in days (default 21, per item)**, repeats-annually flag, notes. Intended for house/car
insurance and anything else that auto-renews. Renewals are deliberately not supplier-level fields: one
insurer can hold two vehicle policies with different renewal dates. When a repeating renewal date passes, it
advances a year automatically (visible, editable; 29 February handling per plan OQ13). A renewal is an alert
plus context; where the renewal is also a payment (annual premium), that is a schedule with
`frequency = annual` (§11) — reminder and money stay separate and complementary.

### 22.3 Where alerts appear — and the delivery channel

- **Overview panel "Contracts & renewals":** every item inside its warning window, soonest first, each one
  tap from the supplier contact card and the related schedule/renewal.
- **Contracts & Renewals page:** the full list, leads, follow-up dates from interactions, and history.
- **Channel: in-app for v1 — confirmed by the product owner 2026-09-20**, consistent with decision 19 and
  with the users' 4–5-day checkpoint cadence (a 21-day window guarantees several sightings). An optional
  **email alert channel is a recorded v2 roadmap item** (SMTP configuration, delivery-failure handling,
  tested delivery — scoped separately when reached). It is deliberately not a v1 blocker.

## 23. Receipt and invoice attachments

Any purchase can carry **attachments** — receipt or invoice photos/scans. v1 formats: PNG, JPEG, PDF;
multiple per purchase; per-file size limit (10 MB, plan OQ12). A household can remove one receipt later (§23.4); that is not automatic pruning.

**Income records too (v0.10.0).** Every entry in "Income received" on the Income page can carry documents —
typically a one-page payslip, and as many as needed. They go through exactly the same pipeline (sniffed
PNG/JPEG/PDF, 10 MB, private serving, audit, backup and restore, removal as §23.4). The file picker does not
force the camera there: a payslip is as often a PDF from the employer's portal as a sheet of paper. A voided
income record keeps its documents viewable but takes no new ones. Each attachment belongs to exactly one
purchase or one income record, never both.

### 23.1 Capture flows

- **Desktop:** file picker during purchase creation, or retroactively from the purchase detail.
- **Mobile:** standard camera capture (`accept="image/*" capture`) during entry, or attach later from the
  phone gallery via the purchase detail. (As built, the input accepts PNG/JPEG/PDF with
  `capture="environment"`; the saved file is classified by content sniffing, so a photo that arrives as
  HEIC is offered as a PNG-extension target only if the bytes really are PNG — the plan's OQ9 default
  applies: the UI asks for JPEG and the household's phone normalises, with HEIC conversion out of scope.)
- **The till moment stays fast:** the purchase save never waits on an attachment upload. Attachment lifecycle
  is independent (`pending → stored | failed`), retryable, and a receipt can be attached days later. The
  online-only stance is unchanged (§14).

### 23.2 Storage and serving

Files live under `/data/documents/` (§18.1) with server-generated storage keys — never user-controlled paths.
The database stores the original filename (for display/download naming only), MIME type, size, sha256,
uploader and timestamp. Viewing/downloading an attachment requires authentication; responses are private and
uncached, with `Content-Disposition` using a sanitized display name.

### 23.3 Integrity and security rules

- MIME validated by content sniffing, not extension alone; size limits enforced server-side (Zod boundary).
  (As built: PNG signature, JPEG `FF D8 FF` and PDF `%PDF-` are the only accepted sniff results; the browser
  MIME type and the file extension are ignored; the 10 MB limit is checked before any bytes are written and
  the display name is sanitised to a basename with control characters, quotes, slashes and the Windows
  reserved set replaced.)
- Only `stored` attachments are referenceable by backups (§18.2); an orphan sweep runs at backup time and
  reports unreferenced files without deleting them.
- Restore verifies presence and sha256 of every referenced document (§18.4).
- **Real receipts are real financial data:** they must never appear in the repository, screenshots, PRs,
  issues or demo data (§19). Demo/dev attachments are generated fictional images.

### 23.4 Removal

A household can remove one receipt from the purchase row on Purchases, Overview and Suppliers. The
purchase record stays. There is no undelete in the app.

- The control posts an attachment id. The storage key is read from the row, never from the request, and
  removal does not grow a second path that builds or accepts a key.
- In one transaction the row moves from `stored` to `deleted` and one audit entry is written on the
  purchase (`attachment.delete`: actor, timestamp, the file key, name, type, size and sha256). A second
  remove of the same row matches nothing and writes nothing.
- The file is unlinked only after that transaction commits. If the file is already gone, that is success.
  If the unlink fails for any other reason, the row stays `deleted` and the leftover file is an orphan —
  reported, not a failed backup, and not a rolled-back removal.
- A removed key is not `stored`, so the viewer returns 404 and a later backup neither includes it nor
  lists it as missing. An archive taken before the removal still restores that receipt (§18.2).
- The purchase's History list shows who removed it and when. The chip disappears from every page that
  renders stored receipts.
