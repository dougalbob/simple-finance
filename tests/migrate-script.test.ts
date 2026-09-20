import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, it } from 'node:test';

/**
 * Proves the exact production path: docker-entrypoint.sh calls
 * `node scripts/migrate.cjs`, which must create/upgrade the database and exit
 * zero — or exit non-zero so the entrypoint refuses to start (blueprint §7).
 */
describe('scripts/migrate.cjs (production migration runner)', () => {
  it('creates a migrated database and is idempotent on re-run', () => {
    const dir = path.join(
      tmpdir(),
      `sf-migrate-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(dir, { recursive: true });
    const databasePath = path.join(dir, 'simple-finance.sqlite');
    const script = path.resolve('scripts/migrate.cjs');

    for (let run = 1; run <= 2; run += 1) {
      const output = execFileSync('node', [script], {
        env: { ...process.env, DATA_DIR: dir, DATABASE_PATH: databasePath },
        encoding: 'utf8',
      });
      assert.match(output, /\[migrate\] database is up to date/);
    }

    const db = new Database(databasePath, { readonly: true });
    try {
      const tables = new Set(
        (
          db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
            name: string;
          }>
        ).map((row) => row.name),
      );
      for (const expected of ['pots', 'checkpoints', 'audit_entries', '__drizzle_migrations']) {
        assert.ok(tables.has(expected), `expected table ${expected}`);
      }
    } finally {
      db.close();
    }
  });
});
