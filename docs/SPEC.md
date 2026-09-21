# Simple Finance — Product Specification

**Status:** agreed with the product owner in discovery, 2026-09-20. This is the authoritative product spec.
**Companion documents:** `AGENT_APP_BLUEPRINT.md` (engineering/delivery contract), `docs/IMPLEMENTATION_PLAN.md` (profile, data model, phases, decision log, open questions), `docs/HANDOFF.md` (session continuation point).

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

- Five money pots: two joint bank accounts and three cash pots (two personal wallets + one shared jar), each
  with user-reported balance checkpoints.
- Fast mobile purchase entry with splits, supplier memory, category tree, attribution defaults and overrides.
- Recurring payment schedules (direct debits, standing orders) and expected income (salary) that
  auto-convert to actual records on their due dates.
- Transfers between pots as a first-class record type that never inflates spending.
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
- Investments, asset tracking, vehicle **valuation**, fuel-economy/mpg logs, mileage logs, maintenance
  reminders. (Vehicles are tracked as **running-cost targets**, nothing more.)
- Offline operation or offline caching of financial data (see §14).
- Notifications, reminders, emails (see §14; deferred, not forgotten).
- Drag-and-drop calendar scheduling; the calendar is a read-only view (§13).
- Fractional/percentage splits of one allocation between the two people (§9.4).
- Budget enforcement, multi-household, multi-currency, public/sharing features.
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
| Alex's wallet | Cash | Personal cash. |
| Sam's wallet | Cash | Personal cash. |
| Shared jar | Cash | Household cash. |

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
| Expected receipt (income) | positive | No (income) | Generated by income schedules (§11). |
| Checkpoint | n/a | No | User-reported balance (§5). |

All money is stored as **integer pence**. No binary floating-point arithmetic on money, ever (blueprint §3).
Pro-rata projections round once, at the period level, half-up to the nearest penny (§7.3).

## 7. Estimates and the payday projection

Two distinct, clearly-labelled numbers. Neither is ever called a bank balance.

### 7.1 Available now (estimate), per pot

For pot P with latest checkpoint C (amount, effective instant t):

```
estimate(P) = C.amount
            − Σ signed spending on P whose effective instant is after t
            − Σ transfers out of P after t
            + Σ transfers into P after t
```

*Signed spending*: purchases add, refunds subtract (so a refund increases the estimate).
Schedule-generated records are ordinary spending records and appear here once converted (§11).

**household_available_now = Σ estimate(P) over all pots.** This is the headline figure. Because it sums pots,
internal transfers can never distort it.

Comparison precision: where both a record and a checkpoint carry times of day, compare by timestamp (mobile
entry auto-timestamps). Where a record is date-only and shares the checkpoint's date, the record counts as
*after* (subtracted) — the conservative direction; it self-corrects at the next checkpoint.

### 7.2 Projected low before payday (projection)

The planning cycle is **payday-to-payday**: from Sam's salary date to the next one (configured day-of-month;
fictional example: the 26th). Insights additionally report by **calendar month** — both are views over the
same date-stamped records.

```
days = payday − today   (whole days, local date arithmetic)
projection starts from household_available_now and applies, day by day until payday inclusive:
  + expected receipts due that day        (income schedules not yet converted)
  − expected commitments due that day     (DD/SO schedule instances not yet converted)
  − projected day-to-day spending         (see 7.3)
projected_low = the minimum running value within the window
```

`projected_low` normally occurs just before salary lands. The projection **includes** expected income; it is
not a spending-only forecast.

### 7.3 Projected day-to-day spending (configured figures + honesty loop)

The household's day-to-day spending is highly predictable (weekly food shop varies by roughly ±£20; per-vehicle
fuel is predictable monthly). So the projection uses **user-configured figures**, set privately in Settings:

- `weekly_groceries` (fictional example: £90.00/week)
- `monthly_fuel[vehicle]` (fictional example: Vehicle A £75.00, Vehicle B £60.00)

Pro-rated at period level, rounded once:

```
groceries_projection = round(weekly_groceries × days / 7)    → nearest penny
fuel_projection      = round(monthly_fuel × days / 30)       → per vehicle, nearest penny
```

**Honesty loop:** Insights show recent actuals (e.g. last 4–8 weeks of Groceries and per-vehicle Fuel) against
these configured figures, so drift is visible and the config can be corrected. The projection panel lists
exactly which configured figures it used.

Recorded spending in the window's *past* is already inside `household_available_now`; the projection only ever
covers *future* days, so actual purchases and projected purchases cannot double-count.

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
  Nothing is silently deleted.
- A **duplicate** (e.g. both users recorded the same purchase) is resolved by voiding one copy — see §9.6.

### 9.6 Duplicate-entry protection (light-touch)

If a user saves a record with the same pot, supplier (or category) and amount as one saved by either user
within the last ~2 hours, a **non-blocking** notice appears: "Sam recorded a matching entry 20 minutes ago —
is this a duplicate?" with a one-tap link to review/void. It never blocks a legitimate second purchase
(two identical coffees are legal); it just makes the common accident visible immediately rather than at
month end.

## 10. Transfers

- Dedicated record type: from-pot, to-pot, amount, date/time, entered_by. Not spending, not income; excluded
  from every spending insight and from `projected_low`'s day-to-day figures; included in per-pot estimates
  (§7.1) so moving money can never look like losing or gaining money.
- The app never auto-creates transfers. Salary lands in the Salary account; moving it to Main is the users'
  decision, recorded when they do it (§7.5 nudges them when it matters).

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

### 11.3 Expected income

Sam's salary is a schedule of kind *expected receipt*: fixed amount, monthly, due into the Salary account on
the configured payday. It enters `projected_low` as a receipt (§7.2) and converts to an actual receipt record
on the day, exactly mirroring §11.2. The payday that defines the planning cycle is this schedule's due date.

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
- Out of scope: valuation, depreciation, mpg, mileage logs, maintenance reminders.

## 14. Connectivity, PWA, notifications

- **Online-only for v1** (agreed). Entry requires a signal; if connectivity drops mid-entry, the app **keeps
  the half-typed record on screen** and retries the save on reconnection (single in-flight submission guard —
  no duplicate posts on flaky networks). No offline queue, no sensitive financial data cached on the device,
  no service-worker caching of pages or API responses.
- Receipt photos/uploads need connectivity like everything else (§23): the purchase save **never waits on an
  attachment**; uploads are retryable and can be added days later. The phone's own gallery is the temporary
  store for a photo taken without signal — the app keeps no offline queue of its own.
- Responsive web; installability (manifest) is a possible later nicety **only** if it never requires caching
  financial data or broad Access bypasses (blueprint §4). Not a v1 commitment.
- **No notifications/reminders in v1** (agreed). Warnings live inside the app. An optional email alert
  channel for renewals/contract ends is a recorded **v2 roadmap item** (§22.3) — not a v1 blocker.

## 15. UX

### 15.1 Mobile — the "walking out of Tesco" tool

Purpose: fast, accurate entry at the till. It does not get into the weeds; review lives on the desktop.
All pages remain reachable on mobile (nothing hidden) — they are simply not the mobile design focus.

Home = three big actions:

1. **Add Purchase** — flow: supplier (fuzzy search, recents first, inline "add new") → amount → category
   (recent/frequent first; parent then child in two taps) → visible default chips (target, pot, paid-by;
   one tap each to override) → optional **Split** to add lines → save (enabled only when lines total exactly;
   remainder helper available) → confirmation with "Add another".
2. **Add Fuel** — prefills payer (signed-in user), pot default, category Fuel, target = the payer's own
   vehicle (one-tap flip to the other vehicle). The **amount is the only required typing**.
3. **Update Balance** — pick pot (defaults to least-recently-updated), enter figure, save. Optional effective
   date. Two fields in the common case.

Supplier memory: suppliers are remembered after first use; a supplier stores the most-used category as the
preselected (always visible, always changeable) chip. Near-duplicate supplier names prompt lightly at add
time ("Did you mean: Tesco?").

### 15.2 Desktop — the "sit down and review" tool

Dense and efficient: useful information per screen, minimal scrolling — but **density never sacrifices
functionality** (agreed correction to the original one-screen proposal). Readable text, real click targets,
clear grouping; dense is not cramped, and this is not a spreadsheet with tiny targets.

Menu pages:

| Page | Contents |
|---|---|
| **Overview** | The one genuinely dense single screen: household available-now + per-pot mini-balances inline + "last checkpoint" times; warning banner when a tier is active; to-payday projection panel (payday date, expected receipts, commitments due, configured day-to-day figures, projected low) with a "what's in this forecast" expansion; pot-level "plan a transfer" notice (§7.5); due-this-week commitments; **contracts & renewals inside their warning windows (§22.3)**; compact recent-entries table with inline edit; month-to-date by parent category with small bars. Quick-add always visible. |
| **Purchases** | Full history table; filters by date range, supplier, category, target, pot, person, tag; inline editing; refund/void/correct with audit trail visible; split editing with the same exact-total rule; **receipt/invoice attachments (§23)** viewed and added from the purchase detail. |
| **Recurring Payments** | The DD/SO/income schedule list (amount, frequency, due day, category, target, pot, next instance, state, contract end date where set); edit/cancel with effective dates; history of converted instances; **read-only month calendar view** of due instances (below). |
| **Suppliers** | Supplier list + detail: contact card (phone, email, website, address, label→value reference pairs such as policy numbers, notes), interaction log with "+ Create Interaction", linked purchases (§21). Tap-to-call on mobile. |
| **Contracts & Renewals** | Key dates: renewal records with per-item warning leads and annual advance; schedules' contract end dates; everything inside its warning window first, sorted by date; history of past renewals (§22). |
| **Accounts & Pots** | Per-pot checkpoint timeline and current estimates; transfer records; staleness of every pot; overdraft context (limit, threshold) for the Main account. |
| **Insights** | §16 panels. |
| **Settings** | Household labels; pots; category-tree editor; projection figures; thresholds; payday/income config; default warning lead for renewals/contract ends. (Suppliers live on their own page.) All private numbers live here at runtime — never in the repo. |

**Calendar (agreed: read-only month view).** A month grid on Recurring Payments showing due DD/SO instances and
expected receipts — another view of the same schedule data, never a second database. Clicking a day shows that
day's instances and opens the ordinary schedule editor. **No drag-and-drop**, and the UI states plainly that
changing a date in the app changes only the app's expectation, never a bank instruction.

**Version display:** the app version is visible unobtrusively on desktop and mobile (blueprint §1).

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
Salary £520.00 (26th); Wallet Alex £41.20; Wallet Sam £28.62; Jar £104.50 (counted 22nd).
`household_available_now` = **£1,043.20**. Next payday: the 26th → `days = 29`.

Outgoings in window:
- Commitments due: Energy £84.55 (28th) + Mortgage £685.00 (1st) + Council Tax £178.42 (1st) + Broadband
  £42.00 (3rd) + Mobile £24.99 (10th) = **£1,014.96**
- Projected groceries: round(£90.00 × 29/7) = **£372.86**
- Projected fuel: round(£75.00 × 29/30) = £72.50 (A) + round(£60.00 × 29/30) = £58.00 (B) = **£130.50**

Receipts in window: salary **£2,150.00** on the 26th.

```
projected_low = £1,043.20 − £1,014.96 − £372.86 − £130.50   (just before salary lands)
              = −£475.12
```

Tier check: −£475.12 ≤ −£250.00 → **Tier 2 Warning**: "Projected to be more than £250 overdrawn before
payday." (Had it fallen between £0 and −£250, only the Tier 1 heads-up would show.) The panel expands to list
every input: five commitments, salary, and the three configured day-to-day figures — nothing invisible.

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
multiple per purchase; per-file size limit (proposed 10 MB, plan OQ12).

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
