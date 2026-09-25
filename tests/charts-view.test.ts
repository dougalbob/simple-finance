import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import {
  createPurchase,
  createRefund,
  listPurchases,
  voidPurchase,
} from '../src/lib/records/purchases';
import { createTransfer } from '../src/lib/records/transfers';
import { createSchedule } from '../src/lib/records/schedules';
import { addCheckpoint } from '../src/lib/records/pots';
import {
  PERSONAL_PARENTS,
  chartSpendingLines,
  effectiveCommitmentCategoryIds,
  getCommitmentCategoryPicker,
  getCommitmentChartView,
  getForecastChartView,
  getGroceriesChartView,
  getPersonalChartView,
  scheduleCommitmentCategoryIds,
} from '../src/lib/records/charts-view';
import { getHorizonProjectionView } from '../src/lib/records/money-view';
import {
  InvalidSettingValueError,
  setCommitmentCategoryIds,
  setWeeklyGroceriesPence,
} from '../src/lib/records/settings';
import { addDaysLocal, addMonthsClamped } from '../src/lib/records/dates';
import { firstOfLocalMonth, startOfWeekLocal } from '../src/lib/records/insights';
import { categories } from '../src/lib/db/schema';
import type { Db } from '../src/lib/db/client';

/**
 * Charts (SPEC §16.7, v0.14.0) reconciled with the purchase history. Same
 * contract as tests/insights-view.test.ts: every figure a chart draws is
 * cross-checked against an INDEPENDENT sum over listPurchases — the rows the
 * review page shows — so a chart that disagrees with the history it claims
 * to summarise cannot ship. Transfers, voids and refunds are asserted too.
 */

const NOW = new Date('2026-09-20T17:00:00Z');
const TODAY = '2026-09-20'; // a Sunday
const ACTOR = 'alex@example.com';

function parentNames(db: Db): Map<number, string> {
  const all = db.select().from(categories).all();
  const byId = new Map(all.map((row) => [row.id, row]));
  const parentOf = new Map<number, string>();
  for (const row of all) {
    if (row.parentId === null) continue;
    const parent = byId.get(row.parentId);
    if (parent !== undefined) parentOf.set(row.id, parent.name);
  }
  return parentOf;
}

/** Independent line-level sum straight from the review rows. */
function lineTotalPence(
  db: Db,
  from: string,
  to: string,
  keep: (line: {
    categoryId: number;
    amountPence: number;
    targetKind: string;
    targetId: number | null;
  }) => boolean,
): number {
  return listPurchases(db, { dateFrom: from, dateTo: to })
    .flatMap((row) => row.allocations)
    .filter((line) => keep(line))
    .reduce((sum, line) => sum + line.amountPence, 0);
}

function seedHistory(fixture: HouseholdFixture) {
  const { db, pots, people, vehicles } = fixture;
  const weeklyShop = fixture.categoryId('Groceries', 'Weekly Shop');
  const topUp = fixture.categoryId('Groceries', 'Top-up Shops');
  const clothing = fixture.categoryId('Personal', 'Clothing & Shoes');
  const hobbies = fixture.categoryId('Personal', 'Hobbies');
  const dining = fixture.categoryId('Entertainment & Eating Out', 'Dining Out & Takeaways');
  const subscriptions = fixture.categoryId(
    'Entertainment & Eating Out',
    'Subscriptions & Streaming',
  );
  const fuel = fixture.categoryId('Vehicle Running', 'Fuel');
  const energy = fixture.categoryId('Utilities', 'Energy');

  const buy = (
    occurredDate: string,
    amountPence: number,
    categoryId: number,
    target: { kind: 'household' | 'person' | 'vehicle'; id?: number } = { kind: 'household' },
  ) =>
    createPurchase(db, {
      potId: pots.main.id,
      totalPence: amountPence,
      paidByPersonId: people.alex.id,
      occurredDate,
      lines: [
        {
          amountPence,
          categoryId,
          targetKind: target.kind,
          ...(target.id === undefined ? {} : { targetId: target.id }),
        },
      ],
      actor: ACTOR,
      now: NOW,
    });

  // Groceries: five weeks back, with one week deliberately EMPTY (the week
  // of 31 Aug) — a week with no shop is a zero week, not a missing one.
  buy('2026-08-25', 8200, weeklyShop); // week of Mon 24 Aug
  buy('2026-08-27', 1150, topUp); // same week
  // (no groceries at all in the week of Mon 31 Aug)
  buy('2026-09-08', 9100, weeklyShop); // week of Mon 7 Sep
  buy('2026-09-15', 8800, weeklyShop); // week of Mon 14 Sep — in progress
  const returned = buy('2026-09-16', 1200, weeklyShop);
  createRefund(db, {
    refundOfPurchaseId: returned.purchase.id,
    totalPence: -1200,
    lines: [{ amountPence: -1200, categoryId: weeklyShop, targetKind: 'household' }],
    actor: ACTOR,
    now: NOW,
  });

  // Personal spending, "For: person", across three calendar months.
  buy('2026-07-12', 4500, clothing, { kind: 'person', id: people.alex.id });
  buy('2026-08-03', 2600, hobbies, { kind: 'person', id: people.alex.id });
  buy('2026-08-19', 3150, clothing, { kind: 'person', id: people.sam.id });
  buy('2026-09-06', 1975, hobbies, { kind: 'person', id: people.sam.id });
  // Shared, and never split between the two.
  buy('2026-09-07', 4200, dining);
  buy('2026-09-09', 1499, subscriptions);
  // Out of scope for the personal chart: a vehicle line and a fuel line.
  buy('2026-09-10', 6000, fuel, { kind: 'vehicle', id: vehicles.vehicleA.id });
  // A hand-typed energy bill: tracked only once the household ticks Energy,
  // and never "schedule-converted".
  buy('2026-08-04', 7400, energy);
  buy('2026-09-04', 7100, energy);

  // A voided purchase must not reach any chart.
  const mistake = buy('2026-09-05', 99999, weeklyShop);
  voidPurchase(db, {
    id: mistake.purchase.id,
    expectedVersion: mistake.purchase.version,
    reason: 'Typed twice',
    actor: ACTOR,
    now: NOW,
  });

  // A transfer between the household's own pots must not reach any chart.
  createTransfer(db, {
    fromPotId: pots.salary.id,
    toPotId: pots.main.id,
    amountPence: 40000,
    occurredDate: '2026-09-19',
    actor: ACTOR,
    now: NOW,
  });

  // A backdated direct debit: the lazy due pass converts the instances that
  // have already fallen due into purchases carrying scheduleInstanceId.
  createSchedule(db, {
    name: 'Fibre broadband',
    kind: 'dd',
    frequency: 'monthly',
    dueDayOfMonth: 12,
    amountPence: 3499,
    potId: pots.main.id,
    categoryId: fixture.categoryId('Utilities', 'Broadband'),
    supplierName: 'Fibre Provider',
    activeFrom: '2026-06-01',
    actor: ACTOR,
    now: NOW,
  });
  // A fresh checkpoint so the forecast has an honest starting point.
  addCheckpoint(db, { potId: pots.main.id, amountPence: 180000, actor: ACTOR, now: NOW });
}

describe('charts-view: reconciliation with the purchase history', () => {
  let fixture: HouseholdFixture;
  before(async () => {
    fixture = await createHouseholdFixture(ACTOR, NOW);
    seedHistory(fixture);
  });
  after(() => fixture.close());
  const db = () => fixture.db;

  /* ---------------- A. Forecast ---------------- */

  it('the forecast starts at the reported balance and ends one month out', () => {
    const view = getForecastChartView(db(), NOW);
    const horizon = getHorizonProjectionView(db(), addMonthsClamped(TODAY, 1), [], true, NOW);
    assert.equal(view.today, TODAY);
    assert.equal(view.throughDate, '2026-10-20');
    assert.equal(view.series.startPence, horizon.availableNowPence);
    assert.equal(view.series.days[0]?.reported, true);
    assert.equal(view.series.days.length, horizon.result.perDay.length + 1);
    // Every projected point is the projection's own running balance.
    for (const [index, day] of horizon.result.perDay.entries()) {
      const point = view.series.days[index + 1];
      assert.equal(point?.date, day.date);
      assert.equal(point?.runningPence, day.runningPence);
      assert.equal(point?.reported, false);
    }
    assert.equal(view.series.endPence, horizon.result.perDay.at(-1)?.runningPence);
    assert.equal(view.unavailable, false);
  });

  it('the forecast names the overdraft room it draws', () => {
    const view = getForecastChartView(db(), NOW);
    // The fixture gives the main account an £800 limit; the cash pots none.
    assert.deepEqual(view.overdraftPots, [{ label: 'Main account', limitPence: 80000 }]);
    assert.equal(view.overdraftLabel, 'Main account overdraft limit');
    assert.equal(view.series.overdraftLimitPence, 80000);
  });

  it('the forecast low point agrees with the day-by-day figures it was taken from', () => {
    const view = getForecastChartView(db(), NOW);
    const low = Math.min(...view.series.days.map((day) => day.runningPence));
    assert.equal(view.series.lowPence, low);
    const first = view.series.days.find((day) => day.runningPence === low);
    assert.equal(view.series.lowDate, first?.date);
    assert.match(view.series.headline, /Lowest projected point/);
  });

  /* ---------------- B. Groceries ---------------- */

  it('every grocery week matches an independent sum over the review rows', () => {
    setWeeklyGroceriesPence(db(), 8500, ACTOR, NOW);
    const view = getGroceriesChartView(db(), {}, NOW);
    const parents = parentNames(db());
    assert.equal(view.phone.weeks.length, 12);
    assert.equal(view.laptop.weeks.length, 26);
    for (const week of view.laptop.weeks) {
      const independent = lineTotalPence(
        db(),
        week.weekStart,
        week.weekEnd,
        (line) => parents.get(line.categoryId) === 'Groceries',
      );
      assert.equal(week.amountPence, independent, week.weekStart);
    }
    assert.equal(view.configuredWeeklyPence, 8500);
  });

  it('a week with no shop is a zero week, and the refund nets off its own week', () => {
    const view = getGroceriesChartView(db(), {}, NOW);
    const week = (weekStart: string) =>
      view.laptop.weeks.find((entry) => entry.weekStart === weekStart);
    assert.equal(week('2026-08-24')?.amountPence, 8200 + 1150);
    assert.equal(week('2026-08-31')?.amountPence, 0);
    assert.equal(week('2026-08-31')?.complete, true);
    assert.equal(week('2026-09-07')?.amountPence, 9100);
    // 8800 recorded, 1200 returned: the till shows both, the week shows one.
    assert.equal(week('2026-09-14')?.amountPence, 8800 + 1200 - 1200);
    assert.equal(week('2026-09-14')?.complete, false);
  });

  it('the grocery average covers complete weeks only and ignores the voided entry', () => {
    const view = getGroceriesChartView(db(), {}, NOW);
    const complete = view.laptop.weeks.filter((week) => week.complete).slice(-8);
    const expected = Math.round(
      complete.reduce((sum, week) => sum + week.amountPence, 0) / complete.length,
    );
    assert.equal(view.laptop.averagePence, expected);
    assert.equal(view.laptop.averageWeeks, 8);
    // £999.99 was voided; nothing in the window can be that large.
    assert.equal(
      view.laptop.weeks.every((week) => week.amountPence < 99999),
      true,
    );
  });

  /* ---------------- C. Personal spending ---------------- */

  it('personal totals match independent "For: person" sums, household kept apart', () => {
    const view = getPersonalChartView(db(), {}, NOW);
    const parents = parentNames(db());
    const inScope = (categoryId: number) =>
      PERSONAL_PARENTS.includes(
        (parents.get(categoryId) ?? '') as (typeof PERSONAL_PARENTS)[number],
      );
    const windowFrom = addMonthsClamped(firstOfLocalMonth(TODAY), -11);
    for (const total of view.laptop.totals) {
      const independent =
        total.key === 'household'
          ? lineTotalPence(
              db(),
              windowFrom,
              TODAY,
              (line) => inScope(line.categoryId) && line.targetKind === 'household',
            )
          : lineTotalPence(
              db(),
              windowFrom,
              TODAY,
              (line) =>
                inScope(line.categoryId) &&
                line.targetKind === 'person' &&
                line.targetId === Number(total.key.slice('person:'.length)),
            );
      assert.equal(total.amountPence, independent, total.key);
    }
    const { alex, sam } = fixture.people;
    assert.equal(
      view.laptop.totals.find((total) => total.key === `person:${alex.id}`)?.amountPence,
      4500 + 2600,
    );
    assert.equal(
      view.laptop.totals.find((total) => total.key === `person:${sam.id}`)?.amountPence,
      3150 + 1975,
    );
    // Dining out + the shared subscription, whole, attributed to nobody.
    assert.equal(
      view.laptop.totals.find((total) => total.key === 'household')?.amountPence,
      4200 + 1499,
    );
  });

  it('the personal chart excludes vehicle and grocery lines, and lists everyone', () => {
    const view = getPersonalChartView(db(), {}, NOW);
    assert.deepEqual(
      view.people.map((person) => person.label),
      ['Alex', 'Sam'],
    );
    const drawn = view.laptop.totals.reduce((sum, total) => sum + total.amountPence, 0);
    assert.equal(drawn, 4500 + 2600 + 3150 + 1975 + 4200 + 1499);
    // Fuel (vehicle) and groceries are simply not in these parents.
    assert.equal(
      view.laptop.months.every((month) => month.totalPence < 60000),
      true,
    );
  });

  it('the chips narrow the chart, its months and its headline together', () => {
    const { sam } = fixture.people;
    const view = getPersonalChartView(db(), { include: [`person:${sam.id}`] }, NOW);
    assert.deepEqual(
      view.laptop.series.map((ref) => ref.label),
      ['Sam'],
    );
    assert.equal(
      view.laptop.totals.reduce((sum, total) => sum + total.amountPence, 0),
      3150 + 1975,
    );
    // …and the full cast is still offered as chips.
    assert.equal(view.people.length, 2);
  });

  it('the September month bucket matches the review rows for that month', () => {
    const view = getPersonalChartView(db(), {}, NOW);
    const september = view.laptop.months.find((month) => month.label === 'September 2026');
    const parents = parentNames(db());
    const independent = lineTotalPence(db(), '2026-09-01', '2026-09-30', (line) =>
      PERSONAL_PARENTS.includes(
        (parents.get(line.categoryId) ?? '') as (typeof PERSONAL_PARENTS)[number],
      ),
    );
    assert.equal(september?.totalPence, independent);
    assert.equal(september?.complete, false);
  });

  /* ---------------- D. Fixed commitments ---------------- */

  it('tracks the schedule categories until the household says otherwise', () => {
    const fromSchedules = scheduleCommitmentCategoryIds(db());
    assert.deepEqual(fromSchedules, [fixture.categoryId('Utilities', 'Broadband')]);
    const tracking = effectiveCommitmentCategoryIds(db());
    assert.equal(tracking.source, 'schedules');
    assert.deepEqual(tracking.categoryIds, fromSchedules);

    const view = getCommitmentChartView(db(), {}, NOW);
    assert.equal(view.tracking.source, 'schedules');
    assert.deepEqual(
      view.trackedCategories.map((entry) => `${entry.parent} / ${entry.child}`),
      ['Utilities / Broadband'],
    );
    // Four monthly instances have fallen due: 12 June to 12 September.
    const converted = view.series.months.reduce((sum, month) => sum + month.amountPence, 0);
    assert.equal(converted, 3499 * 4);
  });

  it('every commitment month matches an independent sum, with and without the toggle', () => {
    const energy = fixture.categoryId('Utilities', 'Energy');
    const broadband = fixture.categoryId('Utilities', 'Broadband');
    setCommitmentCategoryIds(db(), [energy, broadband], ACTOR, NOW);

    const view = getCommitmentChartView(db(), {}, NOW);
    assert.equal(view.tracking.source, 'configured');
    for (const month of view.series.months) {
      const independent = lineTotalPence(
        db(),
        month.from,
        month.to,
        (line) => line.categoryId === energy || line.categoryId === broadband,
      );
      assert.equal(month.amountPence, independent, month.label);
    }
    assert.equal(
      view.series.months.find((month) => month.label === 'August 2026')?.amountPence,
      7400 + 3499,
    );

    const onlySchedules = getCommitmentChartView(db(), { scheduleOnly: true }, NOW);
    for (const month of onlySchedules.series.months) {
      const independent = listPurchases(db(), {
        dateFrom: month.from,
        dateTo: month.to,
        scheduleOnly: true,
      })
        .flatMap((row) => row.allocations)
        .filter((line) => line.categoryId === energy || line.categoryId === broadband)
        .reduce((sum, line) => sum + line.amountPence, 0);
      assert.equal(month.amountPence, independent, month.label);
    }
    // The hand-typed energy bills drop out; the converted direct debit stays.
    assert.equal(
      onlySchedules.series.months.find((month) => month.label === 'August 2026')?.amountPence,
      3499,
    );
  });

  it('an explicitly empty set means none tracked, not "fall back to schedules"', () => {
    setCommitmentCategoryIds(db(), [], ACTOR, NOW);
    const tracking = effectiveCommitmentCategoryIds(db());
    assert.equal(tracking.source, 'configured');
    assert.deepEqual(tracking.categoryIds, []);
    const view = getCommitmentChartView(db(), {}, NOW);
    assert.equal(
      view.series.months.every((month) => month.amountPence === 0),
      true,
    );
    assert.match(view.series.headline, /No categories are tracked/);
  });

  it('refuses a category that is not a live child of the tree', () => {
    const parent = db()
      .select()
      .from(categories)
      .all()
      .find((row) => row.parentId === null);
    assert.notEqual(parent, undefined);
    assert.throws(
      () => setCommitmentCategoryIds(db(), [parent?.id ?? 0], ACTOR, NOW),
      InvalidSettingValueError,
    );
    assert.throws(
      () => setCommitmentCategoryIds(db(), [999999], ACTOR, NOW),
      InvalidSettingValueError,
    );
  });

  it('the Settings picker offers every child, grouped, with the schedule ones flagged', () => {
    const broadband = fixture.categoryId('Utilities', 'Broadband');
    setCommitmentCategoryIds(db(), [broadband], ACTOR, NOW);
    const picker = getCommitmentCategoryPicker(db());
    assert.equal(picker.source, 'configured');
    assert.equal(picker.tickedCount, 1);
    const utilities = picker.groups.find((group) => group.parent === 'Utilities');
    const choice = utilities?.children.find((child) => child.id === broadband);
    assert.equal(choice?.ticked, true);
    assert.equal(choice?.usedBySchedule, true);
    // Groups carry their parent, and no parent is offered as a choice.
    const everyChildId = new Set(
      picker.groups.flatMap((group) => group.children.map((child) => child.id)),
    );
    assert.equal(everyChildId.has(utilities?.parentId ?? -1), false);
    assert.equal(picker.groups.length > 1, true);
  });

  /* ---------------- The shared query ---------------- */

  it('the shared line query skips voided purchases and transfers entirely', () => {
    const lines = chartSpendingLines(db(), '2026-06-01', TODAY);
    assert.equal(
      lines.some((line) => line.amountPence === 99999),
      false,
      'the voided purchase leaked in',
    );
    assert.equal(
      lines.some((line) => line.amountPence === 40000),
      false,
      'the transfer leaked in',
    );
    const independent = listPurchases(db(), { dateFrom: '2026-06-01', dateTo: TODAY }).flatMap(
      (row) => row.allocations,
    );
    assert.equal(lines.length, independent.length);
    assert.equal(
      lines.reduce((sum, line) => sum + line.amountPence, 0),
      independent.reduce((sum, line) => sum + line.amountPence, 0),
    );
    // Parent names are joined in for every line, and the converted direct
    // debits are the only ones flagged.
    assert.equal(
      lines.every((line) => line.parentName.length > 0 && line.childName.length > 0),
      true,
    );
    assert.equal(lines.filter((line) => line.scheduleConverted).length, 4);
  });

  it('draws a window that ends today, never tomorrow', () => {
    const groceries = getGroceriesChartView(db(), {}, NOW);
    const lastWeek = groceries.laptop.weeks.at(-1);
    assert.equal(lastWeek?.weekStart, startOfWeekLocal(TODAY));
    assert.equal(lastWeek?.weekEnd, addDaysLocal(startOfWeekLocal(TODAY), 6));
    const personal = getPersonalChartView(db(), {}, NOW);
    assert.equal(personal.laptop.months.at(-1)?.label, 'September 2026');
    const commitments = getCommitmentChartView(db(), {}, NOW);
    assert.equal(commitments.series.months.at(-1)?.label, 'September 2026');
  });
});
