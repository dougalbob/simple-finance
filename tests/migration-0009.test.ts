import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { openDatabase } from '../src/lib/db/client';
import { applyMigrations } from '../src/lib/db/migrate';
import { makeTempDir } from './helpers';

/**
 * Migration 0009 (v0.10.0) rebuilds the `attachments` table so a document can
 * belong to an income record as well as a purchase, and adds the optional
 * fuel columns to `purchases`. An installation upgrading from v0.9.0 already
 * has receipts attached — this proves every one of them survives the rebuild
 * with its id, key and state, and that the existing purchases come through
 * with no fuel details and the full-tank default.
 */
describe('migration 0009 on an installation that already has receipts', () => {
  it('keeps every attachment and purchase exactly as it was', async () => {
    const dir = await makeTempDir('sf-mig0009-');
    // A migrations folder as v0.9.0 shipped it: 0000…0008.
    const before = path.join(dir, 'drizzle-v0.9.0');
    cpSync(path.resolve('drizzle'), before, { recursive: true });
    rmSync(path.join(before, '0009_income_documents_fuel_details.sql'));
    const journalPath = path.join(before, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ tag: string }>;
    };
    journal.entries = journal.entries.filter(
      (entry) => entry.tag !== '0009_income_documents_fuel_details',
    );
    writeFileSync(journalPath, JSON.stringify(journal));

    const handle = openDatabase(path.join(dir, 'upgrade.sqlite'));
    try {
      applyMigrations(handle.db, before);
      const raw = handle.raw;
      raw
        .prepare(
          `INSERT INTO pots (id, label, kind, sort_order, created_at, updated_at) VALUES (1, 'Main', 'bank', 0, 0, 0)`,
        )
        .run();
      const category = raw
        .prepare(`SELECT id FROM categories WHERE parent_id IS NOT NULL LIMIT 1`)
        .get() as { id: number };
      for (const id of [1, 2]) {
        raw
          .prepare(
            `INSERT INTO purchases (id, pot_id, total_pence, occurred_at, occurred_date, entered_by, created_at, updated_at)
             VALUES (?, 1, 1000, 0, '2026-09-01', 'alex@example.com', 0, 0)`,
          )
          .run(id);
        raw
          .prepare(
            `INSERT INTO allocations (purchase_id, amount_pence, category_id, target_kind) VALUES (?, 1000, ?, 'household')`,
          )
          .run(id, category.id);
      }
      const insertAttachment = raw.prepare(
        `INSERT INTO attachments (id, purchase_id, file_key, original_name, mime, size_bytes, sha256, state, created_by, created_at)
         VALUES (?, ?, ?, ?, 'image/png', 10, 'abc', ?, 'alex@example.com', 0)`,
      );
      insertAttachment.run(1, 1, '11111111-1111-4111-8111-111111111111.png', 'till.png', 'stored');
      insertAttachment.run(7, 2, '22222222-2222-4222-8222-222222222222.png', 'old.png', 'deleted');
      const snapshot = raw.prepare(`SELECT * FROM attachments ORDER BY id`).all();

      applyMigrations(handle.db);

      const after = raw
        .prepare(
          `SELECT id, purchase_id, file_key, original_name, mime, size_bytes, sha256, state, created_by, created_at FROM attachments ORDER BY id`,
        )
        .all();
      assert.deepEqual(after, snapshot);
      const receiptIds = raw.prepare(`SELECT receipt_id FROM attachments`).all() as Array<{
        receipt_id: number | null;
      }>;
      assert.ok(receiptIds.every((row) => row.receipt_id === null));

      // New ids carry on after the highest old one — no reuse of id 7.
      raw
        .prepare(
          `INSERT INTO attachments (purchase_id, file_key, original_name, mime, size_bytes, sha256, created_by, created_at)
           VALUES (1, '33333333-3333-4333-8333-333333333333.pdf', 'new.pdf', 'application/pdf', 5, 'def', 'a', 0)`,
        )
        .run();
      const newest = raw.prepare(`SELECT max(id) AS id FROM attachments`).get() as { id: number };
      assert.equal(newest.id, 8);

      const fuel = raw
        .prepare(`SELECT odometer_miles, fuel_millilitres, fuel_full_tank FROM purchases`)
        .all();
      assert.deepEqual(fuel, [
        { odometer_miles: null, fuel_millilitres: null, fuel_full_tank: 1 },
        { odometer_miles: null, fuel_millilitres: null, fuel_full_tank: 1 },
      ]);
      // The column checks hold: no zero or negative readings.
      assert.throws(() =>
        raw.prepare(`UPDATE purchases SET odometer_miles = 0 WHERE id = 1`).run(),
      );
      assert.throws(() =>
        raw.prepare(`UPDATE purchases SET fuel_millilitres = -5 WHERE id = 1`).run(),
      );
      assert.equal(raw.pragma('foreign_key_check').length, 0);
      assert.equal(raw.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
      handle.raw.close();
    }
  });
});
