import { and, asc, desc, eq, gte, inArray, isNull, isNotNull, lte, ne } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import {
  allocations,
  categories,
  people,
  pots,
  purchases,
  suppliers,
  vehicles,
} from '../db/schema';
import { formatPence } from '../money';
import { isValidLocalDate } from '../time';
import { CategoryLevelError, CategoryNotFoundError, CategoryRetiredError } from './categories';
import { AlreadyVoidError, RecordVoidedError, VersionConflictError } from './errors';
import { resolveOccurred } from './occurred';
import { PersonNotFoundError } from './people';
import { PotNotFoundError } from './pots';
import { assertSplitBalanced } from './splits';
import {
  cleanSupplierName,
  createSupplierRecord,
  normalizeSupplierName,
  SupplierNotFoundError,
  type Supplier,
} from './suppliers';
import { VehicleNotFoundError } from './vehicles';

/**
 * Purchases, splits and refunds (SPEC §9): one payment with one or more
 * allocation lines that must total it exactly, refunds as linked negative
 * records, corrections by edit or void with retained history.
 *
 * Three concepts are never conflated (SPEC §9.1): entered_by (who typed it,
 * audit only), paid_by (whose card or cash), for_whom (the target on each
 * allocation line: household, a person, or a vehicle).
 */

export type TargetKind = 'household' | 'person' | 'vehicle';
export type Purchase = typeof purchases.$inferSelect;
export type Allocation = typeof allocations.$inferSelect;

export interface PurchaseWithLines {
  purchase: Purchase;
  allocations: Allocation[];
}

export class PurchaseNotFoundError extends Error {
  constructor(purchaseId: number) {
    super(`No purchase with id ${purchaseId}`);
    this.name = 'PurchaseNotFoundError';
  }
}

export class InvalidPurchaseInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPurchaseInputError';
  }
}

export class RefundLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundLinkError';
  }
}

/**
 * Voiding a purchase that still has active linked refunds — void the refunds
 * first, explicitly. No silent cascades.
 */
export class VoidBlockedError extends Error {
  readonly entityId: number;
  readonly blockingRefundIds: number[];

  constructor(entityId: number, blockingRefundIds: number[]) {
    const refs = blockingRefundIds.map((id) => `#${id}`).join(', ');
    super(
      `Void the linked refund ${blockingRefundIds.length === 1 ? 'record' : 'records'} ${refs} first — ` +
        `a purchase with money refunded against it cannot be voided while the refunds stand.`,
    );
    this.name = 'VoidBlockedError';
    this.entityId = entityId;
    this.blockingRefundIds = blockingRefundIds;
  }
}

export const MAX_PURCHASE_NOTE_LENGTH = 280;
export const MAX_VOID_REASON_LENGTH = 280;
/** Duplicate-notice matching window (SPEC §9.6, plan OQ3 default: ~2 hours). */
export const DUPLICATE_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface AllocationLineInput {
  amountPence: number;
  categoryId: number;
  targetKind: TargetKind;
  targetId?: number | null;
}

export interface CreatePurchaseInput {
  supplierId?: number | null;
  /** Inline \"add new\": matched case-insensitively, created when unknown. Blank means unknown. */
  supplierName?: string | null;
  potId: number;
  totalPence: number;
  /** Null when nobody in particular paid (e.g. a future schedule conversion); till entry always sets it. */
  paidByPersonId?: number | null;
  occurredAt?: Date;
  occurredDate?: string;
  note?: string | null;
  lines: AllocationLineInput[];
  refundOfPurchaseId?: number | null;
  /**
   * Phase 3: set when this purchase is the converted form of a schedule
   * instance (SPEC §11.2 "from schedule" tag). null for manual entry.
   */
  scheduleInstanceId?: number | null;
  actor: string;
  now?: Date;
}

export interface DuplicateNotice {
  purchaseId: number;
  enteredBy: string;
  totalPence: number;
  recordedAt: Date;
  minutesAgo: number;
}

export interface CreatePurchaseResult extends PurchaseWithLines {
  /** Non-blocking duplicate hint (SPEC §9.6) — the save already succeeded. */
  duplicateNotice: DuplicateNotice | null;
}

export function createPurchase(db: Db, input: CreatePurchaseInput): CreatePurchaseResult {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const isRefund = input.refundOfPurchaseId !== undefined && input.refundOfPurchaseId !== null;
  assertCorrectSign(input.totalPence, isRefund);
  assertSplitBalanced(
    input.totalPence,
    input.lines.map((line) => line.amountPence),
  );
  const note = checkedNote(input.note);
  const occurred = resolveOccurred({
    occurredAt: input.occurredAt,
    occurredDate: input.occurredDate,
    now,
  });

  return db.transaction((tx) => {
    assertPotExists(tx, input.potId);
    if (input.paidByPersonId !== undefined && input.paidByPersonId !== null) {
      assertPersonExists(tx, input.paidByPersonId);
    }
    const supplier = resolveSupplierForCreate(tx, input, actor, now);
    assertLinesReferenceLiveLeaves(tx, input.lines);
    if (isRefund) {
      assertRefundLink(tx, {
        refundOfPurchaseId: input.refundOfPurchaseId as number,
        totalPence: input.totalPence,
        lines: input.lines,
        selfId: null,
      });
    }

    const inserted = tx
      .insert(purchases)
      .values({
        supplierId: supplier?.id ?? null,
        potId: input.potId,
        totalPence: input.totalPence,
        occurredAt: occurred.occurredAt,
        occurredDate: occurred.occurredDate,
        paidByPersonId: input.paidByPersonId ?? null,
        enteredBy: actor,
        note,
        refundOfPurchaseId: input.refundOfPurchaseId ?? null,
        scheduleInstanceId: input.scheduleInstanceId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (inserted === undefined) {
      throw new Error('insert purchase returned no row');
    }
    const insertedLines: Allocation[] = input.lines.map((line) => {
      const row = tx
        .insert(allocations)
        .values({
          purchaseId: inserted.id,
          amountPence: line.amountPence,
          categoryId: line.categoryId,
          targetKind: line.targetKind,
          targetId: line.targetId ?? null,
        })
        .returning()
        .get();
      if (row === undefined) {
        throw new Error('insert allocation returned no row');
      }
      return row;
    });

    const duplicate = findPossibleDuplicates(tx, {
      potId: inserted.potId,
      supplierId: inserted.supplierId,
      categoryIds: insertedLines.map((line) => line.categoryId),
      totalPence: inserted.totalPence,
      excludePurchaseId: inserted.id,
      now,
    })[0];

    recordAudit(tx, {
      actor,
      action: 'purchase.create',
      entity: 'purchase',
      entityId: inserted.id,
      summary: creationSummary(inserted, supplier, insertedLines.length),
      after: { purchase: inserted, lines: insertedLines },
      now,
    });

    return {
      purchase: inserted,
      allocations: insertedLines,
      duplicateNotice:
        duplicate === undefined
          ? null
          : {
              purchaseId: duplicate.purchase.id,
              enteredBy: duplicate.purchase.enteredBy,
              totalPence: duplicate.purchase.totalPence,
              recordedAt: duplicate.purchase.createdAt,
              minutesAgo: Math.max(
                0,
                Math.floor((now.getTime() - duplicate.purchase.createdAt.getTime()) / 60_000),
              ),
            },
    };
  });
}

export interface CreateRefundInput {
  refundOfPurchaseId: number;
  totalPence: number;
  lines: AllocationLineInput[];
  /** Defaults to the original purchase's pot/supplier/payer unless overridden. */
  potId?: number;
  supplierId?: number | null;
  supplierName?: string | null;
  paidByPersonId?: number | null;
  occurredAt?: Date;
  occurredDate?: string;
  note?: string | null;
  actor: string;
  now?: Date;
}

/**
 * Record money back (SPEC §9.5): a negative record in the same
 * category/target as the original, optionally partial. Re-validated inside
 * the creation transaction, so a concurrently voided original still fails.
 */
export function createRefund(db: Db, input: CreateRefundInput): CreatePurchaseResult {
  const original = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, input.refundOfPurchaseId))
    .get();
  if (original === undefined) {
    throw new PurchaseNotFoundError(input.refundOfPurchaseId);
  }
  const supplierExplicit = input.supplierId !== undefined || input.supplierName !== undefined;
  return createPurchase(db, {
    supplierId: supplierExplicit ? input.supplierId : original.supplierId,
    supplierName: supplierExplicit ? input.supplierName : undefined,
    potId: input.potId ?? original.potId,
    totalPence: input.totalPence,
    paidByPersonId:
      input.paidByPersonId === undefined ? original.paidByPersonId : input.paidByPersonId,
    occurredAt: input.occurredAt,
    occurredDate: input.occurredDate,
    note: input.note,
    lines: input.lines,
    refundOfPurchaseId: input.refundOfPurchaseId,
    actor: input.actor,
    now: input.now,
  });
}

export interface EditPurchasePatch {
  supplierId?: number | null;
  supplierName?: string | null;
  potId?: number;
  totalPence?: number;
  /** undefined = unchanged; null = clear the payer. */
  paidByPersonId?: number | null;
  occurredAt?: Date;
  occurredDate?: string;
  /** undefined = unchanged; null = clear the note. */
  note?: string | null;
  /** Full replacement of the allocation lines when provided. */
  lines?: AllocationLineInput[];
}

export interface EditPurchaseInput {
  id: number;
  expectedVersion: number;
  actor: string;
  now?: Date;
  patch: EditPurchasePatch;
}

/**
 * Correct a purchase (SPEC §9.5): a mistake is fixed by an audit-logged edit,
 * never by silent deletion. The refund link is immutable — a record never
 * changes sides between purchase and refund.
 */
export function editPurchase(db: Db, input: EditPurchaseInput): PurchaseWithLines {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const patch = input.patch;

  return db.transaction((tx) => {
    const current = tx.select().from(purchases).where(eq(purchases.id, input.id)).get();
    if (current === undefined) {
      throw new PurchaseNotFoundError(input.id);
    }
    if (current.voidedAt !== null) {
      throw new RecordVoidedError('purchase', input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('purchase', input.id, input.expectedVersion, current.version);
    }
    const currentLines = tx
      .select()
      .from(allocations)
      .where(eq(allocations.purchaseId, current.id))
      .orderBy(asc(allocations.id))
      .all();

    const isRefund = current.refundOfPurchaseId !== null;
    const effectiveTotal = patch.totalPence ?? current.totalPence;
    const effectiveLines: AllocationLineInput[] =
      patch.lines ??
      currentLines.map((line) => ({
        amountPence: line.amountPence,
        categoryId: line.categoryId,
        targetKind: line.targetKind,
        targetId: line.targetId,
      }));
    assertCorrectSign(effectiveTotal, isRefund);
    assertSplitBalanced(
      effectiveTotal,
      effectiveLines.map((line) => line.amountPence),
    );
    if (patch.lines !== undefined) {
      // Unchanged lines are not re-validated against the category tree: a
      // category retired after the purchase must not block fixing a typo.
      assertLinesReferenceLiveLeaves(tx, effectiveLines);
    }

    const effectivePotId = patch.potId ?? current.potId;
    assertPotExists(tx, effectivePotId);
    const effectivePaidBy =
      patch.paidByPersonId === undefined ? current.paidByPersonId : patch.paidByPersonId;
    if (effectivePaidBy !== null) {
      assertPersonExists(tx, effectivePaidBy);
    }
    const supplierId = resolveSupplierForEdit(tx, current, patch, actor, now);
    const occurred =
      patch.occurredAt !== undefined || patch.occurredDate !== undefined
        ? resolveOccurred({ occurredAt: patch.occurredAt, occurredDate: patch.occurredDate, now })
        : { occurredAt: current.occurredAt, occurredDate: current.occurredDate };
    const note = patch.note === undefined ? current.note : checkedNote(patch.note);

    if (isRefund) {
      assertRefundLink(tx, {
        refundOfPurchaseId: current.refundOfPurchaseId as number,
        totalPence: effectiveTotal,
        lines: effectiveLines,
        selfId: current.id,
      });
    } else {
      assertOriginalEditKeepsRefundsWhole(tx, {
        originalId: current.id,
        effectiveTotal,
        effectiveLines,
      });
    }

    const updated = tx
      .update(purchases)
      .set({
        supplierId,
        potId: effectivePotId,
        totalPence: effectiveTotal,
        occurredAt: occurred.occurredAt,
        occurredDate: occurred.occurredDate,
        paidByPersonId: effectivePaidBy,
        note,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(purchases.id, current.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update purchase returned no row');
    }

    let finalLines = currentLines;
    if (patch.lines !== undefined) {
      tx.delete(allocations).where(eq(allocations.purchaseId, current.id)).run();
      finalLines = patch.lines.map((line) => {
        const row = tx
          .insert(allocations)
          .values({
            purchaseId: current.id,
            amountPence: line.amountPence,
            categoryId: line.categoryId,
            targetKind: line.targetKind,
            targetId: line.targetId ?? null,
          })
          .returning()
          .get();
        if (row === undefined) {
          throw new Error('insert allocation returned no row');
        }
        return row;
      });
    }

    recordAudit(tx, {
      actor,
      action: 'purchase.edit',
      entity: 'purchase',
      entityId: current.id,
      summary: `Edited purchase #${current.id} (${formatPence(Math.abs(effectiveTotal))})`,
      before: { purchase: current, lines: currentLines },
      after: { purchase: updated, lines: finalLines },
      now,
    });
    return { purchase: updated, allocations: finalLines };
  });
}

export interface VoidPurchaseInput {
  id: number;
  expectedVersion: number;
  actor: string;
  reason?: string | null;
  now?: Date;
}

/**
 * Void a purchase: retained, marked void, excluded from totals (SPEC §9.5).
 * Duplicates are resolved by voiding one copy (SPEC §9.6, scenario E7).
 */
export function voidPurchase(db: Db, input: VoidPurchaseInput): Purchase {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const reason = checkedVoidReason(input.reason);
  return db.transaction((tx) => {
    const current = tx.select().from(purchases).where(eq(purchases.id, input.id)).get();
    if (current === undefined) {
      throw new PurchaseNotFoundError(input.id);
    }
    if (current.voidedAt !== null) {
      throw new AlreadyVoidError('purchase', input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('purchase', input.id, input.expectedVersion, current.version);
    }
    const linkedRefunds = tx
      .select()
      .from(purchases)
      .where(and(eq(purchases.refundOfPurchaseId, current.id), isNull(purchases.voidedAt)))
      .all();
    if (linkedRefunds.length > 0) {
      throw new VoidBlockedError(
        current.id,
        linkedRefunds.map((refund) => refund.id),
      );
    }
    const updated = tx
      .update(purchases)
      .set({
        voidedAt: now,
        voidedBy: actor,
        voidReason: reason,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(purchases.id, current.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update purchase returned no row');
    }
    const lines = tx
      .select()
      .from(allocations)
      .where(eq(allocations.purchaseId, current.id))
      .orderBy(asc(allocations.id))
      .all();
    recordAudit(tx, {
      actor,
      action: 'purchase.void',
      entity: 'purchase',
      entityId: current.id,
      summary:
        `Voided purchase #${current.id} (${formatPence(Math.abs(current.totalPence))})` +
        (reason === null ? '' : ` — ${reason}`),
      before: { purchase: current, lines },
      after: updated,
      now,
    });
    return updated;
  });
}

export function getPurchaseWithLines(db: Db | DbTx, purchaseId: number): PurchaseWithLines {
  const purchase = db.select().from(purchases).where(eq(purchases.id, purchaseId)).get();
  if (purchase === undefined) {
    throw new PurchaseNotFoundError(purchaseId);
  }
  const lines = db
    .select()
    .from(allocations)
    .where(eq(allocations.purchaseId, purchase.id))
    .orderBy(asc(allocations.id))
    .all();
  return { purchase, allocations: lines };
}

export interface PurchaseFilters {
  potId?: number;
  supplierId?: number;
  categoryId?: number;
  targetKind?: TargetKind;
  targetId?: number;
  paidByPersonId?: number;
  /** Inclusive local-date bounds ('YYYY-MM-DD'). */
  dateFrom?: string;
  dateTo?: string;
  includeVoided?: boolean;
  /** Tag filters (SPEC §15.2 Purchases page): converted schedule records, refunds, voided history. */
  scheduleOnly?: boolean;
  refundsOnly?: boolean;
  voidedOnly?: boolean;
  /** Default 200, capped at 1000 — household scale, no keyset games. */
  limit?: number;
}

/**
 * Purchase history with the review-table filters (SPEC §15.2 Purchases
 * page, Phase 4a): date range, pot, supplier, category, target, paid-by
 * person and the "from schedule" / refund / voided tags. Voided records are
 * excluded unless explicitly requested (or the voided tag is active).
 * Line-level filters (category/target) match purchases; a matched purchase
 * returns with all of its lines, receipt-style.
 */
export function listPurchases(db: Db | DbTx, filters: PurchaseFilters = {}): PurchaseWithLines[] {
  if (filters.dateFrom !== undefined && !isValidLocalDate(filters.dateFrom)) {
    throw new InvalidPurchaseInputError(`Invalid dateFrom filter: ${filters.dateFrom}`);
  }
  if (filters.dateTo !== undefined && !isValidLocalDate(filters.dateTo)) {
    throw new InvalidPurchaseInputError(`Invalid dateTo filter: ${filters.dateTo}`);
  }

  let purchaseIds: number[] | null = null;
  if (
    filters.categoryId !== undefined ||
    filters.targetKind !== undefined ||
    filters.targetId !== undefined
  ) {
    const lineConditions = [];
    if (filters.categoryId !== undefined) {
      lineConditions.push(eq(allocations.categoryId, filters.categoryId));
    }
    if (filters.targetKind !== undefined) {
      lineConditions.push(eq(allocations.targetKind, filters.targetKind));
    }
    if (filters.targetId !== undefined) {
      lineConditions.push(eq(allocations.targetId, filters.targetId));
    }
    const hits = db
      .select({ purchaseId: allocations.purchaseId })
      .from(allocations)
      .where(and(...lineConditions))
      .all();
    purchaseIds = [...new Set(hits.map((hit) => hit.purchaseId))];
    if (purchaseIds.length === 0) return [];
  }

  const conditions = [];
  if (purchaseIds !== null) {
    conditions.push(inArray(purchases.id, purchaseIds));
  }
  if (filters.potId !== undefined) {
    conditions.push(eq(purchases.potId, filters.potId));
  }
  if (filters.supplierId !== undefined) {
    conditions.push(eq(purchases.supplierId, filters.supplierId));
  }
  if (filters.paidByPersonId !== undefined) {
    conditions.push(eq(purchases.paidByPersonId, filters.paidByPersonId));
  }
  if (filters.scheduleOnly === true) {
    conditions.push(isNotNull(purchases.scheduleInstanceId));
  }
  if (filters.refundsOnly === true) {
    conditions.push(isNotNull(purchases.refundOfPurchaseId));
  }
  if (filters.dateFrom !== undefined) {
    conditions.push(gte(purchases.occurredDate, filters.dateFrom));
  }
  if (filters.dateTo !== undefined) {
    conditions.push(lte(purchases.occurredDate, filters.dateTo));
  }
  if (filters.voidedOnly === true) {
    conditions.push(isNotNull(purchases.voidedAt));
  } else if (filters.includeVoided !== true) {
    conditions.push(isNull(purchases.voidedAt));
  }
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);

  const base = db
    .select()
    .from(purchases)
    .orderBy(desc(purchases.occurredAt), desc(purchases.id))
    .limit(limit);
  const rows = (conditions.length === 0 ? base : base.where(and(...conditions))).all();
  if (rows.length === 0) return [];
  const lines = db
    .select()
    .from(allocations)
    .where(
      inArray(
        allocations.purchaseId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(allocations.id))
    .all();
  const byPurchase = new Map<number, Allocation[]>();
  for (const line of lines) {
    const list = byPurchase.get(line.purchaseId) ?? [];
    list.push(line);
    byPurchase.set(line.purchaseId, list);
  }
  return rows.map((purchase) => ({
    purchase,
    allocations: byPurchase.get(purchase.id) ?? [],
  }));
}

export interface DuplicateSearchInput {
  potId: number;
  supplierId: number | null;
  categoryIds: readonly number[];
  totalPence: number;
  excludePurchaseId?: number | null;
  windowMs?: number;
  now?: Date;
}

export type DuplicateCandidate = PurchaseWithLines;

/**
 * Light-touch duplicate-entry protection (SPEC §9.6, plan OQ3): the same
 * pot, supplier (or category when the supplier is unknown) and amount saved
 * within the window. Non-blocking by design — two identical coffees are
 * legal; the notice just makes the common accident visible immediately.
 */
export function findPossibleDuplicates(
  db: Db | DbTx,
  search: DuplicateSearchInput,
): DuplicateCandidate[] {
  const now = search.now ?? new Date();
  const windowMs = search.windowMs ?? DUPLICATE_WINDOW_MS;
  const cutoff = new Date(now.getTime() - windowMs);
  const conditions = [
    eq(purchases.potId, search.potId),
    eq(purchases.totalPence, search.totalPence),
    gte(purchases.createdAt, cutoff),
    lte(purchases.createdAt, now),
    isNull(purchases.voidedAt),
  ];
  if (search.excludePurchaseId !== undefined && search.excludePurchaseId !== null) {
    conditions.push(ne(purchases.id, search.excludePurchaseId));
  }
  const candidates = db
    .select()
    .from(purchases)
    .where(and(...conditions))
    .orderBy(desc(purchases.createdAt))
    .limit(10)
    .all();
  if (candidates.length === 0) return [];
  const lines = db
    .select()
    .from(allocations)
    .where(
      inArray(
        allocations.purchaseId,
        candidates.map((candidate) => candidate.id),
      ),
    )
    .all();
  const byPurchase = new Map<number, Allocation[]>();
  for (const line of lines) {
    const list = byPurchase.get(line.purchaseId) ?? [];
    list.push(line);
    byPurchase.set(line.purchaseId, list);
  }
  const wantedCategories = new Set(search.categoryIds);
  return candidates
    .filter((candidate) => {
      if (
        search.supplierId !== null &&
        candidate.supplierId !== null &&
        candidate.supplierId === search.supplierId
      ) {
        return true;
      }
      return (byPurchase.get(candidate.id) ?? []).some((line) =>
        wantedCategories.has(line.categoryId),
      );
    })
    .map((candidate) => ({
      purchase: candidate,
      allocations: byPurchase.get(candidate.id) ?? [],
    }));
}

function assertCorrectSign(totalPence: number, isRefund: boolean): void {
  if (isRefund && totalPence >= 0) {
    throw new InvalidPurchaseInputError('A refund total is negative — money coming back.');
  }
  if (!isRefund && totalPence <= 0) {
    throw new InvalidPurchaseInputError('A purchase total is positive — money going out.');
  }
}

/**
 * Every line lands on a live leaf category with a coherent target
 * (SPEC §9.3, §12): household lines carry no target id; person/vehicle lines
 * name an existing person/vehicle.
 */
function assertLinesReferenceLiveLeaves(db: Db | DbTx, lines: AllocationLineInput[]): void {
  lines.forEach((line, index) => {
    const label = `Line ${index + 1}`;
    const kind: string = line.targetKind;
    if (kind !== 'household' && kind !== 'person' && kind !== 'vehicle') {
      throw new InvalidPurchaseInputError(`${label}: unknown target “${kind}”.`);
    }
    const category = db.select().from(categories).where(eq(categories.id, line.categoryId)).get();
    if (category === undefined) {
      throw new CategoryNotFoundError(line.categoryId);
    }
    if (category.parentId === null) {
      throw new CategoryLevelError(
        `${label}: allocations always land on a child category — “${category.name}” is a parent. Drill down one level.`,
      );
    }
    if (category.retiredAt !== null) {
      throw new CategoryRetiredError(category.name);
    }
    if (line.targetKind === 'household') {
      if (line.targetId !== undefined && line.targetId !== null) {
        throw new InvalidPurchaseInputError(
          `${label}: a household line carries no person or vehicle target.`,
        );
      }
    } else if (line.targetKind === 'person') {
      if (line.targetId === undefined || line.targetId === null) {
        throw new InvalidPurchaseInputError(`${label}: choose which person this line is for.`);
      }
      assertPersonExists(db, line.targetId);
    } else {
      if (line.targetId === undefined || line.targetId === null) {
        throw new InvalidPurchaseInputError(`${label}: choose which vehicle this line is for.`);
      }
      const vehicle = db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(eq(vehicles.id, line.targetId))
        .get();
      if (vehicle === undefined) {
        throw new VehicleNotFoundError(line.targetId);
      }
    }
  });
}

interface RefundLinkCheck {
  refundOfPurchaseId: number;
  totalPence: number;
  lines: AllocationLineInput[];
  /** The refund being edited (excluded from the cumulative cap), if any. */
  selfId: number | null;
}

/**
 * Refund discipline (SPEC §9.5): the original exists, is not voided and is
 * not itself a refund; every refund line matches an original line's
 * category/target; cumulative refunds can never exceed the original total.
 */
function assertRefundLink(db: Db | DbTx, check: RefundLinkCheck): Purchase {
  const original = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, check.refundOfPurchaseId))
    .get();
  if (original === undefined) {
    throw new RefundLinkError(
      `The purchase being refunded (#${check.refundOfPurchaseId}) does not exist.`,
    );
  }
  if (original.voidedAt !== null) {
    throw new RefundLinkError(
      `Purchase #${original.id} is voided — there is nothing left to refund.`,
    );
  }
  if (original.refundOfPurchaseId !== null) {
    throw new RefundLinkError(
      `Purchase #${original.id} is itself a refund — money owed back on a refund is just a purchase.`,
    );
  }
  const originalLines = db
    .select()
    .from(allocations)
    .where(eq(allocations.purchaseId, original.id))
    .all();
  const originalCombos = new Set(
    originalLines.map((line) => lineCombo(line.categoryId, line.targetKind, line.targetId)),
  );
  check.lines.forEach((line, index) => {
    if (!originalCombos.has(lineCombo(line.categoryId, line.targetKind, line.targetId ?? null))) {
      throw new RefundLinkError(
        `Line ${index + 1}: a refund uses the same category and target as the purchase it refunds.`,
      );
    }
  });
  const siblings = db
    .select()
    .from(purchases)
    .where(and(eq(purchases.refundOfPurchaseId, original.id), isNull(purchases.voidedAt)))
    .all()
    .filter((sibling) => sibling.id !== check.selfId);
  const alreadyRefunded = siblings.reduce((sum, sibling) => sum + Math.abs(sibling.totalPence), 0);
  const remaining = original.totalPence - alreadyRefunded;
  if (Math.abs(check.totalPence) > remaining) {
    throw new RefundLinkError(
      alreadyRefunded === 0
        ? `That refund of ${formatPence(Math.abs(check.totalPence))} is more than the ${formatPence(original.totalPence)} purchase it refunds.`
        : `${formatPence(alreadyRefunded)} of purchase #${original.id} is already refunded — only ${formatPence(remaining)} is left to refund.`,
    );
  }
  return original;
}

interface OriginalEditCheck {
  originalId: number;
  effectiveTotal: number;
  effectiveLines: AllocationLineInput[];
}

/**
 * Editing an original must keep every linked refund whole: the total stays
 * at or above the refunded amount, and no (category, target) a refund points
 * at may disappear. Otherwise the refunds are voided first, explicitly.
 */
function assertOriginalEditKeepsRefundsWhole(db: Db | DbTx, check: OriginalEditCheck): void {
  const linked = db
    .select()
    .from(purchases)
    .where(and(eq(purchases.refundOfPurchaseId, check.originalId), isNull(purchases.voidedAt)))
    .all();
  if (linked.length === 0) return;
  const refunded = linked.reduce((sum, refund) => sum + Math.abs(refund.totalPence), 0);
  if (check.effectiveTotal < refunded) {
    throw new RefundLinkError(
      `${formatPence(refunded)} of this purchase is already refunded — void those refunds before lowering the total below ${formatPence(refunded)}.`,
    );
  }
  const combos = new Set(
    check.effectiveLines.map((line) =>
      lineCombo(line.categoryId, line.targetKind, line.targetId ?? null),
    ),
  );
  for (const refund of linked) {
    const refundLines = db
      .select()
      .from(allocations)
      .where(eq(allocations.purchaseId, refund.id))
      .all();
    for (const refundLine of refundLines) {
      if (
        !combos.has(lineCombo(refundLine.categoryId, refundLine.targetKind, refundLine.targetId))
      ) {
        throw new RefundLinkError(
          `Refund #${refund.id} points at a category/target this edit would remove — void the refund first, then edit.`,
        );
      }
    }
  }
}

function lineCombo(categoryId: number, targetKind: string, targetId: number | null): string {
  return `${categoryId}:${targetKind}:${targetId ?? ''}`;
}

function resolveSupplierForCreate(
  tx: DbTx,
  input: Pick<CreatePurchaseInput, 'supplierId' | 'supplierName'>,
  actor: string,
  now: Date,
): Supplier | null {
  const cleanName = cleanSupplierName(input.supplierName);
  if (input.supplierId !== undefined && input.supplierId !== null && cleanName !== null) {
    throw new InvalidPurchaseInputError('Give the supplier by name or by id, not both.');
  }
  if (cleanName !== null) {
    const existing = tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.normalizedName, normalizeSupplierName(cleanName)))
      .get();
    if (existing !== undefined) return existing;
    return createSupplierRecord(tx, { name: cleanName, actor, now });
  }
  if (input.supplierId !== undefined && input.supplierId !== null) {
    const row = tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).get();
    if (row === undefined) {
      throw new SupplierNotFoundError(input.supplierId);
    }
    return row;
  }
  return null;
}

function resolveSupplierForEdit(
  tx: DbTx,
  current: Purchase,
  patch: EditPurchasePatch,
  actor: string,
  now: Date,
): number | null {
  if (patch.supplierId !== undefined && patch.supplierName !== undefined) {
    throw new InvalidPurchaseInputError('Change the supplier by name or by id, not both.');
  }
  if (patch.supplierName !== undefined) {
    const cleanName = cleanSupplierName(patch.supplierName);
    if (cleanName === null) return null;
    const existing = tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.normalizedName, normalizeSupplierName(cleanName)))
      .get();
    if (existing !== undefined) return existing.id;
    return createSupplierRecord(tx, { name: cleanName, actor, now }).id;
  }
  if (patch.supplierId !== undefined) {
    if (patch.supplierId === null) return null;
    const row = tx.select().from(suppliers).where(eq(suppliers.id, patch.supplierId)).get();
    if (row === undefined) {
      throw new SupplierNotFoundError(patch.supplierId);
    }
    return row.id;
  }
  return current.supplierId;
}

function assertPotExists(db: Db | DbTx, potId: number): void {
  const row = db.select({ id: pots.id }).from(pots).where(eq(pots.id, potId)).get();
  if (row === undefined) {
    throw new PotNotFoundError(potId);
  }
}

function assertPersonExists(db: Db | DbTx, personId: number): void {
  const row = db.select({ id: people.id }).from(people).where(eq(people.id, personId)).get();
  if (row === undefined) {
    throw new PersonNotFoundError(personId);
  }
}

function checkedActor(raw: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new InvalidPurchaseInputError('Every purchase records who entered it.');
  }
  return raw.trim();
}

function checkedNote(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const note = raw.trim();
  if (note === '') return null;
  if (note.length > MAX_PURCHASE_NOTE_LENGTH) {
    throw new InvalidPurchaseInputError(
      `Keep the note to ${MAX_PURCHASE_NOTE_LENGTH} characters or fewer.`,
    );
  }
  return note;
}

function checkedVoidReason(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const reason = raw.trim();
  if (reason === '') return null;
  if (reason.length > MAX_VOID_REASON_LENGTH) {
    throw new InvalidPurchaseInputError(
      `Keep the void reason to ${MAX_VOID_REASON_LENGTH} characters or fewer.`,
    );
  }
  return reason;
}

function creationSummary(purchase: Purchase, supplier: Supplier | null, lineCount: number): string {
  const amount = formatPence(Math.abs(purchase.totalPence));
  const where = supplier === null ? 'unknown supplier' : supplier.name;
  if (purchase.refundOfPurchaseId !== null) {
    return `Recorded refund ${amount} from ${where} for purchase #${purchase.refundOfPurchaseId}`;
  }
  return `Recorded purchase ${amount} at ${where} (${lineCount} ${lineCount === 1 ? 'line' : 'lines'})`;
}
