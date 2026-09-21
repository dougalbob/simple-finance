import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as tar from 'tar';
import { z } from 'zod';
import { decryptBackupPayload, BackupFormatError, BackupPasswordError } from './crypto';
import {
  sha256Hex,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  DOCUMENTS_MEMBER_PREFIX,
  type BackupManifest,
} from './backup';
import { isSafeFileKey } from '../records/attachments';
import { formatInstantLocal } from '../time';

/**
 * Restore (AGENT_APP_BLUEPRINT.md §6, docs/SPEC.md §18.4).
 *
 * Supported formats: **1** (database + manifest only) and **2** (adds
 * `documents/<key>` attachment members) — a Phase 1 archive stays restorable,
 * which is the format-upgrade case the blueprint asks to be tested.
 *
 * Everything that can be checked is checked BEFORE the target is touched:
 * decrypt + authenticate, strict member allowlist (no traversal, no absolute
 * paths, no surprises), manifest schema, sha256 of every member, the restored
 * database's integrity and expected tables, and — for format 2 — the presence
 * and hash of every document the restored database references.
 *
 * The swap itself is two renames (database, then documents) and is therefore
 * not one atomic transaction. Both previous copies are preserved until the
 * replacement has landed; if the documents swap fails the database is put
 * back, and nothing is ever deleted on an error path.
 */
export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreError';
  }
}

const manifestCountsSchema = z
  .object({
    pots: z.number().int().nonnegative(),
    checkpoints: z.number().int().nonnegative(),
    auditEntries: z.number().int().nonnegative(),
    purchases: z.number().int().nonnegative().optional(),
    attachments: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const manifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  formatVersion: z.number().int().min(1).max(ARCHIVE_FORMAT_VERSION),
  app: z.string(),
  appVersion: z.string(),
  createdAt: z.string(),
  createdAtLocal: z.string(),
  counts: manifestCountsSchema,
  documents: z
    .object({
      included: z.number().int().nonnegative(),
      orphans: z.array(z.string()).optional(),
      skippedUnstored: z.number().int().nonnegative().optional(),
    })
    .optional(),
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

const DATABASE_MEMBER = 'db.sqlite';
const MANIFEST_MEMBER = 'manifest.json';

/**
 * Archive members this format accepts. Anything else — absolute paths,
 * traversal, nested documents, extra files — is dropped by the filter, and the
 * manifest must then agree with what was extracted.
 */
function safeMemberName(name: string): boolean {
  const normalized = name.replace(/^\.\//, '').replace(/\/+$/, '');
  if (normalized === DATABASE_MEMBER || normalized === MANIFEST_MEMBER) return true;
  if (!normalized.startsWith(DOCUMENTS_MEMBER_PREFIX)) return false;
  const fileKey = normalized.slice(DOCUMENTS_MEMBER_PREFIX.length);
  return !fileKey.includes('/') && isSafeFileKey(fileKey);
}

export interface RestoreOptions {
  archive: Buffer;
  password: string;
  /** Absolute path of the database file to (re)create */
  targetDatabasePath: string;
  /**
   * Attachment directory to replace. Defaults to `documents/` beside the
   * target database — the container layout (SPEC §18.1).
   */
  targetDocumentsDir?: string;
  now?: Date;
}

export interface RestoreSummary {
  manifest: BackupManifest;
  /** Where the previous database was preserved, or null when none existed */
  previousPreservedAs: string | null;
  /** Where the previous documents directory was preserved, or null */
  previousDocumentsPreservedAs: string | null;
  /** Attachment files written by this restore */
  documentsRestored: number;
}

interface PreservedPath {
  from: string;
  to: string;
}

/** Move something aside so it can be put back if the swap fails. */
async function preserve(from: string, to: string): Promise<PreservedPath | null> {
  if (!existsSync(from)) return null;
  await fs.rename(from, to);
  return { from, to };
}

/**
 * Put preserved copies back after a failed swap. Anything the failed swap
 * managed to move into place is removed first — it is by construction an
 * incomplete replacement, and the preserved copy is the only complete one.
 * Never throws: if a step fails, the preserved copy stays on disk under its
 * `.pre-restore-<stamp>` name and the error path still reports honestly.
 */
async function rollback(paths: Array<PreservedPath | null>): Promise<void> {
  for (const entry of paths) {
    if (entry === null) continue;
    try {
      if (!existsSync(entry.to)) continue;
      if (existsSync(entry.from)) {
        await fs.rm(entry.from, { recursive: true, force: true });
      }
      await fs.rename(entry.to, entry.from);
    } catch {
      // Best effort: the preserved copy stays on disk under its .pre-restore name.
    }
  }
}

export async function restoreEncryptedBackup(options: RestoreOptions): Promise<RestoreSummary> {
  const now = options.now ?? new Date();
  // The path comes from configuration (or a test), never from a request body;
  // the ignore comment keeps Turbopack from tracing the whole project for it.
  const target = path.resolve(/* turbopackIgnore: true */ options.targetDatabasePath);
  const targetDir = path.dirname(target);
  const documentsTarget = path.resolve(
    /* turbopackIgnore: true */
    options.targetDocumentsDir ?? path.join(targetDir, 'documents'),
  );
  await fs.mkdir(targetDir, { recursive: true });

  // Authenticate first — nothing inside the archive is trusted before this.
  let plaintext: Buffer;
  try {
    plaintext = decryptBackupPayload(options.archive, options.password);
  } catch (err) {
    if (err instanceof BackupFormatError || err instanceof BackupPasswordError) throw err;
    throw new RestoreError('Archive could not be read');
  }

  // Stage on the same filesystem as the final destination (EXDEV lesson: on
  // Unraid /tmp and /data are different mounts, so a cross-device rename fails).
  const staging = await fs.mkdtemp(path.join(targetDir, '.restore-staging-'));
  try {
    const archivePath = path.join(staging, 'archive.tar.gz');
    await fs.writeFile(archivePath, plaintext);
    const extractDir = path.join(staging, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });

    const extracted = new Set<string>();
    try {
      await tar.x({
        file: archivePath,
        cwd: extractDir,
        filter: (name) => {
          const normalized = name.replace(/^\.\//, '').replace(/\/+$/, '');
          if (name.endsWith('/')) return false; // directory entries are implied
          const ok = safeMemberName(name);
          if (ok) extracted.add(normalized);
          return ok;
        },
        // Fail rather than follow anything odd out of the archive.
        preservePaths: false,
      });
    } catch {
      // A truncated or corrupted payload is a restore failure, not a crash.
      throw new RestoreError(
        'The archive payload could not be read (it may be truncated or damaged)',
      );
    }
    if (!extracted.has(DATABASE_MEMBER) || !extracted.has(MANIFEST_MEMBER)) {
      throw new RestoreError('Archive is missing its database snapshot or manifest');
    }

    const manifestRaw = await fs.readFile(path.join(extractDir, MANIFEST_MEMBER), 'utf8');
    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(manifestRaw);
    } catch {
      throw new RestoreError('Archive manifest is not valid JSON');
    }
    const manifestParsed = manifestSchema.safeParse(manifestJson);
    if (!manifestParsed.success) {
      throw new RestoreError('Archive manifest is malformed or of an unsupported format');
    }
    const manifest = manifestParsed.data as BackupManifest;

    // Verify every listed member's size and sha256 before touching the target.
    // The manifest describes the payload files (it cannot hash itself), so it
    // is the one member expected in the archive and absent from the list.
    const listed = new Set<string>([MANIFEST_MEMBER]);
    let documentMembers = 0;
    for (const file of manifest.files) {
      if (!safeMemberName(file.path)) {
        throw new RestoreError(`Manifest references an unsupported path: ${file.path}`);
      }
      const normalized = file.path.replace(/^\.\//, '');
      if (listed.has(normalized)) {
        throw new RestoreError(`Manifest lists ${normalized} more than once`);
      }
      listed.add(normalized);
      const memberPath = path.join(extractDir, normalized);
      if (!existsSync(memberPath)) {
        throw new RestoreError(`Archive is missing the file it lists: ${normalized}`);
      }
      const bytes = await fs.readFile(memberPath);
      if (bytes.length !== file.bytes || sha256Hex(bytes) !== file.sha256) {
        throw new RestoreError(`Archive file ${normalized} failed integrity verification`);
      }
      if (normalized.startsWith(DOCUMENTS_MEMBER_PREFIX)) documentMembers += 1;
    }
    // An archive may not smuggle in files the manifest does not describe.
    for (const member of extracted) {
      if (!listed.has(member)) {
        throw new RestoreError(`Archive contains an unlisted member: ${member}`);
      }
    }

    // Sanity-open the restored database before it replaces anything.
    verifyRestoredDatabase(path.join(extractDir, DATABASE_MEMBER));
    verifyReferencedDocuments(path.join(extractDir, DATABASE_MEMBER), extractDir);

    // Swap in, preserving the previous copies until success.
    const stamp = localStamp(now);
    const databasePreserved = await preserve(target, `${target}.pre-restore-${stamp}`);
    const walPreserved = await preserve(`${target}-wal`, `${target}-wal.pre-restore-${stamp}`);
    const shmPreserved = await preserve(`${target}-shm`, `${target}-shm.pre-restore-${stamp}`);
    const documentsPreserved = await preserve(
      documentsTarget,
      `${documentsTarget}.pre-restore-${stamp}`,
    );

    try {
      await fs.rename(path.join(extractDir, DATABASE_MEMBER), target);
      await fs.mkdir(path.dirname(documentsTarget), { recursive: true });
      if (documentMembers > 0) {
        await fs.rename(path.join(extractDir, DOCUMENTS_MEMBER_PREFIX), documentsTarget);
      } else {
        // The archive carries no documents (format 1, or none recorded): the
        // restored installation starts with an empty attachments directory
        // rather than leftovers the restored database does not reference.
        await fs.mkdir(documentsTarget, { recursive: true });
      }
    } catch {
      // Roll back: put the preserved copies back, never lose the only copy.
      await rollback([
        databasePreserved === null
          ? null
          : { from: databasePreserved.from, to: databasePreserved.to },
        documentsPreserved,
        walPreserved,
        shmPreserved,
      ]);
      throw new RestoreError('Restored data could not be moved into place');
    }

    return {
      manifest,
      previousPreservedAs: databasePreserved?.to ?? null,
      previousDocumentsPreservedAs: documentsPreserved?.to ?? null,
      documentsRestored: documentMembers,
    };
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

/**
 * SPEC §18.4: the restore verifies the presence of every document the restored
 * database references. Their sha256 values were already checked against the
 * manifest above, and the manifest was written from the same snapshot, so a
 * restored installation cannot believe in a receipt that is not there.
 */
function verifyReferencedDocuments(databasePath: string, extractDir: string): void {
  const db = new Database(databasePath, { readonly: true });
  try {
    const hasAttachments = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attachments'")
      .get();
    if (hasAttachments === undefined) return;
    const rows = db
      .prepare("SELECT file_key FROM attachments WHERE state = 'stored'")
      .all() as Array<{ file_key: string }>;
    for (const row of rows) {
      if (!isSafeFileKey(row.file_key)) {
        throw new RestoreError('Restored database references an unsafe attachment key');
      }
      const member = path.join(extractDir, DOCUMENTS_MEMBER_PREFIX, row.file_key);
      if (!existsSync(member)) {
        throw new RestoreError(
          `Restored database references attachment ${row.file_key}, which the archive does not contain`,
        );
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
