import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createEncryptedBackup } from '../src/lib/backup/backup';
import { restoreLiveInstallation } from '../src/lib/backup/live-restore';
import { BackupPasswordError } from '../src/lib/backup/crypto';
import { closeDbHandle, getDbHandle } from '../src/lib/db/client';
import { loadAppConfig } from '../src/lib/config';
import { addCheckpoint, createPot, listPots } from '../src/lib/records/pots';
import { makeTempDir } from './helpers';

/**
 * Live in-place restore (blueprint §6 restore contract, SPEC §18.4, decision
 * 34: "live in-place restore is Phase 5"). The rehearsal here is the one the
 * release notes ask the household to trust: take an archive, change the data,
 * put the archive back, and prove the app is reading the restored data again.
 */

const PASSWORD = 'a-long-enough-passphrase';
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('live in-place restore', () => {
  let dataDir: string;

  before(async () => {
    dataDir = await makeTempDir('sf-live-restore-');
    process.env.DATA_DIR = dataDir;
  });

  after(() => {
    closeDbHandle();
    delete process.env.DATA_DIR;
  });

  it('replaces the live installation and reopens the database against the archive', async () => {
    const config = loadAppConfig();
    const handle = getDbHandle(config);
    const keepMe = createPot(handle.db, {
      label: 'Main account',
      kind: 'bank',
      actor: 'alex@example.com',
      now: new Date('2026-09-20T10:00:00Z'),
    });
    addCheckpoint(handle.db, {
      potId: keepMe.id,
      amountPence: 41235,
      effectiveAt: new Date('2026-09-20T18:05:00Z'),
      actor: 'alex@example.com',
      now: new Date('2026-09-20T18:06:00Z'),
    });

    const backup = await createEncryptedBackup({
      handle,
      password: PASSWORD,
      documentsDir: config.documentsDir,
      now: new Date('2026-09-20T20:30:12Z'),
    });

    // Move the installation on: another pot, and one attachment file the
    // archive knows nothing about.
    const after = createPot(handle.db, {
      label: 'Opened after the backup',
      kind: 'cash',
      actor: 'sam@example.com',
    });
    await fs.mkdir(config.documentsDir, { recursive: true });
    const strayKey = '99999999-8888-7777-6666-555555555555.png';
    await fs.writeFile(path.join(config.documentsDir, strayKey), PNG_BYTES);
    assert.equal(listPots(handle.db).length, 2);

    const result = await restoreLiveInstallation({ archive: backup.bytes, password: PASSWORD });
    assert.equal(result.reopened, true);
    assert.equal(result.manifest.counts.pots, 1);

    // The reopened, process-wide handle reads the restored data.
    const reopened = getDbHandle(config);
    const pots = listPots(reopened.db);
    assert.deepEqual(
      pots.map((pot) => pot.label),
      ['Main account'],
      'the post-backup pot is gone and the archived one is back',
    );
    assert.notEqual(pots[0]!.id, after.id);
    assert.equal(
      existsSync(path.join(config.documentsDir, strayKey)),
      false,
      'the restored installation no longer holds the post-backup attachment',
    );
    assert.ok(
      result.previousPreservedAs !== null && existsSync(result.previousPreservedAs),
      'the previous database is preserved for a manual rollback',
    );
    assert.equal(result.previousDocumentsPreservedAs !== null, true);
  });

  it('keeps the installation working when the password is wrong', async () => {
    const config = loadAppConfig();
    const before = listPots(getDbHandle(config).db).length;
    await assert.rejects(
      () =>
        restoreLiveInstallation({
          archive: Buffer.from('not an archive at all, definitely not'),
          password: 'whatever',
        }),
      (err: unknown) => err instanceof Error,
    );
    const handle = getDbHandle(config);
    assert.equal(listPots(handle.db).length, before, 'the live data is untouched and readable');
    assert.deepEqual(handle.raw.prepare('SELECT 1 AS one').get(), { one: 1 });
  });

  it('reports a wrong password without touching the installation', async () => {
    const config = loadAppConfig();
    const handle = getDbHandle(config);
    const backup = await createEncryptedBackup({
      handle,
      password: PASSWORD,
      documentsDir: config.documentsDir,
    });
    const potCount = listPots(handle.db).length;
    await assert.rejects(
      () =>
        restoreLiveInstallation({
          archive: backup.bytes,
          password: 'the wrong passphrase entirely',
        }),
      BackupPasswordError,
    );
    assert.equal(listPots(getDbHandle(config).db).length, potCount, 'nothing changed');
    const files = await fs.readdir(dataDir);
    assert.ok(files.includes('documents'));
    assert.equal(
      files.some((name) => name.startsWith('.restore-staging-')),
      false,
      'the staging directory is always cleaned up',
    );
  });
});
