import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import {
  cancelSchedule,
  createSchedule,
  editSchedule,
  listInstances,
  materializeAndConvert,
} from '../src/lib/records/schedules';
import { addDaysLocal, daysInMonth } from '../src/lib/records/dates';
import { startOfWeekLocal } from '../src/lib/records/insights';

/**
 * Phase 4a exit criterion: the recurring month calendar stays consistent
 * with the instance lists after schedule edits and cancellations.
 *
 * The /recurring page renders the calendar from
 * listInstances(db, { from: firstOfMonth, through: lastOfMonth }) — exactly
 * one query, one row per day cell — so these tests pin down that query's
 * behaviour (plus the grid construction) at every point where the instance
 * set changes. The page also states what the calendar cannot do: app date
 * changes never move bank instructions (a property of the design, tested
 * here as "editing/cancelling only changes which instances exist").
 */

const NOW = new Date('2026-09-20T17:00:00Z');
const p = (value: number) => Math.round(value * 100);

interface MonthRef {
  year: number;
  month: number; // 1–12
}

function monthWindow(ref: MonthRef): { from: string; through: string } {
  const from = `${ref.year}-${String(ref.month).padStart(2, '0')}-01`;
  return { from, through: addDaysLocal(from, daysInMonth(ref.year, ref.month) - 1) };
}

/** Replicates the page's grid: 42 cells (Mon-first) covering the month. */
function gridCells(ref: MonthRef): string[] {
  const { from } = monthWindow(ref);
  const start = startOfWeekLocal(from);
  return Array.from({ length: 42 }, (_, i) => addDaysLocal(start, i));
}

function instancesFor(db: HouseholdFixture['db'], ref: MonthRef, scheduleId: number) {
  const { from, through } = monthWindow(ref);
  return listInstances(db, { from, through, scheduleId });
}

describe('recurring calendar: consistency with instance lists', () => {
  let fixture: HouseholdFixture;
  let rentId: number;
  let rentVersion = 1;
  let insuranceId: number;

  before(async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const rent = createSchedule(db, {
      name: 'Rent standing order',
      kind: 'so',
      frequency: 'monthly',
      dueDayOfMonth: 5,
      amountPence: p(845.55),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Housing', 'Mortgage/Rent'),
      targetKind: 'household',
      activeFrom: '2026-08-01',
      actor: 'alex@example.com',
      now: NOW,
    });
    rentId = rent.schedule.id;
    const insurance = createSchedule(db, {
      name: 'Insurance direct debit',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 1,
      amountPence: p(120),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Vehicle Running', 'Insurance'),
      supplierName: 'Northern Power Co',
      targetKind: 'household',
      activeFrom: '2026-08-01',
      actor: 'alex@example.com',
      now: NOW,
    });
    insuranceId = insurance.schedule.id;
    // The app's daily due pass: converts what is due.
    materializeAndConvert(db, NOW);
  });
  after(() => fixture.close());

  it('shows exactly the due-date instances for the month, inside the grid', () => {
    const sept: MonthRef = { year: 2026, month: 9 };
    const cells = new Set(gridCells(sept));
    // The grid starts on Monday 2026-08-31 — an August instance must NOT
    // appear in the September calendar even though its cell is drawn.
    assert.ok(cells.has('2026-08-31'));

    const rent = instancesFor(fixture.db, sept, rentId);
    assert.deepEqual(
      rent.map((row) => row.instance.dueDate),
      ['2026-09-05'],
    );
    assert.equal(rent[0]?.instance.state, 'converted'); // past the due date
    for (const row of rent) assert.ok(cells.has(row.instance.dueDate));

    const insurance = instancesFor(fixture.db, sept, insuranceId);
    assert.deepEqual(
      insurance.map((row) => row.instance.dueDate),
      ['2026-09-01'],
    );
    // The 1st of August belongs to the August calendar.
    assert.deepEqual(
      instancesFor(fixture.db, { year: 2026, month: 8 }, insuranceId).map(
        (row) => row.instance.dueDate,
      ),
      ['2026-08-01'],
    );
  });

  it('after an edit, future months move to the new day; converted history is untouched', () => {
    editSchedule(fixture.db, {
      id: rentId,
      expectedVersion: rentVersion,
      actor: 'alex@example.com',
      now: NOW,
      patch: { dueDayOfMonth: 20 },
    });
    rentVersion += 1;

    const october = instancesFor(fixture.db, { year: 2026, month: 10 }, rentId);
    assert.deepEqual(
      october.map((row) => row.instance.dueDate),
      ['2026-10-20'],
    );
    assert.equal(october[0]?.instance.state, 'upcoming');

    const november = instancesFor(fixture.db, { year: 2026, month: 11 }, rentId);
    assert.deepEqual(
      november.map((row) => row.instance.dueDate),
      ['2026-11-20'],
    );

    // September's converted instance keeps its original due date and
    // amount; and because the edit lands on the 20th, the NEW due date is
    // today — the next instance is 2026-09-20, due today.
    const september = instancesFor(fixture.db, { year: 2026, month: 9 }, rentId);
    assert.deepEqual(
      september.map((row) => row.instance.dueDate),
      ['2026-09-05', '2026-09-20'],
    );
    assert.equal(september[0]?.instance.state, 'converted');
    assert.equal(september[0]?.amountPence, p(845.55));
    assert.equal(september[1]?.instance.state, 'upcoming');
  });

  it('after a cancellation, instances from the effective date no longer exist', () => {
    cancelSchedule(fixture.db, {
      id: rentId,
      expectedVersion: rentVersion,
      effectiveOn: '2026-10-01',
      actor: 'alex@example.com',
      now: NOW,
    });
    rentVersion += 1;

    const october = instancesFor(fixture.db, { year: 2026, month: 10 }, rentId);
    assert.equal(october.length, 0);
    const november = instancesFor(fixture.db, { year: 2026, month: 11 }, rentId);
    assert.equal(november.length, 0);

    // History stays: September still shows the converted rent (and the
    // in-month instance due today, which the cancellation — effective the
    // 1st of October — does not reach).
    const september = instancesFor(fixture.db, { year: 2026, month: 9 }, rentId);
    assert.deepEqual(
      september.map((row) => row.instance.dueDate),
      ['2026-09-05', '2026-09-20'],
    );
    assert.equal(september[0]?.instance.state, 'converted');

    // The other schedule is unaffected.
    assert.deepEqual(
      instancesFor(fixture.db, { year: 2026, month: 10 }, insuranceId).map(
        (row) => row.instance.dueDate,
      ),
      ['2026-10-01'],
    );
  });
});

describe('recurring calendar: due-day edits land on the next instance (SPEC §11.1)', () => {
  it('moving a due day (not today) moves every future materialized instance', async () => {
    const fixture = await createHouseholdFixture();
    try {
      const { db, pots } = fixture;
      const schedule = createSchedule(db, {
        name: 'Streaming DD',
        kind: 'dd',
        frequency: 'monthly',
        dueDayOfMonth: 5,
        amountPence: p(9.99),
        potId: pots.main.id,
        categoryId: fixture.categoryId('Entertainment & Eating Out', 'Subscriptions & Streaming'),
        supplierName: 'Northern Power Co',
        targetKind: 'household',
        activeFrom: '2026-08-01',
        actor: 'alex@example.com',
        now: NOW,
      });
      materializeAndConvert(db, NOW);
      // Before the edit, October/November show the 5th.
      assert.equal(instancesFor(db, { year: 2026, month: 10 }, schedule.schedule.id).length, 1);

      editSchedule(db, {
        id: schedule.schedule.id,
        expectedVersion: schedule.schedule.version,
        actor: 'alex@example.com',
        now: NOW, // the 20th — not the old (5th) or new (18th) due day
        patch: { dueDayOfMonth: 18 },
      });

      assert.deepEqual(
        instancesFor(db, { year: 2026, month: 10 }, schedule.schedule.id).map(
          (row) => row.instance.dueDate,
        ),
        ['2026-10-18'],
      );
      assert.deepEqual(
        instancesFor(db, { year: 2026, month: 11 }, schedule.schedule.id).map(
          (row) => row.instance.dueDate,
        ),
        ['2026-11-18'],
      );
      // No old-cadence instance survives anywhere in the horizon.
      const stale = listInstances(db, {
        scheduleId: schedule.schedule.id,
        state: 'upcoming',
      }).filter((row) => row.instance.dueDate.endsWith('-05'));
      assert.equal(stale.length, 0);
      // And nothing was backfilled before today under the new cadence.
      const backfilled = listInstances(db, {
        scheduleId: schedule.schedule.id,
        state: 'upcoming',
        through: '2026-09-19',
      });
      assert.equal(backfilled.length, 0);
      // Converted history is untouched.
      assert.deepEqual(
        instancesFor(db, { year: 2026, month: 9 }, schedule.schedule.id).map(
          (row) => row.instance.dueDate,
        ),
        ['2026-09-05'],
      );
      assert.equal(
        instancesFor(db, { year: 2026, month: 9 }, schedule.schedule.id)[0]?.instance.state,
        'converted',
      );
    } finally {
      fixture.close();
    }
  });
});

describe('recurring calendar: month-end clamping on short months', () => {
  it('a day-31 monthly schedule lands on the last day of short months', async () => {
    const fixture = await createHouseholdFixture();
    try {
      const { db, pots } = fixture;
      createSchedule(db, {
        name: 'End-of-month electricity',
        kind: 'dd',
        frequency: 'monthly',
        dueDayOfMonth: 31,
        amountPence: p(99.99),
        potId: pots.main.id,
        categoryId: fixture.categoryId('Utilities', 'Energy'),
        supplierName: 'Northern Power Co',
        targetKind: 'household',
        activeFrom: '2026-01-01',
        actor: 'alex@example.com',
        now: NOW,
      });
      materializeAndConvert(db, NOW);
      const dates = (ref: MonthRef) =>
        listInstances(db, { from: monthWindow(ref).from, through: monthWindow(ref).through }).map(
          (row) => row.instance.dueDate,
        );
      assert.deepEqual(dates({ year: 2026, month: 2 }), ['2026-02-28']); // not 2026-03-02
      assert.deepEqual(dates({ year: 2026, month: 6 }), ['2026-06-30']);
      assert.deepEqual(dates({ year: 2026, month: 9 }), ['2026-09-30']);
      // Every clamped date sits in its month's grid.
      for (const ref of [
        { year: 2026, month: 2 },
        { year: 2026, month: 6 },
        { year: 2026, month: 9 },
      ]) {
        assert.ok(new Set(gridCells(ref)).has(dates(ref)[0] as string));
      }
    } finally {
      fixture.close();
    }
  });
});
