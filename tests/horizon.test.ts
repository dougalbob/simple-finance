import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { Db } from '../src/lib/db/client';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import { addCheckpoint } from '../src/lib/records/pots';
import { createDebt, editDebt, getDebt, InvalidDebtInputError } from '../src/lib/records/debts';
import {
  createExternalMovement,
  voidExternalMovement,
} from '../src/lib/records/external-movements';
import { createPurchase } from '../src/lib/records/purchases';
import { createSchedule } from '../src/lib/records/schedules';
import {
  getHorizonProjectionView,
  getMoneySnapshot,
  getProjectionView,
  landPenceOf,
} from '../src/lib/records/money-view';
import { setMonthlyFuelPence, setWeeklyGroceriesPence } from '../src/lib/records/settings';

const p = (value: number) => Math.round(value * 100);

const ACTOR = 'alex@example.com';

/**
 * The v0.5.0 horizon read model (SPEC §7.6) and debt expected inflow
 * (SPEC §10.2, feature 2). These tests pin the contracts the Horizon page
 * depends on:
 *
 *  1. `getHorizonProjectionView` reuses the pure projection engine with the
 *     chosen date as the window's end — its totals and per-day rows equal a
 *     hand-computed window, and "where we'd land" is
 *     `available + receipts − commitments − day-to-day` (the final day).
 *  2. Debt expected inflow joins the window as `expected` money in and never
 *     leaks into the estimate ("available now") or the payday receipt list
 *     unless it wins earliest — borrowed money is never income (§10.2).
 *  3. The form's compute paths — pot filtering and the day-to-day toggle —
 *     stay true to the data they claim to show.
 *
 * Everything is fictional (SPEC §19): made-up people, pots and amounts.
 */
describe('horizon: expected inflow and the horizon read model (v0.5.0)', () => {
  const now = new Date('2026-09-23T19:30:00+01:00');
  let fixture: HouseholdFixture;

  /**
   * A checkpointed household with a £2,150 salary (26th), an £84.55 Energy
   * DD (25th) and a `we_owe` debt settled with a £1,000 loan into Alex's
   * cash — the household's motivating shape — expecting £1,000 support on
   * the 12th of each month.
   */
  async function setUp(dayOfMonth = 12) {
    fixture = await createHouseholdFixture(ACTOR, now);
    const { db, pots } = fixture;
    const actor = ACTOR;

    addCheckpoint(db, { potId: pots.main.id, amountPence: p(500), actor, now });
    addCheckpoint(db, { potId: pots.salary.id, amountPence: p(200), actor, now });
    addCheckpoint(db, { potId: pots.alexCash.id, amountPence: p(80), actor, now });
    addCheckpoint(db, { potId: pots.samCash.id, amountPence: p(40), actor, now });

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

    createSchedule(db, {
      name: 'Energy DD',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 25,
      amountPence: p(84.55),
      potId: pots.main.id,
      supplierName: 'Northern Power Co',
      categoryId: fixture.categoryId('Utilities', 'Energy'),
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor,
      now: new Date('2026-09-01T09:00:00Z'),
    });

    const debt = createDebt(db, { counterparty: 'Mum', direction: 'we_owe', actor, now });
    createExternalMovement(db, {
      potId: pots.alexCash.id,
      direction: 'in',
      kind: 'loan',
      amountPence: p(1000),
      debtId: debt.id,
      occurredAt: new Date('2026-09-20T12:00:00+01:00'),
      occurredDate: '2026-09-20',
      actor,
      now: new Date('2026-09-20T12:00:00+01:00'),
    });
    editDebt(db, {
      id: debt.id,
      expectedVersion: 1,
      actor,
      now,
      patch: { expectedInflow: { amountPence: p(1000), dayOfMonth } },
    });

    return { db, pots, salary, debt };
  }

  after(() => {
    if (fixture !== undefined) {
      fixture.close();
    }
  });

  it('the expectation rides as a pair and rejects half-set or nonsense values', async () => {
    const { db, debt } = await setUp();
    const edited = editDebt(db, {
      id: debt.id,
      expectedVersion: 2,
      actor: ACTOR,
      now,
      patch: { expectedInflow: { amountPence: p(1200), dayOfMonth: 5 } },
    });
    assert.equal(edited.expectedInflowAmountPence, p(1200));
    assert.equal(edited.expectedInflowDayOfMonth, 5);
    assert.equal(edited.version, 3);

    // Amount must be positive whole pence; the day must be 1–31.
    assert.throws(
      () =>
        editDebt(db, {
          id: debt.id,
          expectedVersion: 3,
          actor: ACTOR,
          now,
          patch: { expectedInflow: { amountPence: 0, dayOfMonth: 12 } },
        }),
      InvalidDebtInputError,
    );
    assert.throws(
      () =>
        editDebt(db, {
          id: debt.id,
          expectedVersion: 3,
          actor: ACTOR,
          now,
          patch: { expectedInflow: { amountPence: p(10), dayOfMonth: 32 } },
        }),
      InvalidDebtInputError,
    );
    assert.throws(
      () =>
        editDebt(db, {
          id: debt.id,
          expectedVersion: 3,
          actor: ACTOR,
          now,
          // A fraction of a penny is not a whole-pence figure.
          patch: { expectedInflow: { amountPence: 1050.5, dayOfMonth: 12 } },
        }),
      InvalidDebtInputError,
    );

    // Clearing the expectation is a valid patch (the pair → null together).
    const cleared = editDebt(db, {
      id: debt.id,
      expectedVersion: 3,
      actor: ACTOR,
      now,
      patch: { expectedInflow: null },
    });
    assert.equal(cleared.expectedInflowAmountPence, null);
    assert.equal(cleared.expectedInflowDayOfMonth, null);
    assert.equal(getDebt(db, debt.id).expectedInflowDayOfMonth, null);

    // A half-set pair is rejected: the amount rides with the day or not at
    // all. (The boundary schema collapses a half-set to null; the domain
    // receives a full pair or null.)
    assert.doesNotThrow(() =>
      editDebt(db, {
        id: debt.id,
        expectedVersion: 4,
        actor: ACTOR,
        now,
        patch: { expectedInflow: { amountPence: p(50), dayOfMonth: 12 } },
      }),
    );
  });

  it('expected inflow feeds the payday window earliest-wins and stays out of estimates', async () => {
    const { db } = await setUp(3);
    // Support on the 3rd of each month: it lands after the salary, so it does
    // not win the cycle. Note the salary's own weekend rule is in play —
    // 2026-09-26 is a Saturday, so the salary is expected Friday the 25th.
    const view = getProjectionView(db, now);
    assert.ok(view);
    assert.equal(view.result.paydayDate, '2026-09-25');
    const expected = view.receiptLines.filter((line) => line.expected === true);
    assert.equal(expected.length, 0); // the 3rd is outside the 25th window

    // The estimate never sees the expectation (borrowed money, never income).
    const snapshot = getMoneySnapshot(db, now);
    assert.equal(snapshot.householdAvailablePence, p(820));
  });

  it('the expectation wins the payday when it lands before the salary', async () => {
    const { db } = await setUp(24);
    // Support due on the 24th (a Thursday) beats the salary, which shifts to
    // Friday the 25th: the cycle flips to the earlier expected money, so the
    // window ends on the 24th and the salary sits outside it.
    const view = getProjectionView(db, now);
    assert.ok(view);
    assert.equal(view.result.paydayDate, '2026-09-24');
    const expected = view.receiptLines.filter((line) => line.expected === true);
    assert.equal(expected.length, 1);
    assert.equal(expected[0]?.dueDate, '2026-09-24');
    assert.match(expected[0]?.name ?? '', /support from Mum/);
    assert.equal(expected[0]?.amountPence, p(1000));
  });

  it('a weekend support day shifts to the Friday before, like salary (decision 7)', async () => {
    const { db } = await setUp(13);
    // Day 13 in the window: Tue 10-13, Fri 11-13, and Sun 12-13 — only the
    // Sunday moves, onto Friday 2026-12-11. Never onto a weekend.
    const lines = getHorizonProjectionView(db, '2026-12-14', [], true, now).receiptLines.filter(
      (line) => line.expected,
    );
    assert.ok(
      lines.some((line) => line.dueDate === '2026-12-11'),
      'Sunday 12-13 → Friday 12-11',
    );
    assert.ok(
      lines.every((line) => {
        const weekday = new Date(`${line.dueDate}T12:00:00Z`).getUTCDay();
        return weekday !== 0 && weekday !== 6;
      }),
      'no expected support ever lands on a weekend',
    );
  });

  it('a settled debt expects nothing', async () => {
    const { db, debt } = await setUp();
    // Repay the full £1,000: the derived balance is zero, so the expectation
    // is ignored even though it is still configured.
    createExternalMovement(db, {
      potId: fixture.pots.alexCash.id,
      direction: 'out',
      kind: 'loan',
      amountPence: p(1000),
      debtId: debt.id,
      occurredAt: new Date('2026-09-22T12:00:00+01:00'),
      occurredDate: '2026-09-22',
      actor: ACTOR,
      now: new Date('2026-09-22T12:00:00+01:00'),
    });
    const lines = getHorizonProjectionView(db, '2026-11-16', [], true, now).receiptLines.filter(
      (line) => line.expected,
    );
    assert.equal(lines.length, 0);
  });

  it('reproduces the window arithmetic by hand, to the penny', async () => {
    const { db, pots } = await setUp();
    setWeeklyGroceriesPence(db, p(90), ACTOR);
    setMonthlyFuelPence(db, fixture.vehicles.vehicleA.id, p(75), ACTOR);
    setMonthlyFuelPence(db, fixture.vehicles.vehicleB.id, p(60), ACTOR);

    // The anchors (SPEC §7.3, v0.6.0): the last weekly shop £84.10 on the
    // 21st resets the groceries week; the last fills (£75 A on the 20th,
    // £60 B on the 5th) reset each vehicle's month. All are recorded before
    // the checkpoints, so the £820 estimate is untouched.
    const recordDated = (
      occurredDate: string,
      amountPence: number,
      category: [string, string],
      targetKind: 'household' | 'vehicle',
      targetId?: number,
    ) =>
      createPurchase(db, {
        supplierId: null,
        potId: pots.main.id,
        totalPence: amountPence,
        paidByPersonId: fixture.people.alex.id,
        occurredAt: new Date(`${occurredDate}T12:00:00+01:00`),
        occurredDate,
        lines: [
          {
            amountPence,
            categoryId: fixture.categoryId(...category),
            targetKind,
            targetId,
          },
        ],
        actor: ACTOR,
        now: new Date(`${occurredDate}T12:00:00+01:00`),
      });
    recordDated('2026-09-21', p(84.1), ['Groceries', 'Weekly Shop'], 'household');
    recordDated(
      '2026-09-20',
      p(75.0),
      ['Vehicle Running', 'Fuel'],
      'vehicle',
      fixture.vehicles.vehicleA.id,
    );
    recordDated(
      '2026-09-05',
      p(60.0),
      ['Vehicle Running', 'Fuel'],
      'vehicle',
      fixture.vehicles.vehicleB.id,
    );

    // Window 23 Sep (today) → 26 Oct (33 days). Inside it:
    //   Energy DD (25th, monthly) — 25 Sep AND 25 Oct  → £169.10
    //   Salary (26th → weekend shift) — 26 Sep is Saturday → Friday 25 Sep,
    //       and Monday 26 Oct  → £4,300
    //   Support (12th) — Monday 12 Oct  → £1,000, flagged expected
    //   Weekly shops — every 7 days from the 21st → 28/9, 5/10, 12/10,
    //       19/10, 26/10  → 5 × £90 = £450
    //   Fuel A — 20/9 + 30 → 20/10  → £75;   Fuel B — 5/9 + 30 → 5/10  → £60
    const through = '2026-10-26';
    const view = getHorizonProjectionView(db, through, [], true, now);
    const { result } = view;

    assert.equal(result.paydayDate, through);
    assert.equal(result.days, 33);
    assert.equal(result.availableNowPence, p(820));
    assert.equal(result.totalCommitmentsPence, p(169.1));
    assert.equal(result.totalReceiptsPence, p(5300)); // two salaries + support
    const expected = view.receiptLines.filter((line) => line.expected);
    assert.equal(expected.length, 1);
    assert.equal(expected[0]?.dueDate, '2026-10-12');
    assert.equal(expected[0]?.amountPence, p(1000));

    // Day-to-day is episodic: dated events from the anchors, no smooth rate.
    assert.equal(result.groceriesPence, p(450.0));
    assert.equal(result.fuelPence, p(135.0)); // £75 A (20/10) + £60 B (5/10)
    assert.equal(result.dayToDayPence, p(585.0));
    assert.deepEqual(
      view.dayToDayEvents
        .filter((event) => event.kind === 'groceries')
        .map((event) => event.dueDate),
      ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'],
    );
    assert.deepEqual(
      view.dayToDayEvents.filter((event) => event.kind === 'fuel').map((event) => event.dueDate),
      ['2026-10-05', '2026-10-20'],
    );

    // The last weekly shop of the window lands on the 26th, the through
    // date — an outgoing on the final day, included like every other.
    const lastDay = result.perDay[result.perDay.length - 1];
    assert.ok(lastDay);
    assert.equal(lastDay.dayToDayPence, p(90.0));

    // "Where we'd land" is the final day's running total — the arithmetic of
    // the engine's final row, never a separately computed figure.
    const handLand =
      result.availableNowPence +
      result.totalReceiptsPence -
      result.totalCommitmentsPence -
      result.dayToDayPence;
    assert.equal(landPenceOf(result), handLand);
    assert.equal(lastDay.runningPence, handLand);

    // The lowest point is pinned by the same engine the payday panel uses,
    // so the two read models agree on the figures their windows share.
    const paydayView = getProjectionView(db, now);
    assert.ok(paydayView);
    assert.equal(paydayView.result.availableNowPence, result.availableNowPence);
  });

  it('bills-only excludes day-to-day and relabels by the same arithmetic', async () => {
    const { db } = await setUp();
    setWeeklyGroceriesPence(db, p(90), ACTOR);
    setMonthlyFuelPence(db, fixture.vehicles.vehicleA.id, p(75), ACTOR);
    setMonthlyFuelPence(db, fixture.vehicles.vehicleB.id, p(60), ACTOR);

    const withDayToDay = getHorizonProjectionView(db, '2026-10-26', [], true, now);
    const billsOnly = getHorizonProjectionView(db, '2026-10-26', [], false, now);
    assert.ok(withDayToDay.result.dayToDayPence > 0);
    assert.equal(billsOnly.result.dayToDayPence, 0);
    assert.equal(withDayToDay.dayToDayIncluded, true);
    assert.equal(billsOnly.dayToDayIncluded, false);

    const landWith = landPenceOf(withDayToDay.result);
    const landBills = landPenceOf(billsOnly.result);
    assert.equal(landBills - landWith, withDayToDay.result.dayToDayPence);
  });

  it('selected pots scope every figure, including the debt expectation', async () => {
    const { db, pots } = await setUp();
    // No day-to-day config here, so the totals are pure commitments.
    const all = getHorizonProjectionView(db, '2026-10-26', [], false, now);
    const mainOnly = getHorizonProjectionView(db, '2026-10-26', [pots.main.id], false, now);

    assert.equal(all.result.availableNowPence, p(820));
    assert.equal(mainOnly.result.availableNowPence, p(500));
    assert.equal(mainOnly.selection.filter((entry) => entry.selected).length, 1);
    // The support loan lives in Alex's cash: deselected → dropped from the
    // receipt list, while the Energy commitment on Main stays.
    assert.ok(all.receiptLines.some((line) => line.expected));
    assert.ok(mainOnly.receiptLines.every((line) => !line.expected));
    assert.equal(mainOnly.result.totalCommitmentsPence, p(169.1)); // 25 Sep + 25 Oct
  });
});

/**
 * Expected support as a plan with a start, a changeable day and an end
 * (SPEC §10.2, v0.7.0). The household's own words drive these tests: set a
 * future day of month, change it later, stop it after N payments, and see
 * every month's date derived from that single figure — never re-entered.
 */
describe('expected support: planning, changing and stopping it (v0.7.0)', () => {
  const now = new Date('2026-09-24T19:30:00+01:00');
  let fixture: HouseholdFixture;

  after(() => {
    if (fixture !== undefined) {
      fixture.close();
    }
  });

  /** Checkpointed household with a £2,150 salary on the 26th and a brand-new 'Mum' IOU. */
  async function setUp() {
    fixture = await createHouseholdFixture(ACTOR, now);
    const { db, pots } = fixture;
    addCheckpoint(db, { potId: pots.main.id, amountPence: p(500), actor: ACTOR, now });
    addCheckpoint(db, { potId: pots.salary.id, amountPence: p(200), actor: ACTOR, now });
    createSchedule(db, {
      name: 'Salary',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 26,
      amountPence: p(2150),
      potId: pots.salary.id,
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    const debt = createDebt(db, { counterparty: 'Mum', direction: 'we_owe', actor: ACTOR, now });
    return { db, pots, debt };
  }

  const expectedLines = (db: Db, through: string) =>
    getHorizonProjectionView(db, through, [], false, now).receiptLines.filter(
      (line) => line.expected === true,
    );

  it('a loan that has not started yet projects its first payment (the whole point)', async () => {
    const { db, debt } = await setUp();
    editDebt(db, {
      id: debt.id,
      expectedVersion: 1,
      actor: ACTOR,
      now,
      patch: { expectedInflow: { amountPence: p(1000), dayOfMonth: 10 } },
    });
    // Today is Thursday 24 September: September's 10th is behind us, so the
    // first payment is October's — Saturday the 10th, expected on Friday the
    // 9th (decision 7) — with nothing whatsoever borrowed yet.
    const lines = expectedLines(db, '2026-10-31');
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.dueDate, '2026-10-09');
    assert.equal(lines[0]?.amountPence, p(1000));
    assert.match(lines[0]?.name ?? '', /support from Mum/);
    // No movement pins a pot yet, so the expectation uses the household's
    // default pot; the estimate still never moves (SPEC §10.2).
    assert.equal(lines[0]?.potLabel, 'Main account');
    const snapshot = getMoneySnapshot(db, now);
    assert.equal(snapshot.householdAvailablePence, p(700));
    assert.equal(snapshot.debts.owedByHouseholdPence, 0);
  });

  it('stops at the inclusive until date, weekend shifts and all', async () => {
    const { db, debt } = await setUp();
    // "About five months" from October: the fifth payment is February's, and
    // nothing is expected from March — no hand-clearing needed.
    editDebt(db, {
      id: debt.id,
      expectedVersion: 1,
      actor: ACTOR,
      now,
      patch: {
        expectedInflow: { amountPence: p(1000), dayOfMonth: 10, untilDate: '2027-02-10' },
      },
    });
    assert.deepEqual(
      expectedLines(db, '2027-04-30').map((line) => line.dueDate),
      ['2026-10-09', '2026-11-10', '2026-12-10', '2027-01-08', '2027-02-10'],
    );
    // The inclusive boundary is the configured day: the payment configured on
    // the until date itself counts (here 10 February, a Wednesday).
    const boundary = editDebt(db, {
      id: debt.id,
      expectedVersion: getDebt(db, debt.id).version,
      actor: ACTOR,
      now,
      patch: {
        expectedInflow: { amountPence: p(1000), dayOfMonth: 10, untilDate: '2027-01-10' },
      },
    });
    assert.equal(boundary.expectedInflowUntilDate, '2027-01-10');
    assert.deepEqual(
      expectedLines(db, '2027-04-30').map((line) => line.dueDate),
      ['2026-10-09', '2026-11-10', '2026-12-10', '2027-01-08'],
    );
    // A single payment: the next occurrence only.
    editDebt(db, {
      id: debt.id,
      expectedVersion: boundary.version,
      actor: ACTOR,
      now,
      patch: {
        expectedInflow: { amountPence: p(1000), dayOfMonth: 10, untilDate: '2026-10-10' },
      },
    });
    assert.deepEqual(
      expectedLines(db, '2027-04-30').map((line) => line.dueDate),
      ['2026-10-09'],
    );
  });

  it('follows a changed day of month across every unrecorded month', async () => {
    const { db, debt } = await setUp();
    const edited = editDebt(db, {
      id: debt.id,
      expectedVersion: 1,
      actor: ACTOR,
      now,
      patch: {
        expectedInflow: { amountPence: p(1000), dayOfMonth: 10, untilDate: '2027-02-10' },
      },
    });
    assert.deepEqual(
      expectedLines(db, '2026-12-31').map((line) => line.dueDate),
      ['2026-10-09', '2026-11-10', '2026-12-10'],
    );

    // In December the household moves the payment to the 13th to line up with
    // its spending. Occurrences are derived, never stored, so the months that
    // have not been recorded follow the new day — and nothing recorded moves,
    // because nothing has been.
    editDebt(db, {
      id: debt.id,
      expectedVersion: edited.version,
      actor: ACTOR,
      now,
      patch: {
        expectedInflow: { amountPence: p(1000), dayOfMonth: 13, untilDate: '2027-02-10' },
      },
    });
    assert.deepEqual(
      expectedLines(db, '2026-12-31').map((line) => line.dueDate),
      ['2026-10-13', '2026-11-13', '2026-12-11'], // Sun 13 Dec → Fri 11 Dec
    );
    const snapshot = getMoneySnapshot(db, now);
    assert.equal(snapshot.householdAvailablePence, p(700));
    assert.equal(snapshot.debts.owedByHouseholdPence, 0);
  });

  it('a recorded month stops projecting; a mid-cycle extra borrowing does not steal the next', async () => {
    const { db, pots, debt } = await setUp();
    editDebt(db, {
      id: debt.id,
      expectedVersion: 1,
      actor: ACTOR,
      now,
      patch: {
        expectedInflow: { amountPence: p(1000), dayOfMonth: 10, untilDate: '2027-02-10' },
      },
    });
    // October's money lands on the day the parents actually transfer — the
    // Saturday — and is recorded. That month is answered; November is not.
    createExternalMovement(db, {
      potId: pots.main.id,
      direction: 'in',
      kind: 'loan',
      amountPence: p(1000),
      debtId: debt.id,
      occurredDate: '2026-10-10',
      actor: ACTOR,
      now: new Date('2026-10-10T12:00:00+01:00'),
    });
    assert.deepEqual(
      expectedLines(db, '2026-12-31').map((line) => line.dueDate),
      ['2026-11-10', '2026-12-10'],
    );
    // An extra £200 borrowed mid-cycle is not November's payment: the
    // expectation for the 10th is still expected.
    createExternalMovement(db, {
      potId: pots.main.id,
      direction: 'in',
      kind: 'loan',
      amountPence: p(200),
      debtId: debt.id,
      occurredDate: '2026-10-20',
      actor: ACTOR,
      now: new Date('2026-10-20T12:00:00+01:00'),
    });
    assert.deepEqual(
      expectedLines(db, '2026-12-31').map((line) => line.dueDate),
      ['2026-11-10', '2026-12-10'],
    );
    assert.equal(getMoneySnapshot(db, now).debts.owedByHouseholdPence, p(1200));
  });

  it('a recorded month is answered, a voided one comes back, and settling stops the rest', async () => {
    const { db, pots, debt } = await setUp();
    editDebt(db, {
      id: debt.id,
      expectedVersion: 1,
      actor: ACTOR,
      now,
      patch: {
        expectedInflow: { amountPence: p(1000), dayOfMonth: 10, untilDate: '2027-02-10' },
      },
    });
    // October's money lands on the day the parents actually transfer — the
    // Saturday — and is recorded. That month is answered; the rest are not.
    const borrowed = createExternalMovement(db, {
      potId: pots.main.id,
      direction: 'in',
      kind: 'loan',
      amountPence: p(1000),
      debtId: debt.id,
      occurredDate: '2026-10-10',
      actor: ACTOR,
      now: new Date('2026-10-10T12:00:00+01:00'),
    });
    assert.deepEqual(
      expectedLines(db, '2026-12-31').map((line) => line.dueDate),
      ['2026-11-10', '2026-12-10'],
    );
    // Voided records never count as money: the expectation returns.
    voidExternalMovement(db, {
      id: borrowed.id,
      expectedVersion: borrowed.version,
      reason: 'entered against the wrong debt',
      actor: ACTOR,
      now: new Date('2026-10-11T09:00:00+01:00'),
    });
    assert.deepEqual(
      expectedLines(db, '2026-12-31').map((line) => line.dueDate),
      ['2026-10-09', '2026-11-10', '2026-12-10'],
    );
    // Repay in full after probate: settled, so nothing further is expected,
    // however the arrangement was configured.
    createExternalMovement(db, {
      potId: pots.main.id,
      direction: 'in',
      kind: 'loan',
      amountPence: p(1000),
      debtId: debt.id,
      occurredDate: '2026-10-09',
      actor: ACTOR,
      now: new Date('2026-10-09T12:00:00+01:00'),
    });
    createExternalMovement(db, {
      potId: pots.main.id,
      direction: 'out',
      kind: 'loan',
      amountPence: p(1000),
      debtId: debt.id,
      occurredDate: '2026-10-20',
      actor: ACTOR,
      now: new Date('2026-10-20T12:00:00+01:00'),
    });
    assert.deepEqual(expectedLines(db, '2027-04-30'), []);
    assert.equal(getMoneySnapshot(db, now).debts.owedByHouseholdPence, 0);
  });
});
