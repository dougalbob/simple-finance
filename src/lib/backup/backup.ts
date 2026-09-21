import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as tar from 'tar';
import { APP_NAME, APP_VERSION } from '../version';
import type { DbHandle } from '../db/client';
import { attachments } from '../db/schema';
import { formatInstantLocal } from '../time';
import { isSafeFileKey } from '../records/attachments';
import { encryptBackupPayload } from './crypto';
import { backupFilename } from './filename';

/**
 * Encrypted backup (AGENT_APP_BLUEPRINT.md §6, docs/SPEC.md §18.2).
 *
 * Format version 2 adds the attachment documents to the Phase 1 skeleton:
 *
 * - `db.sqlite` — consistent SQLite snapshot via the supported `.backup()`
 *   API (WAL-safe, never a raw copy of a live database file);
 * - `manifest.json` — versioned manifest: app version, creation instant
 *   (UTC + Europe/London from the same Date), row counts, and a sha256 for
 *   every member;
 * - `documents/<key>` — every attachment the snapshot references in the
 *   `stored` state.
 *
 * Consistency boundary (SPEC §18.2): the document set is enumerated **from the
 * snapshot**, not from the live database, so the archive can never reference a
 * file the snapshot does not know about. If a referenced file is missing on
 * disk the backup fails loudly (`BackupIncompleteError`) instead of producing
 * an archive that only looks complete. Files present on disk but unreferenced
 * are reported in `documents.orphans` — never silently included, never deleted.
 *
 * Format version 1 (database + manifest only) is still restorable; see
 * `./restore.ts`.
 */
export const ARCHIVE_FORMAT = 'simple-finance-backup';
export const ARCHIVE_FORMAT_VERSION = 2;
export const DOCUMENTS_MEMBER_PREFIX = 'documents/';

export interface BackupManifest {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: number;
  app: string;
  appVersion: string;
  /** ISO instant the archive was created */
  createdAt: string;
  /** Same instant rendered in Europe/London (generated from one Date) */
  createdAtLocal: string;
  counts: {
    pots: number;
    checkpoints: number;
    auditEntries: number;
    purchases: number;
    attachments: number;
  };
  documents: {
    /** Attachments included in this archive (rows in `stored` state). */
    included: number;
    /** Unreferenced files found under `documents/` — reported, never included. */
    orphans: string[];
    /** Rows not in the `stored` state; not referenceable, so not included. */
    skippedUnstored: number;
  };
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

export class BackupIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupIncompleteError';
  }
}

export interface CreateBackupOptions {
  handle: DbHandle;
  password: string;
  appVersion?: string;
  now?: Date;
  /**
   * Attachment directory. Defaults to `documents/` beside the database file —
   * the layout the container and the entrypoint create (SPEC §18.1).
   */
  documentsDir?: string;
}

export interface CreatedBackup {
  bytes: Buffer;
  filename: string;
  manifest: BackupManifest;
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function documentsDirForDatabase(databasePath: string): string {
  return path.join(path.dirname(databasePath), 'documents');
}

interface SnapshotAttachmentRow {
  file_key: string;
  state: string;
}

interface SnapshotFacts {
  counts: BackupManifest['counts'];
  storedKeys: string[];
  skippedUnstored: number;
}

/**
 * Read the facts that describe the archive **from the snapshot** — never from
 * the live connection. This is the coordination point the SPEC asks for: the
 * row counts, the attachment list and the sha256 values all describe the same
 * consistent database image that the archive ships.
 */
function readSnapshotFacts(snapshotPath: string): SnapshotFacts {
  const snapshot = new Database(snapshotPath, { readonly: true });
  try {
    const scalar = (table: string): number =>
      (snapshot.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const rows = snapshot
      .prepare('SELECT file_key, state FROM attachments ORDER BY id')
      .all() as SnapshotAttachmentRow[];
    const storedKeys = rows.filter((row) => row.state === 'stored').map((row) => row.file_key);
    for (const key of storedKeys) {
      if (!isSafeFileKey(key)) {
        throw new BackupIncompleteError(
          `Attachment ${key} has an unexpected storage key; refusing to build an archive.`,
        );
      }
    }
    return {
      counts: {
        pots: scalar('pots'),
        checkpoints: scalar('checkpoints'),
        auditEntries: scalar('audit_entries'),
        purchases: scalar('purchases'),
        attachments: rows.length,
      },
      storedKeys,
      skippedUnstored: rows.length - storedKeys.length,
    };
  } finally {
    snapshot.close();
  }
}

/** Files sitting in the documents directory that the snapshot does not reference. */
async function findOrphanDocuments(
  documentsDir: string,
  referencedKeys: readonly string[],
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(documentsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const referenced = new Set(referencedKeys);
  return entries.filter((name) => !referenced.has(name)).sort();
}

export async function createEncryptedBackup(options: CreateBackupOptions): Promise<CreatedBackup> {
  const now = options.now ?? new Date();
  const appVersion = options.appVersion ?? APP_VERSION;
  const { db, raw } = options.handle;
  const documentsDir = options.documentsDir ?? documentsDirForDatabase(raw.name);

  // Stage on the same filesystem as the database (EXDEV lesson, blueprint §6).
  const staging = await fs.mkdtemp(path.join(path.dirname(raw.name), '.backup-staging-'));
  try {
    const snapshotPath = path.join(staging, 'db.sqlite');
    // Supported, WAL-consistent snapshot — not a raw file copy.
    await raw.backup(snapshotPath);
    const snapshotFacts = readSnapshotFacts(snapshotPath);

    const files: BackupManifest['files'] = [];
    const snapshotBytes = await fs.readFile(snapshotPath);
    files.push({
      path: 'db.sqlite',
      bytes: snapshotBytes.length,
      sha256: sha256Hex(snapshotBytes),
    });

    await fs.mkdir(path.join(staging, DOCUMENTS_MEMBER_PREFIX), { recursive: true });
    for (const fileKey of snapshotFacts.storedKeys) {
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(path.join(documentsDir, fileKey));
      } catch {
        // Never ship an archive that only looks complete (SPEC §18.2).
        throw new BackupIncompleteError(
          `Attachment ${fileKey} is referenced by the database but missing from ${documentsDir}.`,
        );
      }
      await fs.writeFile(path.join(staging, DOCUMENTS_MEMBER_PREFIX, fileKey), bytes);
      files.push({
        path: `${DOCUMENTS_MEMBER_PREFIX}${fileKey}`,
        bytes: bytes.length,
        sha256: sha256Hex(bytes),
      });
    }

    const orphans = await findOrphanDocuments(documentsDir, snapshotFacts.storedKeys);

    const manifest: BackupManifest = {
      format: ARCHIVE_FORMAT,
      formatVersion: ARCHIVE_FORMAT_VERSION,
      app: APP_NAME,
      appVersion,
      createdAt: now.toISOString(),
      createdAtLocal: formatInstantLocal(now),
      counts: snapshotFacts.counts,
      documents: {
        included: snapshotFacts.storedKeys.length,
        orphans,
        skippedUnstored: snapshotFacts.skippedUnstored,
      },
      files,
    };

    await fs.writeFile(
      path.join(staging, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    const archivePath = path.join(staging, 'archive.tar.gz');
    // Explicit member list: the manifest plus exactly the files it describes.
    await tar.c({ file: archivePath, cwd: staging, gzip: true, portable: true }, [
      'manifest.json',
      ...files.map((file) => file.path),
    ]);
    const plaintext = await fs.readFile(archivePath);
    const bytes = encryptBackupPayload(plaintext, options.password);

    return { bytes, filename: backupFilename(appVersion, now), manifest };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

/**
 * A honest, read-only health check of the attachment directory: what the
 * database references versus what is on disk. Used by the UI to show the
 * household whether anything needs attention, and by tests. Never deletes.
 */
export interface DocumentsStatus {
  referenced: number;
  presentOnDisk: number;
  missing: string[];
  orphans: string[];
}

export async function inspectDocuments(handle: DbHandle): Promise<DocumentsStatus> {
  const { db, raw } = handle;
  const documentsDir = documentsDirForDatabase(raw.name);
  const rows = db
    .select({ fileKey: attachments.fileKey, state: attachments.state })
    .from(attachments)
    .all();
  const referenced = rows.filter((row) => row.state === 'stored').map((row) => row.fileKey);
  let onDisk: string[] = [];
  try {
    onDisk = await fs.readdir(documentsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const present = new Set(onDisk);
  const referencedSet = new Set(referenced);
  return {
    referenced: referenced.length,
    presentOnDisk: onDisk.length,
    missing: referenced.filter((key) => !present.has(key)).sort(),
    orphans: onDisk.filter((name) => !referencedSet.has(name)).sort(),
  };
}
