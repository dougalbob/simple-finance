import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { auditEntries } from '../src/lib/db/schema';
import {
  AlreadyVoidError,
  RecordVoidedError,
  VersionConflictError,
} from '../src/lib/records/errors';
import { InvalidOccurredError } from '../src/lib/records/occurred';
import { PotNotFoundError } from '../src/lib/records/pots';
import { listPurchases } from '../src/lib/records/purchases';
import {
  createTransfer,
  editTransfer,
  getTransfer,
  listTransfers,
  voidTransfer,
  InvalidTransferInputError,
  TransferNotFoundError,
} from '../src/lib/records/transfers';
import { endOfLocalDate } from '../src/lib/time';
import { createHouseholdFixture } from './household';

describe('E4 — transfer between pots (SPEC §17)', () => {
  it('moves £400 Salary → Main: per-pot legs, household net zero, never spending', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-25T10:00:00Z');
      const moved = createTransfer(fx.db, {
        fromPotId: fx.pots.salary.id,
        toPotId: fx.pots.main.id,
        amountPence: 40000,
        occurredDate: '2026-09-25',
        actor: 'sam@example.com',
        now: at,
      });
      assert.equal(moved.amountPence, 40000);
      assert.equal(moved.occurredDate, '2026-09-25');
      assert.equal(moved.occurredAt.toISOString(), endOfLocalDate('2026-09-25').toISOString());
      assert.equal(moved.enteredBy, 'sam@example.com');
      assert.equal(moved.version, 1);
      assert.equal(moved.voidedAt, null);

      // Two-sided: £400 out of Salary, £400 into Main (Phase 3 estimate inputs).
      const salaryLegs = listTransfers(fx.db, { potId: fx.pots.salary.id });
      const mainLegs = listTransfers(fx.db, { potId: fx.pots.main.id });
      assert.equal(salaryLegs.length, 1);
      assert.equal(mainLegs.length, 1);
      const outOfSalary = salaryLegs
        .filter((leg) => leg.fromPotId === fx.pots.salary.id)
        .reduce((sum, leg) => sum + leg.amountPence, 0);
      const intoMain = mainLegs
        .filter((leg) => leg.toPotId === fx.pots.main.id)
        .reduce((sum, leg) => sum + leg.amountPence, 0);
      assert.equal(outOfSalary, 40000);
      assert.equal(intoMain, 40000);

      // Household net: every transfer's legs cancel out.
      const net = listTransfers(fx.db).reduce(
        (sum, leg) => sum + leg.amountPence - leg.amountPence,
        0,
      );
      assert.equal(net, 0);

      // Transfers can never inflate spending: no category, no purchase row.
      assert.ok(!('categoryId' in moved));
      assert.equal(listPurchases(fx.db).length, 0);

      const audit = fx.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, String(moved.id)))
        .all()
        .filter((row) => row.entity === 'transfer');
      assert.equal(audit.length, 1);
      assert.equal(audit[0]?.action, 'transfer.create');
    } finally {
      fx.close();
    }
  });
});

describe('transfer validation', () => {
  it('requires two different pots, a positive amount and known pots', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-25T10:00:00Z');
      const base = {
        fromPotId: fx.pots.salary.id,
        toPotId: fx.pots.main.id,
        amountPence: 40000,
        occurredAt: at,
        actor: 'sam@example.com',
        now: at,
      };
      assert.throws(
        () => createTransfer(fx.db, { ...base, toPotId: fx.pots.salary.id }),
        InvalidTransferInputError,
      );
      assert.throws(
        () => createTransfer(fx.db, { ...base, amountPence: 0 }),
        InvalidTransferInputError,
      );
      assert.throws(
        () => createTransfer(fx.db, { ...base, amountPence: -100 }),
        InvalidTransferInputError,
      );
      assert.throws(
        () => createTransfer(fx.db, { ...base, amountPence: 10.5 }),
        InvalidTransferInputError,
      );
      assert.throws(() => createTransfer(fx.db, { ...base, fromPotId: 999999 }), PotNotFoundError);
      assert.throws(() => createTransfer(fx.db, { ...base, toPotId: 999999 }), PotNotFoundError);
      assert.throws(
        () => createTransfer(fx.db, { ...base, occurredDate: '2026-09-26' }),
        InvalidOccurredError,
      );
      assert.throws(() => createTransfer(fx.db, { ...base, actor: '' }), InvalidTransferInputError);
      assert.throws(
        () => createTransfer(fx.db, { ...base, note: 'x'.repeat(281) }),
        InvalidTransferInputError,
      );
    } finally {
      fx.close();
    }
  });
});

describe('transfer editing and voiding', () => {
  it('edits under optimistic concurrency and freezes voids', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-25T10:00:00Z');
      const moved = createTransfer(fx.db, {
        fromPotId: fx.pots.salary.id,
        toPotId: fx.pots.main.id,
        amountPence: 40000,
        occurredAt: at,
        note: 'cover the 1st',
        actor: 'sam@example.com',
        now: at,
      });

      const edited = editTransfer(fx.db, {
        id: moved.id,
        expectedVersion: 1,
        actor: 'alex@example.com',
        now: new Date('2026-09-25T11:00:00Z'),
        patch: { amountPence: 45000, note: 'cover the 1st (corrected)' },
      });
      assert.equal(edited.amountPence, 45000);
      assert.equal(edited.version, 2);

      assert.throws(
        () =>
          editTransfer(fx.db, {
            id: moved.id,
            expectedVersion: 1,
            actor: 'sam@example.com',
            patch: { amountPence: 1 },
          }),
        VersionConflictError,
      );
      assert.equal(getTransfer(fx.db, moved.id).amountPence, 45000);
      assert.throws(
        () =>
          editTransfer(fx.db, {
            id: moved.id,
            expectedVersion: 2,
            actor: 'sam@example.com',
            patch: { toPotId: fx.pots.salary.id },
          }),
        InvalidTransferInputError,
      );
      assert.throws(
        () =>
          editTransfer(fx.db, {
            id: 999999,
            expectedVersion: 1,
            actor: 'sam@example.com',
            patch: { amountPence: 1 },
          }),
        TransferNotFoundError,
      );

      const voided = voidTransfer(fx.db, {
        id: moved.id,
        expectedVersion: 2,
        actor: 'sam@example.com',
        reason: 'moved the wrong amount',
        now: new Date('2026-09-25T12:00:00Z'),
      });
      assert.ok(voided.voidedAt !== null);
      assert.equal(voided.voidReason, 'moved the wrong amount');
      assert.equal(listTransfers(fx.db).length, 0);
      assert.equal(listTransfers(fx.db, { includeVoided: true }).length, 1);

      assert.throws(
        () =>
          editTransfer(fx.db, {
            id: moved.id,
            expectedVersion: 3,
            actor: 'sam@example.com',
            patch: { amountPence: 5 },
          }),
        RecordVoidedError,
      );
      assert.throws(
        () => voidTransfer(fx.db, { id: moved.id, expectedVersion: 3, actor: 'sam@example.com' }),
        AlreadyVoidError,
      );
      assert.throws(
        () => voidTransfer(fx.db, { id: 999999, expectedVersion: 1, actor: 'sam@example.com' }),
        TransferNotFoundError,
      );
    } finally {
      fx.close();
    }
  });

  it('filters by pot (either side) and date range, newest first', async () => {
    const fx = await createHouseholdFixture();
    try {
      createTransfer(fx.db, {
        fromPotId: fx.pots.salary.id,
        toPotId: fx.pots.main.id,
        amountPence: 40000,
        occurredDate: '2026-09-20',
        actor: 'sam@example.com',
        now: new Date('2026-09-20T17:00:00Z'),
      });
      createTransfer(fx.db, {
        fromPotId: fx.pots.main.id,
        toPotId: fx.pots.alexCash.id,
        amountPence: 2000,
        occurredDate: '2026-09-22',
        actor: 'alex@example.com',
        now: new Date('2026-09-22T17:00:00Z'),
      });
      assert.equal(listTransfers(fx.db, { potId: fx.pots.main.id }).length, 2);
      assert.equal(listTransfers(fx.db, { potId: fx.pots.salary.id }).length, 1);
      assert.equal(
        listTransfers(fx.db, { dateFrom: '2026-09-21', dateTo: '2026-09-23' }).length,
        1,
      );
      assert.equal(listTransfers(fx.db, { limit: 1 })[0]?.occurredDate, '2026-09-22');
      assert.throws(
        () => listTransfers(fx.db, { dateFrom: 'yesterday' }),
        InvalidTransferInputError,
      );
    } finally {
      fx.close();
    }
  });
});
