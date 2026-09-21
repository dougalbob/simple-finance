import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { closeDbHandle, openDatabase, type DbHandle } from '../src/lib/db/client';
import { applyMigrations } from '../src/lib/db/migrate';
import { eq } from 'drizzle-orm';
import {
  addCheckpoint,
  createPot,
  latestCheckpointPerPot,
  listPots,
  PotNotFoundError,
  recentCheckpoints,
} from '../src/lib/records/pots';
import { auditEntries } from '../src/lib/db/schema';
import { makeTempDir } from './helpers';

describe('pots & checkpoints on an isolated database', () => {
  async function freshDb(): Promise<DbHandle> {
    const dir = await makeTempDir();
    const handle = openDatabase(path.join(dir, 'slice.sqlite'));
    applyMigrations(handle.db);
    return handle;
  }

  it('applies migrations idempotently and runs in WAL mode', async () => {
    const handle = await freshDb();
    try {
      assert.equal(handle.raw.pragma('journal_mode', { simple: true }), 'wal');
      assert.doesNotThrow(() => applyMigrations(handle.db));
    } finally {
      handle.raw.close();
    }
  });

  it('creates a pot and writes an audit entry in the same transaction', async () => {
    const handle = await freshDb();
    try {
      const pot = createPot(handle.db, {
        label: 'Main account',
        kind: 'bank',
        actor: 'alex@example.com',
        now: new Date('2026-09-20T17:00:00Z'),
      });
      assert.equal(pot.label, 'Main account');
      assert.equal(pot.kind, 'bank');
      assert.equal(pot.version, 1);

      const audit = handle.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, String(pot.id)))
        .all();
      const entry = audit.find((row) => row.entity === 'pot' && row.action === 'pot.create');
      assert.ok(entry, 'expected a pot.create audit entry');
      assert.equal(entry.actor, 'alex@example.com');
      assert.ok(entry.after !== null && JSON.parse(entry.after).label === 'Main account');
    } finally {
      handle.raw.close();
    }
  });

  it('records immutable checkpoints with audit, and rejects unknown pots', async () => {
    const handle = await freshDb();
    try {
      const pot = createPot(handle.db, {
        label: 'Shared jar',
        kind: 'cash',
        actor: 'sam@example.com',
      });
      const checkpoint = addCheckpoint(handle.db, {
        potId: pot.id,
        amountPence: 10450,
        effectiveAt: new Date('2026-09-22T16:00:00Z'),
        note: 'counted the jar',
        actor: 'sam@example.com',
        now: new Date('2026-09-22T16:05:00Z'),
      });
      assert.equal(checkpoint.amountPence, 10450);
      assert.equal(checkpoint.enteredBy, 'sam@example.com');

      const audit = handle.db
        .select()
        .from(auditEntries)
        .all()
        .filter((row) => row.action === 'checkpoint.create');
      assert.equal(audit.length, 1);

      assert.throws(
        () =>
          addCheckpoint(handle.db, {
            potId: pot.id + 1000,
            amountPence: 100,
            effectiveAt: new Date(),
            actor: 'sam@example.com',
          }),
        PotNotFoundError,
      );
    } finally {
      handle.raw.close();
    }
  });

  it('latest checkpoint per pot follows effective time, not insert order', async () => {
    const handle = await freshDb();
    try {
      const pot = createPot(handle.db, {
        label: 'Main account',
        kind: 'bank',
        actor: 'alex@example.com',
      });
      addCheckpoint(handle.db, {
        potId: pot.id,
        amountPence: 50000,
        effectiveAt: new Date('2026-09-25T09:00:00Z'),
        actor: 'alex@example.com',
        now: new Date('2026-09-25T09:05:00Z'),
      });
      addCheckpoint(handle.db, {
        potId: pot.id,
        amountPence: 41235,
        effectiveAt: new Date('2026-09-22T16:00:00Z'),
        actor: 'alex@example.com',
        now: new Date('2026-09-25T09:05:00Z'),
      });
      const latest = latestCheckpointPerPot(handle.db);
      assert.equal(latest.get(pot.id)?.amountPence, 50000);
    } finally {
      handle.raw.close();
    }
  });

  it('enforces foreign keys and lists pots in order', async () => {
    const handle = await freshDb();
    try {
      assert.throws(() =>
        handle.raw
          .prepare(
            'INSERT INTO checkpoints (pot_id, amount_pence, effective_at, entered_by, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(999999, 100, 0, 'nobody@example.com', 0),
      );

      createPot(handle.db, {
        label: 'Salary account',
        kind: 'bank',
        actor: 'sam@example.com',
        sortOrder: 1,
      });
      createPot(handle.db, {
        label: 'Main account',
        kind: 'bank',
        actor: 'sam@example.com',
        sortOrder: 0,
      });
      const labels = listPots(handle.db).map((pot) => pot.label);
      assert.deepEqual(labels, ['Main account', 'Salary account']);

      const recent = recentCheckpoints(handle.db, 10);
      assert.equal(recent.length, 0);
    } finally {
      handle.raw.close();
    }
  });

  it('the shared handle reopens when the configured path changes', async () => {
    const dirA = await makeTempDir('sf-a-');
    const dirB = await makeTempDir('sf-b-');
    closeDbHandle();
    try {
      const { getDbHandle } = await import('../src/lib/db/client');
      const { loadAppConfig } = await import('../src/lib/config');
      const handleA = getDbHandle(loadAppConfig({ NODE_ENV: 'test', DATA_DIR: dirA }));
      createPot(handleA.db, { label: 'Pot in A', kind: 'cash', actor: 'dev@example.com' });
      const handleB = getDbHandle(loadAppConfig({ NODE_ENV: 'test', DATA_DIR: dirB }));
      const labelsInB = listPots(handleB.db).map((pot) => pot.label);
      assert.deepEqual(labelsInB, []);
    } finally {
      closeDbHandle();
    }
  });

  it('the shared handle reopens when the database file is replaced in place', async () => {
    const dir = await makeTempDir('sf-live-swap-');
    closeDbHandle();
    try {
      const { getDbHandle } = await import('../src/lib/db/client');
      const { loadAppConfig } = await import('../src/lib/config');
      const config = loadAppConfig({ NODE_ENV: 'test', DATA_DIR: dir });
      const live = getDbHandle(config);
      createPot(live.db, { label: 'Before restore', kind: 'cash', actor: 'dev@example.com' });

      const replacementPath = path.join(dir, 'replacement.sqlite');
      const replacement = openDatabase(replacementPath);
      try {
        applyMigrations(replacement.db);
        createPot(replacement.db, { label: 'After restore', kind: 'bank', actor: 'dev@example.com' });
        replacement.raw.pragma('wal_checkpoint(TRUNCATE)');
      } finally {
        replacement.raw.close();
      }

      fs.renameSync(config.databasePath, `${config.databasePath}.before-restore`);
      for (const suffix of ['-wal', '-shm']) {
        const current = `${config.databasePath}${suffix}`;
        if (fs.existsSync(current)) {
          fs.renameSync(current, `${current}.before-restore`);
        }
      }
      fs.renameSync(replacementPath, config.databasePath);

      const reopened = getDbHandle(config);
      assert.deepEqual(
        listPots(reopened.db).map((pot) => pot.label),
        ['After restore'],
      );
    } finally {
      closeDbHandle();
    }
  });
});
