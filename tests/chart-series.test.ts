import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  commitmentSeries,
  describeForecast,
  forecastSeries,
  groceriesSeries,
  monthlyBuckets,
  personalSpendSeries,
  purchasesHref,
  weeklyBuckets,
  type ChartSpendingLine,
} from '../src/lib/records/chart-series';
import type { SpendingLineInput } from '../src/lib/records/insights';
import type { ProjectionDay } from '../src/lib/records/projection';
import { chartDomain, formatAxisPence, niceStep, yFor } from '../src/components/charts/scale';

/**
 * The chart resolvers and the chart geometry (SPEC §16.7, v0.14.0). No DB
 * and no browser here — these are pure functions over flat typed rows, and
 * the DB assembly is covered by tests/charts-view.test.ts.
 *
 * The awkward cases are the point: an empty series, a single point, a week
 * with nothing in it, an all-negative forecast, a month whose refunds
 * outweigh its spending.
 */

const TODAY = '2026-09-20'; // a Sunday
const MONDAY = '2026-09-14';

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

function commitmentLine(
  partial: Partial<ChartSpendingLine> & Pick<ChartSpendingLine, 'occurredDate' | 'amountPence'>,
): ChartSpendingLine {
  return { ...line(partial), scheduleConverted: false, ...partial };
}

function day(
  date: string,
  runningPence: number,
  extra: Partial<ProjectionDay> = {},
): ProjectionDay {
  return {
    date,
    receiptsPence: 0,
    commitmentsPence: 0,
    dayToDayPence: 0,
    runningPence,
    ...extra,
  };
}

describe('chart series: forecast (A)', () => {
  it('starts at the reported balance and then follows the projection day by day', () => {
    const series = forecastSeries({
      today: TODAY,
      availableNowPence: 50000,
      perDay: [
        day('2026-09-21', 42000, { commitmentsPence: 8000 }),
        day('2026-09-22', 41000, { dayToDayPence: 1000 }),
        day('2026-09-23', 141000, { receiptsPence: 100000 }),
      ],
    });
    assert.equal(series.days.length, 4);
    assert.equal(series.days[0]?.date, TODAY);
    assert.equal(series.days[0]?.reported, true);
    assert.equal(
      series.days.slice(1).every((entry) => !entry.reported),
      true,
    );
    assert.equal(series.startPence, 50000);
    assert.equal(series.endPence, 141000);
    assert.equal(series.throughDate, '2026-09-23');
    assert.equal(series.lowPence, 41000);
    assert.equal(series.lowDate, '2026-09-22');
    assert.equal(series.highPence, 141000);
    assert.deepEqual(series.incomeDates, ['2026-09-23']);
  });

  it('reports a negative low as "below zero", never clipped at zero', () => {
    const series = forecastSeries({
      today: TODAY,
      availableNowPence: 12000,
      perDay: [day('2026-09-21', -3450, { commitmentsPence: 15450 })],
    });
    assert.equal(series.lowPence, -3450);
    assert.equal(series.belowZeroDate, '2026-09-21');
    assert.match(series.headline, /£34\.50 below zero on Mon 21 Sep/);
  });

  it('separates "overdrawn inside the limit" from "past the limit"', () => {
    const inside = forecastSeries({
      today: TODAY,
      availableNowPence: 1000,
      perDay: [day('2026-09-21', -20000, { commitmentsPence: 21000 })],
      overdraftLimitPence: 80000,
    });
    assert.equal(inside.belowZeroDate, '2026-09-21');
    assert.equal(inside.belowOverdraftDate, null);
    assert.doesNotMatch(inside.headline, /overdraft/);

    const past = forecastSeries({
      today: TODAY,
      availableNowPence: 1000,
      perDay: [
        day('2026-09-21', -20000, { commitmentsPence: 21000 }),
        day('2026-09-22', -90000, { commitmentsPence: 70000 }),
      ],
      overdraftLimitPence: 80000,
    });
    assert.equal(past.belowOverdraftDate, '2026-09-22');
    assert.match(past.headline, /past the £800\.00 overdraft limit from Tue 22 Sep/);
  });

  it('flags the warning threshold and ranks the three biggest outgoing days', () => {
    const series = forecastSeries({
      today: TODAY,
      availableNowPence: 100000,
      perDay: [
        day('2026-09-21', 95000, { commitmentsPence: 5000 }),
        day('2026-09-22', 75000, { commitmentsPence: 20000 }),
        day('2026-09-23', 65000, { dayToDayPence: 10000 }),
        day('2026-09-24', 20000, { commitmentsPence: 40000, dayToDayPence: 5000 }),
      ],
      warningThresholdPence: 25000,
    });
    assert.equal(series.belowThresholdDate, '2026-09-24');
    assert.deepEqual(
      series.dips.map((dip) => dip.date),
      ['2026-09-24', '2026-09-22', '2026-09-23'],
    );
    assert.equal(series.dips[0]?.amountPence, 45000);
  });

  it('survives a horizon with no days at all', () => {
    const series = forecastSeries({ today: TODAY, availableNowPence: 7300, perDay: [] });
    assert.equal(series.days.length, 1);
    assert.equal(series.lowDate, TODAY);
    assert.equal(series.endPence, 7300);
    assert.match(describeForecast(series), /stay at or above today's £73\.00/);
  });
});

describe('chart series: weekly buckets and groceries (B)', () => {
  it('buckets Monday to Sunday and keeps empty weeks as zero weeks', () => {
    const weeks = weeklyBuckets(
      [
        line({ occurredDate: MONDAY, amountPence: 4000 }),
        line({ occurredDate: '2026-09-20', amountPence: 1000 }), // Sunday, same week
        line({ occurredDate: '2026-09-13', amountPence: 2500 }), // previous week's Sunday
      ],
      { today: TODAY, weeks: 4 },
    );
    assert.deepEqual(
      weeks.map((week) => [week.weekStart, week.weekEnd, week.amountPence, week.complete]),
      [
        ['2026-08-24', '2026-08-30', 0, true],
        ['2026-08-31', '2026-09-06', 0, true],
        ['2026-09-07', '2026-09-13', 2500, true],
        ['2026-09-14', '2026-09-20', 5000, false],
      ],
    );
  });

  it('ignores anything outside the window and never invents a bucket', () => {
    const weeks = weeklyBuckets([line({ occurredDate: '2026-01-05', amountPence: 9999 })], {
      today: TODAY,
      weeks: 3,
    });
    assert.equal(weeks.length, 3);
    assert.equal(
      weeks.reduce((sum, week) => sum + week.amountPence, 0),
      0,
    );
  });

  it('averages complete weeks only — the week being lived never counts', () => {
    const lines = [
      line({ occurredDate: '2026-08-31', amountPence: 8000 }),
      line({ occurredDate: '2026-09-07', amountPence: 10000 }),
      // This week, in progress and enormous: it must not move the average.
      line({ occurredDate: '2026-09-14', amountPence: 100000 }),
    ];
    const series = groceriesSeries(lines, {
      today: TODAY,
      weeks: 4,
      configuredWeeklyPence: 7500,
      averageWeeks: 3,
    });
    assert.equal(series.averageWeeks, 3);
    assert.equal(series.averagePence, 6000); // (0 + 8000 + 10000) / 3
    assert.equal(series.driftPence, -1500);
    assert.match(series.headline, /£60\.00 a week over the last 3 complete weeks/);
    assert.match(series.headline, /£15\.00 a week under the £75\.00 configured/);
  });

  it('says so plainly when nothing is configured, and when nothing is recorded', () => {
    const configured = groceriesSeries([line({ occurredDate: '2026-09-07', amountPence: 8000 })], {
      today: TODAY,
      weeks: 4,
      configuredWeeklyPence: null,
    });
    assert.equal(configured.driftPence, null);
    assert.match(configured.headline, /No weekly grocery figure is configured yet/);

    const nothing = groceriesSeries([], {
      today: TODAY,
      weeks: 1,
      configuredWeeklyPence: 7500,
    });
    assert.equal(nothing.averageWeeks, 0);
    assert.match(nothing.headline, /No complete week of shopping recorded yet/);
  });

  it('nets refunds off the week they land in', () => {
    const series = groceriesSeries(
      [
        line({ occurredDate: '2026-09-07', amountPence: 9000 }),
        line({ occurredDate: '2026-09-09', amountPence: -1500 }),
      ],
      { today: TODAY, weeks: 2, configuredWeeklyPence: null },
    );
    assert.equal(series.weeks[0]?.amountPence, 7500);
  });
});

describe('chart series: monthly buckets', () => {
  it('ends with the in-progress month and keeps quiet months at zero', () => {
    const months = monthlyBuckets(
      [
        line({ occurredDate: '2026-07-15', amountPence: 1000 }),
        line({ occurredDate: '2026-09-02', amountPence: 2000 }),
      ],
      { today: TODAY, months: 3 },
    );
    assert.deepEqual(
      months.map((month) => [month.label, month.amountPence, month.complete]),
      [
        ['July 2026', 1000, true],
        ['August 2026', 0, true],
        ['September 2026', 2000, false],
      ],
    );
    assert.equal(months[2]?.from, '2026-09-01');
    assert.equal(months[2]?.to, '2026-09-30');
  });
});

describe('chart series: personal spending (C)', () => {
  const people = [
    { id: 1, label: 'Alex' },
    { id: 2, label: 'Sam' },
  ];
  const parentNames = ['Personal', 'Entertainment & Eating Out'];
  const lines = [
    line({
      occurredDate: '2026-09-03',
      amountPence: 4500,
      parentName: 'Personal',
      childName: 'Clothing & Shoes',
      targetKind: 'person',
      targetId: 1,
    }),
    line({
      occurredDate: '2026-09-05',
      amountPence: 2000,
      parentName: 'Personal',
      childName: 'Hobbies',
      targetKind: 'person',
      targetId: 2,
    }),
    line({
      occurredDate: '2026-09-06',
      amountPence: 3000,
      parentName: 'Entertainment & Eating Out',
      childName: 'Dining Out & Takeaways',
      targetKind: 'household',
    }),
    // Out of scope: groceries are not discretionary personal spending…
    line({
      occurredDate: '2026-09-07',
      amountPence: 8000,
      parentName: 'Groceries',
      childName: 'Weekly Shop',
      targetKind: 'person',
      targetId: 1,
    }),
    // …and a vehicle-targeted line belongs to the vehicle.
    line({
      occurredDate: '2026-09-08',
      amountPence: 1200,
      parentName: 'Personal',
      childName: 'Hobbies',
      targetKind: 'vehicle',
      targetId: 9,
    }),
  ];

  it('attributes by "For: person" and keeps household spending as its own series', () => {
    const series = personalSpendSeries(lines, people, { today: TODAY, months: 1, parentNames });
    assert.deepEqual(
      series.series.map((ref) => ref.key),
      ['person:1', 'person:2', 'household'],
    );
    assert.deepEqual(
      series.totals.map((total) => total.amountPence),
      [4500, 2000, 3000],
    );
    assert.equal(series.months[0]?.totalPence, 9500);
    assert.match(series.headline, /Alex £45\.00, Sam £20\.00, Household £30\.00/);
  });

  it('never splits a household line between the two people', () => {
    const series = personalSpendSeries(lines, people, { today: TODAY, months: 1, parentNames });
    const household = series.totals.find((total) => total.key === 'household');
    assert.equal(household?.amountPence, 3000);
    assert.deepEqual(household?.children, [
      { child: 'Entertainment & Eating Out / Dining Out & Takeaways', amountPence: 3000 },
    ]);
  });

  it('takes its scope from the parents given, so a new child is in scope at once', () => {
    const withNewChild = [
      ...lines,
      line({
        occurredDate: '2026-09-09',
        amountPence: 999,
        parentName: 'Personal',
        childName: 'Book Club',
        targetKind: 'person',
        targetId: 1,
      }),
      // Subscriptions & Streaming, marked for the household as agreed.
      line({
        occurredDate: '2026-09-10',
        amountPence: 1499,
        parentName: 'Entertainment & Eating Out',
        childName: 'Subscriptions & Streaming',
        targetKind: 'household',
      }),
    ];
    const series = personalSpendSeries(withNewChild, people, {
      today: TODAY,
      months: 1,
      parentNames,
    });
    assert.equal(series.totals[0]?.amountPence, 4500 + 999);
    assert.equal(series.totals[2]?.amountPence, 3000 + 1499);
  });

  it('honours the filter chips, headline and totals included', () => {
    const series = personalSpendSeries(lines, people, {
      today: TODAY,
      months: 1,
      parentNames,
      include: ['person:2'],
    });
    assert.deepEqual(
      series.series.map((ref) => ref.label),
      ['Sam'],
    );
    assert.equal(series.months[0]?.totalPence, 2000);
    assert.match(series.headline, /^Over 1 month: Sam £20\.00\.$/);
  });

  it('lists a person with nothing spent as an honest zero', () => {
    const series = personalSpendSeries([], people, { today: TODAY, months: 2, parentNames });
    assert.equal(series.series.length, 3);
    assert.deepEqual(
      series.totals.map((total) => total.amountPence),
      [0, 0, 0],
    );
  });
});

describe('chart series: fixed commitments (D)', () => {
  const tracked = [10, 11];
  const lines = [
    commitmentLine({
      occurredDate: '2026-06-04',
      amountPence: 5000,
      categoryId: 10,
      parentName: 'Utilities',
      childName: 'Energy',
      scheduleConverted: true,
    }),
    commitmentLine({
      occurredDate: '2026-07-04',
      amountPence: 4800,
      categoryId: 10,
      parentName: 'Utilities',
      childName: 'Energy',
      scheduleConverted: true,
    }),
    commitmentLine({
      occurredDate: '2026-08-04',
      amountPence: 4600,
      categoryId: 10,
      parentName: 'Utilities',
      childName: 'Energy',
      scheduleConverted: true,
    }),
    // Same month, same tracked set, but typed in by hand.
    commitmentLine({
      occurredDate: '2026-08-12',
      amountPence: 1200,
      categoryId: 11,
      parentName: 'Vehicle Running',
      childName: 'Insurance',
      scheduleConverted: false,
    }),
    // Untracked: the household left Fuel unticked on purpose.
    commitmentLine({
      occurredDate: '2026-08-15',
      amountPence: 6000,
      categoryId: 12,
      parentName: 'Vehicle Running',
      childName: 'Fuel',
      scheduleConverted: false,
    }),
  ];

  it('counts only the tracked child categories', () => {
    const series = commitmentSeries(lines, {
      today: TODAY,
      months: 4,
      trackedCategoryIds: tracked,
    });
    assert.deepEqual(
      series.months.map((month) => [month.label, month.amountPence]),
      [
        ['June 2026', 5000],
        ['July 2026', 4800],
        ['August 2026', 5800],
        ['September 2026', 0],
      ],
    );
    assert.deepEqual(
      series.byCategory.map((entry) => [entry.child, entry.amountPence]),
      [
        ['Energy', 14400],
        ['Insurance', 1200],
      ],
    );
  });

  it('narrows to schedule-converted purchases when the toggle is on', () => {
    const series = commitmentSeries(lines, {
      today: TODAY,
      months: 4,
      trackedCategoryIds: tracked,
      scheduleOnly: true,
    });
    assert.equal(series.months[2]?.amountPence, 4600);
    assert.match(series.headline, /schedule-converted only/);
  });

  it('compares the latest complete month with three complete months earlier', () => {
    const series = commitmentSeries(lines, {
      today: TODAY,
      months: 5,
      trackedCategoryIds: tracked,
    });
    assert.equal(series.latestCompleteLabel, 'August 2026');
    assert.equal(series.comparedLabel, 'May 2026');
    assert.equal(series.comparedPence, 0);
    assert.equal(series.deltaPence, 5800);
    assert.match(series.headline, /up £58\.00 on May 2026/);
  });

  it('says what to do when nothing is tracked yet', () => {
    const series = commitmentSeries(lines, {
      today: TODAY,
      months: 4,
      trackedCategoryIds: [],
    });
    assert.equal(
      series.months.every((month) => month.amountPence === 0),
      true,
    );
    assert.match(series.headline, /No categories are tracked.*Settings/);
  });
});

describe('chart drill-down links', () => {
  it('builds a /purchases URL the review page already understands', () => {
    assert.equal(
      purchasesHref({ from: '2026-09-08', to: '2026-09-14', categoryIds: [3] }),
      '/purchases?from=2026-09-08&to=2026-09-14&categoryId=3',
    );
    assert.equal(
      purchasesHref({
        from: '2026-07-01',
        to: '2026-07-31',
        categoryIds: [6, 7],
        targetKind: 'person',
        targetId: 2,
      }),
      '/purchases?from=2026-07-01&to=2026-07-31&categoryId=6&categoryId=7&targetKind=person&targetId=2',
    );
    assert.equal(
      purchasesHref({ from: '2026-07-01', to: '2026-07-31', categoryIds: [9], scheduleOnly: true }),
      '/purchases?from=2026-07-01&to=2026-07-31&categoryId=9&scheduleOnly=1',
    );
    assert.equal(purchasesHref({}), '/purchases');
  });
});

describe('chart geometry', () => {
  it('always includes zero, so no chart of money floats off the baseline', () => {
    const domain = chartDomain([120000, 125000, 123000]);
    assert.equal(domain.min, 0);
    assert.equal(domain.ticks.includes(0), true);
    assert.equal(domain.max >= 125000, true);
  });

  it('gives the below-zero half real room instead of a sliver', () => {
    const domain = chartDomain([100000, 50000, -2000]);
    const share = (0 - domain.min) / (domain.max - domain.min);
    assert.equal(share >= 0.15, true, `sub-zero share was ${share}`);
    assert.equal(domain.ticks.includes(0), true);
  });

  it('handles an all-negative series and a single point', () => {
    const negative = chartDomain([-5000, -12000]);
    assert.equal(negative.min <= -12000, true);
    assert.equal(negative.max >= 0, true);

    const single = chartDomain([4200]);
    assert.equal(single.min, 0);
    assert.equal(single.max > 4200, true);

    const empty = chartDomain([]);
    assert.equal(empty.min, 0);
    assert.equal(empty.max > 0, true);
    assert.equal(empty.ticks.length >= 2, true);
  });

  it('places values inside the plot box, top to bottom', () => {
    const domain = chartDomain([0, 10000]);
    const plot = { left: 40, top: 10, width: 200, height: 100 };
    const bottom = yFor(domain.min, domain, plot);
    const top = yFor(domain.max, domain, plot);
    assert.equal(bottom, 110);
    assert.equal(top, 10);
    assert.equal(yFor(999999, domain, plot), top, 'values above the domain clamp to the top');
  });

  it('rounds steps and axis labels to figures a person can read', () => {
    assert.equal(niceStep(230), 250);
    assert.equal(niceStep(1100), 2000);
    assert.equal(niceStep(0), 1);
    assert.equal(formatAxisPence(0), '£0');
    assert.equal(formatAxisPence(8500), '£85');
    assert.equal(formatAxisPence(-250000), '-£2.5k');
    assert.equal(formatAxisPence(123456), '£1.2k');
  });
});
