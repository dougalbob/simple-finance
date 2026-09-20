import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

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

/**
 * Phase 2a core money records (docs/SPEC.md §6, §9–§10, §12).
 *
 * Conventions shared by the new tables:
 * - money is integer pence (blueprint §3);
 * - date-only facts are TEXT 'YYYY-MM-DD' in Europe/London; instants are
 *   millisecond timestamps (UTC);
 * - correctable records carry voided_at/voided_by/void_reason (retained,
 *   excluded from totals — never silently deleted) and a version counter for
 *   optimistic concurrency on shared edits.
 */

/** The two household members (labels configured privately; SPEC §3). */
export const people = sqliteTable('people', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  version: integer('version').notNull().default(1),
});

/** Vehicles as running-cost targets (SPEC §13), each with an owning person. */
export const vehicles = sqliteTable('vehicles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  ownerPersonId: integer('owner_person_id').references(() => people.id),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  version: integer('version').notNull().default(1),
});

/**
 * Two-level category tree (SPEC §12): rows with parent_id NULL are parents;
 * allocations always land on a child (leaf). Retiring a child blocks new
 * assignments but preserves history.
 */
export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    parentId: integer('parent_id').references((): AnySQLiteColumn => categories.id),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    retiredAt: integer('retired_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [index('categories_parent_idx').on(table.parentId)],
);

/**
 * Suppliers: autocomplete memory plus the contact card (SPEC §21.1).
 * normalized_name is unique so \"Tesco\" and \"  TESCO \" cannot fork.
 */
export const suppliers = sqliteTable(
  'suppliers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    website: text('website'),
    address: text('address'),
    notes: text('notes'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [uniqueIndex('suppliers_normalized_uidx').on(table.normalizedName)],
);

/**
 * Purchases, including refunds: a refund is its own record with a negative
 * total, negative allocation lines and refund_of_purchase_id set (SPEC §9.5).
 * The exact-total rule (Σ allocations = total) is enforced in the domain
 * transaction (src/lib/records/purchases.ts) and covered by tests.
 */
export const purchases = sqliteTable(
  'purchases',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    supplierId: integer('supplier_id').references(() => suppliers.id),
    potId: integer('pot_id')
      .notNull()
      .references(() => pots.id),
    totalPence: integer('total_pence').notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    /** Local calendar date the purchase belongs to ('YYYY-MM-DD'). */
    occurredDate: text('occurred_date').notNull(),
    paidByPersonId: integer('paid_by_person_id').references(() => people.id),
    enteredBy: text('entered_by').notNull(),
    note: text('note'),
    refundOfPurchaseId: integer('refund_of_purchase_id').references(
      (): AnySQLiteColumn => purchases.id,
    ),
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    voidedBy: text('voided_by'),
    voidReason: text('void_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    check('purchases_total_nonzero', sql`${table.totalPence} != 0`),
    check(
      'purchases_refund_sign',
      sql`(${table.refundOfPurchaseId} IS NULL AND ${table.totalPence} > 0) OR (${table.refundOfPurchaseId} IS NOT NULL AND ${table.totalPence} < 0)`,
    ),
    index('purchases_pot_occurred_idx').on(table.potId, table.occurredAt),
    index('purchases_supplier_idx').on(table.supplierId),
    index('purchases_occurred_date_idx').on(table.occurredDate),
    index('purchases_refund_of_idx').on(table.refundOfPurchaseId),
  ],
);

/**
 * Allocation lines: each a whole-pence amount on exactly one leaf category
 * with exactly one target (SPEC §9.3–§9.4). target_id is NULL for household,
 * a people.id for person, a vehicles.id for vehicle (polymorphic by
 * target_kind — existence is enforced in the domain layer).
 */
export const allocations = sqliteTable(
  'allocations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    purchaseId: integer('purchase_id')
      .notNull()
      .references(() => purchases.id),
    amountPence: integer('amount_pence').notNull(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id),
    targetKind: text('target_kind', { enum: ['household', 'person', 'vehicle'] }).notNull(),
    targetId: integer('target_id'),
  },
  (table) => [
    check('allocations_amount_nonzero', sql`${table.amountPence} != 0`),
    index('allocations_purchase_idx').on(table.purchaseId),
    index('allocations_category_idx').on(table.categoryId),
  ],
);

/**
 * Pot-to-pot movements (SPEC §10): first-class records that never count as
 * spending. Included in per-pot estimates, excluded from every insight.
 */
export const transfers = sqliteTable(
  'transfers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fromPotId: integer('from_pot_id')
      .notNull()
      .references(() => pots.id),
    toPotId: integer('to_pot_id')
      .notNull()
      .references(() => pots.id),
    amountPence: integer('amount_pence').notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    occurredDate: text('occurred_date').notNull(),
    enteredBy: text('entered_by').notNull(),
    note: text('note'),
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    voidedBy: text('voided_by'),
    voidReason: text('void_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    check('transfers_amount_positive', sql`${table.amountPence} > 0`),
    check('transfers_different_pots', sql`${table.fromPotId} != ${table.toPotId}`),
    index('transfers_from_occurred_idx').on(table.fromPotId, table.occurredAt),
    index('transfers_to_occurred_idx').on(table.toPotId, table.occurredAt),
  ],
);
