import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { POST } from '../src/app/api/backup/route';
import { restoreEncryptedBackup } from '../src/lib/backup/restore';
import { closeDbHandle, getDbHandle } from '../src/lib/db/client';
import { loadAppConfig } from '../src/lib/config';
import { addCheckpoint, createPot } from '../src/lib/records/pots';
import { makeTempDir } from './helpers';

/**
 * Exercises the real route handler (auth guard, validation, archive response)
 * against an isolated DATA_DIR, then proves the downloaded bytes restore.
 */
describe('POST /api/backup (route handler)', () => {
  let dataDir: string;

  before(async () => {
    dataDir = await makeTempDir('sf-api-backup-');
    process.env.DATA_DIR = dataDir;
    process.env.AUTH_DEV_BYPASS = 'false';
  });

  after(async () => {
    closeDbHandle();
    delete process.env.DATA_DIR;
    delete process.env.AUTH_DEV_BYPASS;
    delete process.env.AUTH_DEV_IDENTITY_EMAIL;
  });

  function request(body: unknown): Request {
    return new Request('http://localhost:3000/api/backup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects unauthenticated requests (no bypass, auth unconfigured)', async () => {
    const response = await POST(request({ password: 'x' }));
    assert.equal(response.status, 401);
  });

  it('rejects a missing/empty password before doing any work', async () => {
    process.env.AUTH_DEV_BYPASS = 'true';
    process.env.AUTH_DEV_IDENTITY_EMAIL = 'dev@example.com';
    try {
      const noPassword = await POST(request({}));
      assert.equal(noPassword.status, 400);
      const emptyPassword = await POST(request({ password: '' }));
      assert.equal(emptyPassword.status, 400);
    } finally {
      process.env.AUTH_DEV_BYPASS = 'false';
    }
  });

  it('returns an encrypted, restorable archive for an authenticated user', async () => {
    process.env.AUTH_DEV_BYPASS = 'true';
    process.env.AUTH_DEV_IDENTITY_EMAIL = 'dev@example.com';

    const config = loadAppConfig();
    const handle = getDbHandle(config);
    const pot = createPot(handle.db, {
      label: 'Main account',
      kind: 'bank',
      actor: 'dev@example.com',
    });
    addCheckpoint(handle.db, {
      potId: pot.id,
      amountPence: 41235,
      effectiveAt: new Date('2026-09-26T18:05:00Z'),
      actor: 'dev@example.com',
    });

    const response = await POST(request({ password: 'backup-passphrase-1' }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');

    const disposition = response.headers.get('content-disposition') ?? '';
    assert.match(disposition, /^attachment; filename="simple-finance-backup-v0\.1\.0-/);
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1];
    assert.ok(filename !== undefined);

    const bytes = Buffer.from(await response.arrayBuffer());
    const targetDir = await makeTempDir('sf-api-restore-');
    const summary = await restoreEncryptedBackup({
      archive: bytes,
      password: 'backup-passphrase-1',
      targetDatabasePath: path.join(targetDir, 'restored.sqlite'),
    });
    assert.equal(summary.manifest.counts.pots, 1);
    assert.equal(summary.manifest.counts.checkpoints, 1);
  });
});
