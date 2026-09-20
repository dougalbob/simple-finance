#!/usr/bin/env node
/**
 * Simple Finance migration runner (AGENT_APP_BLUEPRINT.md §7).
 * Invoked by docker-entrypoint.sh before the server starts, and available as
 * `npm run db:migrate`. Uses production dependencies only — no TypeScript
 * toolchain needed in the container. Migration failure exits non-zero so the
 * entrypoint refuses to start the server.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { migrate } = require('drizzle-orm/better-sqlite3/migrator');

function resolveDatabasePath() {
  const dataDir = (
    process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/data' : './data')
  ).trim();
  return (process.env.DATABASE_PATH || path.join(dataDir, 'simple-finance.sqlite')).trim();
}

const databasePath = resolveDatabasePath();
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const raw = new Database(databasePath);
raw.pragma('journal_mode = WAL');
raw.pragma('foreign_keys = ON');

try {
  const db = drizzle(raw);
  migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
  console.log(`[migrate] database is up to date: ${databasePath}`);
} catch (err) {
  console.error('[migrate] FAILED:', err && err.message ? err.message : err);
  process.exitCode = 1;
} finally {
  raw.close();
}
