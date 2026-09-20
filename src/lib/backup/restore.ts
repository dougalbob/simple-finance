import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as tar from 'tar';
import { z } from 'zod';
import { decryptBackupPayload, BackupFormatError, BackupPasswordError } from './crypto';
import { sha256Hex, ARCHIVE_FORMAT, ARCHIVE_FORMAT_VERSION, type BackupManifest } from './backup';
import { formatInstantLocal } from '../time';

/**
 * Phase 1 restore skeleton (SPEC §18.4). Restores an encrypted archive into a
 * TARGET DIRECTORY OF THE CALLER'S CHOOSING — isolated installs in tests and
 * rehearsals. The live in-place restore path (close open connections, WAL/SHM
 * handling, maintenance mode, UI refresh) is Phase 5.
 *
 * Already enforced here:
 * - decrypt + authenticate before anything is trusted;
 * - reject unsafe paths (strict allowlist of archive members);
 * - validate the manifest and every file's sha256 BEFORE touching the target;
 * - sanity-open the restored database (integrity + expected tables);
 * - stage on the same filesystem as the target before renaming;
 * - preserve the previous database (recoverable) until the swap succeeds;
 * - never delete the only recoverable copy on an error path.
 */
export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreError';
  }
}

const manifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  formatVersion: z.literal(ARCHIVE_FORMAT_VERSION),
  app: z.string(),
  appVersion: z.string(),
  createdAt: z.string(),
  createdAtLocal: z.string(),
  counts: z.object({
    pots: z.number().int().nonnegative(),
    checkpoints: z.number().int().nonnegative(),
    auditEntries: z.number().int().nonnegative(),
  }),
  files: z
    .array(
      z.object({
        path: z.string(),
        bytes: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .min(1),
});

/** Archive members this format is allowed to contain (Phase 1: two flat files). */
const ALLOWED_MEMBERS = new Set(['db.sqlite', 'manifest.json']);

function safeMemberName(name: string): boolean {
  const normalized = name.replace(/^\.\//, '');
  return ALLOWED_MEMBERS.has(normalized);
}

export interface RestoreOptions {
  archive: Buffer;
  password: string;
  /** Absolute path of the database file to (re)create */
  targetDatabasePath: string;
  now?: Date;
}

export interface RestoreSummary {
  manifest: BackupManifest;
  /** Where the previous database was preserved, or null when none existed */
  previousPreservedAs: string | null;
}

export async function restoreEncryptedBackup(options: RestoreOptions): Promise<RestoreSummary> {
  const now = options.now ?? new Date();
  const target = path.resolve(options.targetDatabasePath);
  const targetDir = path.dirname(target);
  await fs.mkdir(targetDir, { recursive: true });

  // Authenticate first — nothing inside the archive is trusted before this.
  let plaintext: Buffer;
  try {
    plaintext = decryptBackupPayload(options.archive, options.password);
  } catch (err) {
    if (err instanceof BackupFormatError || err instanceof BackupPasswordError) throw err;
    throw new RestoreError('Archive could not be read');
  }

  // Stage on the same filesystem as the final destination (EXDEV lesson).
  const staging = await fs.mkdtemp(path.join(targetDir, '.restore-staging-'));
  try {
    const archivePath = path.join(staging, 'archive.tar.gz');
    await fs.writeFile(archivePath, plaintext);
    const extractDir = path.join(staging, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });

    let sawDatabase = false;
    let sawManifest = false;
    await tar.x({
      file: archivePath,
      cwd: extractDir,
      filter: (name) => {
        const ok = safeMemberName(name);
        if (ok && name.endsWith('db.sqlite')) sawDatabase = true;
        if (ok && name.endsWith('manifest.json')) sawManifest = true;
        return ok;
      },
      // Fail rather than follow anything odd out of the archive.
      preservePaths: false,
    });
    if (!sawDatabase || !sawManifest) {
      throw new RestoreError('Archive is missing its database snapshot or manifest');
    }

    const manifestRaw = await fs.readFile(path.join(extractDir, 'manifest.json'), 'utf8');
    const manifestParsed = manifestSchema.safeParse(JSON.parse(manifestRaw));
    if (!manifestParsed.success) {
      throw new RestoreError('Archive manifest is malformed or of an unsupported format');
    }
    const manifest = manifestParsed.data as BackupManifest;

    // Verify every listed file's size and sha256 before touching the target.
    for (const file of manifest.files) {
      if (!safeMemberName(file.path)) {
        throw new RestoreError(`Manifest references an unsupported path: ${file.path}`);
      }
      const filePath = path.join(extractDir, file.path);
      const bytes = await fs.readFile(filePath);
      if (bytes.length !== file.bytes || sha256Hex(bytes) !== file.sha256) {
        throw new RestoreError(`Archive file ${file.path} failed integrity verification`);
      }
    }

    // Sanity-open the restored database before it replaces anything.
    verifyRestoredDatabase(path.join(extractDir, 'db.sqlite'));

    // Swap in, preserving the previous database until success.
    const stamp = localStamp(now);
    let previousPreservedAs: string | null = null;
    if (existsSync(target)) {
      previousPreservedAs = `${target}.pre-restore-${stamp}`;
      await fs.rename(target, previousPreservedAs);
    }
    // Stale WAL/SHM sidecars of the previous database must move aside with it.
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(target + suffix)) {
        await fs.rename(target + suffix, `${target}${suffix}.pre-restore-${stamp}`);
      }
    }
    try {
      await fs.rename(path.join(extractDir, 'db.sqlite'), target);
    } catch (err) {
      // Roll back: put the preserved previous database back, never lose it.
      if (previousPreservedAs !== null && existsSync(previousPreservedAs)) {
        await fs.rename(previousPreservedAs, target).catch(() => undefined);
      }
      throw new RestoreError('Restored database could not be moved into place');
    }
    return { manifest, previousPreservedAs };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

function verifyRestoredDatabase(databasePath: string): void {
  let db: Database.Database;
  try {
    db = new Database(databasePath, { readonly: true });
  } catch {
    throw new RestoreError('Restored file is not a readable SQLite database');
  }
  try {
    const check = db.pragma('quick_check', { simple: true });
    if (check !== 'ok') {
      throw new RestoreError('Restored database failed its integrity check');
    }
    const tables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    for (const expected of ['pots', 'checkpoints', 'audit_entries', '__drizzle_migrations']) {
      if (!tables.has(expected)) {
        throw new RestoreError(`Restored database is missing the ${expected} table`);
      }
    }
  } finally {
    db.close();
  }
}

function localStamp(instant: Date): string {
  return formatInstantLocal(instant)
    .replace(/[^0-9]/g, '')
    .slice(0, 12);
}
