import { toLocalDateString } from '../time';
import { periodProjectionPence } from '../money';
import { addDaysLocal, daysBetween } from './dates';

/**
 * The payday-to-payday projection engine (docs/SPEC.md §7.2–§7.3), the two
 * warning tiers (§8) and the pot-level "plan a transfer" watch (§7.5).
 * Pure, framework-free, penny-exact — shared by the Overview/Insights UI
 * and the tests (scenario E8 is the forecast acceptance case).
 *
 * Semantics fixed by the worked example E8:
 * - `days` = payday − today in whole local days; the window is the days
 *   strictly after today up to and including payday.
 * - The configured day-to-day block (groceries + per-vehicle fuel, each
 *   rounded once at the period level, half-up) is applied pessimistically
 *   up front — the low is computed as if all predictable spending happens
 *   before the pay lands. E8 subtracts the full period totals before the
 *   salary and the result must match to the penny.
 * - Expected receipts and commitments (unconverted schedule instances only)
 *   apply on their due day; within a day, outgoings apply before receipts
 *   (still the conservative direction).
 * - `projected_low` = the minimum running value in the window (inclusive of
 *   the start). It normally occurs just before salary lands. The projection
 *   includes expected income — it is not a spending-only forecast.
 *
 * The engine is generic over the window: the "payday" is only the window's
 * upper bound. The horizon projection (SPEC §7.6) reuses it by passing the
 * chosen date as `paydayDate`; the final day's `runningPence` is then
 * `availableNowPence + Σ receipts − Σ commitments − dayToDay` — the
 * "where we'd land" figure, pinned by a property test.
 */

export interface ProjectionScheduleLine {
  scheduleId: number;
  name: string;
  potId: number;
  amountPence: number;
  dueDate: string; // 'YYYY-MM-DD'
  /**
   * True for money that is expected but not received (a debt's expected
   * inflow, v0.5.0 — borrowed money is never income, it may only be
   * *expected* in a projection). Never affects the engine's arithmetic.
   */
  expected?: boolean;
}

export interface PotWatchInput {
  potId: number;
  /** null when the pot has no checkpoint — no estimate, no watch. */
  estimatePence: number | null;
  /** Commitments due from this pot inside the window (post-conversion state). */
  commitments: ProjectionScheduleLine[];
}

export interface ProjectionInput {
  now: Date;
  /** household_available_now (SPEC §7.1) — null when no pot is checkpointed. */
  availableNowPence: number;
  /** Next expected-receipt due date (the planning-cycle payday, SPEC §11.3). */
  paydayDate: string | null;
  commitments: ProjectionScheduleLine[];
  receipts: ProjectionScheduleLine[];
  weeklyGroceriesPence: number;
  /** Per-vehicle configured monthly fuel figures (SPEC §7.3). */
  monthlyFuelPence: number[];
  /** Overdraft warning threshold in pence (SPEC §8); null when none configured. */
  warningThresholdPence: number | null;
  potWatches: PotWatchInput[];
}

export type WarningTier = 'none' | 'heads-up' | 'warning';

export interface ProjectionDay {
  date: string;
  receiptsPence: number;
  commitmentsPence: number;
  /** Running value at the end of the day (after that day's receipts landed). */
  runningPence: number;
}

export interface PotWatchResult {
  potId: number;
  estimatePence: number;
  commitmentsPence: number;
  watchPence: number;
  shortfallPence: number;
  /** null when the pot is short without any due commitments. */
  earliestDueDate: string | null;
  earliestCommitments: Array<{ name: string; amountPence: number }>;
}

export interface ProjectionResult {
  availableNowPence: number;
  paydayDate: string | null;
  days: number;
  groceriesPence: number;
  fuelPence: number;
  dayToDayPence: number;
  totalCommitmentsPence: number;
  totalReceiptsPence: number;
  /** null when there is no payday (no income schedule configured). */
  projectedLowPence: number | null;
  lowDate: string | null;
  tier: WarningTier;
  warningThresholdPence: number | null;
  perDay: ProjectionDay[];
  potWatches: PotWatchResult[];
}

export function projectToPayday(input: ProjectionInput): ProjectionResult {
  const today = toLocalDateString(input.now);
  const days = input.paydayDate === null ? 0 : daysBetween(today, input.paydayDate);
  const hasWindow = input.paydayDate !== null && days > 0;

  const groceriesPence = periodProjectionPence(input.weeklyGroceriesPence, Math.max(days, 0), 7);
  const fuelPence = input.monthlyFuelPence.reduce(
    (sum, pence) => sum + periodProjectionPence(pence, Math.max(days, 0), 30),
    0,
  );
  const dayToDayPence = groceriesPence + fuelPence;

  let projectedLowPence: number | null = null;
  let lowDate: string | null = null;
  const perDay: ProjectionDay[] = [];

  if (hasWindow) {
    const commitmentsByDate = sumByDate(input.commitments);
    const receiptsByDate = sumByDate(input.receipts);
    const base = input.availableNowPence - dayToDayPence;

    projectedLowPence = base;
    lowDate = today;
    let receiptsCumulative = 0;
    let commitmentsCumulative = 0;

    for (let step = 1; step <= days; step += 1) {
      const date = addDaysLocal(today, step);
      const commitmentsDue = commitmentsByDate.get(date) ?? 0;
      const receiptsDue = receiptsByDate.get(date) ?? 0;

      // Outgoings apply before receipts on the same day (conservative).
      const minOfDay = base + receiptsCumulative - commitmentsCumulative - commitmentsDue;
      const endOfDay = minOfDay + receiptsDue;
      if (minOfDay < projectedLowPence) {
        projectedLowPence = minOfDay;
        lowDate = date;
      }
      if (endOfDay < projectedLowPence) {
        projectedLowPence = endOfDay;
        lowDate = date;
      }
      commitmentsCumulative += commitmentsDue;
      receiptsCumulative += receiptsDue;
      perDay.push({
        date,
        receiptsPence: receiptsDue,
        commitmentsPence: commitmentsDue,
        runningPence: endOfDay,
      });
    }
  }

  const tier = selectTier(projectedLowPence, input.warningThresholdPence);
  const potWatches = input.potWatches
    .map((watch) => evaluatePotWatch(watch))
    .filter((watch): watch is PotWatchResult => watch !== null);

  return {
    availableNowPence: input.availableNowPence,
    paydayDate: input.paydayDate,
    days,
    groceriesPence,
    fuelPence,
    dayToDayPence,
    totalCommitmentsPence: sum(input.commitments.map((line) => line.amountPence)),
    totalReceiptsPence: sum(input.receipts.map((line) => line.amountPence)),
    projectedLowPence,
    lowDate,
    tier,
    warningThresholdPence: input.warningThresholdPence,
    perDay,
    potWatches,
  };
}

/**
 * SPEC §8: two tiers against `projected_low`, household-wide.
 * Tier 1 (heads-up): below £0. Tier 2 (warning): at or beyond the
 * configured overdrawn threshold. No third tier in v1.
 */
export function selectTier(
  projectedLowPence: number | null,
  warningThresholdPence: number | null,
): WarningTier {
  if (projectedLowPence === null) return 'none';
  if (warningThresholdPence !== null && projectedLowPence <= -Math.abs(warningThresholdPence)) {
    return 'warning';
  }
  if (projectedLowPence < 0) return 'heads-up';
  return 'none';
}

/**
 * SPEC §7.5: the pot-level watch deliberately excludes day-to-day
 * projection (groceries/fuel vary by pot and payment method and would muddy
 * a transfer-planning signal). Only the pot's own commitments count.
 */
function evaluatePotWatch(input: PotWatchInput): PotWatchResult | null {
  if (input.estimatePence === null) return null;
  const commitmentsPence = sum(input.commitments.map((line) => line.amountPence));
  const watchPence = input.estimatePence - commitmentsPence;
  if (watchPence >= 0) return null;
  const firstDue = input.commitments[0]?.dueDate;
  const earliestDueDate =
    firstDue === undefined
      ? null
      : input.commitments.reduce(
          (min, line) => (line.dueDate < min ? line.dueDate : min),
          firstDue,
        );
  return {
    potId: input.potId,
    estimatePence: input.estimatePence,
    commitmentsPence,
    watchPence,
    shortfallPence: -watchPence,
    earliestDueDate,
    earliestCommitments: input.commitments
      .filter((line) => earliestDueDate !== null && line.dueDate === earliestDueDate)
      .map((line) => ({ name: line.name, amountPence: line.amountPence })),
  };
}

function sumByDate(lines: readonly ProjectionScheduleLine[]): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const line of lines) {
    byDate.set(line.dueDate, (byDate.get(line.dueDate) ?? 0) + line.amountPence);
  }
  return byDate;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
