import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import { addCheckpoint } from '../src/lib/records/pots';
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
    assert.equal(view.result.groceriesPence, p(372.86));
    assert.equal(view.result.fuelPence, p(130.5));
    assert.equal(view.result.projectedLowPence, p(-579.62));
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
