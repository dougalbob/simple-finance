import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../src/lib/db/client';
import { applyMigrations } from '../src/lib/db/migrate';
import { findChildCategory } from '../src/lib/records/categories';
import { createDebt, editDebt } from '../src/lib/records/debts';
import { createExternalMovement } from '../src/lib/records/external-movements';
import { createPerson } from '../src/lib/records/people';
import { addCheckpoint, createPot } from '../src/lib/records/pots';
import { createPurchase } from '../src/lib/records/purchases';
import { createReceipt } from '../src/lib/records/receipts';
import { createRenewal } from '../src/lib/records/renewals';
import { createSchedule } from '../src/lib/records/schedules';
import {
  setDefaultPurchasePotId,
  setMonthlyFuelPence,
  setWeeklyGroceriesPence,
} from '../src/lib/records/settings';
import { createSupplier } from '../src/lib/records/suppliers';
import { createVehicle } from '../src/lib/records/vehicles';
import { addSupplierInteraction } from '../src/lib/records/supplier-details';
import { toLocalDateString } from '../src/lib/time';

/**
 * E2E server (Playwright `webServer`): an isolated, fictional installation.
 *
 * Everything here is made up: fake people, fake suppliers, fake amounts. It
 * never touches the real appdata directory (`.e2e-data` is git-ignored), which
 * is the rule in blueprint §9 ("never run seeds, restore tests or destructive
 * checks against the user's appdata").
 *
 * The development identity bypass is used so the browser can sign in without
 * Cloudflare; `loadAppConfig` computes that bypass as impossible whenever
 * NODE_ENV is production, so this can never become a production hole.
 */
const DATA_DIR = path.resolve(process.cwd(), '.e2e-data');
const PORT = Number(process.env.E2E_PORT ?? 3100);
const DATABASE_PATH = path.join(DATA_DIR, 'simple-finance.sqlite');
const ACTOR = 'alex@example.com';

function seed(): void {
  rmSync(DATA_DIR, { recursive: true, force: true });
  const handle = openDatabase(DATABASE_PATH);
  applyMigrations(handle.db);
  const db = handle.db;

  const now = new Date();
  // The household's calendar date (Europe/London), not UTC's: between 23:00
  // and 00:00 UTC in summer they differ, and a seed dated by UTC put "today's"
  // records on yesterday as far as the app was concerned (decision 134).
  const todayIso = toLocalDateString(now);
  const today = new Date(`${todayIso}T12:00:00Z`);

  const main = createPot(db, {
    label: 'Main account',
    kind: 'bank',
    overdraftLimitPence: 80000,
    warningThresholdPence: 25000,
    actor: ACTOR,
    now,
  });
  const salary = createPot(db, { label: 'Salary account', kind: 'bank', actor: ACTOR, now });
  const alexCash = createPot(db, { label: "Alex's cash", kind: 'cash', actor: ACTOR, now });
  const samCash = createPot(db, { label: "Sam's cash", kind: 'cash', actor: ACTOR, now });

  // The till form's starting pot is a setting (v0.9.0) — the seed sets it the
  // way a household would, and the specs prove the form honours it.
  setDefaultPurchasePotId(db, main.id, ACTOR, now);

  const alex = createPerson(db, { label: 'Alex', actor: ACTOR, now });
  const sam = createPerson(db, { label: 'Sam', actor: ACTOR, now });
  const vehicleA = createVehicle(db, {
    label: 'Vehicle A',
    ownerPersonId: alex.id,
    actor: ACTOR,
    now,
  });
  const vehicleB = createVehicle(db, {
    label: 'Vehicle B',
    ownerPersonId: sam.id,
    actor: ACTOR,
    now,
  });

  addCheckpoint(db, {
    potId: main.id,
    amountPence: 161235,
    note: 'Friday evening check',
    actor: ACTOR,
    now,
  });
  addCheckpoint(db, { potId: salary.id, amountPence: 120000, actor: ACTOR, now });
  addCheckpoint(db, { potId: alexCash.id, amountPence: 4210, actor: ACTOR, now });
  addCheckpoint(db, { potId: samCash.id, amountPence: 2862, actor: ACTOR, now });

  const groceries = findChildCategory(db, 'Groceries', 'Weekly Shop');
  const fuel = findChildCategory(db, 'Vehicle Running', 'Fuel');
  const insurance = findChildCategory(db, 'Vehicle Running', 'Insurance');
  if (groceries === null || fuel === null || insurance === null) {
    throw new Error('E2E seed: the SPEC §12 category tree is missing an expected child');
  }

  const cornerFoods = createSupplier(db, {
    name: 'Corner Foods',
    contactPhone: '01632 960111',
    contactEmail: 'hello@cornerfoods.example',
    website: 'https://cornerfoods.example',
    address: '1 Fictional Parade, Testville',
    notes: 'Weekend shop usually here.',
    actor: ACTOR,
    now,
  });
  const insurerCo = createSupplier(db, {
    name: 'InsurerCo',
    contactPhone: '01632 960222',
    contactEmail: 'policies@insurerco.example',
    actor: ACTOR,
    now,
  });
  const broadbandCo = createSupplier(db, {
    name: 'BroadbandCo',
    contactEmail: 'billing@broadbandco.example',
    notes: '18-month contract, ends next spring.',
    actor: ACTOR,
    now,
  });

  createPurchase(db, {
    potId: main.id,
    totalPence: 6347,
    occurredAt: new Date(now.getTime() - 26 * 60 * 60 * 1000),
    paidByPersonId: alex.id,
    supplierId: cornerFoods.id,
    note: 'Weekly shop',
    actor: ACTOR,
    lines: [
      { amountPence: 4198, categoryId: groceries.id, targetKind: 'household' },
      { amountPence: 2149, categoryId: fuel.id, targetKind: 'vehicle', targetId: vehicleA.id },
    ],
    now,
  });
  createPurchase(db, {
    potId: samCash.id,
    totalPence: 349,
    occurredAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
    paidByPersonId: sam.id,
    supplierName: 'The Corner Cafe',
    actor: 'sam@example.com',
    lines: [{ amountPence: 349, categoryId: groceries.id, targetKind: 'person', targetId: sam.id }],
    now,
  });

  // One-off income (plan decision 110): the old bicycle sold for cash, paid
  // into the cash pot — so the Income page, All Transactions and the estimate
  // all have a manual, non-schedule income row to show. Fictional, like
  // everything in this seed.
  createReceipt(db, {
    potId: alexCash.id,
    amountPence: 4500,
    occurredAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
    source: 'Sale of bicycle',
    note: 'Collected in cash',
    actor: ACTOR,
    now,
  });

  // Recurring commitments: a direct debit whose contract ends inside the
  // warning window, a standing order, a monthly income schedule (the payday the
  // projection plans to) and an annual insurance renewal.
  const dueDay = Math.min(Number(todayIso.slice(8, 10)) + 2, 28);
  createSchedule(db, {
    name: 'BroadbandCo fibre',
    kind: 'dd',
    frequency: 'monthly',
    dueDayOfMonth: dueDay,
    amountPence: 3499,
    potId: main.id,
    categoryId: insurance.id,
    supplierId: broadbandCo.id,
    targetKind: 'household',
    contractEndsOn: localDate(today, 12),
    activeFrom: localDate(today, -180),
    actor: ACTOR,
    now,
  });
  createSchedule(db, {
    name: 'Phone plan',
    kind: 'so',
    frequency: 'monthly',
    dueDayOfMonth: Math.min(dueDay + 5, 28),
    amountPence: 1200,
    potId: main.id,
    categoryId: insurance.id,
    // Standing order with no supplier: household transfer option.
    targetKind: 'household',
    activeFrom: localDate(today, -90),
    actor: ACTOR,
    now,
  });
  createSchedule(db, {
    name: 'Salary',
    kind: 'receipt',
    frequency: 'monthly',
    dueDayOfMonth: 27,
    amountPence: 245000,
    potId: salary.id,
    activeFrom: localDate(today, -60),
    actor: ACTOR,
    now,
  });
  // A tracked debt with the household's motivating expected inflow: £1,000
  // borrowed from Mum into Alex's cash, expecting £1,000 support on the 12th
  // of each month (v0.5.0 feature 2). The loan raises the pot estimate and
  // the owed balance together — never income; the expectation only ever
  // feeds the projections. (Deliberately no second seeded income schedule:
  // `income.spec.ts` locates schedules with `hasText: 'Salary'`, which also
  // matches any row whose pot picker offers "Salary account", so a second
  // schedule would steal that spec's `.first()` edit — a second schedule is
  // already covered by that spec adding one through the UI.)
  const mum = createDebt(db, {
    counterparty: 'Mum',
    direction: 'we_owe',
    note: 'helping with the bills until spring',
    actor: ACTOR,
    now,
  });
  createExternalMovement(db, {
    potId: alexCash.id,
    direction: 'in',
    kind: 'loan',
    amountPence: 100000,
    debtId: mum.id,
    occurredAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
    occurredDate: localDate(today, -5),
    actor: ACTOR,
    now,
  });
  editDebt(db, {
    id: mum.id,
    expectedVersion: 1,
    actor: ACTOR,
    now,
    patch: { expectedInflow: { amountPence: 100000, dayOfMonth: 12 } },
  });
  createRenewal(db, {
    label: 'Vehicle A insurance',
    supplierId: insurerCo.id,
    targetKind: 'vehicle',
    targetId: vehicleA.id,
    nextRenewalDate: localDate(today, 17),
    warnDaysBefore: 21,
    repeatsAnnually: true,
    notes: 'Compare the comparison sites before renewing.',
    actor: ACTOR,
    now,
  });

  addSupplierInteraction(db, {
    supplierId: broadbandCo.id,
    channel: 'call',
    summary: 'Asked what the out-of-contract price would be',
    outcome: 'They will write to us',
    followUpDate: localDate(today, 6),
    actor: ACTOR,
    now,
  });

  setWeeklyGroceriesPence(db, 8500, ACTOR);
  setMonthlyFuelPence(db, vehicleA.id, 6000, ACTOR);
  setMonthlyFuelPence(db, vehicleB.id, 4500, ACTOR);

  handle.raw.close();
  // The second vehicle exists so the Insights panels have a zero-activity row
  // to list honestly (SPEC §16 decision 66).
  void vehicleB;
}

function localDate(base: Date, dayOffset: number): string {
  const shifted = new Date(base.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

seed();

// `E2E_SEED_ONLY=1` prepares (or refreshes) the fictional data and exits. CI
// uses it to check the harness itself; a human can use it to inspect the seed
// before starting the server by hand.
if (process.env.E2E_SEED_ONLY === '1') {
  console.log(`[e2e-server] seeded ${DATA_DIR} (fictional data only)`);
  process.exit(0);
}

const child = spawn('node_modules/.bin/next', ['dev', '-H', '0.0.0.0', '-p', String(PORT)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    DATA_DIR,
    DATABASE_PATH,
    PORT: String(PORT),
    AUTH_DEV_BYPASS: 'true',
    AUTH_DEV_IDENTITY_EMAIL: ACTOR,
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    child.kill(signal);
    process.exit(0);
  });
}
child.on('exit', (code) => process.exit(code ?? 0));
