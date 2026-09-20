import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import { allocations, purchases, suppliers } from '../db/schema';
import { VersionConflictError } from './errors';

/**
 * Suppliers (SPEC §9.2, §15.1, §21.1): autocomplete memory plus the contact
 * card. The most-used category is derived from recorded purchases at read
 * time — never cached — so the preselected chip can never go stale.
 */

export type Supplier = typeof suppliers.$inferSelect;

export class SupplierNotFoundError extends Error {
  constructor(supplierId: number) {
    super(`No supplier with id ${supplierId}`);
    this.name = 'SupplierNotFoundError';
  }
}

export class InvalidSupplierNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSupplierNameError';
  }
}

export class DuplicateSupplierError extends Error {
  constructor(name: string) {
    super(`“${name}” is already a supplier — reusing the existing one.`);
    this.name = 'DuplicateSupplierError';
  }
}

export class InvalidSupplierContactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSupplierContactError';
  }
}

export const MAX_SUPPLIER_NAME_LENGTH = 120;
export const MAX_SUPPLIER_CONTACT_LENGTH = 254;
export const MAX_SUPPLIER_NOTES_LENGTH = 2000;

/**
 * Canonical supplier identity for uniqueness: trimmed, inner whitespace
 * collapsed, lower-cased. \"  TESCO \" and \"Tesco\" are the same supplier.
 */
export function normalizeSupplierName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function listSuppliers(db: Db): Supplier[] {
  return db.select().from(suppliers).orderBy(asc(suppliers.name)).all();
}

/**
 * Entry-friendly ordering: suppliers used recently appear first, followed by
 * the remaining names alphabetically. The list is deliberately small so the
 * browser can provide a native datalist without turning autocomplete into a
 * second financial workflow.
 */
export function listSuppliersForEntry(db: Db, limit = 40): Supplier[] {
  const all = listSuppliers(db);
  const recentIds = db
    .select({
      supplierId: purchases.supplierId,
      lastUsed: sql<number>`max(${purchases.occurredAt})`,
    })
    .from(purchases)
    .where(and(isNull(purchases.voidedAt), sql`${purchases.supplierId} IS NOT NULL`))
    .groupBy(purchases.supplierId)
    .orderBy(desc(sql`max(${purchases.occurredAt})`))
    .limit(limit)
    .all()
    .flatMap((row) => (row.supplierId === null ? [] : [row.supplierId]));
  const rank = new Map(recentIds.map((id, index) => [id, index]));
  return [...all]
    .sort((left, right) => {
      const leftRank = rank.get(left.id);
      const rightRank = rank.get(right.id);
      if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
      if (leftRank !== undefined) return -1;
      if (rightRank !== undefined) return 1;
      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

export function getSupplier(db: Db, supplierId: number): Supplier {
  const row = db.select().from(suppliers).where(eq(suppliers.id, supplierId)).get();
  if (row === undefined) {
    throw new SupplierNotFoundError(supplierId);
  }
  return row;
}

/** Case-insensitive lookup by typed name (autocomplete + inline \"add new\"). */
export function findSupplierByName(db: Db, name: string): Supplier | null {
  const normalized = normalizeSupplierName(name);
  if (normalized === '') return null;
  const row = db.select().from(suppliers).where(eq(suppliers.normalizedName, normalized)).get();
  return row ?? null;
}

export interface SupplierContactInput {
  contactPhone?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface CreateSupplierInput extends SupplierContactInput {
  name: string;
  actor: string;
  now?: Date;
}

export function createSupplier(db: Db, input: CreateSupplierInput): Supplier {
  const now = input.now ?? new Date();
  const name = checkedName(input.name);
  const contact = checkedContact(input);
  return db.transaction((tx) =>
    createSupplierRecord(tx, { name, ...contact, actor: input.actor, now }),
  );
}

export interface SupplierRecordInput {
  name: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  address?: string | null;
  notes?: string | null;
  actor: string;
  now: Date;
}

/**
 * Insert a supplier inside an existing transaction (used by createSupplier
 * and by purchase entry's inline \"add new\" supplier path — one code path).
 * The name must already be validated; the uniqueness clash is checked here.
 */
export function createSupplierRecord(tx: DbTx, input: SupplierRecordInput): Supplier {
  const clash = tx
    .select()
    .from(suppliers)
    .where(eq(suppliers.normalizedName, normalizeSupplierName(input.name)))
    .get();
  if (clash !== undefined) {
    throw new DuplicateSupplierError(clash.name);
  }
  let inserted: Supplier | undefined;
  try {
    inserted = tx
      .insert(suppliers)
      .values({
        name: input.name,
        normalizedName: normalizeSupplierName(input.name),
        contactPhone: input.contactPhone ?? null,
        contactEmail: input.contactEmail ?? null,
        website: input.website ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning()
      .get();
  } catch (err) {
    throw mapUniqueViolation(err, input.name);
  }
  if (inserted === undefined) {
    throw new Error('insert supplier returned no row');
  }
  recordAudit(tx, {
    actor: input.actor,
    action: 'supplier.create',
    entity: 'supplier',
    entityId: inserted.id,
    summary: `Added supplier “${inserted.name}”`,
    after: inserted,
    now: input.now,
  });
  return inserted;
}

export interface RenameSupplierInput {
  id: number;
  expectedVersion: number;
  name: string;
  actor: string;
  now?: Date;
}

export function renameSupplier(db: Db, input: RenameSupplierInput): Supplier {
  const now = input.now ?? new Date();
  const name = checkedName(input.name);
  return db.transaction((tx) => {
    const current = tx.select().from(suppliers).where(eq(suppliers.id, input.id)).get();
    if (current === undefined) {
      throw new SupplierNotFoundError(input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('supplier', input.id, input.expectedVersion, current.version);
    }
    const normalized = normalizeSupplierName(name);
    if (normalized !== current.normalizedName) {
      const clash = tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.normalizedName, normalized))
        .get();
      if (clash !== undefined) {
        throw new DuplicateSupplierError(clash.name);
      }
    }
    let updated: Supplier | undefined;
    try {
      updated = tx
        .update(suppliers)
        .set({ name, normalizedName: normalized, updatedAt: now, version: current.version + 1 })
        .where(eq(suppliers.id, input.id))
        .returning()
        .get();
    } catch (err) {
      throw mapUniqueViolation(err, name);
    }
    if (updated === undefined) {
      throw new Error('update supplier returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'supplier.rename',
      entity: 'supplier',
      entityId: input.id,
      summary: `Renamed supplier “${current.name}” to “${name}”`,
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export interface UpdateSupplierContactInput extends SupplierContactInput {
  id: number;
  expectedVersion: number;
  actor: string;
  now?: Date;
}

/**
 * Edit the contact card (SPEC §21.1). Omitted fields are left unchanged;
 * explicit null clears a field.
 */
export function updateSupplierContact(db: Db, input: UpdateSupplierContactInput): Supplier {
  const now = input.now ?? new Date();
  const contact = checkedContactUpdate(input);
  return db.transaction((tx) => {
    const current = tx.select().from(suppliers).where(eq(suppliers.id, input.id)).get();
    if (current === undefined) {
      throw new SupplierNotFoundError(input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('supplier', input.id, input.expectedVersion, current.version);
    }
    const updated = tx
      .update(suppliers)
      .set({ ...contact, updatedAt: now, version: current.version + 1 })
      .where(eq(suppliers.id, input.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update supplier returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'supplier.contact',
      entity: 'supplier',
      entityId: input.id,
      summary: `Updated the contact card for supplier “${current.name}”`,
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export interface SupplierCategoryMemory {
  categoryId: number;
  /** How many non-void purchases from this supplier used the category. */
  purchaseCount: number;
}

/**
 * The supplier's most-used category across its non-void purchases — the
 * preselected (always visible, always changeable) chip (SPEC §9.2). Derived
 * live; ties break towards the most recently used category, then the lowest
 * category id so the answer is stable, never arbitrary per query.
 */
export function mostUsedCategoryForSupplier(
  db: Db,
  supplierId: number,
): SupplierCategoryMemory | null {
  const rows = db
    .select({
      categoryId: allocations.categoryId,
      purchaseCount: sql<number>`count(distinct ${allocations.purchaseId})`,
      lastUsed: sql<number>`max(${purchases.occurredAt})`,
    })
    .from(allocations)
    .innerJoin(purchases, eq(purchases.id, allocations.purchaseId))
    .where(and(eq(purchases.supplierId, supplierId), isNull(purchases.voidedAt)))
    .groupBy(allocations.categoryId)
    .orderBy(
      desc(sql`count(distinct ${allocations.purchaseId})`),
      desc(sql`max(${purchases.occurredAt})`),
      asc(allocations.categoryId),
    )
    .limit(1)
    .all();
  const top = rows[0];
  if (top === undefined) return null;
  return { categoryId: top.categoryId, purchaseCount: Number(top.purchaseCount) };
}

/**
 * Clean a typed supplier name for a money record: blank means \"unknown\"
 * supplier (null); anything else must be a valid name.
 */
export function cleanSupplierName(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return null;
  return checkedName(trimmed);
}

function checkedName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name === '') {
    throw new InvalidSupplierNameError('Give the supplier a name.');
  }
  if (name.length > MAX_SUPPLIER_NAME_LENGTH) {
    throw new InvalidSupplierNameError(
      `Keep the supplier name to ${MAX_SUPPLIER_NAME_LENGTH} characters or fewer.`,
    );
  }
  return name;
}

type ContactFields = Pick<
  Supplier,
  'contactPhone' | 'contactEmail' | 'website' | 'address' | 'notes'
>;

function checkedContact(input: SupplierContactInput): ContactFields {
  return {
    contactPhone: checkedContactField(
      'Phone number',
      input.contactPhone,
      MAX_SUPPLIER_CONTACT_LENGTH,
    ),
    contactEmail: checkedContactField('Email', input.contactEmail, MAX_SUPPLIER_CONTACT_LENGTH),
    website: checkedContactField('Website', input.website, MAX_SUPPLIER_CONTACT_LENGTH),
    address: checkedContactField('Address', input.address, MAX_SUPPLIER_CONTACT_LENGTH),
    notes: checkedContactField('Notes', input.notes, MAX_SUPPLIER_NOTES_LENGTH),
  };
}

function checkedContactUpdate(input: SupplierContactInput): Partial<ContactFields> {
  const patch: Partial<ContactFields> = {};
  if (input.contactPhone !== undefined) {
    patch.contactPhone = checkedContactField(
      'Phone number',
      input.contactPhone,
      MAX_SUPPLIER_CONTACT_LENGTH,
    );
  }
  if (input.contactEmail !== undefined) {
    patch.contactEmail = checkedContactField(
      'Email',
      input.contactEmail,
      MAX_SUPPLIER_CONTACT_LENGTH,
    );
  }
  if (input.website !== undefined) {
    patch.website = checkedContactField('Website', input.website, MAX_SUPPLIER_CONTACT_LENGTH);
  }
  if (input.address !== undefined) {
    patch.address = checkedContactField('Address', input.address, MAX_SUPPLIER_CONTACT_LENGTH);
  }
  if (input.notes !== undefined) {
    patch.notes = checkedContactField('Notes', input.notes, MAX_SUPPLIER_NOTES_LENGTH);
  }
  return patch;
}

function checkedContactField(
  label: string,
  raw: string | null | undefined,
  maxLength: number,
): string | null {
  if (raw === undefined || raw === null) return null;
  const value = raw.trim();
  if (value === '') return null;
  if (value.length > maxLength) {
    throw new InvalidSupplierContactError(
      `Keep the supplier ${label.toLowerCase()} to ${maxLength} characters or fewer.`,
    );
  }
  return value;
}

/** Map a SQLite UNIQUE violation on normalized_name to the domain error. */
function mapUniqueViolation(err: unknown, name: string): unknown {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  ) {
    return new DuplicateSupplierError(name);
  }
  return err;
}
