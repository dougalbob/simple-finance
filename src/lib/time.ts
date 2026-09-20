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
