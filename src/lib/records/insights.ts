import { roundHalfUpDivide } from '../money';
import {
  addDaysLocal,
  addMonthsClamped,
  checkedLocalDate,
  daysInMonth,
  toDateString,
} from './dates';

/**
 * The Insights v1 engine (docs/SPEC.md §16, panels 1–4): month comparisons,
 * personal-vs-personal spending, per-vehicle running costs, and the
 * projection honesty loop (configured figures vs recent actuals).
 *
 * Pure, framework-free, integer-pence — shared by the Insights UI and the
 * tests ("insights figures reconcile with the pure engines", Phase 4 exit).
 *
 * Conventions:
 * - Every input row is a flat, typed spending line (a date, its category
 *   parent/child names, one target, signed pence). Purchases add, refunds
 *   subtract, so a summary is NET spending. Transfers never appear here
 *   (SPEC §10 — excluded from every spending insight); the DB assembly
 *   (insights-view.ts) is the only place that queries the database.
 * - All arithmetic is over local 'YYYY-MM-DD' dates (dates.ts), so DST
 *   transitions cannot leak in. Calendar months are calendar months
 *   (decision 4: payday cycle for projections, calendar month for Insights).
 */

/** Category names the honesty loop tracks (SPEC §12 seed tree). */
export const GROCERIES_PARENT = 'Groceries';
export const FUEL_CHILD = 'Fuel';

export interface SpendingLineInput {
  occurredDate: string; // 'YYYY-MM-DD'
  categoryId: number;
  parentName: string;
  childName: string;
  targetKind: 'household' | 'person' | 'vehicle';
  targetId: number | null;
  /** Signed: purchases positive, refunds negative (net spending). */
  amountPence: number;
}

export interface ChildSum {
  child: string;
  amountPence: number;
}

/** A parent-category roll-up with its child drill-down (SPEC §12, §16.1). */
export interface ParentSum {
  parent: string;
  amountPence: number;
  children: ChildSum[];
}

/** Net spending over an inclusive local-date window, rolled up to parents. */
export interface SpendingSummary {
  from: string;
  to: string;
  totalPence: number;
  byParent: ParentSum[];
}

export interface MonthRef {
  year: number;
  month: number; // 1–12
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function checkedMonthRef(ref: MonthRef): MonthRef {
  if (!Number.isInteger(ref.year) || ref.year < 1 || ref.year > 9999) {
    throw new Error(`Expected a calendar month, received year ${ref.year}`);
  }
  if (!Number.isInteger(ref.month) || ref.month < 1 || ref.month > 12) {
    throw new Error(`Expected a calendar month, received month ${ref.month}`);
  }
  return ref;
}

export function monthOfLocalDate(date: string): MonthRef {
  const d = checkedLocalDate(date);
  return { year: d.year, month: d.month };
}

export function firstOfLocalMonth(date: string): string {
  const d = checkedLocalDate(date);
  return toDateString({ year: d.year, month: d.month, day: 1 });
}

export function lastOfLocalMonth(date: string): string {
  const d = checkedLocalDate(date);
  return toDateString({ year: d.year, month: d.month, day: daysInMonth(d.year, d.month) });
}

/** The calendar month before the month containing `date` (handles January). */
export function previousLocalMonth(date: string): MonthRef {
  const d = checkedLocalDate(date);
  return d.month === 1 ? { year: d.year - 1, month: 12 } : { year: d.year, month: d.month - 1 };
}

export function monthRange(ref: MonthRef): { from: string; to: string } {
  checkedMonthRef(ref);
  return {
    from: toDateString({ year: ref.year, month: ref.month, day: 1 }),
    to: toDateString({ year: ref.year, month: ref.month, day: daysInMonth(ref.year, ref.month) }),
  };
}

export function formatMonthLabel(ref: MonthRef): string {
  checkedMonthRef(ref);
  return `${MONTH_NAMES[ref.month - 1]} ${ref.year}`;
}

/**
 * Panel 1 building block: net spending over [from, to] (inclusive local
 * dates), total plus parent roll-up with child drill-down. Lines outside
 * the window are ignored; a parent with activity that nets to zero is still
 * shown (an honest "spent and refunded" is not a hidden month).
 */
export function summarizeSpending(
  lines: readonly SpendingLineInput[],
  from: string,
  to: string,
): SpendingSummary {
  checkedLocalDate(from);
  checkedLocalDate(to);
  const parents = new Map<string, { amountPence: number; children: Map<string, number> }>();
  let total = 0;
  for (const line of lines) {
    if (line.occurredDate < from || line.occurredDate > to) continue;
    total += line.amountPence;
    const parent = parents.get(line.parentName) ?? { amountPence: 0, children: new Map() };
    parent.amountPence += line.amountPence;
    parent.children.set(
      line.childName,
      (parent.children.get(line.childName) ?? 0) + line.amountPence,
    );
    parents.set(line.parentName, parent);
  }
  const byParent: ParentSum[] = [...parents.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([parent, value]) => ({
      parent,
      amountPence: value.amountPence,
      children: [...value.children.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([child, amountPence]) => ({ child, amountPence })),
    }));
  return { from, to, totalPence: total, byParent };
}

export interface MonthComparison {
  today: string;
  /** True while the current calendar month is still running (label it as such). */
  currentInProgress: boolean;
  current: { month: MonthRef; label: string; summary: SpendingSummary };
  previous: { month: MonthRef; label: string; summary: SpendingSummary };
  totalDeltaPence: number;
  byParent: Array<{
    parent: string;
    currentPence: number;
    previousPence: number;
    deltaPence: number;
  }>;
}

/**
 * Panel 1 (SPEC §16.1): this calendar month vs the previous one, by parent
 * category with child drill-down. Pure over the window's lines; the view
 * layer decides which dates to query (from the previous month's first day
 * through today).
 */
export function compareCalendarMonths(
  lines: readonly SpendingLineInput[],
  today: string,
): MonthComparison {
  checkedLocalDate(today);
  const current = monthOfLocalDate(today);
  const previous = previousLocalMonth(today);
  const currentRange = monthRange(current);
  const previousRange = monthRange(previous);
  const currentSummary = summarizeSpending(lines, currentRange.from, currentRange.to);
  const previousSummary = summarizeSpending(lines, previousRange.from, previousRange.to);

  const parentNames = new Set<string>([
    ...currentSummary.byParent.map((entry) => entry.parent),
    ...previousSummary.byParent.map((entry) => entry.parent),
  ]);
  const currentByParent = new Map(currentSummary.byParent.map((entry) => [entry.parent, entry]));
  const previousByParent = new Map(previousSummary.byParent.map((entry) => [entry.parent, entry]));
  const byParent = [...parentNames]
    .sort((a, b) => a.localeCompare(b))
    .map((parent) => {
      const currentPence = currentByParent.get(parent)?.amountPence ?? 0;
      const previousPence = previousByParent.get(parent)?.amountPence ?? 0;
      return { parent, currentPence, previousPence, deltaPence: currentPence - previousPence };
    });

  return {
    today,
    currentInProgress: today < lastOfLocalMonth(today),
    current: { month: current, label: formatMonthLabel(current), summary: currentSummary },
    previous: { month: previous, label: formatMonthLabel(previous), summary: previousSummary },
    totalDeltaPence: currentSummary.totalPence - previousSummary.totalPence,
    byParent,
  };
}

export interface PersonRef {
  id: number;
  label: string;
}

/** One person's for-person spending for a window (SPEC §16.2). */
export interface PersonSpend {
  personId: number;
  person: string;
  totalPence: number;
  byParent: ParentSum[];
}

/**
 * Panel 2 (SPEC §16.2): each person's for-person allocations, side by side,
 * per month. Only lines with a person target are attributed — household
 * allocations are NEVER attributed to whoever happened to pay, and vehicle
 * lines stay with the vehicle (SPEC §13). A person with no for-person lines
 * in the window is still listed (an honest zero, not a missing person).
 */
export function personalSpending(
  lines: readonly SpendingLineInput[],
  people: readonly PersonRef[],
  from: string,
  to: string,
): PersonSpend[] {
  checkedLocalDate(from);
  checkedLocalDate(to);
  const groups = new Map<
    number,
    { amountPence: number; parents: Map<string, Map<string, number>> }
  >();
  for (const line of lines) {
    if (line.targetKind !== 'person' || line.targetId === null) continue;
    if (line.occurredDate < from || line.occurredDate > to) continue;
    const group = groups.get(line.targetId) ?? { amountPence: 0, parents: new Map() };
    group.amountPence += line.amountPence;
    const parent = group.parents.get(line.parentName) ?? new Map<string, number>();
    parent.set(line.childName, (parent.get(line.childName) ?? 0) + line.amountPence);
    group.parents.set(line.parentName, parent);
    groups.set(line.targetId, group);
  }
  return people.map((person) => {
    const group = groups.get(person.id);
    return {
      personId: person.id,
      person: person.label,
      totalPence: group?.amountPence ?? 0,
      byParent: group
        ? [...group.parents.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([parent, children]) => ({
              parent,
              amountPence: [...children.values()].reduce((sum, value) => sum + value, 0),
              children: [...children.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([child, amountPence]) => ({ child, amountPence })),
            }))
        : [],
    };
  });
}

export interface VehicleRef {
  id: number;
  label: string;
}

/** Per-vehicle running costs for the current view (SPEC §16.3). */
export interface VehicleCosts {
  vehicleId: number;
  label: string;
  /** Current calendar month (partial until month end — labelled in the UI). */
  monthPence: number;
  previousMonthPence: number;
  /**
   * Twelve calendar months including the (partial) current one: from the
   * first day of (current month − 11) through today. "Everything Vehicle A
   * cost us" — fuel, insurance, maintenance, road tax, parking (SPEC §13).
   */
  rolling12Pence: number;
  rolling12From: string;
  /** By child category over the rolling window (fuel/insurance/…). */
  byChild: Array<{ parent: string; child: string; amountPence: number }>;
}

/**
 * Panel 3 (SPEC §16.3, §13): per-vehicle monthly totals and the rolling
 * 12-month total, by child category. Costs stay with the vehicle regardless
 * of who paid or drove; only lines whose target is the vehicle count.
 */
export function vehicleRunningCosts(
  lines: readonly SpendingLineInput[],
  vehicles: readonly VehicleRef[],
  today: string,
): VehicleCosts[] {
  checkedLocalDate(today);
  const current = monthOfLocalDate(today);
  const previous = previousLocalMonth(today);
  const currentRange = monthRange(current);
  const previousRange = monthRange(previous);
  const rolling12From = addMonthsClamped(firstOfLocalMonth(today), -11);

  const inRange = (line: SpendingLineInput, from: string, to: string): boolean =>
    line.occurredDate >= from && line.occurredDate <= to;

  return vehicles.map((vehicle) => {
    const mine = lines.filter(
      (line) => line.targetKind === 'vehicle' && line.targetId === vehicle.id,
    );
    const monthPence = mine
      .filter((line) => inRange(line, currentRange.from, currentRange.to))
      .reduce((sum, line) => sum + line.amountPence, 0);
    const previousMonthPence = mine
      .filter((line) => inRange(line, previousRange.from, previousRange.to))
      .reduce((sum, line) => sum + line.amountPence, 0);
    const rollingLines = mine.filter((line) => inRange(line, rolling12From, today));
    const byChild = new Map<string, { parent: string; child: string; amountPence: number }>();
    for (const line of rollingLines) {
      const key = `${line.parentName}/${line.childName}`;
      const entry = byChild.get(key) ?? {
        parent: line.parentName,
        child: line.childName,
        amountPence: 0,
      };
      entry.amountPence += line.amountPence;
      byChild.set(key, entry);
    }
    return {
      vehicleId: vehicle.id,
      label: vehicle.label,
      monthPence,
      previousMonthPence,
      rolling12Pence: rollingLines.reduce((sum, line) => sum + line.amountPence, 0),
      rolling12From,
      byChild: [...byChild.values()].sort(
        (a, b) => a.parent.localeCompare(b.parent) || a.child.localeCompare(b.child),
      ),
    };
  });
}

export interface HonestyFuelConfig {
  vehicleId: number;
  label: string;
  configuredPence: number | null;
}

export interface HonestyConfig {
  /** SPEC §7.3 configured weekly groceries; null = not configured yet. */
  weeklyGroceriesPence: number | null;
  /** SPEC §7.3 configured monthly fuel per vehicle; null = not configured. */
  monthlyFuelPence: readonly HonestyFuelConfig[];
}

export interface GroceriesWeek {
  weekStart: string; // Monday (local)
  weekEnd: string; // Sunday (local)
  actualPence: number;
}

export interface HonestyGroceries {
  parent: string;
  /** The last `weeks` COMPLETE Monday–Sunday weeks, oldest first. */
  weeks: GroceriesWeek[];
  /** Mean per-week actual over the whole window (zero weeks included). */
  averageWeeklyPence: number;
  configuredPence: number | null;
  /** averageWeeklyPence − configuredPence; null when nothing is configured. */
  driftPence: number | null;
}

export interface HonestyFuelMonth {
  month: string; // 'YYYY-MM' of the COMPLETE calendar month
  from: string;
  to: string;
  actualPence: number;
}

export interface HonestyFuel {
  vehicleId: number;
  label: string;
  /** The last `months` COMPLETE calendar months (this partial month excluded). */
  months: HonestyFuelMonth[];
  averageMonthlyPence: number;
  configuredPence: number | null;
  driftPence: number | null;
}

export interface HonestyLoop {
  today: string;
  groceries: HonestyGroceries;
  fuel: HonestyFuel[];
}

/** The Monday (local) starting the week that contains `date`. */
export function startOfWeekLocal(date: string): string {
  const d = checkedLocalDate(date);
  const dayOfWeek = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return addDaysLocal(date, -daysSinceMonday);
}

/**
 * Panel 4 — the projection honesty loop (SPEC §7.3, §16.4): configured
 * weekly groceries and per-vehicle monthly fuel vs recent actuals, so drift
 * is visible and the config can be corrected from Settings.
 *
 * Windows are complete periods only — the partial current week/month is
 * excluded, so the comparison never mixes a 3-day week with a 7-day one:
 * - groceries: the last 8 complete Monday–Sunday weeks;
 * - fuel (per vehicle): the last 3 complete calendar months.
 *
 * Actuals are NET signed spending in the tracked categories (Groceries
 * parent for groceries; Vehicle Running / Fuel lines targeted at the
 * vehicle for fuel), so refunds net off honestly. Averages round once,
 * half-up, at the period level (SPEC §6) — no floating-point money.
 */
export function computeHonestyLoop(
  lines: readonly SpendingLineInput[],
  config: HonestyConfig,
  today: string,
  options: { weeks?: number; months?: number } = {},
): HonestyLoop {
  checkedLocalDate(today);
  const weekCount = Math.min(Math.max(options.weeks ?? 8, 1), 52);
  const monthCount = Math.min(Math.max(options.months ?? 3, 1), 24);

  const thisMonday = startOfWeekLocal(today);
  const groceryLines = lines.filter((line) => line.parentName === GROCERIES_PARENT);
  const weeks: GroceriesWeek[] = [];
  for (let i = weekCount; i >= 1; i -= 1) {
    const weekStart = addDaysLocal(thisMonday, -7 * i);
    const weekEnd = addDaysLocal(weekStart, 6);
    const actualPence = groceryLines
      .filter((line) => line.occurredDate >= weekStart && line.occurredDate <= weekEnd)
      .reduce((sum, line) => sum + line.amountPence, 0);
    weeks.push({ weekStart, weekEnd, actualPence });
  }
  const groceryTotal = weeks.reduce((sum, week) => sum + week.actualPence, 0);
  const averageWeeklyPence = roundHalfUpDivide(groceryTotal, weekCount);

  const firstOfCurrent = firstOfLocalMonth(today);
  const fuel: HonestyFuel[] = config.monthlyFuelPence.map((vehicle) => {
    const fuelLines = lines.filter(
      (line) =>
        line.childName === FUEL_CHILD &&
        line.targetKind === 'vehicle' &&
        line.targetId === vehicle.vehicleId,
    );
    const months: HonestyFuelMonth[] = [];
    for (let k = monthCount; k >= 1; k -= 1) {
      const monthStart = addMonthsClamped(firstOfCurrent, -k);
      const { from, to } = monthRange(monthOfLocalDate(monthStart));
      const actualPence = fuelLines
        .filter((line) => line.occurredDate >= from && line.occurredDate <= to)
        .reduce((sum, line) => sum + line.amountPence, 0);
      months.push({ month: `${from.slice(0, 4)}-${from.slice(5, 7)}`, from, to, actualPence });
    }
    const total = months.reduce((sum, entry) => sum + entry.actualPence, 0);
    const averageMonthlyPence = roundHalfUpDivide(total, monthCount);
    return {
      vehicleId: vehicle.vehicleId,
      label: vehicle.label,
      months,
      averageMonthlyPence,
      configuredPence: vehicle.configuredPence,
      driftPence:
        vehicle.configuredPence === null ? null : averageMonthlyPence - vehicle.configuredPence,
    };
  });

  return {
    today,
    groceries: {
      parent: GROCERIES_PARENT,
      weeks,
      averageWeeklyPence,
      configuredPence: config.weeklyGroceriesPence,
      driftPence:
        config.weeklyGroceriesPence === null
          ? null
          : averageWeeklyPence - config.weeklyGroceriesPence,
    },
    fuel,
  };
}
