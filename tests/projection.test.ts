import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  projectToPayday,
  selectTier,
  type ProjectionScheduleLine,
} from '../src/lib/records/projection';

/**
 * Scenario E8 (docs/SPEC.md §17): the forecast acceptance case. Friday the
 * 27th, 20:00. Everything must reproduce to the penny.
 *
 *   household_available_now = £938.70 (Main £348.88 + Salary £520.00 +
 *                               Alex's cash £41.20 + Sam's cash £28.62)
 *   next payday = the 26th → days = 29
 *   commitments  = £84.55 (28th) + £685.00 (1st) + £178.42 (1st) +
 *                  £42.00 (3rd) + £24.99 (10th) = £1,014.96
 *   groceries    = round(£90.00 × 29/7)  = £372.86
 *   fuel         = round(£75.00 × 29/30) = £72.50 (A)
 *                  + round(£60.00 × 29/30) = £58.00 (B) = £130.50
 *   salary       = £2,150.00 on the 26th
 *   projected_low = 938.70 − 1,014.96 − 372.86 − 130.50 = −£579.62
 *   tier         = warning (−579.62 ≤ −250.00)
 *   pot_watch(Main) = £348.88 − £1,014.96 = −£666.08
 */

const NOW = new Date('2026-09-27T20:00:00+01:00'); // Friday the 27th, 20:00 (fictional)

const p = (value: number) => Math.round(value * 100);

function e8Commitments(): ProjectionScheduleLine[] {
  return [
    { scheduleId: 1, name: 'Energy DD', potId: 1, amountPence: p(84.55), dueDate: '2026-09-28' },
    { scheduleId: 2, name: 'Mortgage DD', potId: 1, amountPence: p(685.0), dueDate: '2026-10-01' },
    {
      scheduleId: 3,
      name: 'Council Tax DD',
      potId: 1,
      amountPence: p(178.42),
      dueDate: '2026-10-01',
    },
    { scheduleId: 4, name: 'Broadband DD', potId: 1, amountPence: p(42.0), dueDate: '2026-10-03' },
    { scheduleId: 5, name: 'Mobile DD', potId: 1, amountPence: p(24.99), dueDate: '2026-10-10' },
  ];
}

describe('projection: scenario E8 reproduces to the penny', () => {
  const result = projectToPayday({
    now: NOW,
    availableNowPence: p(938.7),
    paydayDate: '2026-10-26',
    commitments: e8Commitments(),
    receipts: [
      { scheduleId: 6, name: 'Salary', potId: 2, amountPence: p(2150.0), dueDate: '2026-10-26' },
    ],
    weeklyGroceriesPence: p(90.0),
    monthlyFuelPence: [p(75.0), p(60.0)],
    warningThresholdPence: p(250.0),
    potWatches: [
      { potId: 1, estimatePence: p(348.88), commitments: e8Commitments() },
      { potId: 2, estimatePence: p(520.0), commitments: [] },
    ],
  });

  it('window length and configured day-to-day figures', () => {
    assert.equal(result.days, 29);
    assert.equal(result.groceriesPence, p(372.86));
    assert.equal(result.fuelPence, p(130.5)); // 72.50 + 58.00
    assert.equal(result.dayToDayPence, p(503.36));
  });

  it('totals over commitments and receipts', () => {
    assert.equal(result.totalCommitmentsPence, p(1014.96));
    assert.equal(result.totalReceiptsPence, p(2150.0));
  });

  it('projected low and its date (just before salary lands)', () => {
    assert.equal(result.projectedLowPence, p(-579.62));
    assert.equal(result.lowDate, '2026-10-10'); // last outgo before the quiet stretch
  });

  it('two-tier warning: tier 2 (warning) at −£579.62 vs threshold £250.00', () => {
    assert.equal(result.tier, 'warning');
    assert.equal(result.warningThresholdPence, p(250.0));
  });

  it('pot-level transfer watch: Main −£666.08, Salary clean', () => {
    const main = result.potWatches.find((watch) => watch.potId === 1);
    assert.notEqual(main, undefined);
    assert.equal(main?.estimatePence, p(348.88));
    assert.equal(main?.commitmentsPence, p(1014.96));
    assert.equal(main?.watchPence, p(-666.08));
    assert.equal(main?.shortfallPence, p(666.08));
    assert.equal(main?.earliestDueDate, '2026-09-28');
    assert.equal(main?.earliestCommitments[0]?.name, 'Energy DD');
    // Salary pot has no commitments → no watch notice.
    assert.equal(result.potWatches.length, 1);
  });

  it('day-by-day runs match the worked example (outgoings before receipts on the same day)', () => {
    const byDate = new Map(result.perDay.map((day) => [day.date, day]));
    assert.equal(result.perDay.length, 29);
    assert.equal(byDate.get('2026-09-28')?.runningPence, p(938.7 - 503.36 - 84.55));
    assert.equal(
      byDate.get('2026-10-01')?.runningPence,
      p(938.7 - 503.36 - 84.55 - 685.0 - 178.42),
    );
    assert.equal(
      byDate.get('2026-10-03')?.runningPence,
      p(938.7 - 503.36 - 84.55 - 685.0 - 178.42 - 42.0),
    );
    assert.equal(byDate.get('2026-10-10')?.runningPence, p(-579.62));
    const payday = byDate.get('2026-10-26');
    assert.equal(payday?.receiptsPence, p(2150.0));
    assert.equal(payday?.runningPence, p(-579.62 + 2150.0));
  });
});

describe('projection: rounding and edge cases', () => {
  it('period-level half-up rounding (nearest penny, ties toward +)', () => {
    // £90.00 weekly for 14 days: 9000 × 14 / 7 = exactly 18000.
    const exact = projectToPayday({
      now: new Date('2026-09-20T09:00:00Z'),
      availableNowPence: p(100),
      paydayDate: '2026-10-04',
      commitments: [],
      receipts: [],
      weeklyGroceriesPence: p(90),
      monthlyFuelPence: [],
      warningThresholdPence: null,
      potWatches: [],
    });
    assert.equal(exact.groceriesPence, p(180));

    // 31 days at £75.00/30: 7500 × 31 / 30 = 7750 exactly.
    const fuel = projectToPayday({
      now: new Date('2026-09-20T09:00:00Z'),
      availableNowPence: p(100),
      paydayDate: '2026-10-21',
      commitments: [],
      receipts: [],
      weeklyGroceriesPence: 0,
      monthlyFuelPence: [p(75)],
      warningThresholdPence: null,
      potWatches: [],
    });
    assert.equal(fuel.fuelPence, p(77.5));
  });

  it('no payday (no income schedule) → null projection, no tier, zero days', () => {
    const result = projectToPayday({
      now: NOW,
      availableNowPence: p(100),
      paydayDate: null,
      commitments: e8Commitments(),
      receipts: [],
      weeklyGroceriesPence: p(90),
      monthlyFuelPence: [p(75)],
      warningThresholdPence: p(250),
      potWatches: [],
    });
    assert.equal(result.days, 0);
    assert.equal(result.projectedLowPence, null);
    assert.equal(result.tier, 'none');
    assert.equal(result.perDay.length, 0);
  });

  it('warning tier requires being at or beyond the threshold; heads-up between 0 and threshold', () => {
    assert.equal(selectTier(p(-10), p(250)), 'heads-up');
    assert.equal(selectTier(p(-250), p(250)), 'warning');
    assert.equal(selectTier(p(-250.01), p(250)), 'warning');
    assert.equal(selectTier(p(5), p(250)), 'none');
    assert.equal(selectTier(p(-5), null), 'heads-up'); // no threshold configured: tier 1 only
    assert.equal(selectTier(null, p(250)), 'none');
  });

  it('an outgoing on payday itself applies before the receipt lands (conservative)', () => {
    const result = projectToPayday({
      now: NOW,
      availableNowPence: p(1000),
      paydayDate: '2026-10-26',
      commitments: [
        { scheduleId: 1, name: 'Rent DD', potId: 1, amountPence: p(900), dueDate: '2026-10-26' },
      ],
      receipts: [
        { scheduleId: 2, name: 'Salary', potId: 2, amountPence: p(500), dueDate: '2026-10-26' },
      ],
      weeklyGroceriesPence: 0,
      monthlyFuelPence: [],
      warningThresholdPence: p(250),
      potWatches: [],
    });
    // 1000 − 900 (rent, before salary) = 100 low; end of payday = 600.
    assert.equal(result.projectedLowPence, p(100));
    assert.equal(result.lowDate, '2026-10-26');
    assert.equal(result.perDay.at(-1)?.runningPence, p(600));
    assert.equal(result.tier, 'none');
  });

  it('DST-boundary windows count whole local days (autumn-back 2026-10-25)', () => {
    // Today the 24th, payday the 1st → 7 whole days across the 25th.
    const result = projectToPayday({
      now: new Date('2026-10-24T22:30:00Z'),
      availableNowPence: p(100),
      paydayDate: '2026-10-31',
      commitments: [],
      receipts: [],
      weeklyGroceriesPence: 0,
      monthlyFuelPence: [],
      warningThresholdPence: null,
      potWatches: [],
    });
    assert.equal(result.days, 7);
    assert.equal(result.perDay.length, 7);
    assert.equal(result.perDay[0]?.date, '2026-10-25');
  });
});
