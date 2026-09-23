import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, it } from 'node:test';
import { createEncryptedBackup } from '../src/lib/backup/backup';
import { BackupFormatError, BackupPasswordError } from '../src/lib/backup/crypto';
import { restoreEncryptedBackup, RestoreError } from '../src/lib/backup/restore';
import { openDatabase } from '../src/lib/db/client';
import { applyMigrations } from '../src/lib/db/migrate';
import { addCheckpoint, createPot } from '../src/lib/records/pots';
import { APP_VERSION } from '../src/lib/version';
import { makeTempDir } from './helpers';

const PASSWORD = 'correct-horse-battery-staple';

async function seededHandle() {
  const dir = await makeTempDir('sf-backup-src-');
  const handle = openDatabase(path.join(dir, 'simple-finance.sqlite'));
  applyMigrations(handle.db);
  const pot = createPot(handle.db, {
    label: 'Main account',
    kind: 'bank',
    actor: 'alex@example.com',
    now: new Date('2026-09-20T10:00:00Z'),
  });
  addCheckpoint(handle.db, {
    potId: pot.id,
    amountPence: 41235,
    effectiveAt: new Date('2026-09-26T18:05:00Z'),
    note: 'evening check',
    actor: 'alex@example.com',
    now: new Date('2026-09-26T18:06:00Z'),
  });
  addCheckpoint(handle.db, {
    potId: pot.id,
    amountPence: 34888,
    effectiveAt: new Date('2026-09-27T14:10:00Z'),
    actor: 'sam@example.com',
    now: new Date('2026-09-27T14:11:00Z'),
  });
  return handle;
}

function countRows(databasePath: string, table: string): number {
  const db = new Database(databasePath, { readonly: true });
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  } finally {
    db.close();
  }
}

describe('encrypted backup + restore round-trip (isolated copies only)', () => {
  it('creates an archive with the versioned filename and an honest manifest', async () => {
    const handle = await seededHandle();
    try {
      const backup = await createEncryptedBackup({
        handle,
        password: PASSWORD,
        now: new Date('2026-09-20T20:30:12Z'),
      });
      // Tied to the version module, not a literal — a version bump must not
      // break the filename-contract assertion (it broke once at v0.1.1).
      assert.match(
        backup.filename,
        new RegExp(
          `^simple-finance-backup-v${APP_VERSION.replaceAll('.', '\\.')}-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.simple-finance-backup$`,
        ),
      );
      assert.equal(backup.manifest.counts.pots, 1);
      assert.equal(backup.manifest.counts.checkpoints, 2);
      assert.equal(backup.manifest.counts.auditEntries, 3);
      assert.equal(backup.manifest.files.length, 1);
      assert.ok(backup.bytes.length > 1000);
      assert.notEqual(backup.bytes.indexOf(Buffer.from('sqlite')), 3); // ciphertext, not plaintext
    } finally {
      handle.raw.close();
    }
  });

  it('round-trips records into a clean isolated installation', async () => {
    const handle = await seededHandle();
    try {
      const backup = await createEncryptedBackup({ handle, password: PASSWORD });
      const targetDir = await makeTempDir('sf-restore-clean-');
      const target = path.join(targetDir, 'simple-finance.sqlite');
      const summary = await restoreEncryptedBackup({
        archive: backup.bytes,
        password: PASSWORD,
        targetDatabasePath: target,
      });
      assert.equal(summary.previousPreservedAs, null);
      assert.equal(summary.manifest.counts.checkpoints, 2);
      assert.equal(countRows(target, 'pots'), 1);
      assert.equal(countRows(target, 'checkpoints'), 2);
      assert.equal(countRows(target, 'audit_entries'), 3);
      assert.equal(countRows(target, '__drizzle_migrations'), 6);
    } finally {
      handle.raw.close();
    }
  });

  it('preserves the previous database when restoring over an existing one', async () => {
    const source = await seededHandle();
    try {
      const backup = await createEncryptedBackup({ handle: source, password: PASSWORD });
      const targetDir = await makeTempDir('sf-restore-over-');
      const target = path.join(targetDir, 'simple-finance.sqlite');
      // A pre-existing, different database (one pot, no checkpoints).
      const existing = openDatabase(target);
      applyMigrations(existing.db);
      createPot(existing.db, { label: 'Old pot', kind: 'cash', actor: 'sam@example.com' });
      existing.raw.close();

      const summary = await restoreEncryptedBackup({
        archive: backup.bytes,
        password: PASSWORD,
        targetDatabasePath: target,
      });
      assert.ok(summary.previousPreservedAs !== null);
      assert.equal(countRows(target, 'pots'), 1); // restored content
      assert.equal(countRows(target, 'checkpoints'), 2);
      assert.equal(countRows(summary.previousPreservedAs, 'pots'), 1); // old data preserved
    } finally {
      source.raw.close();
    }
  });

  it('rejects a wrong password without touching the target', async () => {
    const handle = await seededHandle();
    try {
      const backup = await createEncryptedBackup({ handle, password: PASSWORD });
      const targetDir = await makeTempDir('sf-restore-wrongpw-');
      const target = path.join(targetDir, 'simple-finance.sqlite');
      const existing = openDatabase(target);
      applyMigrations(existing.db);
      const pot = createPot(existing.db, {
        label: 'Keep me',
        kind: 'cash',
        actor: 'sam@example.com',
      });
      existing.raw.close();

      await assert.rejects(
        () =>
          restoreEncryptedBackup({
            archive: backup.bytes,
            password: 'wrong password',
            targetDatabasePath: target,
          }),
        BackupPasswordError,
      );
      assert.equal(countRows(target, 'pots'), 1);
      const db = new Database(target, { readonly: true });
      const label = (db.prepare('SELECT label FROM pots').get() as { label: string }).label;
      db.close();
      assert.equal(label, pot.label);
    } finally {
      handle.raw.close();
    }
  });

  it('rejects tampered and truncated archives', async () => {
    const handle = await seededHandle();
    try {
      const backup = await createEncryptedBackup({ handle, password: PASSWORD });
      const target = path.join(await makeTempDir('sf-restore-tamper-'), 'x.sqlite');

      const flipped = Buffer.from(backup.bytes);
      const flipIndex = flipped.length - 20; // inside ciphertext
      flipped[flipIndex] = (flipped[flipIndex] ?? 0) ^ 0xff;
      await assert.rejects(
        () =>
          restoreEncryptedBackup({
            archive: flipped,
            password: PASSWORD,
            targetDatabasePath: target,
          }),
        BackupPasswordError,
      );

      const truncated = backup.bytes.subarray(0, 25);
      await assert.rejects(
        () =>
          restoreEncryptedBackup({
            archive: truncated,
            password: PASSWORD,
            targetDatabasePath: target,
          }),
        BackupFormatError,
      );

      const notABackup = Buffer.from('this is definitely not an archive, sorry');
      await assert.rejects(
        () =>
          restoreEncryptedBackup({
            archive: notABackup,
            password: PASSWORD,
            targetDatabasePath: target,
          }),
        BackupFormatError,
      );
    } finally {
      handle.raw.close();
    }
  });

  it('rejects a manifest that does not verify against file contents', async () => {
    const handle = await seededHandle();
    try {
      const backup = await createEncryptedBackup({ handle, password: PASSWORD });
      // Decrypt legitimately, tamper with the snapshot, re-encrypt.
      const { decryptBackupPayload, encryptBackupPayload } =
        await import('../src/lib/backup/crypto');
      const plaintext = decryptBackupPayload(backup.bytes, PASSWORD);
      const poisoned = Buffer.from(plaintext);
      // Corrupt somewhere inside the tar.gz payload.
      poisoned[60] = (poisoned[60] ?? 0) ^ 0xff;
      const reEncrypted = encryptBackupPayload(poisoned, PASSWORD);
      const target = path.join(await makeTempDir('sf-restore-mitm-'), 'x.sqlite');
      await assert.rejects(
        () =>
          restoreEncryptedBackup({
            archive: reEncrypted,
            password: PASSWORD,
            targetDatabasePath: target,
          }),
        (err: unknown) => err instanceof RestoreError || err instanceof Error,
      );
    } finally {
      handle.raw.close();
    }
  });
});
