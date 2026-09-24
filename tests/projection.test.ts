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
 *   groceries    = 4 projected weekly shops × £90.00 on
 *                  4th/11th/18th/25th = £360.00  (last shop was E1's Tesco
 *                  run on the 27th; every 7 days from there — v0.6.0,
 *                  anchor-reset §7.3)
 *   fuel         = £75.00 on the 12th (A: last fill 12 Sept + 30 days)
 *                  + £60.00 on the 8th (B: last fill 8 Sept + 30 days)
 *                  = £135.00
 *   salary       = £2,150.00 on the 26th
 *   projected_low = −£571.26 on the 25th (the last weekly shop of the
 *   cycle, just before salary lands)
 *   tier         = warning (−571.26 ≤ −250.00)
 *   pot_watch(Main) = £348.88 − £1,014.96 = −£666.08 (day-to-day events
 *   never enter the pot watch, §7.5)
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

/** E8's four weekly shops: the 27th's Tesco run + 7-day cadence, ≤ 26 Oct. */
function e8ProjectedGroceries(): ProjectionScheduleLine[] {
  return ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'].map((date, index) => ({
    scheduleId: 100 + index,
    name: 'Weekly shop (projected)',
    potId: 0,
    amountPence: p(90.0),
    dueDate: date,
  }));
}

/** E8's fills: A on the 12th (last fill 12/9 + 30), B on the 8th (8/9 + 30). */
function e8ProjectedFuel(): ProjectionScheduleLine[] {
  return [
    {
      scheduleId: 200,
      name: 'Fuel — Vehicle A (projected)',
      potId: 0,
      amountPence: p(75.0),
      dueDate: '2026-10-12',
    },
    {
      scheduleId: 201,
      name: 'Fuel — Vehicle B (projected)',
      potId: 0,
      amountPence: p(60.0),
      dueDate: '2026-10-08',
    },
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
    projectedGroceries: e8ProjectedGroceries(),
    projectedFuel: e8ProjectedFuel(),
    warningThresholdPence: p(250.0),
    potWatches: [
      { potId: 1, estimatePence: p(348.88), commitments: e8Commitments() },
      { potId: 2, estimatePence: p(520.0), commitments: [] },
    ],
  });

  it('window length and projected day-to-day event totals', () => {
    assert.equal(result.days, 29);
    assert.equal(result.groceriesPence, p(360.0)); // 4 shops × £90.00
    assert.equal(result.fuelPence, p(135.0)); // £75.00 (A) + £60.00 (B)
    assert.equal(result.dayToDayPence, p(495.0));
  });

  it('totals over commitments and receipts', () => {
    assert.equal(result.totalCommitmentsPence, p(1014.96));
    assert.equal(result.totalReceiptsPence, p(2150.0));
  });

  it('projected low and its date (the last shop of the cycle, before salary)', () => {
    assert.equal(result.projectedLowPence, p(-571.26));
    assert.equal(result.lowDate, '2026-10-25');
  });

  it('two-tier warning: tier 2 (warning) at −£571.26 vs threshold £250.00', () => {
    assert.equal(result.tier, 'warning');
    assert.equal(result.warningThresholdPence, p(250.0));
  });

  it('pot-level transfer watch: Main −£666.08, Salary clean (day-to-day never counts)', () => {
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

  it('where the household lands on payday: available + receipts − commitments − day-to-day', () => {
    const finalDay = result.perDay[result.perDay.length - 1];
    assert.ok(finalDay);
    const handLand =
      result.availableNowPence +
      result.totalReceiptsPence -
      result.totalCommitmentsPence -
      result.dayToDayPence;
    assert.equal(handLand, p(1578.74));
    assert.equal(finalDay.runningPence, handLand);
  });

  it('day-by-day runs match the worked example (outgoings before receipts, events dated)', () => {
    const byDate = new Map(result.perDay.map((day) => [day.date, day]));
    assert.equal(result.perDay.length, 29);
    assert.equal(byDate.get('2026-09-28')?.runningPence, p(938.7 - 84.55));
    assert.equal(byDate.get('2026-10-01')?.runningPence, p(938.7 - 84.55 - 685.0 - 178.42));
    assert.equal(byDate.get('2026-10-03')?.runningPence, p(938.7 - 84.55 - 685.0 - 178.42 - 42.0));
    // The first projected shop lands on the 4th, dated — not on day zero.
    const fourth = byDate.get('2026-10-04');
    assert.equal(fourth?.dayToDayPence, p(90.0));
    assert.equal(fourth?.runningPence, p(938.7 - 84.55 - 685.0 - 178.42 - 42.0 - 90.0));
    // B's fill on the 8th, the mobile on the 10th, A's fill on the 12th.
    assert.equal(byDate.get('2026-10-08')?.dayToDayPence, p(60.0));
    assert.equal(
      byDate.get('2026-10-10')?.runningPence,
      p(938.7 - 84.55 - 685.0 - 178.42 - 42.0 - 90.0 - 60.0 - 24.99),
    );
    assert.equal(byDate.get('2026-10-12')?.dayToDayPence, p(75.0));
    // The cycle's low: the last weekly shop of the window, day before pay.
    const twentyFifth = byDate.get('2026-10-25');
    assert.equal(twentyFifth?.runningPence, p(-571.26));
    const payday = byDate.get('2026-10-26');
    assert.equal(payday?.receiptsPence, p(2150.0));
    assert.equal(payday?.runningPence, p(-571.26 + 2150.0));
  });
});

describe('projection: day-to-day events and edge cases', () => {
  it('no window → projected day-to-day totals are zero, no tier, zero days', () => {
    const result = projectToPayday({
      now: NOW,
      availableNowPence: p(100),
      paydayDate: null,
      commitments: e8Commitments(),
      receipts: [],
      projectedGroceries: e8ProjectedGroceries(),
      projectedFuel: e8ProjectedFuel(),
      warningThresholdPence: p(250),
      potWatches: [],
    });
    assert.equal(result.days, 0);
    assert.equal(result.groceriesPence, 0);
    assert.equal(result.fuelPence, 0);
    assert.equal(result.dayToDayPence, 0);
    assert.equal(result.projectedLowPence, null);
    assert.equal(result.lowDate, null);
    assert.equal(result.tier, 'none');
    assert.equal(result.perDay.length, 0);
  });

  it('no projected events at all → an unconfigured household, day-to-day zero', () => {
    const result = projectToPayday({
      now: NOW,
      availableNowPence: p(100),
      paydayDate: '2026-10-26',
      commitments: [],
      receipts: [],
      projectedGroceries: [],
      projectedFuel: [],
      warningThresholdPence: null,
      potWatches: [],
    });
    assert.equal(result.dayToDayPence, 0);
    assert.equal(
      result.perDay.every((day) => day.dayToDayPence === 0),
      true,
    );
    assert.equal(result.projectedLowPence, p(100)); // nothing dips: low is the start
    assert.equal(result.lowDate, '2026-09-27'); // today — the inclusive start
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
      projectedGroceries: [],
      projectedFuel: [],
      warningThresholdPence: p(250),
      potWatches: [],
    });
    // 1000 − 900 (rent, before salary) = 100 low; end of payday = 600.
    assert.equal(result.projectedLowPence, p(100));
    assert.equal(result.lowDate, '2026-10-26');
    assert.equal(result.perDay.at(-1)?.runningPence, p(600));
    assert.equal(result.tier, 'none');
  });

  it('a projected shop on payday clears before the salary, like any outgoing', () => {
    const result = projectToPayday({
      now: NOW,
      availableNowPence: p(1000),
      paydayDate: '2026-10-26',
      commitments: [],
      receipts: [
        { scheduleId: 2, name: 'Salary', potId: 2, amountPence: p(500), dueDate: '2026-10-26' },
      ],
      projectedGroceries: [
        {
          scheduleId: 10,
          name: 'Weekly shop (projected)',
          potId: 0,
          amountPence: p(90),
          dueDate: '2026-10-26',
        },
      ],
      projectedFuel: [],
      warningThresholdPence: null,
      potWatches: [],
    });
    // 1000 − 90 (the shop leaves the morning of payday) = 910 low.
    assert.equal(result.projectedLowPence, p(910));
    assert.equal(result.lowDate, '2026-10-26');
    assert.equal(result.perDay.at(-1)?.runningPence, p(1000 - 90 + 500));
    assert.equal(result.perDay.at(-1)?.dayToDayPence, p(90));
  });

  it('DST-boundary windows count whole local days (autumn-back 2026-10-25)', () => {
    // Today the 24th, payday the 1st → 7 whole days across the 25th.
    const result = projectToPayday({
      now: new Date('2026-10-24T22:30:00Z'),
      availableNowPence: p(100),
      paydayDate: '2026-10-31',
      commitments: [],
      receipts: [],
      projectedGroceries: [],
      projectedFuel: [],
      warningThresholdPence: null,
      potWatches: [],
    });
    assert.equal(result.days, 7);
    assert.equal(result.perDay.length, 7);
    assert.equal(result.perDay[0]?.date, '2026-10-25');
  });
});
