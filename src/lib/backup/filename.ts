import { BUSINESS_TIMEZONE } from '../time';

/**
 * Backup filename contract (AGENT_APP_BLUEPRINT.md §6 — the v0.2.21 lesson,
 * docs/SPEC.md §18.3):
 *
 *   simple-finance-backup-v<app-version>-YYYY-MM-DD-HHmmss.simple-finance-backup
 *
 * - Date and time are generated from the SAME instant, rendered in the
 *   business timezone (Europe/London).
 * - Seconds are included (minute precision does not guarantee uniqueness).
 *   Note: during the repeated hour of the autumn DST fallback two distinct
 *   instants can share a wall-clock second — vanishingly unlikely for
 *   user-initiated downloads; revisit only if real use demands it.
 * - The server sets Content-Disposition; any client blob-download path must
 *   carry this filename into anchor.download (blob URLs do not inherit
 *   response headers). Client-side behaviour is exercised in Phase 5.
 */
export function backupFilename(appVersion: string, instant: Date): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .format(instant)
    .replaceAll(':', '');
  return `simple-finance-backup-v${appVersion}-${date}-${time}.simple-finance-backup`;
}
