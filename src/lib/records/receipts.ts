import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import { pots, receipts } from '../db/schema';
import { formatPence, isValidPenceAmount } from '../money';
import { isValidLocalDate } from '../time';
import { AlreadyVoidError, RecordVoidedError, VersionConflictError } from './errors';
import { resolveOccurred } from './occurred';
import { PotNotFoundError } from './pots';

/**
 * Income records (SPEC §6, §11.3). Phase 3 money-record shape decision
 * (plan OQ5): receipts live in their own table, not in purchases — income
 * carries no category or target and never counts as spending, but it shares
 * every money-record convention: integer pence, occurred_at + occurred_date
 * (same backdating rule), voided_* history and a version counter.
 *
 * A receipt is either the converted form of an expected-receipt schedule
 * instance (schedule_instance_id set, written by the conversion path in
 * schedules.ts) or a manual one-off entry (this module's createReceipt).
 */

export type Receipt = typeof receipts.$inferSelect;

export class ReceiptNotFoundError extends Error {
  constructor(receiptId: number) {
    super(`No receipt with id ${receiptId}`);
    this.name = 'ReceiptNotFoundError';
  }
}

export class InvalidReceiptInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReceiptInputError';
  }
}

export const MAX_RECEIPT_NOTE_LENGTH = 280;
export const MAX_RECEIPT_VOID_REASON_LENGTH = 280;
export const MAX_RECEIPT_SOURCE_LENGTH = 120;

export interface CreateReceiptInput {
  scheduleInstanceId?: number | null;
  potId: number;
  amountPence: number;
  occurredAt?: Date;
  occurredDate?: string;
  /** Who or what the money came from ("Sale of bicycle") — free text. */
  source?: string | null;
  note?: string | null;
  actor: string;
  now?: Date;
}

export function createReceipt(db: Db, input: CreateReceiptInput): Receipt {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  assertPositiveAmount(input.amountPence);
  const source = checkedSource(input.source);
  const note = checkedNote(input.note);
  const occurred = resolveOccurred({
    occurredAt: input.occurredAt,
    occurredDate: input.occurredDate,
    now,
  });

  return db.transaction((tx) => {
    assertPotExists(tx, input.potId);
    const inserted = tx
      .insert(receipts)
      .values({
        scheduleInstanceId: input.scheduleInstanceId ?? null,
        potId: input.potId,
        amountPence: input.amountPence,
        occurredAt: occurred.occurredAt,
        occurredDate: occurred.occurredDate,
        enteredBy: actor,
        source,
        note,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (inserted === undefined) {
      throw new Error('insert receipt returned no row');
    }
    recordAudit(tx, {
      actor,
      action: 'receipt.create',
      entity: 'receipt',
      entityId: inserted.id,
      summary:
        `Recorded income ${formatPence(inserted.amountPence)}` +
        (source === null ? '' : ` — ${source}`),
      after: inserted,
      now,
    });
    return inserted;
  });
}

export interface EditReceiptPatch {
  potId?: number;
  amountPence?: number;
  occurredAt?: Date;
  occurredDate?: string;
  /** undefined = unchanged; null = clear the source. */
  source?: string | null;
  /** undefined = unchanged; null = clear the note. */
  note?: string | null;
}

export interface EditReceiptInput {
  id: number;
  expectedVersion: number;
  actor: string;
  now?: Date;
  patch: EditReceiptPatch;
}

export function editReceipt(db: Db, input: EditReceiptInput): Receipt {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const patch = input.patch;
  return db.transaction((tx) => {
    const current = tx.select().from(receipts).where(eq(receipts.id, input.id)).get();
    if (current === undefined) {
      throw new ReceiptNotFoundError(input.id);
    }
    if (current.voidedAt !== null) {
      throw new RecordVoidedError('receipt', input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('receipt', input.id, input.expectedVersion, current.version);
    }
    const effectivePotId = patch.potId ?? current.potId;
    assertPotExists(tx, effectivePotId);
    const effectiveAmount = patch.amountPence ?? current.amountPence;
    assertPositiveAmount(effectiveAmount);
    const occurred =
      patch.occurredAt !== undefined || patch.occurredDate !== undefined
        ? resolveOccurred({ occurredAt: patch.occurredAt, occurredDate: patch.occurredDate, now })
        : { occurredAt: current.occurredAt, occurredDate: current.occurredDate };
    const note = patch.note === undefined ? current.note : checkedNote(patch.note);
    const source = patch.source === undefined ? current.source : checkedSource(patch.source);

    const updated = tx
      .update(receipts)
      .set({
        potId: effectivePotId,
        amountPence: effectiveAmount,
        occurredAt: occurred.occurredAt,
        occurredDate: occurred.occurredDate,
        source,
        note,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(receipts.id, current.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update receipt returned no row');
    }
    recordAudit(tx, {
      actor,
      action: 'receipt.edit',
      entity: 'receipt',
      entityId: current.id,
      summary:
        `Edited income #${current.id} (${formatPence(effectiveAmount)})` +
        (source === null ? '' : ` — ${source}`),
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export interface VoidReceiptInput {
  id: number;
  expectedVersion: number;
  actor: string;
  reason?: string | null;
  now?: Date;
}

export function voidReceipt(db: Db, input: VoidReceiptInput): Receipt {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const reason = checkedVoidReason(input.reason);
  return db.transaction((tx) => {
    const current = tx.select().from(receipts).where(eq(receipts.id, input.id)).get();
    if (current === undefined) {
      throw new ReceiptNotFoundError(input.id);
    }
    if (current.voidedAt !== null) {
      throw new AlreadyVoidError('receipt', input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('receipt', input.id, input.expectedVersion, current.version);
    }
    const updated = tx
      .update(receipts)
      .set({
        voidedAt: now,
        voidedBy: actor,
        voidReason: reason,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(receipts.id, current.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update receipt returned no row');
    }
    recordAudit(tx, {
      actor,
      action: 'receipt.void',
      entity: 'receipt',
      entityId: current.id,
      summary:
        `Voided income #${current.id} (${formatPence(current.amountPence)})` +
        (reason === null ? '' : ` — ${reason}`),
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export function getReceipt(db: Db | DbTx, receiptId: number): Receipt {
  const row = db.select().from(receipts).where(eq(receipts.id, receiptId)).get();
  if (row === undefined) {
    throw new ReceiptNotFoundError(receiptId);
  }
  return row;
}

export interface ReceiptFilters {
  potId?: number;
  dateFrom?: string;
  dateTo?: string;
  includeVoided?: boolean;
  limit?: number;
}

export function listReceipts(db: Db | DbTx, filters: ReceiptFilters = {}): Receipt[] {
  if (filters.dateFrom !== undefined && !isValidLocalDate(filters.dateFrom)) {
    throw new InvalidReceiptInputError(`Invalid dateFrom filter: ${filters.dateFrom}`);
  }
  if (filters.dateTo !== undefined && !isValidLocalDate(filters.dateTo)) {
    throw new InvalidReceiptInputError(`Invalid dateTo filter: ${filters.dateTo}`);
  }
  const conditions = [];
  if (filters.potId !== undefined) {
    conditions.push(eq(receipts.potId, filters.potId));
  }
  if (filters.dateFrom !== undefined) {
    conditions.push(gte(receipts.occurredDate, filters.dateFrom));
  }
  if (filters.dateTo !== undefined) {
    conditions.push(lte(receipts.occurredDate, filters.dateTo));
  }
  if (filters.includeVoided !== true) {
    conditions.push(isNull(receipts.voidedAt));
  }
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  const base = db
    .select()
    .from(receipts)
    .orderBy(desc(receipts.occurredAt), desc(receipts.id))
    .limit(limit);
  return (conditions.length === 0 ? base : base.where(and(...conditions))).all();
}

function assertPositiveAmount(amountPence: number): void {
  if (!isValidPenceAmount(amountPence) || amountPence <= 0) {
    throw new InvalidReceiptInputError('A receipt amount is a positive whole-pence figure.');
  }
}

function assertPotExists(db: Db | DbTx, potId: number): void {
  const row = db.select({ id: pots.id }).from(pots).where(eq(pots.id, potId)).get();
  if (row === undefined) {
    throw new PotNotFoundError(potId);
  }
}

function checkedActor(raw: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new InvalidReceiptInputError('Every receipt records who entered it.');
  }
  return raw.trim();
}

/**
 * The money's origin as typed by the household. Free text, never required
 * (a converted salary is already named by its schedule), trimmed, and blank
 * is stored as NULL rather than as an empty string — "no source" and
 * "a source of nothing" are the same fact.
 */
function checkedSource(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const source = raw.trim();
  if (source === '') return null;
  if (source.length > MAX_RECEIPT_SOURCE_LENGTH) {
    throw new InvalidReceiptInputError(
      `Keep the source to ${MAX_RECEIPT_SOURCE_LENGTH} characters or fewer.`,
    );
  }
  return source;
}

function checkedNote(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const note = raw.trim();
  if (note === '') return null;
  if (note.length > MAX_RECEIPT_NOTE_LENGTH) {
    throw new InvalidReceiptInputError(
      `Keep the note to ${MAX_RECEIPT_NOTE_LENGTH} characters or fewer.`,
    );
  }
  return note;
}

function checkedVoidReason(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const reason = raw.trim();
  if (reason === '') return null;
  if (reason.length > MAX_RECEIPT_VOID_REASON_LENGTH) {
    throw new InvalidReceiptInputError(
      `Keep the void reason to ${MAX_RECEIPT_VOID_REASON_LENGTH} characters or fewer.`,
    );
  }
  return reason;
}
