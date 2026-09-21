import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { POST as backupPOST } from '../src/app/api/backup/route';
import { POST as restorePOST } from '../src/app/api/restore/route';
import { closeDbHandle, getDbHandle } from '../src/lib/db/client';
import { loadAppConfig } from '../src/lib/config';
import { listPots, createPot, addCheckpoint } from '../src/lib/records/pots';
import { makeTempDir } from './helpers';

/**
 * The restore entry point (SPEC §18.4, blueprint §4.4/§4.7). Exercised through
 * the real route handlers: unauthenticated, cross-origin, unconfirmed, wrong
 * password and the honest happy path — including that the live database is
 * reopened against the restored data.
 */

const PASSWORD = 'a-long-enough-passphrase';

describe('POST /api/restore (route handler)', () => {
  let dataDir: string;
  let archive: Buffer;

  before(async () => {
    dataDir = await makeTempDir('sf-api-restore-');
    process.env.DATA_DIR = dataDir;
    process.env.AUTH_DEV_BYPASS = 'false';
    delete process.env.AUTH_DEV_IDENTITY_EMAIL;

    // An installation with a pot and a checkpoint, archived with two pots'
    // worth of later activity left out.
    process.env.AUTH_DEV_BYPASS = 'true';
    process.env.AUTH_DEV_IDENTITY_EMAIL = 'dev@example.com';
    const config = loadAppConfig();
    const handle = getDbHandle(config);
    const main = createPot(handle.db, {
      label: 'Main account',
      kind: 'bank',
      actor: 'dev@example.com',
    });
    addCheckpoint(handle.db, {
      potId: main.id,
      amountPence: 41235,
      effectiveAt: new Date('2026-09-20T18:05:00Z'),
      actor: 'dev@example.com',
      now: new Date('2026-09-20T18:06:00Z'),
    });
    const backupResponse = await backupPOST(
      new Request('http://localhost:3000/api/backup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );
    assert.equal(backupResponse.status, 200);
    archive = Buffer.from(await backupResponse.arrayBuffer());
    createPot(handle.db, {
      label: 'Added after the backup',
      kind: 'cash',
      actor: 'dev@example.com',
    });
    process.env.AUTH_DEV_BYPASS = 'false';
  });

  after(() => {
    closeDbHandle();
    delete process.env.DATA_DIR;
    delete process.env.AUTH_DEV_BYPASS;
    delete process.env.AUTH_DEV_IDENTITY_EMAIL;
  });

  function restoreRequest(
    fields: { confirm?: string; password?: string; archive?: Blob | null },
    headers: Record<string, string> = {},
  ): Request {
    const body = new FormData();
    if (fields.confirm !== undefined) body.set('confirm', fields.confirm);
    if (fields.password !== undefined) body.set('password', fields.password);
    if (fields.archive !== undefined && fields.archive !== null) {
      body.set('archive', fields.archive, 'archive.simple-finance-backup');
    }
    return new Request('http://localhost:3000/api/restore', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', ...headers },
      body,
    });
  }

  it('rejects an unauthenticated request', async () => {
    const response = await restorePOST(
      restoreRequest({
        confirm: 'RESTORE',
        password: PASSWORD,
        archive: new Blob([new Uint8Array(archive)]),
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(listPots(getDbHandle(loadAppConfig()).db).length, 2);
  });

  it('rejects a cross-origin request even when it is authenticated', async () => {
    process.env.AUTH_DEV_BYPASS = 'true';
    process.env.AUTH_DEV_IDENTITY_EMAIL = 'dev@example.com';
    try {
      const response = await restorePOST(
        restoreRequest(
          { confirm: 'RESTORE', password: PASSWORD, archive: new Blob([new Uint8Array(archive)]) },
          { origin: 'https://somewhere-else.example.com' },
        ),
      );
      assert.equal(response.status, 403);
      assert.equal(listPots(getDbHandle(loadAppConfig()).db).length, 2);
    } finally {
      process.env.AUTH_DEV_BYPASS = 'false';
    }
  });

  it('requires the typed confirmation and a file', async () => {
    process.env.AUTH_DEV_BYPASS = 'true';
    process.env.AUTH_DEV_IDENTITY_EMAIL = 'dev@example.com';
    try {
      const unconfirmed = await restorePOST(
        restoreRequest({
          confirm: 'yes',
          password: PASSWORD,
          archive: new Blob([new Uint8Array(archive)]),
        }),
      );
      assert.equal(unconfirmed.status, 400);
      const noFile = await restorePOST(restoreRequest({ confirm: 'RESTORE', password: PASSWORD }));
      assert.equal(noFile.status, 400);
      const noPassword = await restorePOST(
        restoreRequest({
          confirm: 'RESTORE',
          password: '',
          archive: new Blob([new Uint8Array(archive)]),
        }),
      );
      assert.equal(noPassword.status, 400);
      assert.equal(listPots(getDbHandle(loadAppConfig()).db).length, 2, 'nothing changed');
    } finally {
      process.env.AUTH_DEV_BYPASS = 'false';
    }
  });

  it('reports a wrong password without touching the installation', async () => {
    process.env.AUTH_DEV_BYPASS = 'true';
    process.env.AUTH_DEV_IDENTITY_EMAIL = 'dev@example.com';
    try {
      const response = await restorePOST(
        restoreRequest({
          confirm: 'RESTORE',
          password: 'the wrong passphrase',
          archive: new Blob([new Uint8Array(archive)]),
        }),
      );
      assert.equal(response.status, 400);
      const payload = (await response.json()) as { error: string };
      assert.match(payload.error, /password/i);
      assert.equal(listPots(getDbHandle(loadAppConfig()).db).length, 2, 'the live data is intact');
    } finally {
      process.env.AUTH_DEV_BYPASS = 'false';
    }
  });

  it('restores over the live installation and reopens the database', async () => {
    process.env.AUTH_DEV_BYPASS = 'true';
    process.env.AUTH_DEV_IDENTITY_EMAIL = 'dev@example.com';
    try {
      const response = await restorePOST(
        restoreRequest({
          confirm: 'RESTORE',
          password: PASSWORD,
          archive: new Blob([new Uint8Array(archive)]),
        }),
      );
      assert.equal(response.status, 200);
      const payload = (await response.json()) as {
        restored: boolean;
        counts: { pots: number; checkpoints: number };
        reopened: boolean;
        previousPreservedAs: string | null;
      };
      assert.equal(payload.restored, true);
      assert.equal(payload.reopened, true);
      assert.equal(payload.counts.pots, 1);
      assert.ok(payload.previousPreservedAs !== null);

      const pots = listPots(getDbHandle(loadAppConfig()).db);
      assert.deepEqual(
        pots.map((pot) => pot.label),
        ['Main account'],
        'the pot added after the backup is gone',
      );
      assert.ok(path.isAbsolute(payload.previousPreservedAs!));
    } finally {
      process.env.AUTH_DEV_BYPASS = 'false';
    }
  });
});
