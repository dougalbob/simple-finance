import { APP_VERSION } from '../version';
import { loadAppConfig, type AppConfig } from '../config';
import { closeDbHandle, getDbHandle, type DbHandle } from '../db/client';
import { BackupFormatError, BackupPasswordError } from './crypto';
import { restoreEncryptedBackup, RestoreError, type RestoreSummary } from './restore';

/**
 * Live, in-place restore (blueprint §6 restore contract, SPEC §18.4; Phase 1
 * deliberately stopped at "isolated directories only" — decision 34).
 *
 * The order matters and is the whole point of this module:
 *
 *   1. close the process-wide database handle so the WAL is checkpointed and
 *      no open connection can hold the file we are about to replace;
 *   2. run the staged restore (verify everything, then swap database and
 *      documents, preserving the previous copies);
 *   3. reopen the handle so the running app reads the restored data.
 *
 * If anything fails, the original installation is put back by the restore
 * layer and the handle is reopened against it — a failed restore leaves a
 * working app, never a half-swapped one. The previous database and documents
 * stay on disk under `.pre-restore-<stamp>` names for a manual rollback.
 */
export interface LiveRestoreOptions {
  archive: Buffer;
  password: string;
  now?: Date;
  config?: AppConfig;
}

export interface LiveRestoreResult extends RestoreSummary {
  /** True when the app is reading the restored data again. */
  reopened: boolean;
  /** The version recorded in the archive that was restored. */
  restoredAppVersion: string;
}

export async function restoreLiveInstallation(
  options: LiveRestoreOptions,
): Promise<LiveRestoreResult> {
  const config = options.config ?? loadAppConfig();

  // 1. No live connection during the swap (WAL/SHM safety, blueprint §6.4).
  closeDbHandle();

  let summary: RestoreSummary;
  try {
    summary = await restoreEncryptedBackup({
      archive: options.archive,
      password: options.password,
      targetDatabasePath: config.databasePath,
      targetDocumentsDir: config.documentsDir,
      now: options.now,
    });
  } catch (err) {
    // Reopen against whatever is on disk: the restore layer preserved the
    // previous data whenever it had to touch anything.
    reopen(config);
    // Pass the archive-authentication failures through unchanged: the caller
    // must be able to say "wrong password" rather than "something failed".
    if (
      err instanceof RestoreError ||
      err instanceof BackupPasswordError ||
      err instanceof BackupFormatError
    )
      throw err;
    throw new RestoreError(
      err instanceof Error ? `Restore failed: ${err.message}` : 'Restore failed',
    );
  }

  // 3. Read the restored data again.
  const reopened = reopen(config);
  if (!reopened) {
    throw new RestoreError(
      'Data was restored but the database could not be reopened — restart the container before entering data.',
    );
  }

  return {
    ...summary,
    reopened,
    restoredAppVersion: summary.manifest.appVersion || APP_VERSION,
  };
}

function reopen(config: AppConfig): boolean {
  try {
    const handle: DbHandle = getDbHandle(config);
    // A trivial cheap read proves the connection is genuinely usable.
    handle.raw.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}
