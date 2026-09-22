import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import { addCheckpoint } from '../src/lib/records/pots';
import { createPurchase, listPurchases } from '../src/lib/records/purchases';
import {
  SCHEDULE_ACTOR,
  cancelSchedule,
  createSchedule,
  editSchedule,
  listInstances,
  materializeAndConvert,
  nextDueDateAfter,
} from '../src/lib/records/schedules';
import { getMoneySnapshot } from '../src/lib/records/money-view';
import { eq } from 'drizzle-orm';
import { scheduleInstances, schedules } from '../src/lib/db/schema';

const p = (value: number) => Math.round(value * 100);

/**
 * Scenario E3 (docs/SPEC.md §17): the direct-debit lifecycle, counted
 * exactly once — and the DST-sweep variant demanded by the Phase 3 exit
 * criteria. Timeline:
 *
 *   26th 18:05  checkpoint Main £412.35
 *   27th 14:10  E1 Tesco £63.47 (Main)
 *   27th 20:00  read: estimate(Main) = £348.88; Energy instance UPCOMING
 *   28th 00:30  due pass: instance CONVERTED → record dated 28th; estimate = £264.33
 *   30th 17:00  checkpoint Main £412.35 (ledger now includes the DD)
 *               → estimate = £412.35: the record predates the new
 *               checkpoint, so it is excluded — never subtracted twice.
 */
describe('schedules: E3 lifecycle — counted exactly once', () => {
  let fixture: HouseholdFixture;
  after(() => fixture.close());

  it('walks the 26th→30th timeline with no double subtraction', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const energyCategory = fixture.categoryId('Utilities', 'Energy');

    const energy = createSchedule(db, {
      name: 'Energy Co direct debit',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 28,
      amountPence: p(84.55),
      potId: pots.main.id,
      categoryId: energyCategory,
      supplierName: 'Northern Power Co',
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: 'alex@example.com',
      now: new Date('2026-09-05T09:00:00Z'),
    });
    // 1st, 5th→28th September, then October … materialised ahead.
    assert.ok(energy.materializedInstances >= 2);

    // — 26th 18:05: checkpoint Main at £412.35 (bank ledger).
    const checkpointNow = new Date('2026-09-26T18:05:00+01:00');
    addCheckpoint(db, {
      potId: pots.main.id,
      amountPence: p(412.35),
      actor: 'alex@example.com',
      now: checkpointNow,
    });

    // — 27th 14:10: the E1 Tesco card purchase from Main.
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
      actor: 'alex@example.com',
      now: new Date('2026-09-27T14:10:00+01:00'),
    });

    // — 27th 20:00: the due pass converts nothing; the 28th is upcoming.
    const t1 = new Date('2026-09-27T20:00:00+01:00');
    assert.equal(materializeAndConvert(db, t1), 0);
    const snapshot1 = getMoneySnapshot(db, t1);
    const main1 = snapshot1.pots.find((pot) => pot.pot.id === pots.main.id);
    assert.equal(main1?.estimatePence, p(348.88));
    const upcomingBefore = listInstances(db, {
      scheduleId: energy.schedule.id,
      state: 'upcoming',
      from: '2026-09-27',
      through: '2026-09-30',
    });
    assert.deepEqual(
      upcomingBefore.map((row) => row.instance.dueDate),
      ['2026-09-28'],
    );

    // — 28th 00:30 (local midnight of the due date has arrived): converts.
    const t2 = new Date('2026-09-28T00:30:00+01:00');
    assert.equal(materializeAndConvert(db, t2), 1);
    const convertedRows = listInstances(db, {
      scheduleId: energy.schedule.id,
      state: 'converted',
    });
    assert.equal(convertedRows.length, 1);
    const converted = convertedRows[0]?.instance;
    assert.equal(converted?.dueDate, '2026-09-28');
    assert.equal(converted?.state, 'converted');
    assert.equal(converted?.convertedRecordKind, 'purchase');
    assert.ok(converted?.convertedRecordId);

    const convertedPurchases = listPurchases(db, { limit: 50, includeVoided: false }).filter(
      ({ purchase }) => purchase.id === converted?.convertedRecordId,
    );
    assert.equal(convertedPurchases.length, 1);
    const record = convertedPurchases[0]?.purchase;
    assert.equal(record?.totalPence, p(84.55));
    assert.equal(record?.potId, pots.main.id);
    assert.equal(record?.occurredDate, '2026-09-28');
    assert.equal(record?.note, 'From schedule “Energy Co direct debit”');
    assert.equal(record?.enteredBy, SCHEDULE_ACTOR);

    const snapshot2 = getMoneySnapshot(db, t2);
    const main2 = snapshot2.pots.find((pot) => pot.pot.id === pots.main.id);
    assert.equal(main2?.estimatePence, p(348.88) - p(84.55)); // £264.33

    // — Idempotency: a second pass (and the read-path pass inside the
    //   snapshot) must not convert or double-record.
    assert.equal(materializeAndConvert(db, new Date('2026-09-28T08:00:00+01:00')), 0);
    const snapshot2b = getMoneySnapshot(db, new Date('2026-09-28T08:00:00+01:00'));
    assert.equal(
      snapshot2b.pots.find((pot) => pot.pot.id === pots.main.id)?.estimatePence,
      p(348.88) - p(84.55),
    );
    assert.equal(
      listPurchases(db, { limit: 50, includeVoided: false }).filter(
        ({ purchase }) => purchase.id === converted?.convertedRecordId,
      ).length,
      1,
    );

    // — 30th 17:00: the user checkpoints again; the ledger now includes
    //   the DD. The record predates the new checkpoint → excluded from the
    //   fresh estimate (still in history).
    const t3 = new Date('2026-09-30T17:00:00+01:00');
    addCheckpoint(db, {
      potId: pots.main.id,
      amountPence: p(412.35),
      actor: 'alex@example.com',
      now: t3,
    });
    const snapshot3 = getMoneySnapshot(db, t3);
    assert.equal(
      snapshot3.pots.find((pot) => pot.pot.id === pots.main.id)?.estimatePence,
      p(412.35),
    );
    assert.equal(
      listInstances(db, { scheduleId: energy.schedule.id, state: 'converted' }).length,
      1, // history kept
    );

    // The following month's instance is still upcoming and intact.
    const next = listInstances(db, {
      scheduleId: energy.schedule.id,
      state: 'upcoming',
      from: '2026-10-01',
      through: '2026-10-31',
    });
    assert.deepEqual(
      next.map((row) => row.instance.dueDate),
      ['2026-10-28'],
    );
  });

  it('self-heals a crash between the record insert and the instance link', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const schedule = createSchedule(db, {
      name: 'Bills standing order',
      kind: 'so',
      frequency: 'monthly',
      dueDayOfMonth: 15,
      amountPence: p(50),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Other', 'Uncategorised'),
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: 'alex@example.com',
      now: new Date('2026-09-02T09:00:00Z'),
    });
    // Materialise only (no conversion yet).
    materializeAndConvert(db, new Date('2026-09-10T09:00:00Z'));
    const instance = listInstances(db, {
      scheduleId: schedule.schedule.id,
      state: 'upcoming',
      from: '2026-09-15',
      through: '2026-09-15',
    })[0]?.instance;
    assert.ok(instance);

    // Simulate the crash: the converted record exists, the link does not.
    createPurchase(db, {
      supplierId: null,
      potId: pots.main.id,
      totalPence: p(50),
      paidByPersonId: null,
      occurredAt: new Date('2026-09-15T01:00:00Z'), // placeholder; pass repairs nothing about time
      occurredDate: '2026-09-15',
      scheduleInstanceId: instance.id,
      note: 'From schedule “Bills standing order”',
      lines: [
        {
          amountPence: p(50),
          categoryId: fixture.categoryId('Other', 'Uncategorised'),
          targetKind: 'household',
        },
      ],
      actor: SCHEDULE_ACTOR,
      now: new Date('2026-09-15T01:00:00Z'),
    });

    // The due pass must repair the link — not create a second record.
    assert.equal(materializeAndConvert(db, new Date('2026-09-15T09:00:00Z')), 1);
    const repaired = listInstances(db, {
      scheduleId: schedule.schedule.id,
      state: 'converted',
    })[0]?.instance;
    assert.equal(repaired?.state, 'converted');
    assert.equal(repaired?.convertedRecordKind, 'purchase');
    const duplicates = listPurchases(db, { limit: 50, includeVoided: false }).filter(
      ({ purchase }) => purchase.scheduleInstanceId === instance.id,
    );
    assert.equal(duplicates.length, 1);
  });

  it('sweeps DST days: conversion lands at local midnight on 2026-10-25 and 2026-03-29', async () => {
    for (const [dueDate, passAt, expectedInstantUtc] of [
      ['2026-10-25', '2026-10-25T00:05:00Z', '2026-10-24T23:00:00.000Z'], // autumn-back (BST → GMT)
      ['2026-03-29', '2026-03-29T01:05:00Z', '2026-03-29T00:00:00.000Z'], // spring-forward (GMT → BST)
    ] as const) {
      const fx = await createHouseholdFixture();
      const { db, pots } = fx;
      const schedule = createSchedule(db, {
        name: `Monthly due ${dueDate}`,
        kind: 'dd',
        frequency: 'monthly',
        dueDayOfMonth: Number(dueDate.slice(8)),
        amountPence: p(10),
        potId: pots.jar.id,
        categoryId: fixture.categoryId('Other', 'Uncategorised'),
        supplierName: 'Northern Power Co',
        targetKind: 'household',
        activeFrom: dueDate.slice(0, 8) + '01',
        actor: 'alex@example.com',
        now: new Date('2026-01-01T12:00:00Z'),
      });
      void schedule;
      const convertedCount = materializeAndConvert(db, new Date(passAt));
      assert.equal(convertedCount, 1, `no conversion on ${dueDate}`);
      const record = listPurchases(db, { limit: 10, includeVoided: false })
        .map(({ purchase }) => purchase)
        .find((purchase) => purchase.occurredDate === dueDate);
      assert.ok(record, `no converted record dated ${dueDate}`);
      assert.equal(
        record.occurredAt.toISOString(),
        expectedInstantUtc,
        `conversion instant wrong on ${dueDate}`,
      );
      // A repeat pass the next morning converts nothing new.
      const nextMorning =
        dueDate === '2026-10-25' ? '2026-10-26T00:05:00Z' : '2026-03-30T01:05:00Z';
      assert.equal(materializeAndConvert(db, new Date(nextMorning)), 0);
      fx.close();
    }
  });

  it('cancelling stops future instances from the effective date; history stays', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const schedule = createSchedule(db, {
      name: 'Streaming DD',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 5,
      amountPence: p(10.99),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Entertainment & Eating Out', 'Subscriptions & Streaming'),
      supplierName: 'Northern Power Co',
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: 'alex@example.com',
      now: new Date('2026-09-02T09:00:00Z'),
    });
    // September 5 has already converted.
    materializeAndConvert(db, new Date('2026-09-06T09:00:00Z'));
    const before = listInstances(db, { scheduleId: schedule.schedule.id });
    const upcomingBefore = before.filter((row) => row.instance.state === 'upcoming');
    assert.ok(upcomingBefore.length >= 2);

    const cancelled = cancelSchedule(db, {
      id: schedule.schedule.id,
      expectedVersion: schedule.schedule.version,
      effectiveOn: '2026-11-05',
      actor: 'alex@example.com',
      now: new Date('2026-09-10T09:00:00Z'),
    });
    assert.equal(cancelled.cancelledEffectiveOn, '2026-11-05');

    const after = listInstances(db, { scheduleId: schedule.schedule.id, state: 'upcoming' });
    const dates = after.map((row) => row.instance.dueDate);
    assert.ok(!dates.includes('2026-11-05'), 'instance on the effective date must be gone');
    assert.ok(!dates.includes('2026-12-05'));
    assert.ok(dates.includes('2026-10-05'), 'instances before the effective date stay');
    assert.equal(
      listInstances(db, { scheduleId: schedule.schedule.id, state: 'converted' }).length,
      1, // the 5th September remains history
    );

    // Editing a cancelled schedule is refused.
    assert.throws(
      () =>
        editSchedule(db, {
          id: schedule.schedule.id,
          expectedVersion: cancelled.version,
          actor: 'alex@example.com',
          now: new Date('2026-09-10T09:05:00Z'),
          patch: { name: 'Renamed' },
        }),
      /cancelled/i,
    );
  });

  it('edits regenerate upcoming from the next instance; converted history is untouched', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const schedule = createSchedule(db, {
      name: 'Gym DD',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 1,
      amountPence: p(30),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Personal', 'Hobbies'),
      supplierName: 'Northern Power Co',
      targetKind: 'person',
      targetId: fixture.people.alex.id,
      activeFrom: '2026-09-01',
      actor: 'alex@example.com',
      now: new Date('2026-09-02T09:00:00Z'),
    });
    // The 1st and… only the 1st has converted (now is the 15th).
    materializeAndConvert(db, new Date('2026-09-15T09:00:00Z'));
    assert.equal(
      listInstances(db, { scheduleId: schedule.schedule.id, state: 'converted' }).length,
      1,
    );

    // Raise the price from the 1st October onward.
    const edited = editSchedule(db, {
      id: schedule.schedule.id,
      expectedVersion: schedule.schedule.version,
      actor: 'alex@example.com',
      now: new Date('2026-09-15T09:30:00Z'),
      patch: { amountPence: p(35) },
    });
    assert.equal(edited.amountPence, p(35));

    // The already-converted 1st keeps the old amount in its record
    // (instances are links; the history lives in the converted purchase).
    const converted = listInstances(db, {
      scheduleId: schedule.schedule.id,
      state: 'converted',
    })[0];
    assert.ok(converted?.instance.convertedRecordId);
    const historyRecord = listPurchases(db, { limit: 10, includeVoided: false })
      .map(({ purchase }) => purchase)
      .find((purchase) => purchase.id === converted?.instance.convertedRecordId);
    assert.equal(historyRecord?.totalPence, p(30));
    // Upcoming instances still exist; next due date is the 1st October.
    const next = nextDueDateAfter(edited, '2026-09-15');
    assert.equal(next, '2026-10-01');
  });

  it('annual schedules need a due month and clamp like monthly (Feb 29 → 28)', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const supplier = null;
    void supplier;

    // Monthly is fine without a month; annual refuses without one.
    assert.throws(
      () =>
        createSchedule(db, {
          name: 'Car insurance',
          kind: 'dd',
          frequency: 'annual',
          dueDayOfMonth: 12,
          dueMonth: null,
          amountPence: p(400),
          potId: pots.main.id,
          categoryId: fixture.categoryId('Vehicle Running', 'Insurance'),
          supplierName: 'Northern Power Co',
          targetKind: 'household',
          activeFrom: '2026-09-01',
          actor: 'alex@example.com',
          now: new Date('2026-09-01T09:00:00Z'),
        }),
      /due month/i,
    );

    const insurance = createSchedule(db, {
      name: 'Car insurance',
      kind: 'dd',
      frequency: 'annual',
      dueDayOfMonth: 12,
      dueMonth: 10,
      amountPence: p(400),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Vehicle Running', 'Insurance'),
      supplierName: 'Northern Power Co',
      targetKind: 'vehicle',
      targetId: fixture.vehicles.vehicleA.id,
      contractEndsOn: '2026-11-03',
      activeFrom: '2026-09-01',
      actor: 'alex@example.com',
      now: new Date('2026-09-01T09:00:00Z'),
    });
    assert.equal(nextDueDateAfter(insurance.schedule, '2026-09-01'), '2026-10-12');
    assert.equal(nextDueDateAfter(insurance.schedule, '2026-10-12'), '2027-10-12');

    // A Feb 29 due day: 2026 lands on 28 February (OQ13).
    const leap = createSchedule(db, {
      name: 'Leap annual',
      kind: 'dd',
      frequency: 'annual',
      dueDayOfMonth: 29,
      dueMonth: 2,
      amountPence: p(5),
      potId: pots.jar.id,
      categoryId: fixture.categoryId('Other', 'Uncategorised'),
      supplierName: 'Northern Power Co',
      targetKind: 'household',
      activeFrom: '2024-01-01',
      actor: 'alex@example.com',
      now: new Date('2026-09-01T09:00:00Z'),
    });
    // Initially materialised: every February, clamped (29 → 28 in non-leap
    // years), including the already-due 2026/2027 dates.
    const dates = listInstances(db, {
      scheduleId: leap.schedule.id,
      state: 'upcoming',
      from: '2026-01-01',
      through: '2027-12-31',
    }).map((row) => row.instance.dueDate);
    assert.ok(dates.includes('2026-02-28'));
    assert.ok(dates.includes('2027-02-28'));

    // A pass once the horizon rolls forward materializes leap year 2028:
    // 29 February stays the 29th there (OQ13).
    materializeAndConvert(db, new Date('2027-10-01T00:00:00Z'));
    const later = listInstances(db, {
      scheduleId: leap.schedule.id,
      state: 'upcoming',
      from: '2028-01-01',
      through: '2029-12-31',
    }).map((row) => row.instance.dueDate);
    assert.ok(later.includes('2028-02-29'), 'leap year keeps 29 February');
  });

  it('receipt schedules convert into receipts (income), not purchases', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const salary = createSchedule(db, {
      name: 'Salary',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 26,
      amountPence: p(2150),
      potId: pots.salary.id,
      categoryId: null,
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: 'alex@example.com',
      now: new Date('2026-09-02T09:00:00Z'),
    });
    materializeAndConvert(db, new Date('2026-09-26T00:30:00+01:00'));
    const rows = listInstances(db, { scheduleId: salary.schedule.id, state: 'converted' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.instance.convertedRecordKind, 'receipt');
    assert.ok(rows[0]?.instance.convertedRecordId);
    const purchases = listPurchases(db, { limit: 10, includeVoided: false }).filter(
      ({ purchase }) => purchase.scheduleInstanceId === rows[0]?.instance.convertedRecordId,
    );
    assert.equal(purchases.length, 0, 'income must never become a purchase');

    // The household estimate includes the converted receipt.
    addCheckpoint(db, {
      potId: pots.salary.id,
      amountPence: p(100),
      actor: 'alex@example.com',
      now: new Date('2026-09-25T09:00:00+01:00'),
    });
    const snapshot = getMoneySnapshot(db, new Date('2026-09-27T09:00:00+01:00'));
    assert.equal(
      snapshot.pots.find((pot) => pot.pot.id === pots.salary.id)?.estimatePence,
      p(100) + p(2150),
    );
  });

  it('keeps instances in exactly one state at all times (no two states, no orphans)', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const schedule = createSchedule(db, {
      name: 'Insurance DD',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 10,
      amountPence: p(40),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Vehicle Running', 'Insurance'),
      supplierName: 'Northern Power Co',
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: 'alex@example.com',
      now: new Date('2026-09-01T09:00:00Z'),
    });
    for (const passAt of [
      '2026-09-10T00:10:00+01:00',
      '2026-09-10T12:00:00+01:00',
      '2026-10-10T00:10:00+01:00',
      '2026-10-11T08:00:00+01:00',
    ]) {
      materializeAndConvert(db, new Date(passAt));
      const rows = db
        .select()
        .from(scheduleInstances)
        .where(eq(scheduleInstances.scheduleId, schedule.schedule.id))
        .all();
      for (const row of rows) {
        if (row.state === 'upcoming') {
          assert.equal(row.convertedRecordKind, null);
          assert.equal(row.convertedRecordId, null);
          assert.equal(row.convertedAt, null);
        } else {
          assert.equal(row.convertedRecordKind, 'purchase');
          assert.ok(row.convertedRecordId);
          assert.ok(row.convertedAt instanceof Date);
        }
      }
    }
    assert.equal(
      db
        .select()
        .from(scheduleInstances)
        .where(eq(scheduleInstances.scheduleId, schedule.schedule.id))
        .all()
        .filter((row) => row.state === 'converted').length,
      2,
    );
    void schedules;
  });
});
