import assert from 'node:assert/strict';
import { cpSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadAppConfig, type AppConfig } from '../src/lib/config';
import { closeDbHandle, getDbHandle } from '../src/lib/db/client';
import { createPot, listPots } from '../src/lib/records/pots';
import { makeTempDir } from './helpers';

/**
 * getDbHandle()'s identity check: better-sqlite3's `raw.name` is the path AS
 * PASSED, so comparing it with `path.resolve(config.databasePath)` never
 * matched when DATABASE_PATH/DATA_DIR was relative — every call closed the
 * previous handle and reopened a new one. /settings is the only page that
 * calls getDbHandle() twice, so its first handle died mid-render and the page
 * 500'd with "The database connection is not open". Both sides must resolve.
 */
describe('getDbHandle identity check', () => {
  it('returns the same live handle twice for a relative DATABASE_PATH', async () => {
    const originalCwd = process.cwd();
    const dir = await makeTempDir('sf-db-handle-');
    // getDbHandle() applies the checked-in ./drizzle migrations in development,
    // resolved from the working directory — take them along.
    cpSync(path.join(originalCwd, 'drizzle'), path.join(dir, 'drizzle'), { recursive: true });
    process.chdir(dir);
    closeDbHandle();
    try {
      const config: AppConfig = loadAppConfig({
        NODE_ENV: 'development',
        DATABASE_PATH: 'relative-data/simple-finance.sqlite',
      });
      assert.equal(config.databasePath, 'relative-data/simple-finance.sqlite');

      const first = getDbHandle(config);
      createPot(first.db, { label: 'Main account', kind: 'bank', actor: 'alex@example.com' });

      const second = getDbHandle(config);
      assert.equal(second, first, 'the same handle must come back, not a reopened one');
      assert.equal(first.raw.open, true, 'the first connection must not be closed');
      assert.deepEqual(
        listPots(first.db).map((pot) => pot.label),
        ['Main account'],
        'the first db must still answer queries',
      );
    } finally {
      closeDbHandle();
      process.chdir(originalCwd);
    }
  });

  it('still reopens when the database path really changes', async () => {
    const dir = await makeTempDir('sf-db-handle-');
    closeDbHandle();
    try {
      const first = getDbHandle(
        loadAppConfig({ NODE_ENV: 'development', DATABASE_PATH: path.join(dir, 'one.sqlite') }),
      );
      const second = getDbHandle(
        loadAppConfig({ NODE_ENV: 'development', DATABASE_PATH: path.join(dir, 'two.sqlite') }),
      );
      assert.notEqual(second, first, 'a different database must get a fresh handle');
      assert.equal(second.raw.name, path.join(dir, 'two.sqlite'));
    } finally {
      closeDbHandle();
    }
  });
});
