import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Phase 1 slice of the data model (docs/IMPLEMENTATION_PLAN.md — data model
 * sketch). Later phases add purchases/allocations, schedules, suppliers,
 * renewals, attachments and settings via further checked-in migrations.
 * Never edit an applied migration to change its meaning (blueprint §3).
 */

export const pots = sqliteTable('pots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  kind: text('kind', { enum: ['bank', 'cash'] }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  /** Authorised overdraft facility (pence); only set on pots that have one */
  overdraftLimitPence: integer('overdraft_limit_pence'),
  /** Warning threshold inside the overdraft (pence); SPEC §8 */
  warningThresholdPence: integer('warning_threshold_pence'),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  /** Optimistic concurrency counter (blueprint §3) */
  version: integer('version').notNull().default(1),
});

/**
 * A user-reported balance for a pot — "this is how much is in this pot at
 * this moment" (SPEC §5). Immutable history: a new checkpoint never edits or
 * deletes an older one.
 */
export const checkpoints = sqliteTable(
  'checkpoints',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    potId: integer('pot_id')
      .notNull()
      .references(() => pots.id),
    amountPence: integer('amount_pence').notNull(),
    effectiveAt: integer('effective_at', { mode: 'timestamp_ms' }).notNull(),
    note: text('note'),
    enteredBy: text('entered_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('checkpoints_pot_effective_idx').on(table.potId, table.effectiveAt)],
);

/**
 * Audit trail (blueprint §3): written in the same transaction as the change.
 * Corrections are edits/voids with retained history, never silent deletion.
 */
export const auditEntries = sqliteTable(
  'audit_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    summary: text('summary').notNull(),
    before: text('before'),
    after: text('after'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('audit_entity_idx').on(table.entity, table.entityId)],
);
