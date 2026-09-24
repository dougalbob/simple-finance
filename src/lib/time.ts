/**
 * Time helpers. Business timezone is Europe/London (blueprint §2).
 * Instants are stored in UTC; date-only facts are stored date-only (Phase 2+).
 * Rendering to local time happens here, in one place.
 */
export const BUSINESS_TIMEZONE = 'Europe/London';

/**
 * Render an instant in the business timezone, e.g. "22 Sept 2026, 17:00".
 */
export function formatInstantLocal(instant: Date, timeZone: string = BUSINESS_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(instant);
}

/**
 * Rough, honest "how long ago" label for checkpoint staleness display
 * (docs/SPEC.md §4: the last-updated age of every pot must always be visible).
 */
export function formatRelativeAge(instant: Date, now: Date = new Date()): string {
  const ms = now.getTime() - instant.getTime();
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 14) return plural(days, 'day');
  if (days < 70) return plural(Math.floor(days / 7), 'week');
  return plural(Math.floor(days / 30), 'month');
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Strict 'YYYY-MM-DD' check that also rejects impossible calendar dates
 * (2026-02-30, 2026-13-01, …). Pure — used by domain validation and tests.
 */
export function isValidLocalDate(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Short, human label for a 'YYYY-MM-DD' local calendar date, e.g.
 * "Fri 27 Sep". The value is already a local date, so it is assembled from
 * parts in UTC rather than parsed as an instant — no timezone drift, and the
 * same string on the server and in the browser.
 */
export function formatShortLocalDate(dateString: string): string {
  const match = DATE_ONLY_PATTERN.exec(dateString);
  if (match === null) return dateString;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

/**
 * Local calendar date of an instant as 'YYYY-MM-DD' in the business timezone.
 * Assembled from formatToParts so the shape never depends on locale order.
 */
export function toLocalDateString(instant: Date, timeZone: string = BUSINESS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * How far local wall-clock time is ahead of UTC at the given instant, in
 * milliseconds (positive east of Greenwich). One Intl call per invocation.
 */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  // Truncate the instant to whole seconds so sub-second time never leaks in.
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant a date-only fact takes effect: the last millisecond of that
 * local date (SPEC §5 — a date-only checkpoint \"takes effect at the end of
 * that local date\"; backdated purchases/transfers follow the same rule. The
 * same-day tie-break against a timed checkpoint is sign-aware per SPEC §7.1:
 * date-only debits count as after, date-only credits as absorbed — the
 * estimate can only understate). DST-safe: Europe/London transitions happen at
 * 01:00 UTC, far from 23:59, and the offset lookup is iterated to converge.
 */
export function endOfLocalDate(dateString: string, timeZone: string = BUSINESS_TIMEZONE): Date {
  if (!isValidLocalDate(dateString)) {
    throw new Error(
      `Expected a local date like 2026-09-24, received ${JSON.stringify(dateString)}`,
    );
  }
  const [year, month, day] = dateString.split('-').map(Number) as [number, number, number];
  const wallUtcMs = Date.UTC(year, (month as number) - 1, day, 23, 59, 59, 999);
  let utcMs = wallUtcMs;
  for (let i = 0; i < 3; i += 1) {
    utcMs = wallUtcMs - timeZoneOffsetMs(new Date(utcMs), timeZone);
  }
  return new Date(utcMs);
}

/**
 * The instant a local date begins: 00:00 of that date in the business
 * timezone (the inverse of endOfLocalDate). Schedule instances convert at
 * local midnight on their due date (SPEC §11.2); Europe/London transitions
 * its clocks at 01:00/02:00, so local midnight exists on every day, but the
 * offset lookup is still iterated to converge for the same reason endOfLocalDate is.
 */
export function startOfLocalDate(dateString: string, timeZone: string = BUSINESS_TIMEZONE): Date {
  if (!isValidLocalDate(dateString)) {
    throw new Error(
      `Expected a local date like 2026-09-24, received ${JSON.stringify(dateString)}`,
    );
  }
  const [year, month, day] = dateString.split('-').map(Number) as [number, number, number];
  const wallUtcMs = Date.UTC(year, (month as number) - 1, day, 0, 0, 0, 0);
  let utcMs = wallUtcMs;
  for (let i = 0; i < 3; i += 1) {
    utcMs = wallUtcMs - timeZoneOffsetMs(new Date(utcMs), timeZone);
  }
  return new Date(utcMs);
}

/**
 * True when an instant is exactly the end-of-local-date marker for its own
 * local date — i.e. it was produced by endOfLocalDate from a date-only
 * entry. Used by the estimate engine's comparison-precision rule (SPEC
 * §7.1): a real timed entry at 23:59:59.999 cannot occur (mobile entry
 * stamps whole seconds on a tap), so the marker identifies date-only facts
 * unambiguously.
 */
export function isDateOnlyInstant(instant: Date, dateString: string): boolean {
  return instant.getTime() === endOfLocalDate(dateString).getTime();
}
