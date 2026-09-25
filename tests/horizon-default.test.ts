import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import { addCheckpoint } from '../src/lib/records/pots';
import { createDebt, editDebt } from '../src/lib/records/debts';
import { createExternalMovement } from '../src/lib/records/external-movements';
import { createSchedule } from '../src/lib/records/schedules';
import { getProjectionView, nextScheduledIncomeDate } from '../src/lib/records/money-view';
import {
  defaultHorizonThrough,
  resolveHorizonThrough,
  type HorizonThroughInput,
} from '../src/lib/records/horizon-default';

/**
 * Horizon's default "Look ahead to" date (SPEC §7.6, decision 150): the day
 * before the next **scheduled** income (the salary — a debt's expected
 * support never counts), clamped into the selectable window, with the
 * five-week fallback when no income is scheduled, and an explicit in-range
 * `?through=` always winning.
 *
 * Everything is fictional (SPEC §19).
 */

const TODAY = '2026-09-23';
const base: HorizonThroughInput = {
  today: TODAY,
  requested: null,
  nextIncomeDate: null,
  minDate: '2026-09-24', // today + 1
  maxDate: '2027-10-28', // today + 400
  fallbackDays: 35,
};
const resolve = (patch: Partial<HorizonThroughInput>) =>
  resolveHorizonThrough({ ...base, ...patch });

describe('horizon default date — the clamp table (decision 150)', () => {
  it('ordinary case: the day before the next income', () => {
    assert.deepEqual(resolve({ nextIncomeDate: '2026-10-25' }), {
      date: '2026-10-24',
      source: 'day-before-income',
    });
  });

  it('crosses a month boundary with local-calendar arithmetic', () => {
    assert.equal(resolve({ nextIncomeDate: '2026-11-01' }).date, '2026-10-31');
    // …and a leap day.
    assert.equal(
      resolve({
        today: '2028-02-10',
        minDate: '2028-02-11',
        maxDate: '2029-03-16',
        nextIncomeDate: '2028-03-01',
      }).date,
      '2028-02-29',
    );
  });

  it('income tomorrow: clamps up to today + 1 (the income day itself)', () => {
    assert.deepEqual(resolve({ nextIncomeDate: '2026-09-24' }), {
      date: '2026-09-24',
      source: 'day-before-income',
    });
  });

  it('income the day after tomorrow: the day before is tomorrow, the minimum', () => {
    assert.equal(resolve({ nextIncomeDate: '2026-09-25' }).date, '2026-09-24');
  });

  it('income beyond the 400-day cap: clamps down to today + 400', () => {
    assert.deepEqual(resolve({ nextIncomeDate: '2027-12-01' }), {
      date: '2027-10-28',
      source: 'day-before-income',
    });
    // Income exactly one day past the cap lands on the cap itself, unclamped.
    assert.equal(resolve({ nextIncomeDate: '2027-10-29' }).date, '2027-10-28');
  });

  it('no scheduled income: the five-week fallback', () => {
    assert.deepEqual(resolve({ nextIncomeDate: null }), {
      date: '2026-10-28',
      source: 'fallback',
    });
  });

  it('ignores a nonsense or past "next income" and falls back', () => {
    assert.equal(resolve({ nextIncomeDate: 'soon' }).source, 'fallback');
    assert.equal(resolve({ nextIncomeDate: TODAY }).source, 'fallback');
    assert.equal(resolve({ nextIncomeDate: '2026-09-01' }).source, 'fallback');
  });

  it('an explicit in-range ?through= wins, unchanged', () => {
    assert.deepEqual(resolve({ requested: '2026-12-01', nextIncomeDate: '2026-10-25' }), {
      date: '2026-12-01',
      source: 'requested',
    });
    // Both ends of the window are selectable.
    assert.equal(resolve({ requested: '2026-09-24' }).source, 'requested');
    assert.equal(resolve({ requested: '2027-10-28' }).source, 'requested');
  });

  it('an invalid or out-of-range ?through= falls to the smart default', () => {
    for (const requested of ['', 'tomorrow', '2026-02-30', TODAY, '2026-09-01', '2027-10-29']) {
      assert.deepEqual(
        resolve({ requested, nextIncomeDate: '2026-10-25' }),
        { date: '2026-10-24', source: 'day-before-income' },
        `requested=${JSON.stringify(requested)}`,
      );
    }
  });

  it('defaultHorizonThrough ignores the request entirely', () => {
    assert.equal(
      defaultHorizonThrough({ ...base, nextIncomeDate: '2026-10-25' }).date,
      '2026-10-24',
    );
  });

  it('the default always sits inside [min, max]', () => {
    const candidates = [null, '2026-09-24', '2026-09-25', '2026-10-25', '2027-10-29', '2030-01-01'];
    for (const nextIncomeDate of candidates) {
      const { date } = resolve({ nextIncomeDate });
      assert.ok(date >= base.minDate && date <= base.maxDate, `${nextIncomeDate} → ${date}`);
    }
  });
});

describe('nextScheduledIncomeDate — scheduled income only (decision 150)', () => {
  // Wednesday 2026-09-23, evening in London.
  const now = new Date('2026-09-23T19:30:00+01:00');
  let fixture: HouseholdFixture | undefined;
  after(() => fixture?.close());

  it('reads the weekend-shifted salary and ignores an earlier expected support', async () => {
    fixture = await createHouseholdFixture('alex@example.com', now);
    const { db, pots } = fixture;
    const actor = 'alex@example.com';

    // No receipt schedule yet ⇒ nothing scheduled ⇒ the page falls back.
    assert.equal(nextScheduledIncomeDate(db, TODAY), null);

    for (const pot of [pots.main, pots.salary, pots.alexCash, pots.samCash]) {
      addCheckpoint(db, { potId: pot.id, amountPence: 10000, actor, now });
    }

    // Support from Mum expected on the 24th (tomorrow, a Thursday).
    const debt = createDebt(db, { counterparty: 'Mum', direction: 'we_owe', actor, now });
    createExternalMovement(db, {
      potId: pots.alexCash.id,
      direction: 'in',
      kind: 'loan',
      amountPence: 100000,
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
      patch: { expectedInflow: { amountPence: 100000, dayOfMonth: 24 } },
    });

    // Support alone is never scheduled income.
    assert.equal(nextScheduledIncomeDate(db, TODAY), null);

    // Salary on the 27th — Sunday 2026-09-27 ⇒ expected Friday the 25th.
    createSchedule(db, {
      name: 'Salary',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 27,
      amountPence: 215000,
      potId: pots.salary.id,
      activeFrom: '2026-09-01',
      actor,
      now: new Date('2026-09-01T09:00:00Z'),
    });

    assert.equal(nextScheduledIncomeDate(db, TODAY), '2026-09-25');
    // The payday window (§7.2) still counts the support, which lands first —
    // the two definitions deliberately differ here.
    assert.equal(getProjectionView(db, now)?.result.paydayDate, '2026-09-24');

    // Horizon's default: the day before the salary, not the day before Mum.
    const { date } = resolveHorizonThrough({
      ...base,
      nextIncomeDate: nextScheduledIncomeDate(db, TODAY),
    });
    assert.equal(date, '2026-09-24');
  });
});
