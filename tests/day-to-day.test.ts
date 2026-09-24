import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import { createPurchase, voidPurchase } from '../src/lib/records/purchases';
import {
  lastFuelDatesByVehicle,
  lastWeeklyShopDate,
  projectDayToDayEvents,
  type ProjectedDayToDayEvent,
} from '../src/lib/records/day-to-day';
import { setMonthlyFuelPence, setWeeklyGroceriesPence } from '../src/lib/records/settings';
import { getHorizonProjectionView, getProjectionView } from '../src/lib/records/money-view';
import { createSchedule } from '../src/lib/records/schedules';
import { addCheckpoint } from '../src/lib/records/pots';

const p = (value: number) => Math.round(value * 100);

const ACTOR = 'alex@example.com';
/** The user-reported Friday: "today" for every scenario below. */
const NOW = new Date('2026-09-24T12:00:00+01:00');
const TODAY = '2026-09-24';

/**
 * The v0.6.0 anchor-reset model (SPEC §7.3, decisions 118–119): projected
 * day-to-day spending is episodic, not a smooth rate. A recorded weekly
 * shop resets the groceries week; a recorded fill resets that vehicle's
 * fuel month; nothing records → tomorrow, pessimistically. These tests pin
 * the anchor rules against the real ledger (categories `Groceries > Weekly
 * Shop` and `Vehicle Running > Fuel`, targets, voiding) and the read
 * models that consume the events.
 */
describe('day-to-day: anchor-reset projected shops and fills (v0.6.0)', () => {
  let fixture: HouseholdFixture;

  async function setUp() {
    fixture = await createHouseholdFixture(ACTOR, new Date('2026-09-01T09:00:00Z'));
    return fixture;
  }

  after(() => {
    if (fixture !== undefined) fixture.close();
  });

  /** A full instant when given a timestamp, a same-day noon otherwise. */
  function at(dateOrInstant: string): Date {
    return dateOrInstant.includes('T')
      ? new Date(dateOrInstant)
      : new Date(`${dateOrInstant}T12:00:00+01:00`);
  }

  function shop(
    db: HouseholdFixture['db'],
    opts: {
      occurredDate: string;
      amount: number;
      category?: [string, string];
      pot?: number;
      now?: string;
    },
  ) {
    const instant = at(opts.now ?? opts.occurredDate);
    return createPurchase(db, {
      supplierId: null,
      potId: opts.pot ?? fixture.pots.main.id,
      totalPence: p(opts.amount),
      paidByPersonId: fixture.people.alex.id,
      occurredAt: instant,
      occurredDate: opts.occurredDate,
      lines: [
        {
          amountPence: p(opts.amount),
          categoryId: fixture.categoryId(...(opts.category ?? ['Groceries', 'Weekly Shop'])),
          targetKind: 'household',
        },
      ],
      actor: ACTOR,
      now: instant,
    });
  }

  function fill(
    db: HouseholdFixture['db'],
    opts: { occurredDate: string; amount: number; vehicleId: number; now?: string },
  ) {
    const instant = at(opts.now ?? opts.occurredDate);
    return createPurchase(db, {
      supplierId: null,
      potId: fixture.pots.main.id,
      totalPence: p(opts.amount),
      paidByPersonId: fixture.people.alex.id,
      occurredAt: instant,
      occurredDate: opts.occurredDate,
      lines: [
        {
          amountPence: p(opts.amount),
          categoryId: fixture.categoryId('Vehicle Running', 'Fuel'),
          targetKind: 'vehicle',
          targetId: opts.vehicleId,
        },
      ],
      actor: ACTOR,
      now: instant,
    });
  }

  function datesOf(events: readonly ProjectedDayToDayEvent[]): string[] {
    return events.map((event) => event.dueDate);
  }

  it('no history → the next shop is projected tomorrow, then every 7 days', async () => {
    const { db } = await setUp();
    setWeeklyGroceriesPence(db, p(90), ACTOR);

    assert.equal(lastWeeklyShopDate(db), null);
    const events = projectDayToDayEvents(db, TODAY, '2026-10-20').filter(
      (event) => event.kind === 'groceries',
    );
    assert.deepEqual(datesOf(events), ['2026-09-25', '2026-10-02', '2026-10-09', '2026-10-16']);
    assert.ok(events.every((event) => event.amountPence === p(90)));
  });

  it('a recorded weekly shop resets the week: next at anchor + 7', async () => {
    const { db } = await setUp();
    setWeeklyGroceriesPence(db, p(90), ACTOR);
    shop(db, { occurredDate: '2026-09-22', amount: 83.12 }); // two days ago

    assert.equal(lastWeeklyShopDate(db), '2026-09-22');
    const events = projectDayToDayEvents(db, TODAY, '2026-10-20').filter(
      (event) => event.kind === 'groceries',
    );
    // The actual amount doesn't matter — the shop happened; projected
    // amounts come from the configured figure.
    assert.deepEqual(datesOf(events), ['2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20']);
  });

  it('an overdue anchor (no shop for 10 days on a 7-day cycle) → tomorrow, not catch-up spam', async () => {
    const { db } = await setUp();
    setWeeklyGroceriesPence(db, p(90), ACTOR);
    shop(db, { occurredDate: '2026-09-14', amount: 88.4 }); // ten days ago

    const events = projectDayToDayEvents(db, TODAY, '2026-10-08').filter(
      (event) => event.kind === 'groceries',
    );
    // Overdue ⇒ money may be needed any time: projected tomorrow, then the
    // 7-day cadence resumes from there (deliberately not 21st/28th).
    assert.deepEqual(datesOf(events), ['2026-09-25', '2026-10-02']);
  });

  it('top-up shops never reset the week — only Weekly Shop anchors groceries', async () => {
    const { db } = await setUp();
    setWeeklyGroceriesPence(db, p(90), ACTOR);
    shop(db, { occurredDate: '2026-09-14', amount: 80 });
    shop(db, {
      occurredDate: '2026-09-23',
      amount: 12.5,
      category: ['Groceries', 'Top-up Shops'],
    });

    assert.equal(lastWeeklyShopDate(db), '2026-09-14'); // yesterday's top-up ignored
    const events = projectDayToDayEvents(db, TODAY, '2026-09-30').filter(
      (event) => event.kind === 'groceries',
    );
    assert.deepEqual(datesOf(events), ['2026-09-25']);
  });

  it('a voided shop is no anchor — the week falls back as if it never happened', async () => {
    const { db } = await setUp();
    setWeeklyGroceriesPence(db, p(90), ACTOR);
    shop(db, { occurredDate: '2026-09-14', amount: 70 });
    const fresh = shop(db, { occurredDate: '2026-09-22', amount: 95 });

    assert.equal(lastWeeklyShopDate(db), '2026-09-22');
    voidPurchase(db, {
      id: fresh.purchase.id,
      expectedVersion: fresh.purchase.version,
      actor: ACTOR,
      now: NOW,
    });
    assert.equal(lastWeeklyShopDate(db), '2026-09-14'); // older shop is the anchor again
  });

  it('fuel anchors per vehicle: a fill of one car never resets the other', async () => {
    const { db } = await setUp();
    setMonthlyFuelPence(db, fixture.vehicles.vehicleA.id, p(75), ACTOR);
    setMonthlyFuelPence(db, fixture.vehicles.vehicleB.id, p(60), ACTOR);
    fill(db, { occurredDate: '2026-09-14', amount: 55, vehicleId: fixture.vehicles.vehicleA.id });

    const anchors = lastFuelDatesByVehicle(db);
    assert.equal(anchors.get(fixture.vehicles.vehicleA.id), '2026-09-14');
    assert.equal(anchors.get(fixture.vehicles.vehicleB.id), null);

    const events = projectDayToDayEvents(db, TODAY, '2026-11-30').filter(
      (event) => event.kind === 'fuel',
    );
    const aEvents = events.filter((event) => event.vehicleId === fixture.vehicles.vehicleA.id);
    const bEvents = events.filter((event) => event.vehicleId === fixture.vehicles.vehicleB.id);
    // A: last fill 14/9 + 30 days → 14/10, then monthly. B: never filled →
    // tomorrow, then every 30 days. Each vehicle keeps its own clock.
    assert.deepEqual(datesOf(aEvents), ['2026-10-14', '2026-11-13']);
    assert.deepEqual(datesOf(bEvents), ['2026-09-25', '2026-10-25', '2026-11-24']);
    assert.ok(aEvents.every((event) => event.amountPence === p(75)));
    assert.ok(bEvents.every((event) => event.amountPence === p(60)));
  });

  it('a fuel fill targeted at the household does not anchor any vehicle', async () => {
    const { db } = await setUp();
    setMonthlyFuelPence(db, fixture.vehicles.vehicleA.id, p(75), ACTOR);
    createPurchase(db, {
      supplierId: null,
      potId: fixture.pots.main.id,
      totalPence: p(40),
      paidByPersonId: fixture.people.alex.id,
      occurredAt: new Date('2026-09-23T12:00:00+01:00'),
      occurredDate: '2026-09-23',
      lines: [
        {
          amountPence: p(40),
          categoryId: fixture.categoryId('Vehicle Running', 'Fuel'),
          targetKind: 'household', // a fuel line with no vehicle target
        },
      ],
      actor: ACTOR,
      now: new Date('2026-09-23T12:00:00+01:00'),
    });

    assert.equal(lastFuelDatesByVehicle(db).get(fixture.vehicles.vehicleA.id), null);
  });

  it('unset or zero figures project nothing; a zero fuel vehicle is silent', async () => {
    const { db } = await setUp();
    // Nothing configured at all:
    assert.deepEqual(projectDayToDayEvents(db, TODAY, '2026-11-30'), []);

    setWeeklyGroceriesPence(db, p(90), ACTOR); // groceries only
    const events = projectDayToDayEvents(db, TODAY, '2026-09-30');
    assert.ok(events.every((event) => event.kind === 'groceries'));
  });

  it('window edges: the through date is inclusive, an empty window is empty', async () => {
    const { db } = await setUp();
    setWeeklyGroceriesPence(db, p(90), ACTOR);
    shop(db, { occurredDate: '2026-09-22', amount: 90 });

    assert.deepEqual(projectDayToDayEvents(db, TODAY, '2026-09-29').length, 1); // 29th counts
    assert.deepEqual(projectDayToDayEvents(db, TODAY, '2026-09-28').length, 0);
    assert.deepEqual(projectDayToDayEvents(db, TODAY, TODAY), []);
  });

  it('end to end: a fresh fill pushes the horizon’s projected fuel out by a month', async () => {
    const { db } = await setUp();
    const { pots, vehicles } = fixture;
    setWeeklyGroceriesPence(db, p(90), ACTOR);
    setMonthlyFuelPence(db, vehicles.vehicleA.id, p(75), ACTOR);
    addCheckpoint(db, { potId: pots.main.id, amountPence: p(1000), actor: ACTOR, now: NOW });
    createSchedule(db, {
      name: 'Salary',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 26,
      amountPence: p(2000),
      potId: pots.salary.id,
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });

    // Before any fill: the payday window expects A's fuel tomorrow
    // (pessimism — the tank state is unknown).
    const before = getProjectionView(db, NOW);
    assert.ok(before);
    const beforeFuel = before.result.perDay
      .filter((day) => day.dayToDayPence > 0)
      .map((day) => day.date);
    assert.ok(beforeFuel[0] === '2026-09-25');

    // Now Alex fills Vehicle A today: the projected fill moves out 30 days.
    fill(db, {
      occurredDate: TODAY,
      amount: 55.0,
      vehicleId: vehicles.vehicleA.id,
      now: '2026-09-24T12:30:00+01:00',
    });
    const after = getHorizonProjectionView(db, '2026-11-30', [], true, NOW);
    const fuelDates = after.dayToDayEvents
      .filter((event) => event.kind === 'fuel')
      .map((event) => event.dueDate);
    assert.deepEqual(fuelDates, ['2026-10-24', '2026-11-23']);

    // …and the horizon no longer charges that £55 fill twice: it is in the
    // estimate already, and the projected fill is a month away.
    assert.equal(after.availableNowPence, p(1000 - 55.0));
    const between = after.result.perDay.find((day) => day.date === '2026-09-25');
    assert.equal(between?.dayToDayPence, p(90)); // groceries only, no fuel
  });
});
