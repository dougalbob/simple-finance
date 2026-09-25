import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { loadAppConfig, type AppConfig } from '../config';
import { applyMigrations } from './migrate';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
export type RawDatabase = Database.Database;

export interface DbHandle {
  db: Db;
  raw: RawDatabase;
  fileIdentity: DatabaseFileIdentity;
}

interface DatabaseFileIdentity {
  dev: number;
  ino: number;
}

/**
 * Open a SQLite database with the pragmas this app depends on:
 * WAL for safe concurrent reads, foreign keys enforced, bounded lock waits.
 */
export function openDatabase(databasePath: string): DbHandle {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const raw = new Database(databasePath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('busy_timeout = 5000');
  return { db: drizzle(raw, { schema }), raw, fileIdentity: databaseFileIdentity(databasePath) };
}

let handle: DbHandle | null = null;

/**
 * Process-wide handle for request handling. In non-production it also applies
 * pending migrations on open (developer convenience — idempotent); in
 * production the container entrypoint owns migrations and startup fails if
 * they cannot be applied (blueprint §7).
 */
export function getDbHandle(config: AppConfig = loadAppConfig()): DbHandle {
  // `raw.name` is the path AS PASSED — resolve both sides before comparing,
  // or a relative DATABASE_PATH never matches and every call closes and
  // reopens the handle (its first victim: /settings, which calls this twice
  // and used to die mid-render with "The database connection is not open").
  if (
    handle === null ||
    path.resolve(handle.raw.name) !== path.resolve(config.databasePath) ||
    !sameDatabaseFile(handle.fileIdentity, config.databasePath)
  ) {
    if (handle !== null) handle.raw.close();
    handle = openDatabase(config.databasePath);
    if (!config.isProduction) {
      applyMigrations(handle.db);
    }
  }
  return handle;
}

function databaseFileIdentity(databasePath: string): DatabaseFileIdentity {
  const stat = fs.statSync(databasePath);
  return { dev: stat.dev, ino: stat.ino };
}

function sameDatabaseFile(identity: DatabaseFileIdentity, databasePath: string): boolean {
  try {
    const current = databaseFileIdentity(databasePath);
    return current.dev === identity.dev && current.ino === identity.ino;
  } catch {
    return false;
  }
}

/** Close the shared handle (used by tests to switch isolated databases). */
export function closeDbHandle(): void {
  if (handle !== null) {
    handle.raw.close();
    handle = null;
  }
}
