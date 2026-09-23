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
  voidSwap,
} from '../src/lib/records/external-movements';
import { getMonthComparisonView } from '../src/lib/records/insights-view';
import { getMoneySnapshot } from '../src/lib/records/money-view';
import { addCheckpoint, archivePot, InvalidPotInputError, listPots } from '../src/lib/records/pots';
import { createPurchase, createRefund } from '../src/lib/records/purchases';
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

  it('voidSwap voids both legs atomically, with one shared reason and version guards', async () => {
    const fx = await createHouseholdFixture();
    try {
      const swap = createSwap(fx.db, {
        inPotId: fx.pots.alexCash.id,
        outPotId: fx.pots.main.id,
        amountPence: 12000,
        counterparty: 'our son',
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      const result = voidSwap(fx.db, {
        exchangeKey: swap.exchangeKey,
        inLegId: swap.inLeg.id,
        outLegId: swap.outLeg.id,
        expectedInVersion: 1,
        expectedOutVersion: 1,
        reason: 'the swap never happened',
        actor: ACTOR,
        now: NOW,
      });
      assert.notEqual(result.inLeg.voidedAt, null);
      assert.notEqual(result.outLeg.voidedAt, null);
      assert.equal(result.inLeg.voidReason, 'the swap never happened');
      assert.equal(result.outLeg.voidReason, 'the swap never happened');
      assert.equal(result.inLeg.version, 2);
      assert.equal(result.outLeg.version, 2);
      // Both legs, one step: the pair is gone from the live list…
      assert.equal(listExchanges(fx.db).length, 0);
      // …but stays in history, as a voided pair.
      const history = listExchanges(fx.db, { includeVoided: true });
      assert.equal(history.length, 1);
      assert.notEqual(history[0]?.inLeg?.voidedAt, null);
      assert.notEqual(history[0]?.outLeg?.voidedAt, null);

      // Guards: already-voided pair, stale version, wrong exchange key,
      // and a leg that is not a swap leg all fail, nothing half-applied.
      assert.throws(
        () =>
          voidSwap(fx.db, {
            exchangeKey: swap.exchangeKey,
            inLegId: swap.inLeg.id,
            outLegId: swap.outLeg.id,
            expectedInVersion: 2,
            expectedOutVersion: 2,
            actor: ACTOR,
          }),
        AlreadyVoidError,
      );
      const second = createSwap(fx.db, {
        inPotId: fx.pots.samCash.id,
        outPotId: fx.pots.main.id,
        amountPence: 500,
        counterparty: 'the bank',
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.throws(
        () =>
          voidSwap(fx.db, {
            exchangeKey: second.exchangeKey,
            inLegId: second.inLeg.id,
            outLegId: second.outLeg.id,
            expectedInVersion: 99,
            expectedOutVersion: 1,
            actor: ACTOR,
          }),
        VersionConflictError,
      );
      assert.throws(
        () =>
          voidSwap(fx.db, {
            exchangeKey: 'not-the-key',
            inLegId: second.inLeg.id,
            outLegId: second.outLeg.id,
            expectedInVersion: 1,
            expectedOutVersion: 1,
            actor: ACTOR,
          }),
        InvalidExternalMovementInputError,
      );
      const loanMovement = createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'out',
        kind: 'other',
        amountPence: 200,
        counterparty: 'the plumber',
        note: 'deposit',
        occurredDate: '2026-09-20',
        actor: ACTOR,
        now: NOW,
      });
      assert.throws(
        () =>
          voidSwap(fx.db, {
            exchangeKey: second.exchangeKey,
            inLegId: loanMovement.id,
            outLegId: second.outLeg.id,
            expectedInVersion: 1,
            expectedOutVersion: 1,
            actor: ACTOR,
          }),
        InvalidExternalMovementInputError,
      );
      // A failed pair void leaves the pair fully live (atomic).
      assert.equal(listExchanges(fx.db).length, 1);
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

/**
 * E13 — the same-day credit double-count (the £180 bug, fixed in v0.2.1 by
 * the sign-aware tie-break in SPEC §7.1). DB-level, over the real domain
 * paths: createSwap + addCheckpoint + getMoneySnapshot. The shape of the
 * household's real chronology: swap legs are date-only (form date input),
 * Pots-page checkpoints are timed (effectiveAt = now).
 */
describe('E13: a same-day credit is absorbed by a same-day checkpoint (v0.2.1 fix)', () => {
  function estimatePence(
    fx: Awaited<ReturnType<typeof createHouseholdFixture>>,
    potId: number,
    now: Date,
  ): number {
    const view = getMoneySnapshot(fx.db, now).pots.find((entry) => entry.pot.id === potId);
    if (view?.estimatePence === null || view === undefined) {
      throw new Error(`pot ${potId} has no estimate at this stage`);
    }
    return view.estimatePence;
  }

  it('the five-step repro reads 2000 / 10000 / 10000 / 10000 / 10000', async () => {
    const fx = await createHouseholdFixture(ACTOR, new Date('2026-09-22T09:00:00Z'));
    try {
      const cash = fx.pots.alexCash;
      const main = fx.pots.main;

      // Step 1: the cash pot is checkpointed at £20 on the 22nd.
      addCheckpoint(fx.db, {
        potId: cash.id,
        amountPence: 2000,
        effectiveAt: new Date('2026-09-22T10:00:00Z'),
        actor: ACTOR,
        now: new Date('2026-09-22T10:00:00Z'),
      });
      assert.equal(
        estimatePence(fx, cash.id, new Date('2026-09-22T10:00:00Z')),
        2000,
        'step 1: the 22nd checkpoint reads £20',
      );

      // Step 2: a swap IN of £80, date-only on the 23rd (in → cash, out → Main).
      const swap = createSwap(fx.db, {
        inPotId: cash.id,
        outPotId: main.id,
        amountPence: 8000,
        counterparty: 'our son',
        occurredDate: '2026-09-23',
        actor: ACTOR,
        now: new Date('2026-09-23T10:00:00Z'),
      });
      assert.equal(swap.inLeg.occurredDate, '2026-09-23');
      assert.equal(
        estimatePence(fx, cash.id, new Date('2026-09-23T10:00:00Z')),
        10000,
        'step 2: £20 + £80 (the leg is on a later date) = £100',
      );

      // Step 3: a TIMED checkpoint of £100 at 23 Sept 12:00 — the counted
      // figure already includes the £80 cash in hand. Pre-fix: £180.
      addCheckpoint(fx.db, {
        potId: cash.id,
        amountPence: 10000,
        effectiveAt: new Date('2026-09-23T12:00:00Z'),
        actor: ACTOR,
        now: new Date('2026-09-23T12:00:00Z'),
      });
      assert.equal(
        estimatePence(fx, cash.id, new Date('2026-09-23T12:00:00Z')),
        10000,
        'step 3: the same-day credit is absorbed, not double-counted',
      );

      // Step 4: a second timed £100 checkpoint — pre-fix still £180, because
      // no same-day checkpoint could absorb the date-only credit.
      addCheckpoint(fx.db, {
        potId: cash.id,
        amountPence: 10000,
        effectiveAt: new Date('2026-09-23T18:00:00Z'),
        actor: ACTOR,
        now: new Date('2026-09-23T18:00:00Z'),
      });
      assert.equal(
        estimatePence(fx, cash.id, new Date('2026-09-23T18:00:00Z')),
        10000,
        'step 4: still £100 — the same-day credit stays absorbed',
      );

      // Step 5: the next-day £100 checkpoint — £100, as it always was.
      addCheckpoint(fx.db, {
        potId: cash.id,
        amountPence: 10000,
        effectiveAt: new Date('2026-09-24T09:00:00Z'),
        actor: ACTOR,
        now: new Date('2026-09-24T09:00:00Z'),
      });
      assert.equal(
        estimatePence(fx, cash.id, new Date('2026-09-24T09:00:00Z')),
        10000,
        'step 5: the next-day checkpoint reads £100',
      );

      // The out-leg of the swap sits in Main. With Main uncheckpointed there
      // is no estimate (null) — the leg still exists and shows in history.
      const mainView = getMoneySnapshot(fx.db, new Date('2026-09-24T09:00:00Z')).pots.find(
        (entry) => entry.pot.id === main.id,
      );
      assert.equal(mainView?.estimatePence ?? null, null);
    } finally {
      fx.close();
    }
  });

  it('the out-leg understates the bank pot safely until its next checkpoint', async () => {
    const fx = await createHouseholdFixture(ACTOR, new Date('2026-09-22T09:00:00Z'));
    try {
      const cash = fx.pots.alexCash;
      const main = fx.pots.main;
      addCheckpoint(fx.db, {
        potId: main.id,
        amountPence: 50000,
        effectiveAt: new Date('2026-09-22T10:00:00Z'),
        actor: ACTOR,
        now: new Date('2026-09-22T10:00:00Z'),
      });
      createSwap(fx.db, {
        inPotId: cash.id,
        outPotId: main.id,
        amountPence: 8000,
        counterparty: 'our son',
        occurredDate: '2026-09-23',
        actor: ACTOR,
        now: new Date('2026-09-23T10:00:00Z'),
      });
      // The date-only out-leg counts as after the 22nd checkpoint: Main
      // reads £420 (understated if the bank already debited it — the safe
      // direction), while the cash in-leg is absorbed, never overstated.
      assert.equal(
        estimatePence(fx, main.id, new Date('2026-09-23T10:00:00Z')),
        42000,
        'the same-day debit leg counts (understates, safely)',
      );
      // Asymmetry, both safe: a same-day CREDIT is absorbed by a same-day
      // checkpoint (the in-leg case), but a same-day DEBIT keeps counting —
      // a £420 checkpoint at 12:00 still reads £340 (understated, never
      // overstated). The debit is absorbed only by a LATER-date checkpoint.
      addCheckpoint(fx.db, {
        potId: main.id,
        amountPence: 42000,
        effectiveAt: new Date('2026-09-23T12:00:00Z'),
        actor: ACTOR,
        now: new Date('2026-09-23T12:00:00Z'),
      });
      assert.equal(
        estimatePence(fx, main.id, new Date('2026-09-23T12:00:00Z')),
        34000,
        'a same-day checkpoint does not absorb a same-day debit (safe: understates)',
      );
      addCheckpoint(fx.db, {
        potId: main.id,
        amountPence: 42000,
        effectiveAt: new Date('2026-09-24T09:00:00Z'),
        actor: ACTOR,
        now: new Date('2026-09-24T09:00:00Z'),
      });
      assert.equal(
        estimatePence(fx, main.id, new Date('2026-09-24T09:00:00Z')),
        42000,
        'the next-day checkpoint absorbs the debit leg (self-correction)',
      );
    } finally {
      fx.close();
    }
  });

  it('receipts, transfer-ins, refunds and loan-ins: every same-day credit path is absorbed', async () => {
    const fx = await createHouseholdFixture(ACTOR, new Date('2026-09-23T08:00:00Z'));
    try {
      const cash = fx.pots.alexCash;
      const main = fx.pots.main;
      const morning = new Date('2026-09-23T09:00:00Z');
      addCheckpoint(fx.db, {
        potId: cash.id,
        amountPence: 5000,
        effectiveAt: morning,
        actor: ACTOR,
        now: morning,
      });
      const at = new Date('2026-09-23T11:00:00Z');
      const onThe23rd = '2026-09-23';

      // All same-day credits below must be ABSORBED by the 09:00 checkpoint;
      // the one same-day debit (the purchase) stays counted. Pre-v0.2.1 every
      // credit in this list would have been added again.
      createReceipt(fx.db, {
        potId: cash.id,
        amountPence: 3000,
        occurredDate: onThe23rd,
        note: 'cash gift',
        actor: ACTOR,
        now: at,
      });
      assert.equal(estimatePence(fx, cash.id, at), 5000, 'same-day receipt absorbed');
      createTransfer(fx.db, {
        fromPotId: main.id,
        toPotId: cash.id,
        amountPence: 2000,
        occurredDate: onThe23rd,
        note: 'from the bank',
        actor: ACTOR,
        now: at,
      });
      assert.equal(
        estimatePence(fx, cash.id, at),
        5000,
        'same-day transfer-in leg absorbed (the out leg sits in uncheckpointed Main)',
      );
      const purchase = createPurchase(fx.db, {
        potId: cash.id,
        totalPence: 1000,
        occurredDate: onThe23rd,
        paidByPersonId: fx.people.alex.id,
        supplierName: 'Cafe',
        actor: ACTOR,
        lines: [
          {
            amountPence: 1000,
            categoryId: fx.categoryId('Groceries', 'Top-up Shops'),
            targetKind: 'household',
          },
        ],
        now: at,
      });
      assert.equal(estimatePence(fx, cash.id, at), 4000, 'same-day purchase still counted (debit)');
      const topUp = fx.categoryId('Groceries', 'Top-up Shops');
      createRefund(fx.db, {
        refundOfPurchaseId: purchase.purchase.id,
        totalPence: -1000,
        lines: [{ amountPence: -1000, categoryId: topUp, targetKind: 'household' }],
        occurredDate: onThe23rd,
        actor: ACTOR,
        now: at,
      });
      assert.equal(
        estimatePence(fx, cash.id, at),
        4000,
        'the refund (a same-day credit) is absorbed, so it nets to the purchase',
      );
      const debt = createDebt(fx.db, {
        counterparty: 'Mum',
        direction: 'we_owe',
        actor: ACTOR,
        now: at,
      });
      createExternalMovement(fx.db, {
        potId: cash.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 4000,
        debtId: debt.id,
        occurredDate: onThe23rd,
        actor: ACTOR,
        now: at,
      });
      assert.equal(estimatePence(fx, cash.id, at), 4000, 'same-day loan-in absorbed');

      // And a next-day checkpoint of the true figure reads it exactly —
      // nothing double-counted anywhere along the way.
      addCheckpoint(fx.db, {
        potId: cash.id,
        amountPence: 4000,
        effectiveAt: new Date('2026-09-24T09:00:00Z'),
        actor: ACTOR,
        now: new Date('2026-09-24T09:00:00Z'),
      });
      assert.equal(
        estimatePence(fx, cash.id, new Date('2026-09-24T09:00:00Z')),
        4000,
        'next-day checkpoint: every movement absorbed exactly once',
      );
    } finally {
      fx.close();
    }
  });
});
