import { addDaysLocal } from './dates';
import { isValidLocalDate } from '../time';

/**
 * Horizon's "Look ahead to" date (SPEC §7.6, decision 150) — pure, so the
 * rules are pinned in Node rather than only through the browser.
 *
 * - An explicit `?through=` that is a valid local date inside
 *   `[minDate, maxDate]` is used exactly as given (a shared or bookmarked
 *   horizon opens on the date it names).
 * - Otherwise the default is **the day before the next scheduled income**
 *   ("where would we land the day before the salary lands?"), clamped into
 *   `[minDate, maxDate]` so the browser never blocks a submission from a field
 *   the page filled in itself: income tomorrow ⇒ `minDate` (the income day
 *   itself); income beyond the cap ⇒ `maxDate`.
 * - With no scheduled income at all, the long-standing fallback stands:
 *   `today + fallbackDays` (five weeks), clamped the same way.
 *
 * All arithmetic is local-calendar (`addDaysLocal`), never `Date` maths.
 */
export interface HorizonThroughInput {
  /** The household's local today, `YYYY-MM-DD`. */
  today: string;
  /** The raw `?through=` value, if any (never trusted). */
  requested?: string | null;
  /** The next scheduled income date (receipt schedules only), or null. */
  nextIncomeDate: string | null;
  /** Earliest selectable date (today + 1). */
  minDate: string;
  /** Latest selectable date (today + 400). */
  maxDate: string;
  /** Fallback window when nothing is expected in (35 days). */
  fallbackDays: number;
}

export type HorizonThroughSource = 'requested' | 'day-before-income' | 'fallback';

export interface HorizonThrough {
  date: string;
  source: HorizonThroughSource;
}

function clamp(date: string, minDate: string, maxDate: string): string {
  if (date < minDate) return minDate;
  if (date > maxDate) return maxDate;
  return date;
}

/** The default alone (no `?through=`): day before the next income, else the fallback. */
export function defaultHorizonThrough(
  input: Omit<HorizonThroughInput, 'requested'>,
): HorizonThrough {
  const { today, nextIncomeDate, minDate, maxDate, fallbackDays } = input;
  if (nextIncomeDate !== null && isValidLocalDate(nextIncomeDate) && nextIncomeDate > today) {
    return {
      date: clamp(addDaysLocal(nextIncomeDate, -1), minDate, maxDate),
      source: 'day-before-income',
    };
  }
  return { date: clamp(addDaysLocal(today, fallbackDays), minDate, maxDate), source: 'fallback' };
}

/** The date the page uses: a valid in-range `?through=`, else the default. */
export function resolveHorizonThrough(input: HorizonThroughInput): HorizonThrough {
  const requested = typeof input.requested === 'string' ? input.requested : '';
  if (isValidLocalDate(requested) && requested >= input.minDate && requested <= input.maxDate) {
    return { date: requested, source: 'requested' };
  }
  return defaultHorizonThrough(input);
}
