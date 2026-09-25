import { and, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { allocations, categories, purchases, schedules } from '../db/schema';
import { toLocalDateString } from '../time';
import { addDaysLocal, addMonthsClamped } from './dates';
import { categoryTree, findParentCategory } from './categories';
import {
  commitmentSeries,
  forecastSeries,
  groceriesSeries,
  personalSpendSeries,
  type ChartSpendingLine,
  type CommitmentSeries,
  type ForecastSeries,
  type GroceriesSeries,
  type PersonalSeries,
} from './chart-series';
import { firstOfLocalMonth, startOfWeekLocal, GROCERIES_PARENT } from './insights';
import { ensureScheduleState, getHorizonProjectionView } from './money-view';
import { listPeople } from './people';
import { getCommitmentCategoryIds, getWeeklyGroceriesPence } from './settings';

/**
 * The DB assembly layer for the Charts page (docs/SPEC.md §16.7, v0.14.0).
 *
 * Same shape and same discipline as `insights-view.ts`: every read runs the
 * lazy due pass first (a converted schedule purchase is ordinary spending
 * and belongs in its month), then hands flat typed rows to the pure
 * resolvers in `chart-series.ts`. **No arithmetic lives here** — which is
 * what lets `tests/charts-view.test.ts` sum `listPurchases` independently
 * and demand the same figures, and what keeps `/charts` and `/insights`
 * telling the same story.
 *
 * Transfers never reach a chart (SPEC §10) and income is not spending
 * (SPEC §6): the join over `allocations` enforces both by construction.
 */

/** Parent categories the personal chart treats as discretionary (§16.7 C). */
export const PERSONAL_PARENTS = ['Personal', 'Entertainment & Eating Out'] as const;

/* ------------------------------------------------------------------ */
/* A. Forecast                                                         */
/* ------------------------------------------------------------------ */

export interface ForecastDayDetail {
  date: string;
  commitments: Array<{ name: string; amountPence: number; potLabel: string }>;
  receipts: Array<{ name: string; amountPence: number; potLabel: string; expected: boolean }>;
  dayToDay: Array<{ name: string; amountPence: number }>;
}

export interface ForecastChartView {
  asOf: Date;
  today: string;
  throughDate: string;
  series: ForecastSeries;
  /** Which pots carry an overdraft, and their combined room. */
  overdraftPots: Array<{ label: string; limitPence: number }>;
  overdraftLabel: string | null;
  /** What lands on each day that has anything — the laptop drill-down. */
  details: ForecastDayDetail[];
  /** True when no pot has a checkpoint, so there is nothing honest to draw. */
  unavailable: boolean;
}

/**
 * The household total from today to one month ahead (decision 152: no
 * per-pot lines — the per-pot question is answered by the pot watch on
 * /overview, and one line stays readable at 320px).
 *
 * Today's point is the household's reported figure; every later point is
 * projected from schedules and the day-to-day model. Empty `potIds` is every
 * pot, which is exactly the household total.
 */
export function getForecastChartView(db: Db, nowArg?: Date): ForecastChartView {
  const now = nowArg ?? new Date();
  const today = toLocalDateString(now);
  const throughDate = addMonthsClamped(today, 1);
  const view = getHorizonProjectionView(db, throughDate, [], true, now);

  const overdraftPots = view.selection
    .filter((entry) => entry.selected && entry.pot.overdraftLimitPence !== null)
    .map((entry) => ({
      label: entry.pot.label,
      limitPence: entry.pot.overdraftLimitPence as number,
    }));
  const overdraftTotal = overdraftPots.reduce((sum, pot) => sum + pot.limitPence, 0);
  const overdraftLabel =
    overdraftPots.length === 0
      ? null
      : overdraftPots.length === 1
        ? `${(overdraftPots[0] as { label: string }).label} overdraft limit`
        : `Overdraft room across ${overdraftPots.length} pots`;

  const series = forecastSeries({
    today,
    availableNowPence: view.availableNowPence,
    perDay: view.result.perDay,
    overdraftLimitPence: overdraftTotal > 0 ? overdraftTotal : null,
    warningThresholdPence: view.result.warningThresholdPence,
  });

  const byDate = new Map<string, ForecastDayDetail>();
  const detailFor = (date: string): ForecastDayDetail => {
    const existing = byDate.get(date);
    if (existing !== undefined) return existing;
    const created: ForecastDayDetail = { date, commitments: [], receipts: [], dayToDay: [] };
    byDate.set(date, created);
    return created;
  };
  for (const line of view.commitmentLines) {
    detailFor(line.dueDate).commitments.push({
      name: line.name,
      amountPence: line.amountPence,
      potLabel: line.potLabel,
    });
  }
  for (const line of view.receiptLines) {
    detailFor(line.dueDate).receipts.push({
      name: line.name,
      amountPence: line.amountPence,
      potLabel: line.potLabel,
      expected: line.expected,
    });
  }
  for (const event of view.dayToDayEvents) {
    detailFor(event.dueDate).dayToDay.push({ name: event.name, amountPence: event.amountPence });
  }

  return {
    asOf: now,
    today,
    throughDate,
    series,
    overdraftPots,
    overdraftLabel,
    details: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    unavailable: view.selection.every((entry) => !entry.selected) || view.availableNowPence === 0,
  };
}

/* ------------------------------------------------------------------ */
/* B. Groceries                                                        */
/* ------------------------------------------------------------------ */

export interface GroceriesChartView {
  today: string;
  /** Last 12 Monday–Sunday weeks. */
  phone: GroceriesSeries;
  /** Last 26 Monday–Sunday weeks. */
  laptop: GroceriesSeries;
  parentName: string;
  /** The Groceries parent id — the drill-down link's category filter. */
  parentCategoryId: number | null;
  configuredWeeklyPence: number | null;
}

export interface GroceriesChartOptions {
  phoneWeeks?: number;
  laptopWeeks?: number;
}

export function getGroceriesChartView(
  db: Db,
  options: GroceriesChartOptions = {},
  nowArg?: Date,
): GroceriesChartView {
  const now = nowArg ?? new Date();
  ensureScheduleState(db, now);
  const today = toLocalDateString(now);
  const phoneWeeks = options.phoneWeeks ?? 12;
  const laptopWeeks = options.laptopWeeks ?? 26;
  const windowFrom = startOfWeekLocal(
    addDaysLocal(today, -7 * (Math.max(phoneWeeks, laptopWeeks) - 1)),
  );
  const lines = chartSpendingLines(db, windowFrom, today).filter(
    (line) => line.parentName === GROCERIES_PARENT,
  );
  const configuredWeeklyPence = getWeeklyGroceriesPence(db);
  const parent = findParentCategory(db, GROCERIES_PARENT);
  return {
    today,
    phone: groceriesSeries(lines, { today, weeks: phoneWeeks, configuredWeeklyPence }),
    laptop: groceriesSeries(lines, { today, weeks: laptopWeeks, configuredWeeklyPence }),
    parentName: GROCERIES_PARENT,
    parentCategoryId: parent?.id ?? null,
    configuredWeeklyPence,
  };
}

/* ------------------------------------------------------------------ */
/* C. Personal spending                                                */
/* ------------------------------------------------------------------ */

export interface PersonalChartView {
  today: string;
  /** Everyone in the household, chips included, whatever the filter says. */
  people: Array<{ id: number; label: string }>;
  /** Last 6 calendar months. */
  phone: PersonalSeries;
  /** Last 12 calendar months. */
  laptop: PersonalSeries;
  /** Parent ids in scope — the drill-down link's category filter. */
  parentCategoryIds: number[];
  parentNames: string[];
  /** Children in scope, for the caption (they come from the live tree). */
  childNames: string[];
}

export interface PersonalChartOptions {
  phoneMonths?: number;
  laptopMonths?: number;
  /** Series keys the filter chips have left switched on. */
  include?: readonly string[];
}

/**
 * Discretionary spending per person per month. The scope is the two parent
 * categories, resolved from the **live** tree rather than a hard-coded list
 * of children (decision 154): the tree is user-editable, so a new child
 * under Personal is in scope the day it is created — and a household-marked
 * line such as a shared subscription lands in the Household series, exactly
 * as the household asked, without anything being hard-coded.
 */
export function getPersonalChartView(
  db: Db,
  options: PersonalChartOptions = {},
  nowArg?: Date,
): PersonalChartView {
  const now = nowArg ?? new Date();
  ensureScheduleState(db, now);
  const today = toLocalDateString(now);
  const phoneMonths = options.phoneMonths ?? 6;
  const laptopMonths = options.laptopMonths ?? 12;
  const windowFrom = addMonthsClamped(
    firstOfLocalMonth(today),
    -(Math.max(phoneMonths, laptopMonths) - 1),
  );
  const parentNames: string[] = [...PERSONAL_PARENTS];
  const lines = chartSpendingLines(db, windowFrom, today).filter((line) =>
    parentNames.includes(line.parentName),
  );
  const people = listPeople(db).map((person) => ({ id: person.id, label: person.label }));
  const tree = categoryTree(db).filter((parent) => parentNames.includes(parent.name));
  const include = options.include;
  return {
    today,
    phone: personalSpendSeries(lines, people, {
      today,
      months: phoneMonths,
      parentNames,
      include,
    }),
    laptop: personalSpendSeries(lines, people, {
      today,
      months: laptopMonths,
      parentNames,
      include,
    }),
    people,
    parentCategoryIds: tree.map((parent) => parent.id),
    parentNames,
    childNames: tree.flatMap((parent) =>
      parent.children.filter((child) => child.retiredAt === null).map((child) => child.name),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* D. Fixed commitments                                                */
/* ------------------------------------------------------------------ */

export interface CommitmentTracking {
  categoryIds: number[];
  /** 'configured' = ticked in Settings; 'schedules' = the useful default. */
  source: 'configured' | 'schedules';
}

/** Child categories already used by a direct debit or standing order. */
export function scheduleCommitmentCategoryIds(db: Db): number[] {
  const rows = db
    .select({ categoryId: schedules.categoryId })
    .from(schedules)
    .where(and(isNotNull(schedules.categoryId), sql`${schedules.kind} in ('dd','so')`))
    .all();
  return [
    ...new Set(rows.flatMap((row) => (row.categoryId === null ? [] : [row.categoryId]))),
  ].sort((a, b) => a - b);
}

/**
 * What the chart tracks today: the household's ticked set when they have
 * saved one, otherwise the children already used by schedules — so the
 * chart says something true on first open, before anyone visits Settings.
 */
export function effectiveCommitmentCategoryIds(db: Db): CommitmentTracking {
  const configured = getCommitmentCategoryIds(db);
  if (configured !== null) return { categoryIds: configured, source: 'configured' };
  return { categoryIds: scheduleCommitmentCategoryIds(db), source: 'schedules' };
}

export interface CommitmentCategoryChoice {
  id: number;
  name: string;
  ticked: boolean;
  usedBySchedule: boolean;
  retired: boolean;
}

export interface CommitmentCategoryGroup {
  parentId: number;
  parent: string;
  children: CommitmentCategoryChoice[];
}

export interface CommitmentCategoryPicker {
  groups: CommitmentCategoryGroup[];
  source: 'configured' | 'schedules';
  tickedCount: number;
}

/** The Settings checkbox list: every child, grouped by parent, pre-ticked. */
export function getCommitmentCategoryPicker(db: Db): CommitmentCategoryPicker {
  const tracking = effectiveCommitmentCategoryIds(db);
  const ticked = new Set(tracking.categoryIds);
  const used = new Set(scheduleCommitmentCategoryIds(db));
  const groups = categoryTree(db)
    .map((parent) => ({
      parentId: parent.id,
      parent: parent.name,
      children: parent.children
        .filter((child) => child.retiredAt === null || ticked.has(child.id) || used.has(child.id))
        .map((child) => ({
          id: child.id,
          name: child.name,
          ticked: ticked.has(child.id),
          usedBySchedule: used.has(child.id),
          retired: child.retiredAt !== null,
        })),
    }))
    .filter((group) => group.children.length > 0);
  return { groups, source: tracking.source, tickedCount: ticked.size };
}

export interface CommitmentChartView {
  today: string;
  series: CommitmentSeries;
  tracking: CommitmentTracking;
  scheduleOnly: boolean;
  /** Tracked categories with their names, for the laptop list. */
  trackedCategories: Array<{ id: number; parent: string; child: string; retired: boolean }>;
}

export interface CommitmentChartOptions {
  months?: number;
  scheduleOnly?: boolean;
}

export function getCommitmentChartView(
  db: Db,
  options: CommitmentChartOptions = {},
  nowArg?: Date,
): CommitmentChartView {
  const now = nowArg ?? new Date();
  ensureScheduleState(db, now);
  const today = toLocalDateString(now);
  const months = options.months ?? 12;
  const scheduleOnly = options.scheduleOnly === true;
  const tracking = effectiveCommitmentCategoryIds(db);
  const windowFrom = addMonthsClamped(firstOfLocalMonth(today), -(months - 1));
  const lines = chartSpendingLines(db, windowFrom, today);
  const names = new Map(
    categoryTree(db).flatMap((parent) =>
      parent.children.map(
        (child) =>
          [
            child.id,
            { parent: parent.name, child: child.name, retired: child.retiredAt !== null },
          ] as const,
      ),
    ),
  );
  return {
    today,
    series: commitmentSeries(lines, {
      today,
      months,
      trackedCategoryIds: tracking.categoryIds,
      scheduleOnly,
    }),
    tracking,
    scheduleOnly,
    trackedCategories: tracking.categoryIds.map((id) => ({
      id,
      parent: names.get(id)?.parent ?? 'Unknown',
      child: names.get(id)?.child ?? `Category ${id}`,
      retired: names.get(id)?.retired ?? false,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* The one query every chart reads                                     */
/* ------------------------------------------------------------------ */

/**
 * Non-void allocation lines whose purchase falls inside [from, to], with the
 * category parent/child names joined in and the schedule-converted flag
 * carried through (`purchases.scheduleInstanceId`). Allocations always point
 * at a leaf, so the parent join is total.
 */
export function chartSpendingLines(db: Db, from: string, to: string): ChartSpendingLine[] {
  const rows = db
    .select({
      occurredDate: purchases.occurredDate,
      categoryId: allocations.categoryId,
      childName: categories.name,
      parentName: sql<string>`(select p.name from categories p where p.id = ${categories.parentId})`,
      targetKind: allocations.targetKind,
      targetId: allocations.targetId,
      amountPence: allocations.amountPence,
      scheduleInstanceId: purchases.scheduleInstanceId,
    })
    .from(allocations)
    .innerJoin(purchases, eq(purchases.id, allocations.purchaseId))
    .innerJoin(categories, eq(categories.id, allocations.categoryId))
    .where(
      and(
        isNull(purchases.voidedAt),
        gte(purchases.occurredDate, from),
        lte(purchases.occurredDate, to),
      ),
    )
    .all();
  return rows.map((row) => ({
    occurredDate: row.occurredDate,
    categoryId: row.categoryId,
    parentName: row.parentName,
    childName: row.childName,
    targetKind: row.targetKind as 'household' | 'person' | 'vehicle',
    targetId: row.targetId,
    amountPence: row.amountPence,
    scheduleConverted: row.scheduleInstanceId !== null,
  }));
}
