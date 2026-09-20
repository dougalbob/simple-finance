import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';
import { count } from 'drizzle-orm';
import { APP_NAME, APP_VERSION } from '../version';
import type { DbHandle } from '../db/client';
import { auditEntries, checkpoints, pots } from '../db/schema';
import { formatInstantLocal } from '../time';
import { encryptBackupPayload } from './crypto';
import { backupFilename } from './filename';

/**
 * Phase 1 backup skeleton (docs/IMPLEMENTATION_PLAN.md Phase 1; full contract
 * hardening is Phase 5). Already honest about the parts that matter:
 * - consistent SQLite snapshot via the supported .backup() API (WAL-safe,
 *   never a raw copy of a live database file);
 * - versioned manifest with sha256 per file, so restore can verify integrity;
 * - staging on the same filesystem as the database;
 * - encrypted with AES-256-GCM + scrypt before it leaves the process.
 *
 * Phase 5 adds: documents/ attachments in the archive, orphan reporting,
 * schema-compatibility checks on restore, and the live in-place restore path
 * (close connections, WAL/SHM handling, rollback). Phase 1 restore targets an
 * isolated directory only.
 */
export const ARCHIVE_FORMAT = 'simple-finance-backup';
export const ARCHIVE_FORMAT_VERSION = 1;

export interface BackupManifest {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: number;
  app: string;
  appVersion: string;
  /** ISO instant the archive was created */
  createdAt: string;
  /** Same instant rendered in Europe/London (generated from one Date) */
  createdAtLocal: string;
  counts: { pots: number; checkpoints: number; auditEntries: number };
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

export interface CreateBackupOptions {
  handle: DbHandle;
  password: string;
  appVersion?: string;
  now?: Date;
}

export interface CreatedBackup {
  bytes: Buffer;
  filename: string;
  manifest: BackupManifest;
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function countRows(
  db: DbHandle['db'],
  table: typeof pots | typeof checkpoints | typeof auditEntries,
): number {
  const row = db.select({ value: count() }).from(table).all()[0];
  return row?.value ?? 0;
}

export async function createEncryptedBackup(options: CreateBackupOptions): Promise<CreatedBackup> {
  const now = options.now ?? new Date();
  const appVersion = options.appVersion ?? APP_VERSION;
  const { db, raw } = options.handle;

  // Stage on the same filesystem as the database (EXDEV lesson, blueprint §6).
  const staging = await fs.mkdtemp(path.join(path.dirname(raw.name), '.backup-staging-'));
  try {
    const snapshotPath = path.join(staging, 'db.sqlite');
    // Supported, WAL-consistent snapshot — not a raw file copy.
    await raw.backup(snapshotPath);
    const snapshotBytes = await fs.readFile(snapshotPath);

    const manifest: BackupManifest = {
      format: ARCHIVE_FORMAT,
      formatVersion: ARCHIVE_FORMAT_VERSION,
      app: APP_NAME,
      appVersion,
      createdAt: now.toISOString(),
      createdAtLocal: formatInstantLocal(now),
      counts: {
        pots: countRows(db, pots),
        checkpoints: countRows(db, checkpoints),
        auditEntries: countRows(db, auditEntries),
      },
      files: [
        {
          path: 'db.sqlite',
          bytes: snapshotBytes.length,
          sha256: sha256Hex(snapshotBytes),
        },
      ],
    };

    await fs.writeFile(
      path.join(staging, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    const archivePath = path.join(staging, 'archive.tar.gz');
    await tar.c({ file: archivePath, cwd: staging, gzip: true, portable: true }, [
      'db.sqlite',
      'manifest.json',
    ]);
    const plaintext = await fs.readFile(archivePath);
    const bytes = encryptBackupPayload(plaintext, options.password);

    return { bytes, filename: backupFilename(appVersion, now), manifest };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
