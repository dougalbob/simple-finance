import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { auditEntries, purchases } from '../src/lib/db/schema';
import { listPotActivity, type ActivityRow } from '../src/lib/records/activity';
import { getMoneySnapshot } from '../src/lib/records/money-view';
import { addCheckpoint } from '../src/lib/records/pots';
import { listPurchases } from '../src/lib/records/purchases';
import { listReceipts } from '../src/lib/records/receipts';
import {
  InvalidScheduleInputError,
  MAX_BACKFILL_SPAN_DAYS,
  createSchedule,
  editSchedule,
  listInstances,
  materializeAndConvert,
  nextDueDateAfter,
} from '../src/lib/records/schedules';
import { createHouseholdFixture, type HouseholdFixture } from './household';

/**
 * The editable start date (SPEC §11.1, decision 162): the one schedule field an
 * edit may move into the past, so a direct debit that was collected before the
 * schedule existed lands as a real schedule-converted record instead of a
 * hand-entered purchase.
 *
 * The case that prompted it: a household that started recording five days after
 * filling up the car, whose recurring debits were set up in the app on the day
 * they started. The payments inside that window belonged to no instance, so the
 * history either had a hole or got typed in as a Purchase and mislabelled every
 * insight that reads the money (SPEC §15.3, §16).
 *
 * The rule these tests pin down: a backdated start **adds** instances, in both
 * directions of history — it never rewrites a converted record, never
 * duplicates a date the app already holds, and never invents a past instance
 * for any other kind of edit (decision 75 stays exactly as it was).
 */

const ACTOR = 'alex@example.com';
/** The day the household is filling the gap in: five days after the fuel fill. */
const TODAY = new Date('2026-09-26T09:00:00Z');

const p = (value: number) => Math.round(value * 100);

function dueDates(
  db: HouseholdFixture['db'],
  scheduleId: number,
  from: string,
  through: string,
): string[] {
  return listInstances(db, { scheduleId, from, through }).map((row) => row.instance.dueDate);
}

function rowsOf(view: { entries: Array<{ kind: string; row?: ActivityRow }> }): ActivityRow[] {
  return view.entries
    .filter((entry): entry is { kind: 'row'; row: ActivityRow } => entry.kind === 'row')
    .map((entry) => entry.row);
}

function purchasesForSchedule(db: HouseholdFixture['db'], scheduleName: string) {
  return listPurchases(db, { limit: 100, includeVoided: false })
    .map(({ purchase }) => purchase)
    .filter((purchase) => (purchase.note ?? '').includes(scheduleName))
    .sort((a, b) => a.occurredDate.localeCompare(b.occurredDate));
}

describe('schedule start date: backfilling what the app was never told about', () => {
  it('turns a missed direct debit into a DD record, dated the day the money left', async () => {
    const fixture = await createHouseholdFixture();
    try {
      const { db, pots } = fixture;
      // Set the insurance DD up in the app on the 22nd; the bank took the
      // money on the 19th.
      const created = createSchedule(db, {
        name: 'Car insurance — InsurerCo',
        kind: 'dd',
        frequency: 'monthly',
        dueDayOfMonth: 19,
        amountPence: p(41.2),
        potId: pots.main.id,
        categoryId: fixture.categoryId('Vehicle Running', 'Insurance'),
        supplierName: 'InsurerCo',
        targetKind: 'vehicle',
        targetId: fixture.vehicles.vehicleA.id,
        activeFrom: '2026-09-22',
        actor: ACTOR,
        now: new Date('2026-09-22T09:00:00Z'),
      });
      const scheduleId = created.schedule.id;
      assert.deepEqual(dueDates(db, scheduleId, '2026-09-01', '2026-09-21'), []);

      const result = editSchedule(db, {
        id: scheduleId,
        expectedVersion: created.schedule.version,
        actor: ACTOR,
        now: TODAY,
        patch: { activeFrom: '2026-09-01' },
      });
      assert.equal(result.schedule.activeFrom, '2026-09-01');
      assert.equal(result.backfilledInstances, 1, 'only the 19th was missing');

      // The next money pass — the same lazy due pass every read page runs —
      // converts it, exactly like an ordinary due date.
      getMoneySnapshot(db, TODAY);
      const view = listPotActivity(db, {
        potId: pots.main.id,
        dateFrom: '2026-09-01',
        dateTo: '2026-09-26',
      });
      const ddRow = rowsOf(view).find((row) => row.date === '2026-09-19');
      assert.ok(ddRow, 'the payment is in the pot history');
      assert.equal(ddRow.code, 'DD', 'a direct debit, not a hand-typed PUR');
      assert.equal(ddRow.direction, 'out');
      assert.equal(ddRow.amountPence, p(41.2));

      const backfilled = purchasesForSchedule(db, 'Car insurance')[0];
      assert.ok(backfilled);
      assert.equal(backfilled.occurredDate, '2026-09-19');
      assert.equal(backfilled.potId, pots.main.id);
      assert.ok(backfilled.scheduleInstanceId !== null, 'linked to its instance');
      assert.match(backfilled.note ?? '', /^From schedule /);

      // The audit trail says so, in the sync entry as well as the edit entry.
      const syncAudit = db
        .select()
        .from(auditEntries)
        .all()
        .filter((row) => row.action === 'schedule.sync' && Number(row.entityId) === scheduleId)
        .at(-1);
      assert.match(syncAudit?.summary ?? '', /Backfilled 1 instance\(s\) before today/);
      assert.match(syncAudit?.summary ?? '', /Converted history untouched/);
    } finally {
      fixture.close();
    }
  });

  it('fills the whole window, including dates before a record that already converted', async () => {
    const fixture = await createHouseholdFixture();
    try {
      const { db, pots } = fixture;
      const created = createSchedule(db, {
        name: 'Rent standing order',
        kind: 'so',
        frequency: 'monthly',
        dueDayOfMonth: 26,
        amountPence: p(620),
        potId: pots.main.id,
        categoryId: fixture.categoryId('Housing', 'Mortgage/Rent'),
        targetKind: 'household',
        activeFrom: '2026-09-02',
        actor: ACTOR,
        now: new Date('2026-09-02T09:00:00Z'),
      });
      const scheduleId = created.schedule.id;
      materializeAndConvert(db, TODAY);
      // July and August are simply absent; the 26th of September has converted.
      assert.equal(
        listInstances(db, { scheduleId, state: 'converted' }).length,
        1,
        'the 26th September',
      );

      const result = editSchedule(db, {
        id: scheduleId,
        expectedVersion: created.schedule.version,
        actor: ACTOR,
        now: TODAY,
        patch: { activeFrom: '2026-07-01' },
      });
      // The two missing months are added; the date that already has a
      // converted row is skipped rather than counted twice.
      assert.equal(result.backfilledInstances, 2);

      materializeAndConvert(db, TODAY);
      assert.deepEqual(
        purchasesForSchedule(db, 'Rent standing order').map((purchase) => purchase.occurredDate),
        ['2026-07-26', '2026-08-26', '2026-09-26'],
      );
      const history = listPurchases(db, { limit: 100, includeVoided: false })
        .map(({ purchase }) => purchase)
        .find((purchase) => purchase.occurredDate === '2026-09-26');
      assert.ok(history, 'the record that had already converted is still there');
      assert.equal(history.totalPence, p(620));
      assert.equal(
        db.select().from(purchases).where(eq(purchases.id, history.id)).get()?.voidedAt ?? null,
        null,
        'and it was not voided or rewritten',
      );
    } finally {
      fixture.close();
    }
  });

  it('backfills nothing when the start date is saved unchanged', async () => {
    const fixture = await createHouseholdFixture();
    try {
      const { db, pots } = fixture;
      // The edit form always posts the start date, so "unchanged" is the case
      // that must never reach behind today (decision 75).
      const created = createSchedule(db, {
        name: 'Broadband DD',
        kind: 'dd',
        frequency: 'monthly',
        dueDayOfMonth: 19,
        amountPence: p(29),
        potId: pots.main.id,
        categoryId: fixture.categoryId('Utilities', 'Broadband'),
        supplierName: 'Northern Power Co',
        targetKind: 'household',
        activeFrom: '2026-09-26',
        actor: ACTOR,
        now: TODAY,
      });
      const result = editSchedule(db, {
        id: created.schedule.id,
        expectedVersion: created.schedule.version,
        actor: ACTOR,
        now: TODAY,
        patch: { activeFrom: '2026-09-26', amountPence: p(31) },
      });
      assert.equal(result.backfilledInstances, 0);
      assert.deepEqual(dueDates(db, created.schedule.id, '2026-09-01', '2026-09-25'), []);
      assert.deepEqual(dueDates(db, created.schedule.id, '2026-10-01', '2026-10-31'), [
        '2026-10-19',
      ]);
      assert.equal(materializeAndConvert(db, TODAY), 0, 'nothing due, so nothing converted');
    } finally {
      fixture.close();
    }
  });

  it('a backdated start plus a cadence change follows the cadence that was saved', async () => {
    const fixture = await createHouseholdFixture();
    try {
      const { db, pots } = fixture;
      const created = createSchedule(db, {
        name: 'Water SO',
        kind: 'so',
        frequency: 'monthly',
        dueDayOfMonth: 19,
        amountPence: p(18.4),
        potId: pots.main.id,
        categoryId: fixture.categoryId('Utilities', 'Water'),
        targetKind: 'household',
        activeFrom: '2026-09-22',
        actor: ACTOR,
        now: new Date('2026-09-22T09:00:00Z'),
      });
      const scheduleId = created.schedule.id;
      assert.deepEqual(dueDates(db, scheduleId, '2026-10-01', '2026-10-31'), ['2026-10-19']);

      editSchedule(db, {
        id: scheduleId,
        expectedVersion: created.schedule.version,
        actor: ACTOR,
        now: TODAY,
        patch: { activeFrom: '2026-09-01', dueDayOfMonth: 20, amountPence: p(19.1) },
      });

      // The household said "this has been running since the 1st, on the 20th",
      // so that is the window the app now believes in — old-cadence rows in it
      // are replaced, not kept alongside.
      assert.deepEqual(dueDates(db, scheduleId, '2026-09-01', '2026-09-30'), ['2026-09-20']);
      assert.deepEqual(dueDates(db, scheduleId, '2026-10-01', '2026-10-31'), ['2026-10-20']);

      materializeAndConvert(db, TODAY);
      const backfilled = purchasesForSchedule(db, 'Water SO')[0];
      assert.equal(backfilled?.occurredDate, '2026-09-20');
      // Stated plainly in the form's copy: the amount saved alongside a
      // backdated start is the amount the backfilled record carries.
      assert.equal(backfilled?.totalPence, p(19.1));
    } finally {
      fixture.close();
    }
  });

  it('moving the start date later drops upcoming instances and keeps converted history', async () => {
    const fixture = await createHouseholdFixture();
    try {
      const { db, pots } = fixture;
      const created = createSchedule(db, {
        name: 'Council Tax DD',
        kind: 'dd',
        frequency: 'monthly',
        dueDayOfMonth: 10,
        amountPence: p(142),
        potId: pots.main.id,
        categoryId: fixture.categoryId('Housing', 'Council Tax'),
        supplierName: 'Council',
        targetKind: 'household',
        activeFrom: '2026-06-01',
        actor: ACTOR,
        now: new Date('2026-06-02T09:00:00Z'),
      });
      const scheduleId = created.schedule.id;
      materializeAndConvert(db, TODAY);
      assert.deepEqual(dueDates(db, scheduleId, '2026-10-01', '2026-10-31'), ['2026-10-10']);

      const result = editSchedule(db, {
        id: scheduleId,
        expectedVersion: created.schedule.version,
        actor: ACTOR,
        now: TODAY,
        patch: { activeFrom: '2026-11-01' },
      });
      assert.equal(result.backfilledInstances, 0);
      assert.deepEqual(dueDates(db, scheduleId, '2026-10-01', '2026-10-31'), []);
      assert.deepEqual(dueDates(db, scheduleId, '2026-11-01', '2026-11-30'), ['2026-11-10']);
      assert.equal(nextDueDateAfter(result.schedule, '2026-09-26'), '2026-11-10');
      // The summer's converted records are history, and history stays.
      assert.ok(
        listInstances(db, { scheduleId, state: 'converted' }).length >= 3,
        'June, July, August, September',
      );
    } finally {
      fixture.close();
    }
  });

  it('an income schedule backdates into a receipt, never a purchase', async () => {
    const fixture = await createHouseholdFixture();
    try {
      const { db, pots } = fixture;
      const created = createSchedule(db, {
        name: 'Salary',
        kind: 'receipt',
        frequency: 'monthly',
        // 2026-09-25 is a Friday, so the payday rule leaves it alone.
        dueDayOfMonth: 25,
        amountPence: p(2400),
        potId: pots.salary.id,
        targetKind: 'person',
        targetId: fixture.people.alex.id,
        activeFrom: '2026-09-26',
        actor: ACTOR,
        now: TODAY,
      });
      const scheduleId = created.schedule.id;
      const before = listPurchases(db, { limit: 100, includeVoided: false }).length;

      const result = editSchedule(db, {
        id: scheduleId,
        expectedVersion: created.schedule.version,
        actor: ACTOR,
        now: TODAY,
        patch: { activeFrom: '2026-09-01' },
      });
      assert.equal(result.backfilledInstances, 1);

      materializeAndConvert(db, TODAY);
      const receipt = listReceipts(db, { potId: pots.salary.id, dateFrom: '2026-09-01' }).find(
        (row) => row.occurredDate === '2026-09-25',
      );
      assert.ok(receipt, 'the payday is recorded');
      assert.equal(receipt.amountPence, p(2400));
      assert.ok(receipt.scheduleInstanceId !== null);
      assert.equal(
        listPurchases(db, { limit: 100, includeVoided: false }).length,
        before,
        'income never becomes a purchase',
      );
      const rows = rowsOf(
        listPotActivity(db, {
          potId: pots.salary.id,
          dateFrom: '2026-09-01',
          dateTo: '2026-09-26',
        }),
      );
      assert.deepEqual(
        rows.filter((row) => row.date === '2026-09-25').map((row) => row.code),
        ['BAC'],
      );
    } finally {
      fixture.close();
    }
  });

  it('re-saving the same backdated start adds nothing a second time', async () => {
    const fixture = await createHouseholdFixture();
    try {
      const { db, pots } = fixture;
      const created = createSchedule(db, {
        name: 'Mobile plan DD',
        kind: 'dd',
        frequency: 'monthly',
        dueDayOfMonth: 15,
        amountPence: p(28.99),
        potId: pots.main.id,
        categoryId: fixture.categoryId('Utilities', 'Mobile Phones'),
        supplierName: 'Mobile Phones',
        targetKind: 'person',
        targetId: fixture.people.alex.id,
        activeFrom: '2026-09-20',
        actor: ACTOR,
        now: new Date('2026-09-20T09:00:00Z'),
      });
      const scheduleId = created.schedule.id;

      const first = editSchedule(db, {
        id: scheduleId,
        expectedVersion: created.schedule.version,
        actor: ACTOR,
        now: TODAY,
        patch: { activeFrom: '2026-06-01' },
      });
      assert.equal(first.backfilledInstances, 4, 'June, July, August and September');
      materializeAndConvert(db, TODAY);
      const convertedAfterFirst = listInstances(db, {
        scheduleId,
        state: 'converted',
      }).length;
      assert.equal(convertedAfterFirst, 4);

      // An explicit second save of the same start date is inert: the dates are
      // occupied now, so there is nothing to invent and nothing to duplicate.
      const second = editSchedule(db, {
        id: scheduleId,
        expectedVersion: first.schedule.version,
        actor: ACTOR,
        now: TODAY,
        patch: { activeFrom: '2026-06-01' },
      });
      assert.equal(second.backfilledInstances, 0);
      materializeAndConvert(db, TODAY);
      assert.equal(
        listInstances(db, { scheduleId, state: 'converted' }).length,
        convertedAfterFirst,
      );
    } finally {
      fixture.close();
    }
  });

  it('a backfilled record older than the checkpoint is absorbed, not subtracted twice', async () => {
    const fixture = await createHouseholdFixture();
    try {
      const { db, pots } = fixture;
      addCheckpoint(db, {
        potId: pots.main.id,
        amountPence: p(412.35),
        actor: ACTOR,
        now: TODAY,
      });
      assert.equal(
        getMoneySnapshot(db, TODAY).pots.find((pot) => pot.pot.id === pots.main.id)?.estimatePence,
        p(412.35),
      );

      const created = createSchedule(db, {
        name: 'Road Tax DD',
        kind: 'dd',
        frequency: 'monthly',
        dueDayOfMonth: 1,
        amountPence: p(180),
        potId: pots.main.id,
        categoryId: fixture.categoryId('Vehicle Running', 'Road Tax'),
        supplierName: 'DVLA',
        targetKind: 'vehicle',
        targetId: fixture.vehicles.vehicleA.id,
        activeFrom: '2026-09-26',
        actor: ACTOR,
        now: TODAY,
      });
      editSchedule(db, {
        id: created.schedule.id,
        expectedVersion: created.schedule.version,
        actor: ACTOR,
        now: TODAY,
        patch: { activeFrom: '2026-08-01' },
      });

      // The record lands on 1st September — before the bank figure the
      // household just read off the app (SPEC §7.1, E6) — so the estimate the
      // household sees is unchanged, and the backfill cannot double-count.
      const snapshot = getMoneySnapshot(db, TODAY);
      assert.equal(
        snapshot.pots.find((pot) => pot.pot.id === pots.main.id)?.estimatePence,
        p(412.35),
      );
      assert.equal(
        dueDates(db, created.schedule.id, '2026-08-01', '2026-09-25').length,
        2,
        'both missed instances exist as records',
      );
    } finally {
      fixture.close();
    }
  });

  it('refuses a start date beyond the window the app keeps instances for', async () => {
    const fixture = await createHouseholdFixture();
    try {
      const { db, pots } = fixture;
      const created = createSchedule(db, {
        name: 'Streaming DD',
        kind: 'dd',
        frequency: 'monthly',
        dueDayOfMonth: 5,
        amountPence: p(9.99),
        potId: pots.main.id,
        categoryId: fixture.categoryId('Entertainment & Eating Out', 'Subscriptions & Streaming'),
        supplierName: 'Northern Power Co',
        targetKind: 'household',
        activeFrom: '2026-09-01',
        actor: ACTOR,
        now: new Date('2026-09-02T09:00:00Z'),
      });

      const tooFarBack = '2019-01-01';
      assert.throws(
        () =>
          editSchedule(db, {
            id: created.schedule.id,
            expectedVersion: created.schedule.version,
            actor: ACTOR,
            now: TODAY,
            patch: { activeFrom: tooFarBack },
          }),
        (error: unknown) => {
          assert.ok(error instanceof InvalidScheduleInputError);
          assert.match(error.message, /at most \d+ days back/);
          assert.match(error.message, new RegExp(String(MAX_BACKFILL_SPAN_DAYS)));
          return true;
        },
      );
      // Rejected before it wrote anything: the schedule is untouched.
      const unchanged = editSchedule(db, {
        id: created.schedule.id,
        expectedVersion: created.schedule.version,
        actor: ACTOR,
        now: TODAY,
        patch: {},
      });
      assert.equal(unchanged.schedule.activeFrom, '2026-09-01');
      assert.equal(unchanged.backfilledInstances, 0);

      // Creation is held to the same bound, with the same sentence.
      assert.throws(
        () =>
          createSchedule(db, {
            name: 'Ancient DD',
            kind: 'dd',
            frequency: 'monthly',
            dueDayOfMonth: 5,
            amountPence: p(10),
            potId: pots.main.id,
            categoryId: fixture.categoryId(
              'Entertainment & Eating Out',
              'Subscriptions & Streaming',
            ),
            supplierName: 'Northern Power Co',
            activeFrom: tooFarBack,
            actor: ACTOR,
            now: TODAY,
          }),
        InvalidScheduleInputError,
      );
    } finally {
      fixture.close();
    }
  });

  it('keeps an annual schedule on its anniversary when the start moves back a year', async () => {
    const fixture = await createHouseholdFixture();
    try {
      const { db, pots } = fixture;
      const created = createSchedule(db, {
        name: 'Buildings insurance',
        kind: 'dd',
        frequency: 'annual',
        dueDayOfMonth: 15,
        dueMonth: 3,
        amountPence: p(310),
        potId: pots.main.id,
        categoryId: fixture.categoryId('Housing', 'Buildings & Contents Insurance'),
        supplierName: 'InsurerCo',
        targetKind: 'household',
        activeFrom: '2026-09-20',
        actor: ACTOR,
        now: new Date('2026-09-20T09:00:00Z'),
      });
      // Created on 20th September, so the app's first expectation is next March:
      // nothing in 2026 at all.
      assert.deepEqual(dueDates(db, created.schedule.id, '2026-01-01', '2026-12-31'), []);
      assert.equal(nextDueDateAfter(created.schedule, '2026-09-20'), '2027-03-15');

      const result = editSchedule(db, {
        id: created.schedule.id,
        expectedVersion: created.schedule.version,
        actor: ACTOR,
        now: TODAY,
        patch: { activeFrom: '2026-01-01' },
      });
      assert.equal(result.backfilledInstances, 1, 'this year’s 15th of March');
      materializeAndConvert(db, TODAY);
      assert.deepEqual(
        purchasesForSchedule(db, 'Buildings insurance').map((purchase) => purchase.occurredDate),
        ['2026-03-15'],
      );
    } finally {
      fixture.close();
    }
  });
});
