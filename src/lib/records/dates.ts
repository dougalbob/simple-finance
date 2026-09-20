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
