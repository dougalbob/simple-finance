import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scheduleInstances } from '../src/lib/db/schema';
import { shiftIncomeOffWeekend, weekdayOf } from '../src/lib/records/dates';
import {
  getIncomeRecord,
  incomeSummary,
  listIncomeRecords,
  listIncomeSchedules,
} from '../src/lib/records/income-view';
import {
  AlreadyVoidError,
  RecordVoidedError,
  VersionConflictError,
} from '../src/lib/records/errors';
import {
  createReceipt,
  editReceipt,
  InvalidReceiptInputError,
  listReceipts,
  ReceiptNotFoundError,
  voidReceipt,
} from '../src/lib/records/receipts';
import {
  createSchedule,
  listInstances,
  materializeAndConvert,
  nextDueDateAfter,
  syncScheduleInstances,
} from '../src/lib/records/schedules';
import { createHouseholdFixture, type HouseholdFixture } from './household';

/**
 * Income (SPEC §6, §11.3 — plan decisions 109–113).
 *
 * Covers the three things v0.4.0 adds to income that already existed as a
 * record family:
 *
 * 1. **a source** — one free-text field for what or who the money came from
 *    (the bicycle sold for cash, the buyer who transferred it), optional and
 *    never a category (income is not spending);
 * 2. **the payday rule** — an income schedule due on a weekend is expected
 *    on the previous Friday (plan OQ2), while direct debits keep their
 *    configured date;
 * 3. **the Income page's view model** — scheduled and one-off income in one
 *    list, with a source that falls back to the schedule's name.
 *
 * The estimate, projection and insight behaviour around receipts is pinned
 * elsewhere (estimate/projection/insights tests) and deliberately untouched.
 */

const ACTOR = 'alex@example.com';
const NOW = new Date('2026-09-20T17:00:00Z');

describe('income records: source, edit and void (SPEC §6)', () => {
  it('stores a trimmed source and treats a blank one as none', async () => {
    const fx = await createHouseholdFixture();
    try {
      const bicycle = createReceipt(fx.db, {
        potId: fx.pots.alexCash.id,
        amountPence: 4500,
        occurredDate: '2026-09-18',
        source: '  Sale of bicycle ',
        note: 'Collected in cash',
        actor: ACTOR,
        now: NOW,
      });
      assert.equal(bicycle.source, 'Sale of bicycle');
      assert.equal(bicycle.occurredDate, '2026-09-18');

      // A converted salary has no typed source: its schedule names it.
      const salary = createReceipt(fx.db, {
        potId: fx.pots.salary.id,
        amountPence: 245000,
        occurredDate: '2026-09-18',
        source: '   ',
        actor: ACTOR,
        now: NOW,
      });
      assert.equal(salary.source, null);
    } finally {
      fx.close();
    }
  });

  it('rejects an over-long source and a non-positive amount', async () => {
    const fx = await createHouseholdFixture();
    try {
      assert.throws(
        () =>
          createReceipt(fx.db, {
            potId: fx.pots.main.id,
            amountPence: 100,
            source: 'x'.repeat(121),
            actor: ACTOR,
            now: NOW,
          }),
        InvalidReceiptInputError,
      );
      assert.throws(
        () =>
          createReceipt(fx.db, {
            potId: fx.pots.main.id,
            amountPence: 0,
            actor: ACTOR,
            now: NOW,
          }),
        InvalidReceiptInputError,
      );
    } finally {
      fx.close();
    }
  });

  it('edits the source, amount, date and note, version-guarded', async () => {
    const fx = await createHouseholdFixture();
    try {
      const created = createReceipt(fx.db, {
        potId: fx.pots.alexCash.id,
        amountPence: 4500,
        occurredDate: '2026-09-18',
        source: 'Sale of bicycle',
        note: 'Collected in cash',
        actor: ACTOR,
        now: NOW,
      });
      const edited = editReceipt(fx.db, {
        id: created.id,
        expectedVersion: created.version,
        actor: ACTOR,
        now: NOW,
        patch: {
          potId: fx.pots.main.id,
          amountPence: 5000,
          occurredDate: '2026-09-19',
          source: 'Sale of bicycle (buyer transferred the rest)',
        },
      });
      assert.equal(edited.version, 2);
      assert.equal(edited.potId, fx.pots.main.id);
      assert.equal(edited.amountPence, 5000);
      assert.equal(edited.occurredDate, '2026-09-19');
      // An untouched note survives a partial patch.
      assert.equal(edited.note, 'Collected in cash');

      const cleared = editReceipt(fx.db, {
        id: created.id,
        expectedVersion: edited.version,
        actor: ACTOR,
        now: NOW,
        patch: { source: null },
      });
      assert.equal(cleared.source, null);

      assert.throws(
        () =>
          editReceipt(fx.db, {
            id: created.id,
            expectedVersion: edited.version,
            actor: ACTOR,
            now: NOW,
            patch: { amountPence: 1 },
          }),
        VersionConflictError,
      );
    } finally {
      fx.close();
    }
  });

  it('voids with a reason and refuses to touch a voided or unknown record', async () => {
    const fx = await createHouseholdFixture();
    try {
      const created = createReceipt(fx.db, {
        potId: fx.pots.main.id,
        amountPence: 2500,
        occurredDate: '2026-09-18',
        source: 'Gift',
        actor: ACTOR,
        now: NOW,
      });
      const voided = voidReceipt(fx.db, {
        id: created.id,
        expectedVersion: created.version,
        actor: ACTOR,
        reason: 'Entered twice',
        now: NOW,
      });
      assert.notEqual(voided.voidedAt, null);
      assert.equal(voided.voidReason, 'Entered twice');
      assert.throws(
        () =>
          voidReceipt(fx.db, {
            id: created.id,
            expectedVersion: voided.version,
            actor: ACTOR,
            now: NOW,
          }),
        AlreadyVoidError,
      );
      assert.throws(
        () =>
          editReceipt(fx.db, {
            id: created.id,
            expectedVersion: voided.version,
            actor: ACTOR,
            now: NOW,
            patch: { amountPence: 1 },
          }),
        RecordVoidedError,
      );
      assert.throws(
        () => voidReceipt(fx.db, { id: 9999, expectedVersion: 1, actor: ACTOR, now: NOW }),
        ReceiptNotFoundError,
      );
      // A voided receipt is invisible to a normal list but still fetchable.
      assert.equal(listReceipts(fx.db, { potId: fx.pots.main.id }).length, 0);
      assert.equal(listReceipts(fx.db, { potId: fx.pots.main.id, includeVoided: true }).length, 1);
    } finally {
      fx.close();
    }
  });
});

describe('payday: income due at the weekend is expected on the Friday before (plan OQ2)', () => {
  it('shifts Saturday and Sunday back to the same Friday, and leaves weekdays alone', () => {
    // September 2026: the 25th is a Friday, the 26th a Saturday, the 27th a Sunday.
    assert.equal(shiftIncomeOffWeekend('2026-09-25'), '2026-09-25');
    assert.equal(shiftIncomeOffWeekend('2026-09-26'), '2026-09-25');
    assert.equal(shiftIncomeOffWeekend('2026-09-27'), '2026-09-25');
    assert.equal(shiftIncomeOffWeekend('2026-09-28'), '2026-09-28');
    assert.equal(weekdayOf('2026-09-26'), 6);
    assert.equal(weekdayOf('2026-09-27'), 0);
  });

  it('applies the shift to income schedules only', async () => {
    const fx = await createHouseholdFixture();
    try {
      const { db } = fx;
      const energy = fx.categoryId('Utilities', 'Energy');
      const salary = createSchedule(db, {
        name: 'Salary',
        kind: 'receipt',
        frequency: 'monthly',
        dueDayOfMonth: 26,
        amountPence: 245000,
        potId: fx.pots.salary.id,
        targetKind: 'household',
        activeFrom: '2026-09-01',
        actor: ACTOR,
        now: NOW,
      });
      const dd = createSchedule(db, {
        name: 'Energy DD',
        kind: 'dd',
        frequency: 'monthly',
        dueDayOfMonth: 26,
        amountPence: 8455,
        potId: fx.pots.main.id,
        categoryId: energy,
        supplierName: 'EnergyCo',
        targetKind: 'household',
        activeFrom: '2026-09-01',
        actor: ACTOR,
        now: NOW,
      });

      const salaryDates = listInstances(db, { scheduleId: salary.schedule.id }).map(
        (row) => row.instance.dueDate,
      );
      const ddDates = listInstances(db, { scheduleId: dd.schedule.id }).map(
        (row) => row.instance.dueDate,
      );
      // Both are configured for the 26th; only the salary moves off the weekend.
      assert.equal(salaryDates[0], '2026-09-25');
      assert.equal(salaryDates[1], '2026-10-26'); // Monday 26 October: stays put
      assert.equal(ddDates[0], '2026-09-26');

      // The same rule holds for the "next due date" the app displays.
      assert.equal(nextDueDateAfter(salary.schedule, '2026-09-01'), '2026-09-25');
      assert.equal(nextDueDateAfter(dd.schedule, '2026-09-01'), '2026-09-26');
      // And it never answers with a date at or before the one asked about.
      assert.equal(nextDueDateAfter(salary.schedule, '2026-09-25'), '2026-10-26');
    } finally {
      fx.close();
    }
  });

  it('moves a 1st-of-month payday back into the previous month when it falls on a weekend', async () => {
    const fx = await createHouseholdFixture();
    try {
      // 1 August 2026 is a Saturday, so August's payday is expected on
      // Friday 31 July — inside the previous month.
      const salary = createSchedule(fx.db, {
        name: 'Salary',
        kind: 'receipt',
        frequency: 'monthly',
        dueDayOfMonth: 1,
        amountPence: 210000,
        potId: fx.pots.salary.id,
        targetKind: 'household',
        activeFrom: '2026-07-01',
        actor: ACTOR,
        now: NOW,
      });
      const dates = listInstances(fx.db, { scheduleId: salary.schedule.id }).map(
        (row) => row.instance.dueDate,
      );
      assert.equal(dates[0], '2026-07-01'); // Wednesday: as configured
      assert.equal(dates[1], '2026-07-31'); // August's payday, moved into July
      assert.equal(dates[2], '2026-09-01'); // Tuesday: as configured
      // Two paydays can therefore land in one calendar month (1st and 31st of
      // July) — which is what a bank actually does. UNIQUE(schedule_id,
      // due_date) is the rule that must hold, not a one-per-month invention.
    } finally {
      fx.close();
    }
  });

  it('re-dates an upcoming weekend instance left behind by the old rule', async () => {
    const fx = await createHouseholdFixture();
    try {
      const { db } = fx;
      const salary = createSchedule(db, {
        name: 'Salary',
        kind: 'receipt',
        frequency: 'monthly',
        dueDayOfMonth: 5,
        amountPence: 210000,
        potId: fx.pots.salary.id,
        targetKind: 'household',
        activeFrom: '2026-09-01',
        actor: ACTOR,
        now: NOW,
      });
      // 5 December 2026 is a Saturday and 6 February 2027 a Saturday too;
      // plant the December instance by hand, as the pre-rule app would have.
      db.insert(scheduleInstances)
        .values({ scheduleId: salary.schedule.id, dueDate: '2026-12-05' })
        .run();
      syncScheduleInstances(db, salary.schedule, NOW);
      const dates = listInstances(db, { scheduleId: salary.schedule.id }).map(
        (row) => row.instance.dueDate,
      );
      assert.equal(dates.includes('2026-12-05'), false, 'the weekend date is gone');
      assert.equal(dates.includes('2026-12-04'), true, 'payday moved to Friday the 4th');
      // And it is still one instance per month — no duplicate, no gap.
      assert.equal(new Set(dates).size, dates.length);
    } finally {
      fx.close();
    }
  });

  it('converts a shifted payday into a receipt on the Friday', async () => {
    const fx = await createHouseholdFixture();
    try {
      const { db } = fx;
      createSchedule(db, {
        name: 'Salary',
        kind: 'receipt',
        frequency: 'monthly',
        dueDayOfMonth: 26,
        amountPence: 245000,
        potId: fx.pots.salary.id,
        targetKind: 'household',
        activeFrom: '2026-09-01',
        actor: ACTOR,
        now: NOW,
      });
      // Local midnight has passed on Friday the 25th, not on the configured 26th.
      materializeAndConvert(db, new Date('2026-09-25T12:00:00+01:00'));
      const receipts = listReceipts(db, { potId: fx.pots.salary.id });
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0]?.occurredDate, '2026-09-25');
      assert.equal(receipts[0]?.amountPence, 245000);
      assert.equal(receipts[0]?.note, 'From schedule “Salary”');
    } finally {
      fx.close();
    }
  });
});

describe('the Income page view model (plan decisions 109–113)', () => {
  async function seeded(): Promise<{ fx: HouseholdFixture; bicycleId: number }> {
    const fx = await createHouseholdFixture();
    const { db } = fx;
    createSchedule(db, {
      name: 'Salary',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 26,
      amountPence: 245000,
      potId: fx.pots.salary.id,
      targetKind: 'household',
      activeFrom: '2026-08-01',
      actor: ACTOR,
      now: NOW,
    });
    // Two paydays have already converted (August and September).
    materializeAndConvert(db, new Date('2026-09-26T12:00:00+01:00'));
    const bicycle = createReceipt(db, {
      potId: fx.pots.alexCash.id,
      amountPence: 4500,
      occurredDate: '2026-09-18',
      source: 'Sale of bicycle',
      note: 'Collected in cash',
      actor: ACTOR,
      now: NOW,
    });
    return { fx, bicycleId: bicycle.id };
  }

  it('lists income schedules with their next payday and receipt history', async () => {
    const { fx } = await seeded();
    try {
      const schedules = listIncomeSchedules(fx.db, new Date('2026-09-26T12:00:00+01:00'));
      assert.equal(schedules.length, 1);
      const salary = schedules[0];
      assert.equal(salary?.name, 'Salary');
      assert.equal(salary?.amountPence, 245000);
      assert.equal(salary?.potLabel, 'Salary account');
      // 26 October 2026 is a Monday; 26 November a Thursday. No shift.
      assert.equal(salary?.nextDueDate, '2026-10-26');
      assert.equal(salary?.nextDueDateShifted, false);
      assert.equal(salary?.receivedCount, 2);
      assert.equal(salary?.lastReceivedDate, '2026-09-25');
    } finally {
      fx.close();
    }
  });

  it('flags a next payday that moved off the weekend', async () => {
    const fx = await createHouseholdFixture();
    try {
      createSchedule(fx.db, {
        name: 'Salary',
        kind: 'receipt',
        frequency: 'monthly',
        dueDayOfMonth: 5,
        amountPence: 210000,
        potId: fx.pots.salary.id,
        targetKind: 'household',
        activeFrom: '2026-09-01',
        actor: ACTOR,
        now: NOW,
      });
      // 5 December 2026 is a Saturday → expected Friday 4 December.
      const schedules = listIncomeSchedules(fx.db, new Date('2026-11-30T12:00:00Z'));
      const salary = schedules.find((row) => row.nextDueDate === '2026-12-04');
      assert.ok(salary, 'the December payday moved to the Friday before');
      assert.equal(salary?.nextDueDateShifted, true);
    } finally {
      fx.close();
    }
  });

  it('resolves each record’s source: typed, then schedule, then "Income"', async () => {
    const { fx, bicycleId } = await seeded();
    try {
      // A receipt with neither a source nor a schedule still has something to
      // show in a dense list rather than a blank cell.
      const bare = createReceipt(fx.db, {
        potId: fx.pots.main.id,
        amountPence: 500,
        occurredDate: '2026-09-19',
        actor: ACTOR,
        now: NOW,
      });
      const records = listIncomeRecords(fx.db);
      assert.equal(records.length, 4);

      const bicycle = records.find((row) => row.id === bicycleId);
      assert.equal(bicycle?.source, 'Sale of bicycle');
      assert.equal(bicycle?.typedSource, 'Sale of bicycle');
      assert.equal(bicycle?.potLabel, "Alex's cash");
      assert.equal(bicycle?.scheduleName, null);
      assert.equal(bicycle?.scheduleId, null);

      const salary = records.find((row) => row.scheduleName === 'Salary');
      assert.equal(salary?.source, 'Salary'); // no typed source: the schedule names it
      assert.equal(salary?.typedSource, null);
      assert.equal(salary?.note, 'From schedule “Salary”');

      const bareView = records.find((row) => row.id === bare.id);
      assert.equal(bareView?.source, 'Income');
      assert.equal(bareView?.typedSource, null);
    } finally {
      fx.close();
    }
  });

  it('excludes voided income from the list but still resolves a deep link to it', async () => {
    const { fx, bicycleId } = await seeded();
    try {
      voidReceipt(fx.db, {
        id: bicycleId,
        expectedVersion: 1,
        actor: ACTOR,
        reason: 'The buyer changed their mind',
        now: NOW,
      });
      assert.equal(
        listIncomeRecords(fx.db).some((row) => row.id === bicycleId),
        false,
      );
      const linked = getIncomeRecord(fx.db, bicycleId);
      assert.equal(linked?.voidReason, 'The buyer changed their mind');
      assert.equal(linked?.source, 'Sale of bicycle');
      assert.equal(getIncomeRecord(fx.db, 9999), null);
    } finally {
      fx.close();
    }
  });

  it('summarises what arrived this month and when the next payday is', async () => {
    const { fx } = await seeded();
    try {
      const summary = incomeSummary(fx.db, new Date('2026-09-26T12:00:00+01:00'));
      // September's converted salary (August's is last month) plus the sale.
      assert.equal(summary.monthToDatePence, 245000 + 4500);
      assert.equal(summary.nextPayday?.date, '2026-10-26');
      assert.equal(summary.nextPayday?.amountPence, 245000);
      assert.equal(summary.nextPayday?.scheduleName, 'Salary');
      assert.equal(summary.nextPayday?.shifted, false);
    } finally {
      fx.close();
    }
  });

  it('scopes the record list to one pot and honours a date window', async () => {
    const { fx } = await seeded();
    try {
      const cashOnly = listIncomeRecords(fx.db, { potId: fx.pots.alexCash.id });
      assert.equal(cashOnly.length, 1);
      assert.equal(cashOnly[0]?.source, 'Sale of bicycle');

      const august = listIncomeRecords(fx.db, {
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
      });
      assert.equal(august.length, 1);
      assert.equal(august[0]?.occurredDate, '2026-08-26');
    } finally {
      fx.close();
    }
  });
});
