import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createEncryptedBackup, BackupIncompleteError } from '../src/lib/backup/backup';
import { restoreEncryptedBackup, RestoreError } from '../src/lib/backup/restore';
import {
  BackupFormatError,
  BackupPasswordError,
  decryptBackupPayload,
  encryptBackupPayload,
} from '../src/lib/backup/crypto';
import { documentsDirForDatabase } from '../src/lib/backup/backup';
import { storeAttachment } from '../src/lib/records/attachments';
import { createPurchase } from '../src/lib/records/purchases';
import { createHouseholdFixture } from './household';
import { makeTempDir } from './helpers';

/**
 * Phase 5 exit criterion: the archive covers records **and** attachments, and
 * a restore into a clean isolated installation verifies both (SPEC §18.2,
 * §18.4, §23.3; blueprint §6, §12).
 */

const PASSWORD = 'a-long-enough-passphrase';
const ACTOR = 'alex@example.com';

/** A tiny, real PNG (1×1 transparent) — fictional test fixture, not a receipt. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');

async function seededWithReceipts() {
  const fx = await createHouseholdFixture(ACTOR);
  const documentsDir = documentsDirForDatabase(fx.handle.raw.name);
  const saved = createPurchase(fx.db, {
    potId: fx.pots.main.id,
    totalPence: 4210,
    occurredAt: new Date('2026-09-18T16:30:00Z'),
    paidByPersonId: fx.people.alex.id,
    supplierName: 'Tesco',
    actor: ACTOR,
    lines: [
      {
        amountPence: 4210,
        categoryId: fx.categoryId('Groceries', 'Weekly Shop'),
        targetKind: 'household',
      },
    ],
    now: new Date('2026-09-18T16:31:00Z'),
  });
  assert.equal(saved.purchase.totalPence, 4210);
  const stored = await storeAttachment({
    db: fx.db,
    purchaseId: saved.purchase.id,
    originalName: 'receipt.png',
    bytes: PNG_BYTES,
    actor: ACTOR,
    documentsDir,
    now: new Date('2026-09-18T16:35:00Z'),
  });
  return { fx, documentsDir, purchaseId: saved.purchase.id, stored };
}

describe('backup covers attachments (format 2)', () => {
  it('includes referenced documents with per-file sha256 in the manifest', async () => {
    const { fx, documentsDir, stored } = await seededWithReceipts();
    try {
      const backup = await createEncryptedBackup({
        handle: fx.handle,
        password: PASSWORD,
        documentsDir,
        now: new Date('2026-09-20T20:30:12Z'),
      });
      assert.equal(backup.manifest.formatVersion, 2);
      assert.equal(backup.manifest.documents.included, 1);
      assert.deepEqual(backup.manifest.documents.orphans, []);
      assert.equal(backup.manifest.counts.attachments, 1);
      assert.equal(backup.manifest.counts.purchases, 1);
      const member = backup.manifest.files.find(
        (file) => file.path === `documents/${stored.fileKey}`,
      );
      assert.ok(member !== undefined, 'the document is listed in the manifest');
      assert.equal(member.bytes, PNG_BYTES.length);
      assert.match(member.sha256, /^[0-9a-f]{64}$/);
    } finally {
      fx.close();
    }
  });

  it('reports unreferenced files as orphans without including or deleting them', async () => {
    const { fx, documentsDir } = await seededWithReceipts();
    try {
      const orphanName = '11111111-2222-3333-4444-555555555555.png';
      await fs.writeFile(path.join(documentsDir, orphanName), PNG_BYTES);
      const backup = await createEncryptedBackup({
        handle: fx.handle,
        password: PASSWORD,
        documentsDir,
      });
      assert.deepEqual(backup.manifest.documents.orphans, [orphanName]);
      assert.equal(
        backup.manifest.files.some((file) => file.path.includes(orphanName)),
        false,
        'an orphan is never smuggled into the archive',
      );
      assert.ok(existsSync(path.join(documentsDir, orphanName)), 'the orphan file is kept');
    } finally {
      fx.close();
    }
  });

  it('refuses to build an archive when a referenced document is missing', async () => {
    const { fx, documentsDir, stored } = await seededWithReceipts();
    try {
      await fs.rm(path.join(documentsDir, stored.fileKey));
      await assert.rejects(
        () => createEncryptedBackup({ handle: fx.handle, password: PASSWORD, documentsDir }),
        BackupIncompleteError,
      );
    } finally {
      fx.close();
    }
  });

  it('round-trips records and documents into a clean isolated installation', async () => {
    const { fx, documentsDir, stored } = await seededWithReceipts();
    try {
      const backup = await createEncryptedBackup({
        handle: fx.handle,
        password: PASSWORD,
        documentsDir,
      });
      const targetDir = await makeTempDir('sf-restore-docs-');
      const targetDocuments = path.join(targetDir, 'documents');
      const summary = await restoreEncryptedBackup({
        archive: backup.bytes,
        password: PASSWORD,
        targetDatabasePath: path.join(targetDir, 'simple-finance.sqlite'),
        targetDocumentsDir: targetDocuments,
      });
      assert.equal(summary.documentsRestored, 1);
      assert.equal(summary.previousDocumentsPreservedAs, null);
      const restored = await fs.readFile(path.join(targetDocuments, stored.fileKey));
      assert.deepEqual(restored, PNG_BYTES, 'the receipt bytes survive the round trip');
      assert.equal(summary.manifest.counts.purchases, 1);
    } finally {
      fx.close();
    }
  });

  it('preserves the previous documents directory when restoring over an installation', async () => {
    const { fx, documentsDir, stored } = await seededWithReceipts();
    try {
      const backup = await createEncryptedBackup({
        handle: fx.handle,
        password: PASSWORD,
        documentsDir,
      });

      // Target installation with its own, different attachment.
      const targetDir = await makeTempDir('sf-restore-over-docs-');
      const targetDocuments = path.join(targetDir, 'documents');
      await fs.mkdir(targetDocuments, { recursive: true });
      const oldKey = '99999999-8888-7777-6666-555555555555.pdf';
      await fs.writeFile(path.join(targetDocuments, oldKey), PDF_BYTES);

      const summary = await restoreEncryptedBackup({
        archive: backup.bytes,
        password: PASSWORD,
        targetDatabasePath: path.join(targetDir, 'simple-finance.sqlite'),
        targetDocumentsDir: targetDocuments,
      });

      assert.ok(summary.previousDocumentsPreservedAs !== null);
      assert.ok(
        existsSync(path.join(summary.previousDocumentsPreservedAs!, oldKey)),
        'the old documents directory is kept, not deleted',
      );
      assert.deepEqual(await fs.readFile(path.join(targetDocuments, stored.fileKey)), PNG_BYTES);
      assert.equal(existsSync(path.join(targetDocuments, oldKey)), false);
    } finally {
      fx.close();
    }
  });

  it('empties the documents directory when the archive carries none', async () => {
    const plain = await createHouseholdFixture(ACTOR);
    try {
      const documentsDir = documentsDirForDatabase(plain.handle.raw.name);
      const backup = await createEncryptedBackup({
        handle: plain.handle,
        password: PASSWORD,
        documentsDir,
      });
      assert.equal(backup.manifest.documents.included, 0);

      const targetDir = await makeTempDir('sf-restore-empty-docs-');
      const targetDocuments = path.join(targetDir, 'documents');
      await fs.mkdir(targetDocuments, { recursive: true });
      const staleKey = '99999999-8888-7777-6666-555555555555.png';
      await fs.writeFile(path.join(targetDocuments, staleKey), PNG_BYTES);

      const summary = await restoreEncryptedBackup({
        archive: backup.bytes,
        password: PASSWORD,
        targetDatabasePath: path.join(targetDir, 'simple-finance.sqlite'),
        targetDocumentsDir: targetDocuments,
      });
      assert.equal(summary.documentsRestored, 0);
      assert.equal(
        existsSync(path.join(targetDocuments, staleKey)),
        false,
        'a restored installation does not keep files the restored database never knew about',
      );
      assert.ok(existsSync(targetDocuments), 'the directory itself exists for future uploads');
    } finally {
      plain.close();
    }
  });
});

describe('restore rejects archives that are not exactly what they claim', () => {
  it('rejects a document whose bytes do not match the manifest', async () => {
    const { fx, documentsDir, stored } = await seededWithReceipts();
    try {
      const backup = await createEncryptedBackup({
        handle: fx.handle,
        password: PASSWORD,
        documentsDir,
      });
      const tar = await import('tar');
      const staging = await makeTempDir('sf-restore-tamper-doc-');
      const archivePath = path.join(staging, 'archive.tar.gz');
      await fs.writeFile(archivePath, decryptBackupPayload(backup.bytes, PASSWORD));
      await tar.x({ file: archivePath, cwd: staging });
      // Replace the receipt with different bytes, leaving the manifest (and so
      // its sha256) untouched — exactly what a tampered archive looks like.
      await fs.writeFile(
        path.join(staging, 'documents', stored.fileKey),
        Buffer.concat([PNG_BYTES, Buffer.from('tampered')]),
      );
      const repacked = path.join(staging, 'repacked.tar.gz');
      await tar.c({ file: repacked, cwd: staging, gzip: true }, [
        'db.sqlite',
        'manifest.json',
        `documents/${stored.fileKey}`,
      ]);
      const archive = encryptBackupPayload(await fs.readFile(repacked), PASSWORD);

      const target = await makeTempDir('sf-restore-tamper-target-');
      await assert.rejects(
        () =>
          restoreEncryptedBackup({
            archive,
            password: PASSWORD,
            targetDatabasePath: path.join(target, 'x.sqlite'),
            targetDocumentsDir: path.join(target, 'documents'),
          }),
        (err: unknown) =>
          err instanceof RestoreError && /integrity verification/.test((err as Error).message),
      );
      assert.equal(existsSync(path.join(target, 'x.sqlite')), false, 'nothing was written');
    } finally {
      fx.close();
    }
  });

  it('rejects an archive containing a member the manifest does not describe', async () => {
    const { fx, documentsDir } = await seededWithReceipts();
    try {
      const backup = await createEncryptedBackup({
        handle: fx.handle,
        password: PASSWORD,
        documentsDir,
      });
      const tar = await import('tar');
      const staging = await makeTempDir('sf-restore-extra-');
      await fs.writeFile(
        path.join(staging, 'archive.tar.gz'),
        decryptBackupPayload(backup.bytes, PASSWORD),
      );
      await tar.x({ file: path.join(staging, 'archive.tar.gz'), cwd: staging });
      // Smuggle in a document the manifest never mentions.
      const smuggled = '99999999-8888-7777-6666-555555555555.png';
      await fs.mkdir(path.join(staging, 'documents'), { recursive: true });
      await fs.writeFile(path.join(staging, 'documents', smuggled), PNG_BYTES);
      const repacked = path.join(staging, 'repacked.tar.gz');
      await tar.c({ file: repacked, cwd: staging, gzip: true }, [
        'db.sqlite',
        'manifest.json',
        'documents',
      ]);
      const archive = encryptBackupPayload(await fs.readFile(repacked), PASSWORD);

      const target = await makeTempDir('sf-restore-extra-target-');
      await assert.rejects(
        () =>
          restoreEncryptedBackup({
            archive,
            password: PASSWORD,
            targetDatabasePath: path.join(target, 'x.sqlite'),
            targetDocumentsDir: path.join(target, 'documents'),
          }),
        (err: unknown) =>
          err instanceof RestoreError && /unlisted member/.test((err as Error).message),
      );
      assert.equal(existsSync(path.join(target, 'x.sqlite')), false, 'nothing was written');
    } finally {
      fx.close();
    }
  });

  it('rejects a manifest that lists a path outside the allowlist', async () => {
    const { fx } = await seededWithReceipts();
    try {
      const tar = await import('tar');
      const staging = await makeTempDir('sf-restore-paths-');
      await fx.handle.raw.backup(path.join(staging, 'db.sqlite'));
      const snapshot = await fs.readFile(path.join(staging, 'db.sqlite'));
      const { sha256Hex } = await import('../src/lib/backup/backup');
      const manifest = {
        format: 'simple-finance-backup',
        formatVersion: 2,
        app: 'Simple Finance',
        appVersion: '0.1.0',
        createdAt: '2026-09-20T20:30:12.000Z',
        createdAtLocal: '20 Sept 2026, 21:30',
        counts: { pots: 5, checkpoints: 0, auditEntries: 0 },
        documents: { included: 1, orphans: [], skippedUnstored: 0 },
        files: [
          { path: 'db.sqlite', bytes: snapshot.length, sha256: sha256Hex(snapshot) },
          { path: '../escape.png', bytes: 3, sha256: sha256Hex(Buffer.from('abc')) },
        ],
      };
      await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest));
      await fs.writeFile(path.join(staging, 'escape.png'), 'abc');
      const archivePath = path.join(staging, 'archive.tar.gz');
      await tar.c({ file: archivePath, cwd: staging, gzip: true }, ['db.sqlite', 'manifest.json']);
      const archive = encryptBackupPayload(await fs.readFile(archivePath), PASSWORD);

      const target = await makeTempDir('sf-restore-paths-target-');
      await assert.rejects(
        () =>
          restoreEncryptedBackup({
            archive,
            password: PASSWORD,
            targetDatabasePath: path.join(target, 'x.sqlite'),
            targetDocumentsDir: path.join(target, 'documents'),
          }),
        (err: unknown) =>
          err instanceof RestoreError && /unsupported path/.test((err as Error).message),
      );
    } finally {
      fx.close();
    }
  });

  it('restores a format 1 archive of an installation without attachments', async () => {
    const fx = await createHouseholdFixture(ACTOR);
    try {
      // Build a format 1 archive by hand: same frame, manifest v1, no documents.
      const staging = await makeTempDir('sf-format1-');
      await fx.handle.raw.backup(path.join(staging, 'db.sqlite'));
      const snapshot = await fs.readFile(path.join(staging, 'db.sqlite'));
      const { sha256Hex } = await import('../src/lib/backup/backup');
      const manifest = {
        format: 'simple-finance-backup',
        formatVersion: 1,
        app: 'Simple Finance',
        appVersion: '0.0.9',
        createdAt: '2026-01-01T12:00:00.000Z',
        createdAtLocal: '1 Jan 2026, 12:00',
        counts: { pots: 5, checkpoints: 0, auditEntries: 0 },
        files: [{ path: 'db.sqlite', bytes: snapshot.length, sha256: sha256Hex(snapshot) }],
      };
      await fs.writeFile(
        path.join(staging, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      const tar = await import('tar');
      const archivePath = path.join(staging, 'archive.tar.gz');
      await tar.c({ file: archivePath, cwd: staging, gzip: true }, ['db.sqlite', 'manifest.json']);
      const archive = encryptBackupPayload(await fs.readFile(archivePath), PASSWORD);

      const targetDir = await makeTempDir('sf-format1-target-');
      const targetDocuments = path.join(targetDir, 'documents');
      const summary = await restoreEncryptedBackup({
        archive,
        password: PASSWORD,
        targetDatabasePath: path.join(targetDir, 'simple-finance.sqlite'),
        targetDocumentsDir: targetDocuments,
      });
      assert.equal(summary.manifest.formatVersion, 1);
      assert.equal(summary.manifest.appVersion, '0.0.9');
      assert.equal(summary.documentsRestored, 0);
      assert.ok(existsSync(path.join(targetDir, 'simple-finance.sqlite')));
    } finally {
      fx.close();
    }
  });

  it('refuses a format 1 archive whose database references attachments it cannot carry', async () => {
    const { fx } = await seededWithReceipts();
    try {
      // A pre-Phase-5 archive of a database that had already recorded receipts:
      // the restore must refuse rather than silently lose the documents.
      const tar = await import('tar');
      const staging = await makeTempDir('sf-format1-legacy-');
      await fx.handle.raw.backup(path.join(staging, 'db.sqlite'));
      const snapshot = await fs.readFile(path.join(staging, 'db.sqlite'));
      const { sha256Hex } = await import('../src/lib/backup/backup');
      await fs.writeFile(
        path.join(staging, 'manifest.json'),
        JSON.stringify({
          format: 'simple-finance-backup',
          formatVersion: 1,
          app: 'Simple Finance',
          appVersion: '0.1.0',
          createdAt: '2026-09-01T09:00:00.000Z',
          createdAtLocal: '1 Sept 2026, 10:00',
          counts: { pots: 5, checkpoints: 0, auditEntries: 0 },
          files: [{ path: 'db.sqlite', bytes: snapshot.length, sha256: sha256Hex(snapshot) }],
        }),
      );
      const archivePath = path.join(staging, 'archive.tar.gz');
      await tar.c({ file: archivePath, cwd: staging, gzip: true }, ['db.sqlite', 'manifest.json']);
      const archive = encryptBackupPayload(await fs.readFile(archivePath), PASSWORD);

      const target = await makeTempDir('sf-format1-legacy-target-');
      await assert.rejects(
        () =>
          restoreEncryptedBackup({
            archive,
            password: PASSWORD,
            targetDatabasePath: path.join(target, 'x.sqlite'),
            targetDocumentsDir: path.join(target, 'documents'),
          }),
        (err: unknown) =>
          err instanceof RestoreError && /archive does not contain/.test((err as Error).message),
      );
      assert.equal(existsSync(path.join(target, 'x.sqlite')), false, 'nothing was written');
    } finally {
      fx.close();
    }
  });
});
