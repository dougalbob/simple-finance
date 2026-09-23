import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createDebt,
  debtBalance,
  debtBalanceLabel,
  debtsSummary,
  DebtNotFoundError,
  editDebt,
  getDebt,
  InvalidDebtInputError,
  listDebtsWithBalances,
} from '../src/lib/records/debts';
import {
  AlreadyVoidError,
  RecordVoidedError,
  VersionConflictError,
} from '../src/lib/records/errors';
import {
  createExternalMovement,
  createSwap,
  editExternalMovement,
  ExternalMovementNotFoundError,
  getExternalMovement,
  InvalidExternalMovementInputError,
  listExchanges,
  listExternalMovements,
  voidExternalMovement,
} from '../src/lib/records/external-movements';
import { getMonthComparisonView } from '../src/lib/records/insights-view';
import { getMoneySnapshot } from '../src/lib/records/money-view';
import { addCheckpoint, archivePot, InvalidPotInputError, listPots } from '../src/lib/records/pots';
import { createPurchase } from '../src/lib/records/purchases';
import { createReceipt } from '../src/lib/records/receipts';
import { createSchedule } from '../src/lib/records/schedules';
import { createTransfer } from '../src/lib/records/transfers';
import { createHouseholdFixture } from './household';

const ACTOR = 'alex@example.com';
const NOW = new Date('2026-09-20T17:00:00Z');

describe('debts: tracking who owes whom (SPEC §10.2)', () => {
  it('creates we_owe and they_owe debts with notes and an audit trail', async () => {
    const fx = await createHouseholdFixture();
    try {
      const loan = createDebt(fx.db, {
        counterparty: '  Mum ',
        direction: 'we_owe',
        note: 'helping with the bills',
        actor: ACTOR,
        now: NOW,
      });
      assert.equal(loan.counterparty, 'Mum');
      assert.equal(loan.direction, 'we_owe');
      assert.equal(loan.version, 1);
      const lent = createDebt(fx.db, {
        counterparty: 'our son',
        direction: 'they_owe',
        actor: ACTOR,
        now: NOW,
      });
      assert.equal(lent.note, null);
      assert.deepEqual(
        (await Promise.resolve(listDebtsWithBalances(fx.db))).map((row) => row.debt.counterparty),
        ['Mum', 'our son'],
      );
      assert.equal(getDebt(fx.db, loan.id).id, loan.id);
      assert.throws(() => getDebt(fx.db, 9999), DebtNotFoundError);
    } finally {
      fx.close();
    }
  });

  it('rejects empty counterparties, bad directions and overlong text', async () => {
    const fx = await createHouseholdFixture();
    try {
      assert.throws(
        () => createDebt(fx.db, { counterparty: '   ', direction: 'we_owe', actor: ACTOR }),
        InvalidDebtInputError,
      );
      assert.throws(
        () =>
          createDebt(fx.db, {
            counterparty: 'Mum',
            direction: 'sideways' as 'we_owe',
            actor: ACTOR,
          }),
        InvalidDebtInputError,
      );
      assert.throws(
        () =>
          createDebt(fx.db, {
            counterparty: 'x'.repeat(121),
            direction: 'we_owe',
            actor: ACTOR,
          }),
        InvalidDebtInputError,
      );
      assert.throws(
        () =>
          createDebt(fx.db, {
            counterparty: 'Mum',
            direction: 'we_owe',
            note: 'x'.repeat(281),
            actor: ACTOR,
          }),
        InvalidDebtInputError,
      );
    } finally {
      fx.close();
    }
  });

  it('renames propagate to linked movements; version guard holds', async () => {
    const fx = await createHouseholdFixture();
    try {
      const debt = createDebt(fx.db, {
        counterparty: 'Mum',
        direction: 'we_owe',
        actor: ACTOR,
        now: NOW,
      });
      const movement = createExternalMovement(fx.db, {
        potId: fx.pots.alexCash.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 100000,
        debtId: debt.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.equal(movement.counterparty, 'Mum');
      const renamed = editDebt(fx.db, {
        id: debt.id,
        expectedVersion: 1,
        actor: ACTOR,
        patch: { counterparty: 'Mother' },
        now: NOW,
      });
      assert.equal(renamed.counterparty, 'Mother');
      assert.equal(renamed.version, 2);
      assert.equal(getExternalMovement(fx.db, movement.id).counterparty, 'Mother');
      assert.throws(
        () =>
          editDebt(fx.db, {
            id: debt.id,
            expectedVersion: 1,
            actor: ACTOR,
            patch: { note: 'stale' },
          }),
        VersionConflictError,
      );
    } finally {
      fx.close();
    }
  });

  it('derives balances from live loan movements; voided rows never count', async () => {
    const fx = await createHouseholdFixture();
    try {
      const owe = createDebt(fx.db, {
        counterparty: 'Mum',
        direction: 'we_owe',
        actor: ACTOR,
        now: NOW,
      });
      assert.deepEqual(debtBalance(fx.db, owe), { balancePence: 0, movementCount: 0 });
      assert.equal(debtBalanceLabel(owe, 0), 'settled');

      createExternalMovement(fx.db, {
        potId: fx.pots.alexCash.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 100000,
        debtId: owe.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.deepEqual(debtBalance(fx.db, owe), { balancePence: 100000, movementCount: 1 });
      assert.equal(debtBalanceLabel(owe, 100000), 'we owe £1,000.00');

      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'out',
        kind: 'loan',
        amountPence: 25000,
        debtId: owe.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.deepEqual(debtBalance(fx.db, owe), { balancePence: 75000, movementCount: 2 });

      // A voided repayment is history, not a balance.
      const repaid = createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'out',
        kind: 'loan',
        amountPence: 75000,
        debtId: owe.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      voidExternalMovement(fx.db, {
        id: repaid.id,
        expectedVersion: 1,
        actor: ACTOR,
        reason: 'entered twice',
        now: NOW,
      });
      assert.deepEqual(debtBalance(fx.db, owe), { balancePence: 75000, movementCount: 2 });

      // They-owe mirrors: out (lent) raises, in (repaid to us) lowers.
      const owed = createDebt(fx.db, {
        counterparty: 'our son',
        direction: 'they_owe',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'out',
        kind: 'loan',
        amountPence: 20000,
        debtId: owed.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 25000,
        debtId: owed.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.deepEqual(debtBalance(fx.db, owed), { balancePence: -5000, movementCount: 2 });
      assert.equal(debtBalanceLabel(owed, -5000), 'overpaid £50.00');
    } finally {
      fx.close();
    }
  });

  it('summarises owed-by and owed-to across debts; settled adds nothing', async () => {
    const fx = await createHouseholdFixture();
    try {
      assert.deepEqual(debtsSummary(fx.db), {
        owedByHouseholdPence: 0,
        owedToHouseholdPence: 0,
        debtCount: 0,
      });
      const owe = createDebt(fx.db, {
        counterparty: 'Mum',
        direction: 'we_owe',
        actor: ACTOR,
        now: NOW,
      });
      const owed = createDebt(fx.db, {
        counterparty: 'our son',
        direction: 'they_owe',
        actor: ACTOR,
        now: NOW,
      });
      const settled = createDebt(fx.db, {
        counterparty: 'neighbour',
        direction: 'we_owe',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.alexCash.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 100000,
        debtId: owe.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'out',
        kind: 'loan',
        amountPence: 3000,
        debtId: owed.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 5000,
        debtId: settled.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'out',
        kind: 'loan',
        amountPence: 5000,
        debtId: settled.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.deepEqual(debtsSummary(fx.db), {
        owedByHouseholdPence: 100000,
        owedToHouseholdPence: 3000,
        debtCount: 3,
      });
    } finally {
      fx.close();
    }
  });
});

describe('external movements: validation and correction', () => {
  it('loans require a debt and take its name; other requires a counterparty and a note', async () => {
    const fx = await createHouseholdFixture();
    try {
      assert.throws(
        () =>
          createExternalMovement(fx.db, {
            potId: fx.pots.main.id,
            direction: 'in',
            kind: 'loan',
            amountPence: 100,
            occurredDate: '2026-09-20',
            actor: ACTOR,
            now: NOW,
          }),
        InvalidExternalMovementInputError,
      );
      assert.throws(
        () =>
          createExternalMovement(fx.db, {
            potId: fx.pots.main.id,
            direction: 'in',
            kind: 'other',
            amountPence: 100,
            occurredDate: '2026-09-20',
            actor: ACTOR,
            now: NOW,
          }),
        InvalidExternalMovementInputError,
      );
      assert.throws(
        () =>
          createExternalMovement(fx.db, {
            potId: fx.pots.main.id,
            direction: 'in',
            kind: 'other',
            amountPence: 100,
            counterparty: 'neighbour',
            occurredDate: '2026-09-20',
            actor: ACTOR,
            now: NOW,
          }),
        InvalidExternalMovementInputError,
      );
      const other = createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'in',
        kind: 'other',
        amountPence: 2500,
        counterparty: 'neighbour',
        note: 'sold the old bike',
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.equal(other.debtId, null);
      assert.equal(other.exchangeKey, null);
    } finally {
      fx.close();
    }
  });

  it('rejects unknown pots, unknown debts, bad amounts and future dates', async () => {
    const fx = await createHouseholdFixture();
    try {
      const debt = createDebt(fx.db, {
        counterparty: 'Mum',
        direction: 'we_owe',
        actor: ACTOR,
        now: NOW,
      });
      const base = {
        direction: 'in' as const,
        kind: 'loan' as const,
        debtId: debt.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      };
      assert.throws(
        () => createExternalMovement(fx.db, { ...base, potId: 9999, amountPence: 100 }),
        /No pot with id/,
      );
      assert.throws(
        () =>
          createExternalMovement(fx.db, {
            ...base,
            potId: fx.pots.main.id,
            amountPence: 100,
            debtId: 9999,
          }),
        DebtNotFoundError,
      );
      assert.throws(
        () => createExternalMovement(fx.db, { ...base, potId: fx.pots.main.id, amountPence: 0 }),
        InvalidExternalMovementInputError,
      );
      assert.throws(
        () =>
          createExternalMovement(fx.db, {
            ...base,
            potId: fx.pots.main.id,
            amountPence: 100,
            occurredDate: '2026-09-21',
          }),
        /future/,
      );
    } finally {
      fx.close();
    }
  });

  it('edits pot/amount/date/note; kind, direction, debt and swap links never move', async () => {
    const fx = await createHouseholdFixture();
    try {
      const debt = createDebt(fx.db, {
        counterparty: 'Mum',
        direction: 'we_owe',
        actor: ACTOR,
        now: NOW,
      });
      const movement = createExternalMovement(fx.db, {
        potId: fx.pots.alexCash.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 100000,
        debtId: debt.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      const edited = editExternalMovement(fx.db, {
        id: movement.id,
        expectedVersion: 1,
        actor: ACTOR,
        patch: { amountPence: 95000, note: 'counted again' },
        now: NOW,
      });
      assert.equal(edited.amountPence, 95000);
      assert.equal(edited.note, 'counted again');
      assert.equal(edited.version, 2);
      assert.equal(debtBalance(fx.db, debt).balancePence, 95000);
      // Loan legs keep the debt's name — rename the debt instead.
      assert.throws(
        () =>
          editExternalMovement(fx.db, {
            id: movement.id,
            expectedVersion: 2,
            actor: ACTOR,
            patch: { counterparty: 'Dad' },
          }),
        InvalidExternalMovementInputError,
      );
      // Stale and voided edits fail loudly.
      assert.throws(
        () =>
          editExternalMovement(fx.db, {
            id: movement.id,
            expectedVersion: 1,
            actor: ACTOR,
            patch: { note: 'stale' },
          }),
        VersionConflictError,
      );
      voidExternalMovement(fx.db, {
        id: movement.id,
        expectedVersion: 2,
        actor: ACTOR,
        now: NOW,
      });
      assert.throws(
        () =>
          editExternalMovement(fx.db, {
            id: movement.id,
            expectedVersion: 3,
            actor: ACTOR,
            patch: { note: 'frozen' },
          }),
        RecordVoidedError,
      );
      assert.throws(
        () => voidExternalMovement(fx.db, { id: movement.id, expectedVersion: 3, actor: ACTOR }),
        AlreadyVoidError,
      );
      assert.throws(
        () => voidExternalMovement(fx.db, { id: 9999, expectedVersion: 1, actor: ACTOR }),
        ExternalMovementNotFoundError,
      );
      // Other movements must keep their note.
      const other = createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'out',
        kind: 'other',
        amountPence: 500,
        counterparty: 'neighbour',
        note: 'chipped in for the fence',
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.throws(
        () =>
          editExternalMovement(fx.db, {
            id: other.id,
            expectedVersion: 1,
            actor: ACTOR,
            patch: { note: null },
          }),
        InvalidExternalMovementInputError,
      );
      const renamed = editExternalMovement(fx.db, {
        id: other.id,
        expectedVersion: 1,
        actor: ACTOR,
        patch: { counterparty: 'next door' },
        now: NOW,
      });
      assert.equal(renamed.counterparty, 'next door');
    } finally {
      fx.close();
    }
  });

  it('filters by pot, debt, kind, direction and dates', async () => {
    const fx = await createHouseholdFixture();
    try {
      const debt = createDebt(fx.db, {
        counterparty: 'Mum',
        direction: 'we_owe',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.alexCash.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 100000,
        debtId: debt.id,
        occurredDate: '2026-09-18',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'out',
        kind: 'other',
        amountPence: 500,
        counterparty: 'neighbour',
        note: 'fence',
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.equal(listExternalMovements(fx.db, { potId: fx.pots.alexCash.id }).length, 1);
      assert.equal(listExternalMovements(fx.db, { debtId: debt.id }).length, 1);
      assert.equal(listExternalMovements(fx.db, { kind: 'other' }).length, 1);
      assert.equal(listExternalMovements(fx.db, { direction: 'out' }).length, 1);
      assert.equal(
        listExternalMovements(fx.db, { dateFrom: '2026-09-19', dateTo: '2026-09-20' }).length,
        1,
      );
      assert.throws(
        () => listExternalMovements(fx.db, { dateFrom: 'not-a-date' }),
        InvalidExternalMovementInputError,
      );
    } finally {
      fx.close();
    }
  });
});

describe('swaps: one pair, household net zero (SPEC §10.2)', () => {
  it('creates both legs atomically; household total does not move', async () => {
    const fx = await createHouseholdFixture();
    try {
      for (const pot of [fx.pots.main, fx.pots.alexCash]) {
        addCheckpoint(fx.db, {
          potId: pot.id,
          amountPence: 50000,
          actor: ACTOR,
          now: new Date('2026-09-19T09:00:00Z'),
        });
      }
      const before = getMoneySnapshot(fx.db, NOW);
      const swap = createSwap(fx.db, {
        inPotId: fx.pots.alexCash.id,
        outPotId: fx.pots.main.id,
        amountPence: 12000,
        counterparty: 'our son',
        note: 'his wages in cash, our bank transfer back',
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.equal(swap.inLeg.exchangeKey, swap.outLeg.exchangeKey);
      assert.ok(swap.exchangeKey.length > 0);
      assert.equal(swap.inLeg.kind, 'swap');
      assert.equal(swap.inLeg.debtId, null);
      assert.equal(swap.outLeg.counterparty, 'our son');

      const after = getMoneySnapshot(fx.db, NOW);
      assert.equal(after.householdAvailablePence, before.householdAvailablePence);
      const estimateOf = (potId: number) =>
        after.pots.find((pot) => pot.pot.id === potId)?.estimatePence;
      assert.equal(estimateOf(fx.pots.alexCash.id), 50000 + 12000);
      assert.equal(estimateOf(fx.pots.main.id), 50000 - 12000);

      const exchanges = listExchanges(fx.db);
      assert.equal(exchanges.length, 1);
      assert.equal(exchanges[0]?.inLeg?.id, swap.inLeg.id);
      assert.equal(exchanges[0]?.outLeg?.id, swap.outLeg.id);
    } finally {
      fx.close();
    }
  });

  it('rejects same-pot swaps; a voided leg stays visible inside its pair', async () => {
    const fx = await createHouseholdFixture();
    try {
      assert.throws(
        () =>
          createSwap(fx.db, {
            inPotId: fx.pots.main.id,
            outPotId: fx.pots.main.id,
            amountPence: 100,
            counterparty: 'our son',
            occurredDate: '2026-09-20',
            actor: ACTOR,
            now: NOW,
          }),
        InvalidExternalMovementInputError,
      );
      const swap = createSwap(fx.db, {
        inPotId: fx.pots.alexCash.id,
        outPotId: fx.pots.main.id,
        amountPence: 12000,
        counterparty: 'our son',
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      voidExternalMovement(fx.db, {
        id: swap.inLeg.id,
        expectedVersion: 1,
        actor: ACTOR,
        reason: 'cash never arrived',
        now: NOW,
      });
      const exchanges = listExchanges(fx.db);
      assert.equal(exchanges.length, 1);
      assert.notEqual(exchanges[0]?.inLeg?.voidedAt, null);
      assert.equal(exchanges[0]?.outLeg?.voidedAt, null);
      // The surviving leg still moves its pot — honestly, not by cascade.
      assert.equal(listExternalMovements(fx.db, { exchangeKey: swap.exchangeKey }).length, 1);
      assert.equal(
        listExternalMovements(fx.db, { exchangeKey: swap.exchangeKey, includeVoided: true }).length,
        2,
      );
    } finally {
      fx.close();
    }
  });
});

describe('external money in the estimate, never in Insights', () => {
  it('money in adds, money out subtracts; the household total genuinely moves', async () => {
    const fx = await createHouseholdFixture();
    try {
      addCheckpoint(fx.db, {
        potId: fx.pots.main.id,
        amountPence: 100000,
        actor: ACTOR,
        now: new Date('2026-09-19T09:00:00Z'),
      });
      const debt = createDebt(fx.db, {
        counterparty: 'Mum',
        direction: 'we_owe',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 100000,
        debtId: debt.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      let snapshot = getMoneySnapshot(fx.db, NOW);
      assert.equal(
        snapshot.pots.find((pot) => pot.pot.id === fx.pots.main.id)?.estimatePence,
        200000,
      );
      assert.equal(snapshot.householdAvailablePence, 200000);
      assert.equal(snapshot.debts.owedByHouseholdPence, 100000);

      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'out',
        kind: 'loan',
        amountPence: 25000,
        debtId: debt.id,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      snapshot = getMoneySnapshot(fx.db, NOW);
      assert.equal(
        snapshot.pots.find((pot) => pot.pot.id === fx.pots.main.id)?.estimatePence,
        175000,
      );
      assert.equal(snapshot.householdAvailablePence, 175000);
      assert.equal(snapshot.debts.owedByHouseholdPence, 75000);
    } finally {
      fx.close();
    }
  });

  it('respects checkpoints: pre-checkpoint movements are assumed cleared', async () => {
    const fx = await createHouseholdFixture();
    try {
      const debt = createDebt(fx.db, {
        counterparty: 'Mum',
        direction: 'we_owe',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 100000,
        debtId: debt.id,
        occurredAt: new Date('2026-09-20T10:00:00Z'),
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      // Checkpoint after the movement absorbs it (SPEC §5 assume-cleared).
      addCheckpoint(fx.db, {
        potId: fx.pots.main.id,
        amountPence: 300000,
        actor: ACTOR,
        now: new Date('2026-09-20T12:00:00Z'),
      });
      const snapshot = getMoneySnapshot(fx.db, NOW);
      assert.equal(
        snapshot.pots.find((pot) => pot.pot.id === fx.pots.main.id)?.estimatePence,
        300000,
      );
      // The debt still owes — checkpoints absorb estimates, never debts.
      assert.equal(snapshot.debts.owedByHouseholdPence, 100000);
    } finally {
      fx.close();
    }
  });

  it('never enters Insights: spending totals see purchases only', async () => {
    const fx = await createHouseholdFixture();
    try {
      createPurchase(fx.db, {
        potId: fx.pots.main.id,
        totalPence: 6347,
        paidByPersonId: fx.people.alex.id,
        occurredAt: new Date('2026-09-19T14:10:00Z'),
        occurredDate: '2026-09-19',
        lines: [
          {
            amountPence: 6347,
            categoryId: fx.categoryId('Groceries', 'Weekly Shop'),
            targetKind: 'household',
          },
        ],
        actor: ACTOR,
        now: NOW,
      });
      const debt = createDebt(fx.db, {
        counterparty: 'Mum',
        direction: 'we_owe',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 100000,
        debtId: debt.id,
        occurredDate: '2026-09-19',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'out',
        kind: 'loan',
        amountPence: 25000,
        debtId: debt.id,
        occurredDate: '2026-09-19',
        actor: ACTOR,
        now: NOW,
      });
      createSwap(fx.db, {
        inPotId: fx.pots.alexCash.id,
        outPotId: fx.pots.main.id,
        amountPence: 12000,
        counterparty: 'our son',
        occurredDate: '2026-09-19',
        actor: ACTOR,
        now: NOW,
      });
      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'in',
        kind: 'other',
        amountPence: 2500,
        counterparty: 'neighbour',
        note: 'sold the old bike',
        occurredDate: '2026-09-19',
        actor: ACTOR,
        now: NOW,
      });
      const view = getMonthComparisonView(fx.db, NOW);
      assert.equal(view.current.summary.totalPence, 6347);
      assert.equal(view.monthToDate.totalPence, 6347);
    } finally {
      fx.close();
    }
  });
});

describe('archivePot: only empty pots leave the lists', () => {
  it('archives an untouched pot; version guard and double-archive hold', async () => {
    const fx = await createHouseholdFixture();
    try {
      const archived = archivePot(fx.db, {
        id: fx.pots.alexCash.id,
        expectedVersion: 1,
        actor: ACTOR,
        now: NOW,
      });
      assert.notEqual(archived.archivedAt, null);
      assert.equal(archived.version, 2);
      assert.ok(!listPots(fx.db).some((pot) => pot.id === fx.pots.alexCash.id));
      assert.throws(
        () => archivePot(fx.db, { id: fx.pots.alexCash.id, expectedVersion: 2, actor: ACTOR }),
        InvalidPotInputError,
      );
      assert.throws(
        () => archivePot(fx.db, { id: fx.pots.samCash.id, expectedVersion: 99, actor: ACTOR }),
        VersionConflictError,
      );
    } finally {
      fx.close();
    }
  });

  it('refuses pots with any records; each record type blocks', async () => {
    const fx = await createHouseholdFixture();
    try {
      // Checkpoint blocks.
      addCheckpoint(fx.db, { potId: fx.pots.main.id, amountPence: 1, actor: ACTOR, now: NOW });
      assert.throws(
        () => archivePot(fx.db, { id: fx.pots.main.id, expectedVersion: 1, actor: ACTOR }),
        InvalidPotInputError,
      );
      // Purchase blocks.
      createPurchase(fx.db, {
        potId: fx.pots.salary.id,
        totalPence: 100,
        paidByPersonId: fx.people.alex.id,
        occurredDate: '2026-09-20',
        lines: [
          {
            amountPence: 100,
            categoryId: fx.categoryId('Groceries', 'Weekly Shop'),
            targetKind: 'household',
          },
        ],
        actor: ACTOR,
        now: NOW,
      });
      assert.throws(
        () => archivePot(fx.db, { id: fx.pots.salary.id, expectedVersion: 1, actor: ACTOR }),
        InvalidPotInputError,
      );
      // Either side of a transfer blocks.
      createTransfer(fx.db, {
        fromPotId: fx.pots.alexCash.id,
        toPotId: fx.pots.samCash.id,
        amountPence: 100,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.throws(
        () => archivePot(fx.db, { id: fx.pots.alexCash.id, expectedVersion: 1, actor: ACTOR }),
        InvalidPotInputError,
      );
      assert.throws(
        () => archivePot(fx.db, { id: fx.pots.samCash.id, expectedVersion: 1, actor: ACTOR }),
        InvalidPotInputError,
      );
    } finally {
      fx.close();
    }
  });

  it('receipts, external movements and schedules block too', async () => {
    const fx = await createHouseholdFixture();
    try {
      createReceipt(fx.db, {
        potId: fx.pots.main.id,
        amountPence: 100,
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.throws(
        () => archivePot(fx.db, { id: fx.pots.main.id, expectedVersion: 1, actor: ACTOR }),
        InvalidPotInputError,
      );
      createExternalMovement(fx.db, {
        potId: fx.pots.salary.id,
        direction: 'in',
        kind: 'other',
        amountPence: 100,
        counterparty: 'neighbour',
        note: 'sold the old bike',
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.throws(
        () => archivePot(fx.db, { id: fx.pots.salary.id, expectedVersion: 1, actor: ACTOR }),
        InvalidPotInputError,
      );
      createSchedule(fx.db, {
        name: 'Energy DD',
        kind: 'dd',
        frequency: 'monthly',
        dueDayOfMonth: 28,
        amountPence: 8455,
        potId: fx.pots.alexCash.id,
        supplierName: 'Energy Co',
        categoryId: fx.categoryId('Utilities', 'Energy'),
        targetKind: 'household',
        activeFrom: '2026-09-01',
        actor: ACTOR,
        now: NOW,
      });
      assert.throws(
        () => archivePot(fx.db, { id: fx.pots.alexCash.id, expectedVersion: 1, actor: ACTOR }),
        InvalidPotInputError,
      );
      // The untouched pot still archives.
      const archived = archivePot(fx.db, {
        id: fx.pots.samCash.id,
        expectedVersion: 1,
        actor: ACTOR,
        now: NOW,
      });
      assert.notEqual(archived.archivedAt, null);
    } finally {
      fx.close();
    }
  });
});
