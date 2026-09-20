import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client';

/**
 * Apply pending checked-in migrations from ./drizzle.
 * Idempotent: drizzle's journal table tracks what has been applied.
 * Called by scripts/migrate.cjs (production entrypoint), by the dev server's
 * first database open, and by tests against isolated databases.
 */
export function applyMigrations(
  db: Db,
  migrationsFolder: string = path.resolve(process.cwd(), 'drizzle'),
): void {
  migrate(db, { migrationsFolder });
}
