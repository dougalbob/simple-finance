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
export const BACKUP_FILENAME_SUFFIX = '.simple-finance-backup';
export const BACKUP_FILENAME_FALLBACK_PREFIX = 'simple-finance-backup';

/**
 * The name a browser should use when the server's `Content-Disposition` header
 * is missing or unusable. A blob URL does **not** inherit response headers, so
 * the client download path must always have a defensible name of its own
 * (blueprint §6 — the v0.2.21 lesson). Generated from the client's clock in the
 * business timezone, so it matches the server's shape even offline.
 */
export function fallbackBackupFilename(appVersion: string, instant: Date = new Date()): string {
  return backupFilename(appVersion, instant);
}

/**
 * Parse the filename out of a `Content-Disposition` header, supporting the
 * forms a server may legitimately send: the quoted `filename="…"` parameter,
 * an unquoted token, and RFC 5987 `filename*=UTF-8''…`. Returns null when the
 * header is absent or carries nothing usable, so the caller falls back rather
 * than producing a nameless download (or, worse, a path).
 */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (header === null || header.trim().length === 0) return null;

  const extended = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (extended !== null) {
    const raw = extended[1]!.trim();
    const value = raw.includes("''") ? raw.slice(raw.indexOf("''") + 2) : raw;
    const decoded = safeDecodeURIComponent(value.replace(/^"|"$/g, ''));
    const cleaned = sanitizeDownloadName(decoded);
    if (cleaned !== null) return cleaned;
  }

  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted !== null) {
    const cleaned = sanitizeDownloadName(quoted[1]!.replace(/\\(.)/g, '$1'));
    if (cleaned !== null) return cleaned;
  }

  const token = /filename\s*=\s*([^;]+)/i.exec(header);
  if (token !== null) {
    const cleaned = sanitizeDownloadName(token[1]!.trim().replace(/^"|"$/g, ''));
    if (cleaned !== null) return cleaned;
  }

  return null;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Accept only a plain file name: no directories, no traversal, no control
 * characters, sane length. Anything else is refused so the caller uses the
 * fallback instead of writing somewhere unexpected.
 */
function sanitizeDownloadName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (trimmed.includes('/') || trimmed.includes('\\')) return null;
  if (trimmed === '.' || trimmed === '..') return null;
  return trimmed;
}

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
