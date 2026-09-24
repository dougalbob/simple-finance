import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import { addCheckpoint } from '../src/lib/records/pots';
import { createDebt, editDebt } from '../src/lib/records/debts';
import { createExternalMovement } from '../src/lib/records/external-movements';
import { createPurchase } from '../src/lib/records/purchases';
import { createTransfer } from '../src/lib/records/transfers';
import { createSchedule } from '../src/lib/records/schedules';
import {
  getMoneySnapshot,
  getProjectionView,
  getUpcomingCommitments,
} from '../src/lib/records/money-view';
import {
  getMonthlyFuelPence,
  getWeeklyGroceriesPence,
  setMonthlyFuelPence,
  setWeeklyGroceriesPence,
} from '../src/lib/records/settings';

const p = (value: number) => Math.round(value * 100);

/**
 * The money view over the real database: E8-shaped data assembled through
 * the domain APIs (checkpoints, a purchase, schedules for the five DDs and
 * the salary receipt, configured day-to-day figures) must produce the
 * SPEC §17 E8 numbers end to end — estimate, projection, tiers, payday
 * selection and the pot-level transfer watch.
 */
describe('money view: E8 end to end over the database', () => {
  let fixture: HouseholdFixture;
  after(() => fixture.close());

  it('reproduces E8 from DB state (penny exact)', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const actor = 'alex@example.com';

    // — Schedules: the five DDs from Main + the monthly salary receipt.
    const dd = (name: string, amountPence: number, dueDay: number, categoryId: number) =>
      createSchedule(db, {
        name,
        kind: 'dd',
        frequency: 'monthly',
        dueDayOfMonth: dueDay,
        amountPence,
        potId: pots.main.id,
        supplierName: 'Northern Power Co',
        categoryId,
        targetKind: 'household',
        activeFrom: '2026-09-01',
        actor,
        now: new Date('2026-09-01T09:00:00Z'),
      });
    dd('Energy DD', p(84.55), 28, fixture.categoryId('Utilities', 'Energy'));
    dd('Mortgage DD', p(685.0), 1, fixture.categoryId('Housing', 'Mortgage/Rent'));
    dd('Council Tax DD', p(178.42), 1, fixture.categoryId('Housing', 'Council Tax'));
    dd('Broadband DD', p(42.0), 3, fixture.categoryId('Other', 'Uncategorised'));
    dd('Mobile DD', p(24.99), 10, fixture.categoryId('Utilities', 'Mobile Phones'));
    createSchedule(db, {
      name: 'Salary',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 26,
      amountPence: p(2150.0),
      potId: pots.salary.id,
      categoryId: null,
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor,
      now: new Date('2026-09-01T09:00:00Z'),
    });

    // — Checkpoints (the E8 balances, all 26th).
    const checkpointNow = new Date('2026-09-26T18:05:00+01:00');
    addCheckpoint(db, { potId: pots.main.id, amountPence: p(412.35), actor, now: checkpointNow });
    addCheckpoint(db, {
      potId: pots.salary.id,
      amountPence: p(520.0),
      actor,
      now: new Date('2026-09-26T12:00:00+01:00'),
    });
    addCheckpoint(db, {
      potId: pots.alexCash.id,
      amountPence: p(41.2),
      actor,
      now: new Date('2026-09-26T12:00:00+01:00'),
    });
    addCheckpoint(db, {
      potId: pots.samCash.id,
      amountPence: p(28.62),
      actor,
      now: new Date('2026-09-26T12:00:00+01:00'),
    });

    // — E1: Saturday the 27th, 14:10, Tesco £63.47 from Main.
    createPurchase(db, {
      supplierId: null,
      potId: pots.main.id,
      totalPence: p(63.47),
      paidByPersonId: fixture.people.alex.id,
      occurredAt: new Date('2026-09-27T14:10:00+01:00'),
      occurredDate: '2026-09-27',
      lines: [
        {
          amountPence: p(63.47),
          categoryId: fixture.categoryId('Groceries', 'Weekly Shop'),
          targetKind: 'household',
        },
      ],
      actor,
      now: new Date('2026-09-27T14:10:00+01:00'),
    });

    // — The last fills (E8's fuel anchors, v0.6.0): Vehicle A £75 on the
    // 12th, Vehicle B £60 on the 8th. Both predate every checkpoint, so the
    // estimates are untouched — but each resets its vehicle's 30-day fuel
    // clock (SPEC §7.3): A next fills 12 October, B on 8 October.
    const fill = (
      occurredDate: string,
      amountPence: number,
      vehicleId: number,
      occurredInstant: string,
    ) =>
      createPurchase(db, {
        supplierId: null,
        potId: pots.main.id,
        totalPence: amountPence,
        paidByPersonId: fixture.people.alex.id,
        occurredAt: new Date(occurredInstant),
        occurredDate,
        lines: [
          {
            amountPence,
            categoryId: fixture.categoryId('Vehicle Running', 'Fuel'),
            targetKind: 'vehicle',
            targetId: vehicleId,
          },
        ],
        actor,
        now: new Date(occurredInstant),
      });
    fill('2026-09-12', p(75.0), fixture.vehicles.vehicleA.id, '2026-09-12T18:30:00+01:00');
    fill('2026-09-08', p(60.0), fixture.vehicles.vehicleB.id, '2026-09-08T08:15:00+01:00');

    // — A transfer for good measure: £400 Salary → Main (E4, net zero).
    createTransfer(db, {
      fromPotId: pots.salary.id,
      toPotId: pots.main.id,
      amountPence: p(400),
      occurredAt: new Date('2026-09-25T10:00:00+01:00'),
      occurredDate: '2026-09-25',
      actor,
      now: new Date('2026-09-25T10:00:00+01:00'),
    });
    // Wait — E8's Main estimate is £348.88 with no transfer. To keep E8's
    // exact figures, checkpoint Main AFTER the transfer so it's inside the
    // reported balance… the transfer is 25th, checkpoint 26th: already
    // included. So estimate(Main) = 412.35 − 63.47 = 348.88 either way.

    // — Configured day-to-day figures (SPEC §7.3).
    setWeeklyGroceriesPence(db, p(90.0), actor);
    setMonthlyFuelPence(db, fixture.vehicles.vehicleA.id, p(75.0), actor);
    setMonthlyFuelPence(db, fixture.vehicles.vehicleB.id, p(60.0), actor);

    // — Read at Friday the 27th, 20:00.
    const now = new Date('2026-09-27T20:00:00+01:00');
    const snapshot = getMoneySnapshot(db, now);

    const estimateOf = (potId: number) =>
      snapshot.pots.find((pot) => pot.pot.id === potId)?.estimatePence;
    assert.equal(estimateOf(pots.main.id), p(348.88));
    assert.equal(estimateOf(pots.salary.id), p(520.0));
    assert.equal(snapshot.householdAvailablePence, p(938.7));

    const view = getProjectionView(db, now);
    assert.ok(view, 'projection view expected once pots are checkpointed');
    assert.equal(view.paydayScheduleName, 'Salary');
    assert.equal(view.result.paydayDate, '2026-10-26');
    assert.equal(view.result.days, 29);
    assert.equal(view.result.availableNowPence, p(938.7));
    assert.equal(view.result.totalCommitmentsPence, p(1014.96));
    assert.equal(view.result.totalReceiptsPence, p(2150.0));
    // Day-to-day (v0.6.0 anchor-reset): E1's Tesco run on the 27th resets
    // the weekly shop — projected 4th/11th/18th/25th × £90 = £360. The
    // fills on the 12th/8th reset each vehicle's 30-day clock — £75 (A) on
    // 12 October + £60 (B) on 8 October = £135. No smooth allowance.
    assert.equal(view.result.groceriesPence, p(360.0));
    assert.equal(view.result.fuelPence, p(135.0));
    assert.equal(view.result.dayToDayPence, p(495.0));
    assert.equal(view.dayToDayEvents.length, 6);
    assert.deepEqual(
      view.dayToDayEvents
        .filter((event) => event.kind === 'groceries')
        .map((event) => event.dueDate),
      ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'],
    );
    assert.deepEqual(
      view.dayToDayEvents
        .filter((event) => event.kind === 'fuel')
        .map((event) => `${event.vehicleId}:${event.dueDate}`),
      [`${fixture.vehicles.vehicleB.id}:2026-10-08`, `${fixture.vehicles.vehicleA.id}:2026-10-12`],
    );
    // The low: the last shop of the cycle clears on the 25th — just before
    // the salary — and the date the card reports is that day, not today.
    assert.equal(view.result.projectedLowPence, p(-571.26));
    assert.equal(view.result.lowDate, '2026-10-25');
    assert.equal(view.result.tier, 'warning');
    assert.equal(view.result.warningThresholdPence, p(250.0));

    const mainWatch = view.result.potWatches.find((watch) => watch.potId === pots.main.id);
    assert.ok(mainWatch);
    assert.equal(mainWatch.watchPence, p(-666.08));
    assert.equal(mainWatch.earliestDueDate, '2026-09-28');
    const salaryHolds = view.otherPotEstimates.get(pots.salary.id);
    assert.equal(salaryHolds, p(520.0));

    // Due this week (27th → 4 October): Energy (28th), Mortgage + Council
    // Tax (1st), Broadband (3rd). The 10th Mobile DD is outside the week.
    const week = getUpcomingCommitments(db, '2026-10-04', now);
    assert.deepEqual(
      week.map((line) => line.name),
      ['Energy DD', 'Council Tax DD', 'Mortgage DD', 'Broadband DD'],
    );

    // Settings accessors round-trip.
    assert.equal(getWeeklyGroceriesPence(db), p(90.0));
    assert.equal(getMonthlyFuelPence(db, fixture.vehicles.vehicleA.id), p(75.0));
  });

  it('payday is the earliest unconverted receipt instance; none → null view with estimates', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const actor = 'alex@example.com';
    addCheckpoint(db, {
      potId: pots.main.id,
      amountPence: p(100),
      actor,
      now: new Date('2026-09-20T09:00:00Z'),
    });

    // No income schedule → estimates exist, the projection does not.
    assert.ok(getProjectionView(db, new Date('2026-09-27T20:00:00+01:00')) === null);

    // Two income schedules: the earliest wins the planning cycle.
    // Active from 29 September, so its first instance (28 November) is
    // after Salary's 26 October — the earliest one must win.
    const late = createSchedule(db, {
      name: 'Late benefit',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 28,
      amountPence: p(50),
      potId: pots.main.id,
      activeFrom: '2026-09-29',
      actor,
      now: new Date('2026-09-29T09:00:00Z'),
    });
    void late;
    const salary = createSchedule(db, {
      name: 'Salary',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 26,
      amountPence: p(2150),
      potId: pots.salary.id,
      activeFrom: '2026-09-01',
      actor,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    const view = getProjectionView(db, new Date('2026-09-27T20:00:00+01:00'));
    assert.ok(view);
    assert.equal(view.paydayScheduleName, 'Salary');
    assert.equal(view.result.paydayDate, '2026-10-26');
    void salary;
  });

  it('no checkpoint anywhere → snapshot with null household, no projection', async () => {
    fixture = await createHouseholdFixture();
    const { db } = fixture;
    const snapshot = getMoneySnapshot(db, new Date('2026-09-27T20:00:00+01:00'));
    assert.equal(snapshot.householdAvailablePence, null);
    assert.equal(snapshot.uncheckpointedPotIds.length, 4);
    assert.equal(getProjectionView(db, new Date('2026-09-27T20:00:00+01:00')), null);
  });
});

/**
 * Expected support in the payday window (SPEC §10.2, v0.7.0): the household
 * sets £1,000 on the 10th from late September and the panel must already
 * show **Friday 9 October** — before a penny has been borrowed, which is the
 * whole reason an expectation is entered ahead of the first payment. The
 * estimate never moves on an expectation, and the day may be changed later
 * without touching anything already recorded.
 */
describe('money view: expected support before the first borrowing (v0.7.0)', () => {
  const actor = 'alex@example.com';
  let fixture: HouseholdFixture;
  after(() => fixture.close());

  /** Checkpointed household (Main £500, Salary £200) with a £2,150 salary on the 26th. */
  async function setUp(dayOfMonth = 10, untilDate: string | null = null) {
    fixture = await createHouseholdFixture(actor, new Date('2026-09-24T19:30:00+01:00'));
    const { db, pots } = fixture;
    const now = new Date('2026-09-24T19:30:00+01:00');
    addCheckpoint(db, { potId: pots.main.id, amountPence: p(500), actor, now });
    addCheckpoint(db, { potId: pots.salary.id, amountPence: p(200), actor, now });
    createSchedule(db, {
      name: 'Salary',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 26,
      amountPence: p(2150),
      potId: pots.salary.id,
      activeFrom: '2026-09-01',
      actor,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    // A brand-new debt: no movements at all, balance £0 — not started.
    const debt = createDebt(db, { counterparty: 'Mum', direction: 'we_owe', actor, now });
    const edited = editDebt(db, {
      id: debt.id,
      expectedVersion: 1,
      actor,
      now,
      patch: { expectedInflow: { amountPence: p(1000), dayOfMonth, untilDate } },
    });
    return { db, pots, debt: edited };
  }

  it('projects the first payment before any borrowing exists, and moves no money', async () => {
    const { db } = await setUp();
    // The morning after payday: the September salary (Fri 25 Sep) has landed,
    // so the next receipt is Monday 26 October — and the 10th's support is
    // earlier than that, so the cycle runs to the money that comes next.
    const at = new Date('2026-09-26T10:00:00+01:00');
    const view = getProjectionView(db, at);
    assert.ok(view);
    assert.equal(view.result.paydayDate, '2026-10-09'); // Sat 10 Oct → Fri 9 Oct (decision 7)
    const expected = view.receiptLines.filter((line) => line.expected === true);
    assert.equal(expected.length, 1);
    assert.equal(expected[0]?.dueDate, '2026-10-09');
    assert.equal(expected[0]?.amountPence, p(1000));
    assert.match(expected[0]?.name ?? '', /support from Mum/);
    assert.equal(expected[0]?.potLabel, 'Main account'); // the default pot until a movement pins one

    // Honest books: the estimate is checkpoint + salary only, and nothing is
    // owed yet — an expectation is a plan, never money.
    const snapshot = getMoneySnapshot(db, at);
    assert.equal(snapshot.householdAvailablePence, p(2850));
    assert.deepEqual(snapshot.debts, {
      owedByHouseholdPence: 0,
      owedToHouseholdPence: 0,
      debtCount: 1,
    });
  });

  it('follows a changed day of month without touching recorded movements', async () => {
    const { db, debt } = await setUp();
    const at = new Date('2026-09-26T10:00:00+01:00');
    const before = getProjectionView(db, at);
    assert.ok(before);
    assert.equal(
      before.receiptLines.filter((line) => line.expected === true)[0]?.dueDate,
      '2026-10-09',
    );

    // Two months later the household aligns the payment with its spending:
    // the 10th becomes the 13th. Occurrences are derived, so every unrecorded
    // month follows — and nothing recorded moves, because nothing is recorded.
    editDebt(db, {
      id: debt.id,
      expectedVersion: debt.version,
      actor,
      now: at,
      patch: { expectedInflow: { amountPence: p(1000), dayOfMonth: 13 } },
    });
    const after = getProjectionView(db, at);
    assert.ok(after);
    const expected = after.receiptLines.filter((line) => line.expected === true);
    assert.equal(expected.length, 1);
    assert.equal(expected[0]?.dueDate, '2026-10-13'); // Tue 13 Oct, no shift
    assert.equal(after.result.availableNowPence, before.result.availableNowPence);
    assert.equal(after.snapshot.debts.owedByHouseholdPence, 0);
  });

  it('a settled loan stops expecting, however the expectation is configured', async () => {
    const { db, pots, debt } = await setUp();
    // Borrowed Friday 9 October, repaid in full after probate on the 20th.
    createExternalMovement(db, {
      potId: pots.main.id,
      direction: 'in',
      kind: 'loan',
      amountPence: p(1000),
      debtId: debt.id,
      occurredDate: '2026-10-09',
      actor,
      now: new Date('2026-10-09T12:00:00+01:00'),
    });
    const borrowed = getProjectionView(db, new Date('2026-10-11T10:00:00+01:00'));
    assert.ok(borrowed);
    // The October month is answered by its own borrowing; November still is not.
    assert.deepEqual(
      borrowed.receiptLines.filter((line) => line.expected === true).map((line) => line.dueDate),
      [],
    );

    createExternalMovement(db, {
      potId: pots.main.id,
      direction: 'out',
      kind: 'loan',
      amountPence: p(1000),
      debtId: debt.id,
      occurredDate: '2026-10-20',
      actor,
      now: new Date('2026-10-20T12:00:00+01:00'),
    });
    const settled = getProjectionView(db, new Date('2026-10-21T10:00:00+01:00'));
    assert.ok(settled);
    assert.deepEqual(
      settled.receiptLines.filter((line) => line.expected === true),
      [],
    );
    assert.equal(settled.snapshot.debts.owedByHouseholdPence, 0);
  });
});
