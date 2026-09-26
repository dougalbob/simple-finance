import path from 'node:path';
import { openDatabase } from '../src/lib/db/client';
import { applyMigrations } from '../src/lib/db/migrate';
import { makeTempDir, migrationsFolderBefore } from './helpers';
import { addCheckpoint, createPot } from '../src/lib/records/pots';
import { getHorizonProjectionView } from '../src/lib/records/money-view';
import { scheduleEntrySchema, editScheduleEntrySchema } from '../src/lib/validation';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import { schedules } from '../src/lib/db/schema';
import { excludedMonthsSchema } from '../src/lib/schedule-months';
import {
  cancelSchedule,
  createSchedule,
  editSchedule,
  InvalidScheduleInputError,
  listInstances,
  materializeAndConvert,
  nextDueDateAfter,
  syncScheduleInstances,
  type CreateScheduleInput,
} from '../src/lib/records/schedules';

const now = new Date('2027-01-15T12:00:00Z');
describe('monthly schedules with excluded calendar months', () => {
  let fixture: HouseholdFixture;
  beforeEach(async () => {
    fixture = await createHouseholdFixture();
  });
  afterEach(() => fixture.close());
  function create(patch: Partial<CreateScheduleInput> = {}) {
    return createSchedule(fixture.db, {
      name: 'Ten-month payment',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 1,
      excludedMonths: [3, 2],
      amountPence: 15000,
      potId: fixture.pots.main.id,
      supplierName: 'Local authority',
      categoryId: fixture.categoryId('Housing', 'Mortgage/Rent'),
      activeFrom: '2027-01-01',
      actor: 'alex@example.com',
      now,
      ...patch,
    }).schedule;
  }
  function dates(id: number, from = '2027-01-01', through = '2027-12-31') {
    return listInstances(fixture.db, { scheduleId: id, from, through }).map(
      ({ instance }) => instance.dueDate,
    );
  }

  it('persists sorted months and generates ten payments, repeating across years', () => {
    const schedule = create();
    assert.deepEqual(
      fixture.db.select().from(schedules).where(eq(schedules.id, schedule.id)).get()
        ?.excludedMonths,
      [2, 3],
    );
    assert.deepEqual(
      dates(schedule.id),
      [1, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => `2027-${String(m).padStart(2, '0')}-01`),
    );
    assert.equal(nextDueDateAfter(schedule, '2027-01-01'), '2027-04-01');
    assert.equal(nextDueDateAfter(schedule, '2027-12-01'), '2028-01-01');
    syncScheduleInstances(fixture.db, schedule, new Date('2028-01-15T12:00:00Z'));
    assert.equal(dates(schedule.id, '2028-01-01', '2028-12-31').length, 10);
    assert.deepEqual(
      syncScheduleInstances(fixture.db, schedule, new Date('2028-01-15T12:00:00Z')),
      { inserted: 0, backfilled: 0 },
    );
  });

  it('Horizon excludes the break and resumes the correct commitment amount in April', () => {
    const schedule = create();
    addCheckpoint(fixture.db, {
      potId: fixture.pots.main.id,
      amountPence: 500000,
      actor: 'alex@example.com',
      now,
    });
    const breakView = getHorizonProjectionView(
      fixture.db,
      '2027-03-31',
      [fixture.pots.main.id],
      false,
      now,
    );
    assert.equal(breakView.totalCommitmentsPence, 0);
    assert.deepEqual(breakView.commitmentLines, []);
    const april = getHorizonProjectionView(
      fixture.db,
      '2027-04-30',
      [fixture.pots.main.id],
      false,
      now,
    );
    assert.equal(april.totalCommitmentsPence, 15000);
    assert.deepEqual(
      april.commitmentLines.map((line) => [line.scheduleId, line.dueDate]),
      [[schedule.id, '2027-04-01']],
    );
  });

  it('next due works for a distant start followed by eleven skipped months', () => {
    const schedule = create({
      activeFrom: '2030-01-01',
      excludedMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    });
    assert.equal(nextDueDateAfter(schedule, '2027-01-15'), '2030-12-01');
  });

  it('validates month exclusions at both action boundaries', () => {
    const input = {
      name: 'Seasonal income',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 1,
      amountPence: 10000,
      potId: fixture.pots.main.id,
      activeFrom: '2027-01-01',
      scheduleId: 1,
      expectedVersion: 1,
    };
    for (const schema of [scheduleEntrySchema, editScheduleEntrySchema]) {
      assert.deepEqual(schema.parse(input).excludedMonths, []);
      assert.deepEqual(schema.parse({ ...input, excludedMonths: [3, 2] }).excludedMonths, [2, 3]);
      for (const excludedMonths of [
        [0],
        [13],
        [2, 2],
        [NaN],
        ['2'],
        Array.from({ length: 12 }, (_, i) => i + 1),
      ]) {
        assert.equal(schema.safeParse({ ...input, excludedMonths }).success, false);
      }
      assert.equal(
        schema.safeParse({ ...input, frequency: 'annual', dueMonth: 1, excludedMonths: [2] })
          .success,
        false,
      );
    }
  });

  it('leaves the legacy twelve-month cadence and annual cadence unchanged', () => {
    assert.equal(dates(create({ excludedMonths: undefined }).id).length, 12);
    assert.deepEqual(dates(create({ frequency: 'annual', dueMonth: 2, excludedMonths: [] }).id), [
      '2027-02-01',
    ]);
  });

  it('removes future skipped instances, preserves converted history, and restores unchecked months', () => {
    let schedule = create({ excludedMonths: [] });
    materializeAndConvert(fixture.db, now);
    const history = listInstances(fixture.db, { scheduleId: schedule.id, state: 'converted' });
    schedule = editSchedule(fixture.db, {
      id: schedule.id,
      expectedVersion: schedule.version,
      actor: 'alex@example.com',
      now,
      patch: { excludedMonths: [1, 2, 3] },
    }).schedule;
    assert.deepEqual(
      listInstances(fixture.db, { scheduleId: schedule.id, state: 'converted' }),
      history,
    );
    assert.deepEqual(dates(schedule.id, '2027-02-01', '2027-03-31'), []);
    materializeAndConvert(fixture.db, new Date('2027-03-15T12:00:00Z'));
    assert.deepEqual(
      listInstances(fixture.db, { scheduleId: schedule.id, state: 'converted' }),
      history,
    );
    schedule = editSchedule(fixture.db, {
      id: schedule.id,
      expectedVersion: schedule.version,
      actor: 'alex@example.com',
      now,
      patch: { excludedMonths: [] },
    }).schedule;
    assert.deepEqual(dates(schedule.id, '2027-02-01', '2027-03-31'), ['2027-02-01', '2027-03-01']);
    assert.deepEqual(
      listInstances(fixture.db, { scheduleId: schedule.id, state: 'converted' }),
      history,
    );
  });

  it('does not invent skipped past dates when exclusions are removed', () => {
    const schedule = create({ activeFrom: '2026-09-01', excludedMonths: [9, 10, 11, 12] });
    editSchedule(fixture.db, {
      id: schedule.id,
      expectedVersion: schedule.version,
      actor: 'alex@example.com',
      now,
      patch: { excludedMonths: [] },
    });
    assert.deepEqual(dates(schedule.id, '2026-09-01', '2026-12-31'), []);
  });

  it('backfills an earlier start using the exclusions, without duplicate records', () => {
    let schedule = create({ activeFrom: '2027-04-01' });
    schedule = editSchedule(fixture.db, {
      id: schedule.id,
      expectedVersion: schedule.version,
      actor: 'alex@example.com',
      now,
      patch: { activeFrom: '2026-01-01' },
    }).schedule;
    assert.equal(dates(schedule.id, '2026-01-01', '2026-12-31').length, 10);
    materializeAndConvert(fixture.db, now);
    const rows = listInstances(fixture.db, { scheduleId: schedule.id, state: 'converted' });
    assert.equal(rows.length, 11);
    materializeAndConvert(fixture.db, now);
    assert.deepEqual(
      listInstances(fixture.db, { scheduleId: schedule.id, state: 'converted' }),
      rows,
    );
  });

  it('uses the configured month for income, not the previous Friday month', () => {
    // 1 August 2027 is Sunday: July is skipped, but August still pays on July 30.
    const schedule = create({
      kind: 'receipt',
      categoryId: null,
      supplierName: null,
      activeFrom: '2027-06-01',
      excludedMonths: [7, 10],
    });
    assert.deepEqual(dates(schedule.id, '2027-07-01', '2027-08-31'), ['2027-07-30']);
    assert.equal(nextDueDateAfter(schedule, '2027-06-01'), '2027-07-30');
    const other = create({
      kind: 'receipt',
      categoryId: null,
      supplierName: null,
      activeFrom: '2027-06-01',
      excludedMonths: [8],
    });
    assert.deepEqual(dates(other.id, '2027-07-02', '2027-08-31'), []);
  });

  it('keeps clamping, active bounds, cancellation and one-payment-per-year cases', () => {
    const schedule = create({
      kind: 'so',
      dueDayOfMonth: 31,
      excludedMonths: [3],
      activeUntil: '2027-04-30',
    });
    assert.deepEqual(dates(schedule.id), ['2027-01-31', '2027-02-28', '2027-04-30']);
    assert.equal(nextDueDateAfter(schedule, '2027-02-28'), '2027-04-30');
    assert.equal(nextDueDateAfter(schedule, '2027-04-30'), null);
    cancelSchedule(fixture.db, {
      id: schedule.id,
      expectedVersion: schedule.version,
      effectiveOn: '2027-04-01',
      actor: 'alex@example.com',
      now,
    });
    assert.deepEqual(dates(schedule.id), ['2027-01-31', '2027-02-28']);
    const once = create({ excludedMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] });
    assert.equal(nextDueDateAfter(once, '2027-12-01'), '2028-12-01');
    const leap = create({ dueDayOfMonth: 31, excludedMonths: [3], activeFrom: '2028-01-01' });
    assert.equal(nextDueDateAfter(leap, '2028-01-31'), '2028-02-29');
  });

  it('validates boundaries in the domain and clears exclusions on switching to annual', () => {
    for (const months of [[0], [13], [2.5], [2, 2], Array.from({ length: 12 }, (_, i) => i + 1)]) {
      assert.equal(excludedMonthsSchema.safeParse(months).success, false);
      assert.throws(() => create({ excludedMonths: months }), InvalidScheduleInputError);
    }
    assert.throws(() => create({ frequency: 'annual', dueMonth: 2 }), /Only monthly/);
    const schedule = create();
    const annual = editSchedule(fixture.db, {
      id: schedule.id,
      expectedVersion: schedule.version,
      actor: 'alex@example.com',
      now,
      patch: { frequency: 'annual', dueMonth: 2 },
    }).schedule;
    assert.deepEqual(annual.excludedMonths, []);
    assert.deepEqual(dates(annual.id, '2027-02-01', '2027-12-31'), ['2027-02-01']);
  });
});

it('migration gives an existing v0.19 schedule an empty exclusion list without touching history', async () => {
  const handle = openDatabase(path.join(await makeTempDir('sf-month-migration-'), 'old.sqlite'));
  try {
    applyMigrations(handle.db, await migrationsFolderBefore('0011_schedule_excluded_months'));
    const pot = createPot(handle.db, {
      label: 'Main account',
      kind: 'bank',
      actor: 'alex@example.com',
    });
    handle.raw
      .prepare(
        `INSERT INTO schedules (name, kind, frequency, due_day_of_month, amount_pence,
      pot_id, active_from, created_by, created_at, updated_at) VALUES ('Legacy', 'receipt', 'monthly', 1, 10000, ?, '2027-01-01', 'alex@example.com', 0, 0)`,
      )
      .run(pot.id);
    handle.raw.exec(
      `INSERT INTO schedule_instances (schedule_id, due_date) VALUES (1, '2027-02-01')`,
    );
    const before = handle.raw.prepare('SELECT * FROM schedule_instances').all();
    applyMigrations(handle.db);
    applyMigrations(handle.db);
    assert.deepEqual(handle.db.select().from(schedules).get()?.excludedMonths, []);
    assert.deepEqual(handle.raw.prepare('SELECT * FROM schedule_instances').all(), before);
  } finally {
    handle.raw.close();
  }
});
