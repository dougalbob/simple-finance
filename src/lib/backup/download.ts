import { fallbackBackupFilename, filenameFromContentDisposition } from './filename';

/**
 * Browser-side download of an encrypted backup (blueprint §6 filename lesson).
 *
 * A blob URL does not inherit HTTP response headers, so `anchor.download` must
 * be given the filename explicitly — from `Content-Disposition` when the server
 * sent one, and from the local fallback when it did not. Leaving the attribute
 * unset makes the browser invent a name (often "download" for blobs), which is
 * exactly the v0.2.21 regression this contract exists to prevent.
 *
 * Kept free of node imports so the same module is testable in the Node suite
 * (parsing/fallback) and used in the browser (fetch/blob/anchor).
 */
export interface BackupDownloadResult {
  filename: string;
  bytes: number;
  /** True when the server sent no usable filename and the fallback was used. */
  usedFallback: boolean;
}

/** Chooses the download name: server header first, local fallback second. */
export function chooseDownloadFilename(
  contentDisposition: string | null,
  appVersion: string,
  instant: Date = new Date(),
): { filename: string; usedFallback: boolean } {
  const fromHeader = filenameFromContentDisposition(contentDisposition);
  if (fromHeader !== null) return { filename: fromHeader, usedFallback: false };
  return { filename: fallbackBackupFilename(appVersion, instant), usedFallback: true };
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.length > 0) return body.error;
  } catch {
    // fall through to the generic message
  }
  return `The backup could not be created (HTTP ${response.status}).`;
}

/**
 * POST the recovery password, then hand the encrypted bytes to the browser
 * under the contract filename. The password is sent once and never stored —
 * not in this module, not in localStorage, not in the DOM after the call.
 */
export async function downloadEncryptedBackup(
  password: string,
  appVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BackupDownloadResult> {
  const response = await fetchImpl('/api/backup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
    // Never let a proxy or the browser cache an archive of household data.
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));

  const { filename, usedFallback } = chooseDownloadFilename(
    response.headers.get('content-disposition'),
    appVersion,
  );
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    // Explicit: blob URLs carry no headers, so this attribute is the only
    // thing that decides what the household sees in their downloads folder.
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return { filename, bytes: blob.size, usedFallback };
}
