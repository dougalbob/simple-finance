import { formatPence, roundHalfUpDivide } from '../money';
import { formatShortLocalDate } from '../time';
import { addDaysLocal, addMonthsClamped, checkedLocalDate } from './dates';
import {
  firstOfLocalMonth,
  formatMonthLabel,
  monthOfLocalDate,
  monthRange,
  startOfWeekLocal,
  type ChildSum,
  type MonthRef,
  type SpendingLineInput,
} from './insights';
import type { ProjectionDay } from './projection';

/**
 * The chart resolvers (docs/SPEC.md §16.7, v0.14.0): the five pure series
 * behind the Charts page — forecast, weekly buckets, monthly buckets,
 * personal spending per person and the tracked fixed commitments.
 *
 * Pure, framework-free, integer-pence — exactly like `insights.ts`, and for
 * the same reason: the drawing layer must not be able to invent a number.
 * A chart is a picture of one of these arrays and nothing else, so the
 * reconciling tests (`tests/charts-view.test.ts`) can sum the purchase
 * history independently and demand the same figures.
 *
 * Conventions shared with the insights engine:
 * - every input row is a flat typed spending line (date, parent/child
 *   category names, one target, signed pence); purchases add and refunds
 *   subtract, so every bucket is NET spending;
 * - all arithmetic is over local 'YYYY-MM-DD' dates, so DST cannot leak in;
 * - a period with no spending is a **zero** bucket, never a missing one —
 *   otherwise an average quietly flatters the household;
 * - the in-progress week/month is carried but flagged `complete: false`, and
 *   averages only ever use complete periods.
 */

/**
 * A spending line that also knows whether its purchase was converted from a
 * schedule (`purchases.scheduleInstanceId`) — the "true DD/SO" flag behind
 * the fixed-commitments chart's stricter view.
 */
export interface ChartSpendingLine extends SpendingLineInput {
  scheduleConverted: boolean;
}

/* ------------------------------------------------------------------ */
/* Drill-down links — a bar is an <a>, not an onClick (decision 155)   */
/* ------------------------------------------------------------------ */

export interface PurchasesLink {
  from?: string;
  to?: string;
  /** Parent ids are expanded to their children by the Purchases page. */
  categoryIds?: readonly number[];
  targetKind?: 'household' | 'person' | 'vehicle';
  targetId?: number;
  potId?: number;
  scheduleOnly?: boolean;
}

/**
 * The `/purchases` URL behind a bar. The review page already accepts every
 * one of these as a plain GET parameter, so a server-rendered `<a>` around a
 * `<rect>` is the whole drill-down: it works without JavaScript, opens in a
 * new tab and can be sent to the other person.
 *
 * One honest wrinkle, stated in the caption on the page: line-level filters
 * match the *purchase*, and a matched purchase comes back with all of its
 * lines, receipt-style — so a split purchase shows up whole, not as the one
 * line that matched.
 */
export function purchasesHref(link: PurchasesLink): string {
  const params = new URLSearchParams();
  if (link.from !== undefined) params.set('from', link.from);
  if (link.to !== undefined) params.set('to', link.to);
  for (const categoryId of link.categoryIds ?? []) {
    params.append('categoryId', String(categoryId));
  }
  if (link.targetKind !== undefined) params.set('targetKind', link.targetKind);
  if (link.targetId !== undefined) params.set('targetId', String(link.targetId));
  if (link.potId !== undefined) params.set('potId', String(link.potId));
  if (link.scheduleOnly === true) params.set('scheduleOnly', '1');
  const query = params.toString();
  return query === '' ? '/purchases' : `/purchases?${query}`;
}

/* ------------------------------------------------------------------ */
/* A. Forecast — the balance from today to the horizon                 */
/* ------------------------------------------------------------------ */

export interface ForecastDay {
  date: string;
  /** Running balance at the end of that day. */
  runningPence: number;
  receiptsPence: number;
  commitmentsPence: number;
  dayToDayPence: number;
  /**
   * True only for the first point: today's balance is the household's own
   * reported figure plus recorded activity. Every later point is projected.
   */
  reported: boolean;
}

export interface ForecastSeries {
  today: string;
  throughDate: string;
  days: ForecastDay[];
  startPence: number;
  endPence: number;
  lowPence: number;
  lowDate: string;
  highPence: number;
  /** First projected day the balance is below zero (null when it never is). */
  belowZeroDate: string | null;
  /** First projected day past the overdraft limit (null when it never is). */
  belowOverdraftDate: string | null;
  /** First projected day under the configured warning threshold. */
  belowThresholdDate: string | null;
  /** Days money is expected in — drawn as ticks, listed in the table twin. */
  incomeDates: string[];
  overdraftLimitPence: number | null;
  warningThresholdPence: number | null;
  /** One sentence: the chart's aria-label and the verdict above it. */
  headline: string;
  /** The three biggest outgoing days, for the "what makes it dip" list. */
  dips: Array<{ date: string; amountPence: number }>;
}

export interface ForecastInput {
  today: string;
  /** household_available_now (SPEC §7.1) — the only reported point. */
  availableNowPence: number;
  /** The projection engine's per-day rows, strictly after today. */
  perDay: readonly ProjectionDay[];
  overdraftLimitPence?: number | null;
  warningThresholdPence?: number | null;
}

/**
 * Today's reported balance followed by one point per projected day (SPEC
 * §7.2/§7.6). The series is a step: the balance changes at day boundaries,
 * so anything smoother would invent values between days.
 *
 * Negatives are first-class — the low is reported as "£X below zero on
 * <date>" rather than clipped, and the overdraft limit is carried through so
 * the drawing layer can tell "overdrawn but inside the limit" from "past it".
 */
export function forecastSeries(input: ForecastInput): ForecastSeries {
  const today = checkedLocalDate(input.today) && input.today;
  const days: ForecastDay[] = [
    {
      date: today,
      runningPence: input.availableNowPence,
      receiptsPence: 0,
      commitmentsPence: 0,
      dayToDayPence: 0,
      reported: true,
    },
    ...input.perDay.map((day) => ({
      date: day.date,
      runningPence: day.runningPence,
      receiptsPence: day.receiptsPence,
      commitmentsPence: day.commitmentsPence,
      dayToDayPence: day.dayToDayPence,
      reported: false,
    })),
  ];

  const overdraftLimitPence = input.overdraftLimitPence ?? null;
  const warningThresholdPence = input.warningThresholdPence ?? null;

  let low = days[0] as ForecastDay;
  let high = days[0] as ForecastDay;
  for (const day of days) {
    if (day.runningPence < low.runningPence) low = day;
    if (day.runningPence > high.runningPence) high = day;
  }

  const firstDateWhere = (predicate: (day: ForecastDay) => boolean): string | null =>
    days.find(predicate)?.date ?? null;

  const dips = days
    .filter((day) => day.commitmentsPence + day.dayToDayPence > 0)
    .map((day) => ({ date: day.date, amountPence: day.commitmentsPence + day.dayToDayPence }))
    .sort((a, b) => b.amountPence - a.amountPence || a.date.localeCompare(b.date))
    .slice(0, 3);

  const lastDay = days[days.length - 1] as ForecastDay;
  const series: ForecastSeries = {
    today,
    throughDate: lastDay.date,
    days,
    startPence: input.availableNowPence,
    endPence: lastDay.runningPence,
    lowPence: low.runningPence,
    lowDate: low.date,
    highPence: high.runningPence,
    belowZeroDate: firstDateWhere((day) => day.runningPence < 0),
    belowOverdraftDate:
      overdraftLimitPence === null
        ? null
        : firstDateWhere((day) => day.runningPence < -overdraftLimitPence),
    belowThresholdDate:
      warningThresholdPence === null
        ? null
        : firstDateWhere((day) => day.runningPence < warningThresholdPence),
    incomeDates: days.filter((day) => day.receiptsPence > 0).map((day) => day.date),
    overdraftLimitPence,
    warningThresholdPence,
    headline: '',
    dips,
  };
  series.headline = describeForecast(series);
  return series;
}

/** The forecast's one sentence — the aria-label and the printed verdict. */
export function describeForecast(series: ForecastSeries): string {
  const when = formatShortLocalDate(series.lowDate);
  if (series.lowPence < 0) {
    const past =
      series.belowOverdraftDate === null
        ? ''
        : ` That is past the ${formatPence(series.overdraftLimitPence ?? 0)} overdraft limit from ${formatShortLocalDate(series.belowOverdraftDate)}.`;
    return `Projected to go ${formatPence(Math.abs(series.lowPence))} below zero on ${when}.${past}`;
  }
  if (series.lowDate === series.today) {
    return `Projected to stay at or above today's ${formatPence(series.lowPence)} through to ${formatShortLocalDate(series.throughDate)}.`;
  }
  return `Lowest projected point ${formatPence(series.lowPence)} on ${when}.`;
}

/* ------------------------------------------------------------------ */
/* B. Weekly buckets — the groceries trend                             */
/* ------------------------------------------------------------------ */

export interface WeekBucket {
  /** Monday of the week, local. */
  weekStart: string;
  /** Sunday of the week, local. */
  weekEnd: string;
  amountPence: number;
  /** False for the week containing `today` — it is still being lived. */
  complete: boolean;
}

export interface WeeklyBucketOptions {
  today: string;
  /** How many Monday–Sunday weeks, ending with the in-progress one. */
  weeks: number;
}

/**
 * Net spending bucketed by local Monday–Sunday week, oldest first, ending
 * with the week containing `today`. A week with nothing recorded is a zero
 * week — the whole point of the chart is to see the quiet weeks next to the
 * loud ones.
 */
export function weeklyBuckets(
  lines: readonly SpendingLineInput[],
  options: WeeklyBucketOptions,
): WeekBucket[] {
  const thisMonday = startOfWeekLocal(options.today);
  const count = Math.max(1, Math.trunc(options.weeks));
  const buckets: WeekBucket[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const weekStart = addDaysLocal(thisMonday, -7 * back);
    const weekEnd = addDaysLocal(weekStart, 6);
    buckets.push({ weekStart, weekEnd, amountPence: 0, complete: back > 0 });
  }
  const index = new Map(buckets.map((bucket, position) => [bucket.weekStart, position]));
  for (const line of lines) {
    const position = index.get(startOfWeekLocal(line.occurredDate));
    if (position === undefined) continue;
    const bucket = buckets[position] as WeekBucket;
    bucket.amountPence += line.amountPence;
  }
  return buckets;
}

export interface GroceriesSeries {
  weeks: WeekBucket[];
  configuredWeeklyPence: number | null;
  /** Trailing average over complete weeks only (the "are"). */
  averagePence: number;
  /** How many complete weeks went into that average. */
  averageWeeks: number;
  /** average − configured; null when nothing is configured. */
  driftPence: number | null;
  headline: string;
}

export interface GroceriesSeriesOptions extends WeeklyBucketOptions {
  configuredWeeklyPence: number | null;
  /** How many complete weeks the trailing average uses (default 8). */
  averageWeeks?: number;
}

/**
 * The groceries chart's series: weekly buckets, the configured weekly figure
 * (the "should") and the trailing average over complete weeks (the "are").
 * Two reference lines, one verdict.
 */
export function groceriesSeries(
  lines: readonly SpendingLineInput[],
  options: GroceriesSeriesOptions,
): GroceriesSeries {
  const weeks = weeklyBuckets(lines, options);
  const wanted = Math.max(1, Math.trunc(options.averageWeeks ?? 8));
  const complete = weeks.filter((week) => week.complete).slice(-wanted);
  const total = complete.reduce((sum, week) => sum + week.amountPence, 0);
  const averageWeeks = complete.length;
  const averagePence = averageWeeks === 0 ? 0 : roundHalfUpDivide(total, averageWeeks);
  const configuredWeeklyPence = options.configuredWeeklyPence;
  const driftPence = configuredWeeklyPence === null ? null : averagePence - configuredWeeklyPence;
  return {
    weeks,
    configuredWeeklyPence,
    averagePence,
    averageWeeks,
    driftPence,
    headline: describeGroceries(averagePence, averageWeeks, configuredWeeklyPence),
  };
}

function describeGroceries(
  averagePence: number,
  averageWeeks: number,
  configuredWeeklyPence: number | null,
): string {
  if (averageWeeks === 0) {
    return 'No complete week of shopping recorded yet.';
  }
  const spent = `${formatPence(averagePence)} a week over the last ${averageWeeks} complete ${
    averageWeeks === 1 ? 'week' : 'weeks'
  }`;
  if (configuredWeeklyPence === null) {
    return `${spent}. No weekly grocery figure is configured yet.`;
  }
  const drift = averagePence - configuredWeeklyPence;
  if (drift === 0)
    return `${spent} — exactly the ${formatPence(configuredWeeklyPence)} configured.`;
  const direction = drift > 0 ? 'over' : 'under';
  return `${spent}, ${formatPence(Math.abs(drift))} a week ${direction} the ${formatPence(
    configuredWeeklyPence,
  )} configured.`;
}

/* ------------------------------------------------------------------ */
/* Monthly buckets — shared by the personal and commitment charts      */
/* ------------------------------------------------------------------ */

export interface MonthBucket {
  month: MonthRef;
  label: string;
  from: string;
  to: string;
  amountPence: number;
  /** False for the month containing `today`. */
  complete: boolean;
}

export interface MonthlyBucketOptions {
  today: string;
  /** How many calendar months, ending with the in-progress one. */
  months: number;
}

/** The empty (zero) calendar-month frame the monthly charts hang figures on. */
function monthFrame(options: MonthlyBucketOptions): MonthBucket[] {
  const firstOfThisMonth = firstOfLocalMonth(options.today);
  const count = Math.max(1, Math.trunc(options.months));
  const frame: MonthBucket[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const monthStart = addMonthsClamped(firstOfThisMonth, -back);
    const month = monthOfLocalDate(monthStart);
    const { from, to } = monthRange(month);
    frame.push({
      month,
      label: formatMonthLabel(month),
      from,
      to,
      amountPence: 0,
      complete: back > 0,
    });
  }
  return frame;
}

/**
 * Net spending bucketed by calendar month, oldest first, ending with the
 * in-progress current month. Zero months are kept, for the same reason zero
 * weeks are.
 */
export function monthlyBuckets(
  lines: readonly SpendingLineInput[],
  options: MonthlyBucketOptions,
): MonthBucket[] {
  const buckets = monthFrame(options);
  const index = new Map(buckets.map((bucket, position) => [bucket.from.slice(0, 7), position]));
  for (const line of lines) {
    const position = index.get(line.occurredDate.slice(0, 7));
    if (position === undefined) continue;
    const bucket = buckets[position] as MonthBucket;
    bucket.amountPence += line.amountPence;
  }
  return buckets;
}

/* ------------------------------------------------------------------ */
/* C. Personal spending — hers, his, household                         */
/* ------------------------------------------------------------------ */

export interface PersonalSeriesRef {
  /** 'person:<id>' or 'household' — stable across months for stacking. */
  key: string;
  kind: 'person' | 'household';
  personId: number | null;
  label: string;
}

export interface PersonalCell {
  key: string;
  amountPence: number;
  children: ChildSum[];
}

export interface PersonalMonthPoint extends Omit<MonthBucket, 'amountPence'> {
  totalPence: number;
  /** One cell per series, in `series` order — stacking is index-aligned. */
  cells: PersonalCell[];
}

export interface PersonalSeries {
  /** The parents in scope (from the live tree, never hard-coded names). */
  parentNames: string[];
  series: PersonalSeriesRef[];
  months: PersonalMonthPoint[];
  /** Window totals per series, in `series` order. */
  totals: PersonalCell[];
  headline: string;
}

export interface PersonalSeriesOptions extends MonthlyBucketOptions {
  /** Parent categories that count as discretionary (SPEC §16.7). */
  parentNames: readonly string[];
  /**
   * Which series to produce, by key ('person:3', 'household'). Omitted (or
   * empty) means all of them — the filter chips on the page pass a subset,
   * and the headline and totals then describe exactly what is drawn.
   */
  include?: readonly string[];
}

export interface PersonRef {
  id: number;
  label: string;
}

/**
 * Discretionary spending per month, split into one series per person plus a
 * Household series (SPEC §16.7 C).
 *
 * Attribution is **"For: person"** — the allocation's target, the same rule
 * Insights panel 2 holds. Not "Paid by": that only says whose card was used.
 * A line marked "For: household" (a joint takeaway, a shared subscription)
 * is its own series and is never split between people — that is the honest
 * answer, and the caption says so.
 *
 * Vehicle-targeted lines are excluded: they belong to the vehicle (SPEC
 * §13), and the vehicle running-cost panel already answers for them.
 */
export function personalSpendSeries(
  lines: readonly SpendingLineInput[],
  people: readonly PersonRef[],
  options: PersonalSeriesOptions,
): PersonalSeries {
  const parents = new Set(options.parentNames);
  const wanted =
    options.include === undefined || options.include.length === 0 ? null : new Set(options.include);
  const series: PersonalSeriesRef[] = [
    ...people.map((person) => ({
      key: `person:${person.id}`,
      kind: 'person' as const,
      personId: person.id,
      label: person.label,
    })),
    { key: 'household', kind: 'household' as const, personId: null, label: 'Household' },
  ].filter((ref) => wanted === null || wanted.has(ref.key));

  const frame = monthFrame(options);
  const monthIndex = new Map(frame.map((bucket, position) => [bucket.from.slice(0, 7), position]));
  const seriesIndex = new Map(series.map((ref, position) => [ref.key, position]));

  const childSums: Array<Array<Map<string, number>>> = frame.map(() => series.map(() => new Map()));
  const cellTotals: number[][] = frame.map(() => series.map(() => 0));

  for (const line of lines) {
    if (!parents.has(line.parentName)) continue;
    const monthPosition = monthIndex.get(line.occurredDate.slice(0, 7));
    if (monthPosition === undefined) continue;
    const key =
      line.targetKind === 'person' && line.targetId !== null
        ? `person:${line.targetId}`
        : line.targetKind === 'household'
          ? 'household'
          : null;
    if (key === null) continue;
    const seriesPosition = seriesIndex.get(key);
    if (seriesPosition === undefined) continue;
    (cellTotals[monthPosition] as number[])[seriesPosition] =
      ((cellTotals[monthPosition] as number[])[seriesPosition] as number) + line.amountPence;
    const children = (childSums[monthPosition] as Array<Map<string, number>>)[
      seriesPosition
    ] as Map<string, number>;
    const childKey = `${line.parentName} / ${line.childName}`;
    children.set(childKey, (children.get(childKey) ?? 0) + line.amountPence);
  }

  const months: PersonalMonthPoint[] = frame.map((bucket, monthPosition) => {
    const cells: PersonalCell[] = series.map((ref, seriesPosition) => ({
      key: ref.key,
      amountPence: (cellTotals[monthPosition] as number[])[seriesPosition] as number,
      children: sortedChildren(
        (childSums[monthPosition] as Array<Map<string, number>>)[seriesPosition] as Map<
          string,
          number
        >,
      ),
    }));
    return {
      month: bucket.month,
      label: bucket.label,
      from: bucket.from,
      to: bucket.to,
      complete: bucket.complete,
      totalPence: cells.reduce((sum, cell) => sum + cell.amountPence, 0),
      cells,
    };
  });

  const totals: PersonalCell[] = series.map((ref, seriesPosition) => {
    const children = new Map<string, number>();
    for (const month of months) {
      for (const child of (month.cells[seriesPosition] as PersonalCell).children) {
        children.set(child.child, (children.get(child.child) ?? 0) + child.amountPence);
      }
    }
    return {
      key: ref.key,
      amountPence: months.reduce(
        (sum, month) => sum + (month.cells[seriesPosition] as PersonalCell).amountPence,
        0,
      ),
      children: sortedChildren(children),
    };
  });

  return {
    parentNames: [...options.parentNames],
    series,
    months,
    totals,
    headline: describePersonal(series, totals, months.length),
  };
}

function sortedChildren(children: Map<string, number>): ChildSum[] {
  return [...children.entries()]
    .filter(([, amountPence]) => amountPence !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([child, amountPence]) => ({ child, amountPence }));
}

function describePersonal(
  series: readonly PersonalSeriesRef[],
  totals: readonly PersonalCell[],
  months: number,
): string {
  const parts = series.map(
    (ref, position) =>
      `${ref.label} ${formatPence((totals[position] as PersonalCell).amountPence)}`,
  );
  return `Over ${months} ${months === 1 ? 'month' : 'months'}: ${parts.join(', ')}.`;
}

/* ------------------------------------------------------------------ */
/* D. Fixed commitments — are the direct debits coming down            */
/* ------------------------------------------------------------------ */

export interface CommitmentCategorySum {
  categoryId: number;
  parent: string;
  child: string;
  amountPence: number;
}

export interface CommitmentMonthPoint extends MonthBucket {
  byCategory: CommitmentCategorySum[];
}

export interface CommitmentSeries {
  months: CommitmentMonthPoint[];
  trackedCategoryIds: number[];
  /** True when narrowed to purchases converted from a schedule. */
  scheduleOnly: boolean;
  /** The most recent complete month (null when the window has none). */
  latestCompletePence: number | null;
  latestCompleteLabel: string | null;
  /** The complete month three months before that one. */
  comparedPence: number | null;
  comparedLabel: string | null;
  deltaPence: number | null;
  /** Every tracked category, summed over the window — the laptop breakdown. */
  byCategory: CommitmentCategorySum[];
  headline: string;
}

export interface CommitmentSeriesOptions extends MonthlyBucketOptions {
  /** Child category ids the household ticked in Settings. */
  trackedCategoryIds: readonly number[];
  /** Narrow to purchases converted from a schedule (true DD/SO). */
  scheduleOnly?: boolean;
}

/**
 * Monthly totals for the household's tracked fixed commitments (SPEC §16.7
 * D). "Direct debit" is not a field on a purchase, so the definition is the
 * household's own: the set of **child categories** they ticked in Settings
 * (`commitment_category_ids`) — which is why Vehicle Running can have
 * Insurance and Road Tax tracked while Fuel is not. The schedule-converted
 * toggle narrows the same set to purchases the app itself converted from a
 * schedule, for the strict bills-only view.
 */
export function commitmentSeries(
  lines: readonly ChartSpendingLine[],
  options: CommitmentSeriesOptions,
): CommitmentSeries {
  const tracked = new Set(options.trackedCategoryIds);
  const scheduleOnly = options.scheduleOnly === true;
  const frame = monthFrame(options);
  const monthIndex = new Map(frame.map((bucket, position) => [bucket.from.slice(0, 7), position]));
  const perMonthCategories: Array<Map<number, CommitmentCategorySum>> = frame.map(() => new Map());
  const windowCategories = new Map<number, CommitmentCategorySum>();

  for (const line of lines) {
    if (!tracked.has(line.categoryId)) continue;
    if (scheduleOnly && !line.scheduleConverted) continue;
    const position = monthIndex.get(line.occurredDate.slice(0, 7));
    if (position === undefined) continue;
    const bucket = frame[position] as MonthBucket;
    bucket.amountPence += line.amountPence;
    addCategory(perMonthCategories[position] as Map<number, CommitmentCategorySum>, line);
    addCategory(windowCategories, line);
  }

  const months: CommitmentMonthPoint[] = frame.map((bucket, position) => ({
    ...bucket,
    byCategory: sortCategories(perMonthCategories[position] as Map<number, CommitmentCategorySum>),
  }));

  const completeMonths = months.filter((month) => month.complete);
  const latest = completeMonths[completeMonths.length - 1] ?? null;
  const compared = completeMonths[completeMonths.length - 4] ?? null;
  const deltaPence =
    latest === null || compared === null ? null : latest.amountPence - compared.amountPence;

  return {
    months,
    trackedCategoryIds: [...options.trackedCategoryIds],
    scheduleOnly,
    latestCompletePence: latest?.amountPence ?? null,
    latestCompleteLabel: latest?.label ?? null,
    comparedPence: compared?.amountPence ?? null,
    comparedLabel: compared?.label ?? null,
    deltaPence,
    byCategory: sortCategories(windowCategories),
    headline: describeCommitments(
      options.trackedCategoryIds.length,
      latest,
      compared,
      deltaPence,
      scheduleOnly,
    ),
  };
}

function addCategory(
  into: Map<number, CommitmentCategorySum>,
  line: ChartSpendingLine | SpendingLineInput,
): void {
  const existing = into.get(line.categoryId);
  if (existing === undefined) {
    into.set(line.categoryId, {
      categoryId: line.categoryId,
      parent: line.parentName,
      child: line.childName,
      amountPence: line.amountPence,
    });
    return;
  }
  existing.amountPence += line.amountPence;
}

function sortCategories(from: Map<number, CommitmentCategorySum>): CommitmentCategorySum[] {
  return [...from.values()].sort(
    (a, b) =>
      b.amountPence - a.amountPence ||
      a.parent.localeCompare(b.parent) ||
      a.child.localeCompare(b.child),
  );
}

function describeCommitments(
  trackedCount: number,
  latest: CommitmentMonthPoint | null,
  compared: CommitmentMonthPoint | null,
  deltaPence: number | null,
  scheduleOnly: boolean,
): string {
  const strict = scheduleOnly ? ' (schedule-converted only)' : '';
  if (trackedCount === 0) {
    return 'No categories are tracked as fixed commitments yet — choose them in Settings.';
  }
  if (latest === null) {
    return `No complete month of tracked commitments yet${strict}.`;
  }
  const headline = `${formatPence(latest.amountPence)} in ${latest.label}${strict}`;
  if (compared === null || deltaPence === null) {
    return `${headline}.`;
  }
  if (deltaPence === 0) {
    return `${headline} — level with ${compared.label}.`;
  }
  const direction = deltaPence < 0 ? 'down' : 'up';
  return `${headline} — ${direction} ${formatPence(Math.abs(deltaPence))} on ${compared.label}.`;
}
