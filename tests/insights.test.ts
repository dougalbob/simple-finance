import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GROCERIES_PARENT,
  FUEL_CHILD,
  compareCalendarMonths,
  computeHonestyLoop,
  personalSpending,
  startOfWeekLocal,
  summarizeSpending,
  vehicleRunningCosts,
  type SpendingLineInput,
} from '../src/lib/records/insights';

/**
 * Insights v1 pure engine (docs/SPEC.md §16, decision 63–67). No DB here —
 * the engine eats flat typed rows; the DB assembly is covered in
 * tests/insights-view.test.ts. All money is integer pence.
 */

function line(
  partial: Partial<SpendingLineInput> & Pick<SpendingLineInput, 'occurredDate' | 'amountPence'>,
): SpendingLineInput {
  return {
    categoryId: 1,
    parentName: 'Other',
    childName: 'Other',
    targetKind: 'household',
    targetId: null,
    ...partial,
  };
}

describe('insights: month comparison (panel 1)', () => {
  const lines: SpendingLineInput[] = [
    line({
      occurredDate: '2026-08-01',
      amountPence: 10000,
      parentName: 'Housing',
      childName: 'Council Tax',
    }),
    line({
      occurredDate: '2026-08-31',
      amountPence: 500,
      parentName: 'Groceries',
      childName: 'Weekly Shop',
    }),
    line({
      occurredDate: '2026-09-01',
      amountPence: 9000,
      parentName: 'Groceries',
      childName: 'Weekly Shop',
    }),
    line({
      occurredDate: '2026-09-20',
      amountPence: 2149,
      parentName: 'Personal',
      childName: 'Clothing',
    }),
    // A refund that nets against September groceries.
    line({
      occurredDate: '2026-09-18',
      amountPence: -500,
      parentName: 'Groceries',
      childName: 'Weekly Shop',
    }),
    // Outside both months — must be ignored.
    line({
      occurredDate: '2026-07-31',
      amountPence: 77777,
      parentName: 'Other',
      childName: 'Other',
    }),
  ];

  it('splits lines into full calendar months on local-date boundaries', () => {
    const view = compareCalendarMonths(lines, '2026-09-20');
    assert.equal(view.previous.summary.totalPence, 10500); // 1st + 31st August
    assert.equal(view.current.summary.totalPence, 10649); // 9000 + 2149 − 500
    assert.equal(view.totalDeltaPence, 10649 - 10500);
    const groceries = view.current.summary.byParent.find((entry) => entry.parent === 'Groceries');
    assert.equal(groceries?.amountPence, 8500); // refund netted
  });

  it('flags the in-progress current month and reports deltas per parent', () => {
    const midMonth = compareCalendarMonths(lines, '2026-09-20');
    assert.equal(midMonth.currentInProgress, true);
    const delta = midMonth.byParent.find((row) => row.parent === 'Housing');
    assert.deepEqual(
      { current: delta?.currentPence, previous: delta?.previousPence, delta: delta?.deltaPence },
      { current: 0, previous: 10000, delta: -10000 },
    );
    // On the last day of the month the current month is complete.
    const monthEnd = compareCalendarMonths(lines, '2026-09-30');
    assert.equal(monthEnd.currentInProgress, false);
  });

  it('keeps month ranges inclusive and DST-adjacent (UK spring-forward boundary)', () => {
    const linesDST: SpendingLineInput[] = [
      line({
        occurredDate: '2026-03-28',
        amountPence: 111,
        parentName: 'Groceries',
        childName: 'Weekly Shop',
      }),
      line({
        occurredDate: '2026-03-29',
        amountPence: 222,
        parentName: 'Groceries',
        childName: 'Weekly Shop',
      }),
      line({
        occurredDate: '2026-03-31',
        amountPence: 333,
        parentName: 'Groceries',
        childName: 'Weekly Shop',
      }),
      line({
        occurredDate: '2026-04-01',
        amountPence: 444,
        parentName: 'Groceries',
        childName: 'Weekly Shop',
      }),
    ];
    const view = compareCalendarMonths(linesDST, '2026-04-01');
    // March is previous (complete), April is current (in progress, 1 day in).
    assert.equal(view.previous.summary.totalPence, 111 + 222 + 333);
    assert.equal(view.current.summary.totalPence, 444);
    assert.equal(view.currentInProgress, true);
  });
});

describe('insights: personal spending (panel 2)', () => {
  const people = [
    { id: 1, label: 'Alex' },
    { id: 2, label: 'Sam' },
  ];
  const lines: SpendingLineInput[] = [
    line({
      occurredDate: '2026-09-05',
      amountPence: 2000,
      parentName: 'Personal',
      childName: 'Clothing',
      targetKind: 'person',
      targetId: 2,
    }),
    line({
      occurredDate: '2026-09-06',
      amountPence: 1500,
      parentName: 'Personal',
      childName: 'Hobbies',
      targetKind: 'person',
      targetId: 2,
    }),
    line({
      occurredDate: '2026-09-07',
      amountPence: 9000,
      parentName: 'Groceries',
      childName: 'Weekly Shop',
      // Household lines are NEVER attributed to the payer (decision 65).
    }),
    line({
      occurredDate: '2026-08-01',
      amountPence: 9999,
      parentName: 'Personal',
      childName: 'Clothing',
      targetKind: 'person',
      targetId: 1,
    }),
    line({
      occurredDate: '2026-09-08',
      amountPence: 4000,
      parentName: 'Vehicle Running',
      childName: 'Fuel',
      targetKind: 'vehicle',
      targetId: 7,
    }),
  ];

  it('attributes only explicit person lines within the window', () => {
    const result = personalSpending(lines, people, '2026-09-01', '2026-09-30');
    const alex = result.find((row) => row.personId === 1);
    const sam = result.find((row) => row.personId === 2);
    assert.equal(alex?.totalPence, 0); // August line is outside the window
    assert.equal(sam?.totalPence, 3500);
    assert.equal(sam?.byParent[0]?.parent, 'Personal');
    assert.equal(sam?.byParent[0]?.amountPence, 3500);
  });

  it('lists every person, including zero-activity ones', () => {
    const result = personalSpending([], people, '2026-09-01', '2026-09-30');
    assert.deepEqual(
      result.map((row) => row.person),
      ['Alex', 'Sam'],
    );
    assert.ok(result.every((row) => row.totalPence === 0));
  });
});

describe('insights: vehicle running costs (panel 3)', () => {
  const vehicles = [
    { id: 1, label: 'Vehicle A' },
    { id: 2, label: 'Vehicle B' },
  ];

  it('computes current month, previous month and the rolling 12-month window', () => {
    const today = '2026-09-20';
    const lines: SpendingLineInput[] = [
      line({
        occurredDate: '2026-09-05',
        amountPence: 5820,
        parentName: 'Vehicle Running',
        childName: FUEL_CHILD,
        targetKind: 'vehicle',
        targetId: 1,
      }),
      line({
        occurredDate: '2026-08-15',
        amountPence: 4000,
        parentName: 'Vehicle Running',
        childName: FUEL_CHILD,
        targetKind: 'vehicle',
        targetId: 1,
      }),
      // First day of the rolling window — included.
      line({
        occurredDate: '2025-10-01',
        amountPence: 1200,
        parentName: 'Vehicle Running',
        childName: 'Insurance',
        targetKind: 'vehicle',
        targetId: 1,
      }),
      // One day before the rolling window — excluded.
      line({
        occurredDate: '2025-09-30',
        amountPence: 80000,
        parentName: 'Vehicle Running',
        childName: 'Insurance',
        targetKind: 'vehicle',
        targetId: 1,
      }),
      // Someone else's vehicle.
      line({
        occurredDate: '2026-09-01',
        amountPence: 6000,
        parentName: 'Vehicle Running',
        childName: FUEL_CHILD,
        targetKind: 'vehicle',
        targetId: 2,
      }),
      // Household-targeted vehicle-adjacent spending is not a running cost.
      line({
        occurredDate: '2026-09-01',
        amountPence: 7000,
        parentName: 'Vehicle Running',
        childName: 'Fuel',
      }),
    ];
    const result = vehicleRunningCosts(lines, vehicles, today);
    const a = result.find((row) => row.vehicleId === 1);
    const b = result.find((row) => row.vehicleId === 2);
    assert.equal(a?.rolling12From, '2025-10-01');
    assert.equal(a?.monthPence, 5820);
    assert.equal(a?.previousMonthPence, 4000);
    assert.equal(a?.rolling12Pence, 5820 + 4000 + 1200);
    const insurance = a?.byChild.find((row) => row.child === 'Insurance');
    assert.equal(insurance?.amountPence, 1200);
    assert.equal(b?.monthPence, 6000);
    assert.equal(b?.rolling12Pence, 6000);
  });

  it('reports zero for vehicles with no lines, and spans year boundaries (DST + year edge)', () => {
    const lines: SpendingLineInput[] = [
      line({
        occurredDate: '2025-12-31',
        amountPence: 100,
        parentName: 'Vehicle Running',
        childName: FUEL_CHILD,
        targetKind: 'vehicle',
        targetId: 1,
      }),
    ];
    // 2026-01-05: current month January 2026, previous December 2025,
    // rolling window starts 2025-02-01.
    const result = vehicleRunningCosts(lines, vehicles, '2026-01-05');
    const a = result.find((row) => row.vehicleId === 1);
    assert.equal(a?.rolling12From, '2025-02-01');
    assert.equal(a?.monthPence, 0);
    assert.equal(a?.previousMonthPence, 100);
    assert.equal(a?.rolling12Pence, 100);
    const b = result.find((row) => row.vehicleId === 2);
    assert.equal(b?.rolling12Pence, 0);
  });
});

describe('insights: honesty loop (panel 4)', () => {
  it('uses only complete Monday–Sunday weeks, even across the UK spring-forward', () => {
    // 2026-03-29 is the last Sunday of March — the clocks go forward on it.
    const today = '2026-03-29';
    assert.equal(startOfWeekLocal(today), '2026-03-23'); // this (incomplete) week's Monday
    const lines: SpendingLineInput[] = [
      // Inside the last COMPLETE week (ends 2026-03-22).
      line({
        occurredDate: '2026-03-16',
        amountPence: 9500,
        parentName: GROCERIES_PARENT,
        childName: 'Weekly Shop',
      }),
      // Inside the INCOMPLETE current week (2026-03-23 → 2026-03-29) — excluded.
      line({
        occurredDate: '2026-03-25',
        amountPence: 12345,
        parentName: GROCERIES_PARENT,
        childName: 'Weekly Shop',
      }),
      // Before the 8-week window (window starts 2026-01-26) — excluded.
      line({
        occurredDate: '2026-01-25',
        amountPence: 77777,
        parentName: GROCERIES_PARENT,
        childName: 'Weekly Shop',
      }),
      // A refund in the window nets off.
      line({
        occurredDate: '2026-03-18',
        amountPence: -500,
        parentName: GROCERIES_PARENT,
        childName: 'Weekly Shop',
      }),
    ];
    const loop = computeHonestyLoop(
      lines,
      { weeklyGroceriesPence: 9000, monthlyFuelPence: [] },
      today,
    );
    assert.equal(loop.groceries.weeks.length, 8);
    assert.equal(loop.groceries.weeks[loop.groceries.weeks.length - 1]?.weekStart, '2026-03-16');
    assert.equal(loop.groceries.weeks[loop.groceries.weeks.length - 1]?.actualPence, 9000); // 9500 − 500
    // Only one of the eight weeks has activity: 9000 / 8 = 1125 exactly.
    assert.equal(loop.groceries.averageWeeklyPence, 1125);
    assert.equal(loop.groceries.driftPence, 1125 - 9000); // running ~£8k under config
  });

  it('rounds weekly averages half-up and leaves drift null when unconfigured', () => {
    // 2026-09-10 sits in the complete week of 2026-09-07 (today's week,
    // 2026-09-14 → 2026-09-20, is excluded by the engine).
    const lines: SpendingLineInput[] = [
      line({
        occurredDate: '2026-09-10',
        amountPence: 9500,
        parentName: GROCERIES_PARENT,
        childName: 'Weekly Shop',
      }),
    ];
    const loop = computeHonestyLoop(
      lines,
      { weeklyGroceriesPence: null, monthlyFuelPence: [] },
      '2026-09-20',
    );
    // 9500 / 8 = 1187.5 → half-up 1188.
    assert.equal(loop.groceries.averageWeeklyPence, 1188);
    assert.equal(loop.groceries.driftPence, null);
  });

  it('uses the last three COMPLETE calendar months for fuel per vehicle', () => {
    const today = '2026-09-20';
    const lines: SpendingLineInput[] = [
      line({
        occurredDate: '2026-06-10',
        amountPence: 1000,
        parentName: 'Vehicle Running',
        childName: FUEL_CHILD,
        targetKind: 'vehicle',
        targetId: 1,
      }),
      line({
        occurredDate: '2026-07-10',
        amountPence: 2000,
        parentName: 'Vehicle Running',
        childName: FUEL_CHILD,
        targetKind: 'vehicle',
        targetId: 1,
      }),
      line({
        occurredDate: '2026-08-10',
        amountPence: 4000,
        parentName: 'Vehicle Running',
        childName: FUEL_CHILD,
        targetKind: 'vehicle',
        targetId: 1,
      }),
      // The partial current month (September) must NOT enter the average.
      line({
        occurredDate: '2026-09-15',
        amountPence: 88888,
        parentName: 'Vehicle Running',
        childName: FUEL_CHILD,
        targetKind: 'vehicle',
        targetId: 1,
      }),
    ];
    const loop = computeHonestyLoop(
      lines,
      {
        weeklyGroceriesPence: null,
        monthlyFuelPence: [
          { vehicleId: 1, label: 'Vehicle A', configuredPence: 3000 },
          { vehicleId: 2, label: 'Vehicle B', configuredPence: null },
        ],
      },
      today,
    );
    const a = loop.fuel.find((row) => row.vehicleId === 1);
    assert.deepEqual(
      a?.months.map((month) => month.month),
      ['2026-06', '2026-07', '2026-08'],
    );
    // (1000 + 2000 + 4000) / 3 = 2333.33 → half-up 2333.
    assert.equal(a?.averageMonthlyPence, 2333);
    assert.equal(a?.driftPence, 2333 - 3000);
    const b = loop.fuel.find((row) => row.vehicleId === 2);
    assert.equal(b?.averageMonthlyPence, 0);
    assert.equal(b?.driftPence, null);
  });
});

describe('insights: summarizeSpending window math', () => {
  it('is inclusive at both ends', () => {
    const lines: SpendingLineInput[] = [
      line({ occurredDate: '2026-09-01', amountPence: 100 }),
      line({ occurredDate: '2026-09-15', amountPence: 200 }),
      line({ occurredDate: '2026-09-30', amountPence: 300 }),
      line({ occurredDate: '2026-08-31', amountPence: 11111 }),
    ];
    const summary = summarizeSpending(lines, '2026-09-01', '2026-09-30');
    assert.equal(summary.totalPence, 600);
  });
});
