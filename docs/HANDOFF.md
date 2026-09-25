# Handoff — payslips on income, fuel economy, and the lost till fixes (v0.10.0)

Date: 2026-09-25. Branch: `arena/01a0d778-simple-finance` (from `main` @ `5cb28e3`, the v0.9.0 merge
plus its release commit).

**Released as v0.10.0** — the tag, merge commit and digest are stamped in
[`docs/RELEASE_NOTES_v0.10.0.md`](RELEASE_NOTES_v0.10.0.md) once published (this file is written before the
merge, because the branch cannot be pushed after it). The household's two steps in Unraid: back up, then
Force Update. The version-badge check is `v0.10.0 · pre-release`.

**Why this session started:** the previous session committed four post-v0.9.0 fixes while GitHub was having
an outage; the push never landed and the sandbox was lost. They were re-done here from their description
(decisions 134–137), and SANDBOX entry 10 now says to push after every commit. The household then chose to
ship them in one release together with two new features.

## What changed

- **Till fixes (decisions 134–137)** — `e2e/support.ts` `londonToday`/`addDaysIso` and
  `timezoneId: 'Europe/London'` (the suite no longer fails 23:00–00:00 UTC); the supplier typeahead hides
  in place (`closing`) on a pointer blur so one tap on Save saves; `.till-touch` in `globals.css` makes
  every Quick Entry control ≥44px and a mobile spec measures them all; the purchase form focuses Supplier
  once `ready` is true.
- **Migration `0009_income_documents_fuel_details`** — `attachments` rebuilt: `purchase_id` nullable, new
  `receipt_id` → `receipts`, `CHECK attachments_one_owner` (exactly one). `purchases` gains
  `odometer_miles`, `fuel_millilitres` (integer mL) and `fuel_full_tank` (default 1), with positive-value
  checks. Upgrade of a v0.9.0-shaped database with receipts is tested (`tests/migration-0009.test.ts`).
- **Income documents (decision 138)** — `records/attachments.ts` takes `purchaseId` *or* `receiptId`
  (`AttachmentOwner`, `listStoredReceiptAttachments`); audit entity `receipt`. `AttachmentForm` takes
  `receiptId` and `allowUpload` and words itself for payslips (no forced camera). The Income page's
  "Income received" rows list and accept documents; voided rows keep theirs but take no new ones.
- **Fuel (decisions 139–141)** — `records/fuel-economy.ts` (pure: parsing, UK-gallon mpg full tank to full
  tank, gaps, totals, the post-save sentence; safe in client components), `records/fuel.ts` (DB: fills per
  vehicle, audited/versioned `editFuelDetails`, the Insights view, row context), Quick Entry Fuel gains
  Litres/Odometer/Filled to full with a live price per litre, `components/fuel-details-form.tsx` on the
  Purchases and Overview rows, and the Insights **Fuel economy** panel.
- **Restore upgrades older archives (decision 142)** — found while writing the notes: a live restore
  reopened the database without migrating it, so an archive from before 0009 would have broken every page
  reading `purchases` until a restart. `restoreEncryptedBackup` now refuses a newer archive and migrates an
  older one on the staged copy, before the swap.
- **Docs** — SPEC §2 non-goals, §13, §15.1, §16 item 6 and **§16.6**, E2, §18.4, §23; decisions 134–142;
  SANDBOX entry 10; v0.10.0 in all five version places.

## Watch out for (learned this session)

- **§16.N means item N of the Insights list.** Code already cited "§16.4" for the honesty loop, so the fuel
  section is **§16.6** (item 6), not a new "16.4". Keep to that when adding panels.
- **A "fuel purchase" is a definition, not a flag:** live, not a refund, Fuel-category lines all to one
  vehicle. The fuel cost is the Fuel lines only. `fuelRowDetails` returns `null` for anything else, which is
  why a split that sends fuel to two vehicles shows no fuel editor. Refunds do not reduce a fill.
- **Totals are ratios of sums.** "Last 12 months" mpg is total miles ÷ total gallons over measured
  stretches, never an average of mpg figures. `tests/fuel-economy.test.ts` pins this.
- **The odometer is only demanded on full tanks.** The "missing details" list flags missing litres on any
  fill but a missing odometer only on a full tank — a part fill's mileage is never used.
- **Two nullable owners, one CHECK.** Anything new that creates `attachments` rows must set exactly one of
  `purchase_id`/`receipt_id`; the database refuses otherwise. Backup/restore and the serving route never
  look at the owner, which is why they needed no change.
- **The audit `entity_id` is text.** Compare with `String(id)` in tests.
- **Restore now runs migrations.** `restoreEncryptedBackup` reads `./drizzle` (or `migrationsFolder`); the
  container image ships it next to the server. A test that fabricates a database must start from real
  migrations, or the upgrade step will refuse or fail it.
- **Date-dependent specs:** the weekend-payday probe picked a weekend day whose Friday was *today*, which
  the seeded salary had already been received on (the 27th was a Sunday). It now needs a Friday after
  today. If a spec fails only on certain dates, look for "today" edge cases like this one.

## Test state

`npm test` — **378 tests, all green, 95 suites** (was 357/90). `npm run format:check`, `npx tsc --noEmit`
and `npm run build` are clean. Local Playwright (SANDBOX entry 8) — **55 tests green** across every project
(was 50), including the new `fuel` project and the payslip spec; CI's `browser` job remains the gate.

## Open / deferred (not forgotten)

- **UK gallons were assumed**, not explicitly confirmed by the household (the UK default; 4.54609 L). If
  they want US gallons or L/100 km it is one constant and a label.
- **Supplier-level documents** (a policy PDF not tied to a purchase) stay deferred — OQ10.
- **The home page's recent-entries table is read-only** and shows no fuel details; Purchases and Overview
  carry the editor.
- **Swipe physics and the 44px sizes have only been driven by emulation** (Pixel 7 profile); a real thumb on
  a real phone is still the household's verdict.
- **Home page mobile layout is still untouched**; the household decides later what to hide on a phone.
- **The Cloudflare Access app** still wants its PWA paths intact (v0.8.0 note); nothing here changes that.
