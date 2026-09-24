import { isValidLocalDate } from '../time';

/**
 * Pure local-date arithmetic for schedules, the payday projection and
 * key-date alerts (docs/SPEC.md §7.2, §11, §22).
 *
 * Every fact here is a 'YYYY-MM-DD' local calendar date (Europe/London) —
 * never an instant. Arithmetic converts dates to whole "day numbers" in a
 * UTC coordinate system, so DST transitions (which only shift instants,
 * never local dates) can never leak in.
 */

export interface LocalDate {
  year: number;
  month: number; // 1–12
  day: number; // 1–last day of month
}

export function checkedLocalDate(value: string): LocalDate {
  if (!isValidLocalDate(value)) {
    throw new Error(`Expected a local date like 2026-09-24, received ${JSON.stringify(value)}`);
  }
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

export function toDateString(date: LocalDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(
    date.day,
  ).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Whole days from 'a' to 'b' in local calendar time (negative when b < a). */
export function daysBetween(a: string, b: string): number {
  const dayA = dayNumber(checkedLocalDate(a));
  const dayB = dayNumber(checkedLocalDate(b));
  return Math.round((dayB - dayA) / 86_400_000);
}

function dayNumber(date: LocalDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

export function addDaysLocal(dateString: string, days: number): string {
  const date = checkedLocalDate(dateString);
  return toDateString(fromDayNumber(dayNumber(date) + days * 86_400_000));
}

export function fromDayNumber(ms: number): LocalDate {
  const utc = new Date(ms);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

/**
 * Advance one month, clamping the day to the target month's last day
 * (plan OQ1: a schedule due on the 31st lands on the 30th in April, the
 * 28th/29th in February). The clamp is re-derived from the original day
 * every step, so 31st-of-month stays anchored: Jan 31 → Feb 28 → Mar 31.
 */
export function addMonthsClamped(dateString: string, months: number): string {
  const date = checkedLocalDate(dateString);
  const total = date.month - 1 + months;
  const year = date.year + Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  const day = Math.min(date.day, daysInMonth(year, month));
  return toDateString({ year, month, day });
}

/**
 * Advance one year, landing 29 February on 28 February in non-leap years
 * (plan OQ13, "visible and editable"). Other dates pass through unchanged;
 * once clamped to the 28th a date stays the 28th — users can fix the date
 * by hand, which is the agreed honest behaviour.
 */
export function addYearsClamped(dateString: string, years: number): string {
  const date = checkedLocalDate(dateString);
  const year = date.year + years;
  const day = date.month === 2 && date.day === 29 && !isLeapYear(year) ? 28 : date.day;
  return toDateString({ year, month: date.month, day });
}

/**
 * Day of the week for a local date: 0 = Sunday … 6 = Saturday. Derived from
 * the same UTC day number every other helper here uses, so DST cannot shift
 * it (a local date's weekday never depends on the instant).
 */
export function weekdayOf(dateString: string): number {
  return new Date(dayNumber(checkedLocalDate(dateString))).getUTCDay();
}

/**
 * Payday rule (SPEC §11.3, plan OQ2 resolved 2026-09-23): **income is paid
 * on the previous Friday when the configured due day falls on a weekend.**
 * Salaries do not wait for Monday — the money lands before the weekend, so
 * the app must expect it then.
 *
 * Monday–Friday pass through untouched; Saturday moves back one day and
 * Sunday two, both to the same Friday. Only *income* schedules shift (a
 * direct debits leave on the date the household configured). Bank holidays
 * are deliberately NOT handled: the app has no holiday data and will not
 * guess one, so a Good Friday salary still expects the record on that day —
 * the receipt can be corrected by hand, and the projection is the only
 * consumer, so a wrong expectation is visible and never silently wrong
 * money.
 */
export function shiftIncomeOffWeekend(dateString: string): string {
  const weekday = weekdayOf(dateString);
  if (weekday === 6) return addDaysLocal(dateString, -1); // Saturday → Friday
  if (weekday === 0) return addDaysLocal(dateString, -2); // Sunday → Friday
  return dateString;
}

/**
 * The due date for a monthly/annual schedule falling in a given month/year:
 * the configured day (1–31), clamped to that month's last day (plan OQ1 —
 * a schedule due on the 31st lands on the 30th in April, the 28th/29th in
 * February). Clamping is the whole point: "due the 29th" in February is a
 * legal due day that simply lands on the 28th/29th, so it does not throw.
 * Only structurally impossible inputs (day 0/32, month 0/13) reject.
 */
export function clampedDueDate(dueDayOfMonth: number, year: number, month: number): string {
  if (!Number.isInteger(dueDayOfMonth) || dueDayOfMonth < 1 || dueDayOfMonth > 31) {
    throw new Error(`Due day must be between 1 and 31, got ${dueDayOfMonth}.`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Month must be between 1 and 12, got ${month}.`);
  }
  const day = Math.min(dueDayOfMonth, daysInMonth(year, month));
  return toDateString({ year, month, day });
}

/**
 * Every occurrence of a day-of-month in an (after, through] window of local
 * dates (SPEC §11.3, v0.5.0). Pure month-by-month stepping with the same
 * clamping rules as schedules (plan OQ1) and the same weekend shift as
 * income (`shiftIncomeOffWeekend`): a support payment configured for the
 * 12th is expected on the previous Friday when the 12th is a weekend —
 * decision 7 in the v0.5.0 plan, the exact rule `dueDateForPeriod` applies
 * to income schedules.
 *
 * The window is derived-only — nothing is materialized. Starts at the month
 * of `afterDate` (the step after the window anchor is still filtered out by
 * `date > afterDate`) and, like `dueDateForPeriod`, membership is decided by
 * the **configured** (clamped) date, never the shifted one, so an occurrence
 * that moves back over the window edge onto its Friday is never dropped.
 * Mirror of `candidateForPeriod`'s rule in schedules.ts: due exactly on
 * `throughDate` is included, on `afterDate` is excluded.
 */
export function incomeOccurrencesBetween(
  dayOfMonth: number,
  afterDate: string,
  throughDate: string,
): string[] {
  const from = checkedLocalDate(afterDate);
  const through = checkedLocalDate(throughDate);
  if (throughDate <= afterDate) return [];
  // Up to 24 months is far beyond any horizon the UI offers (today + 400
  // days); the guard stops a malformed wide window from spinning.
  const result: string[] = [];
  let year = from.year;
  let month = from.month;
  let guard = 0;
  while ((year < through.year || (year === through.year && month <= through.month)) && guard < 24) {
    const configured = clampedDueDate(dayOfMonth, year, month);
    if (configured > afterDate && configured <= throughDate) {
      result.push(shiftIncomeOffWeekend(configured));
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    guard += 1;
  }
  return result;
}
