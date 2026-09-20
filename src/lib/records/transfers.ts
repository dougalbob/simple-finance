import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import { pots, transfers } from '../db/schema';
import { formatPence, isValidPenceAmount } from '../money';
import { isValidLocalDate } from '../time';
import { AlreadyVoidError, RecordVoidedError, VersionConflictError } from './errors';
import { resolveOccurred } from './occurred';
import { PotNotFoundError } from './pots';

/**
 * Pot-to-pot transfers (SPEC §10): a dedicated record type that moves money
 * without ever counting as spending. Moving money can never look like losing
 * or gaining money — the household total is untouched by construction.
 */

export type Transfer = typeof transfers.$inferSelect;

export class TransferNotFoundError extends Error {
  constructor(transferId: number) {
    super(`No transfer with id ${transferId}`);
    this.name = 'TransferNotFoundError';
  }
}

export class InvalidTransferInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransferInputError';
  }
}

export const MAX_TRANSFER_NOTE_LENGTH = 280;
export const MAX_TRANSFER_VOID_REASON_LENGTH = 280;

export interface CreateTransferInput {
  fromPotId: number;
  toPotId: number;
  amountPence: number;
  occurredAt?: Date;
  occurredDate?: string;
  note?: string | null;
  actor: string;
  now?: Date;
}

export function createTransfer(db: Db, input: CreateTransferInput): Transfer {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  assertPositiveAmount(input.amountPence);
  if (input.fromPotId === input.toPotId) {
    throw new InvalidTransferInputError('A transfer moves money between two different pots.');
  }
  const note = checkedNote(input.note);
  const occurred = resolveOccurred({
    occurredAt: input.occurredAt,
    occurredDate: input.occurredDate,
    now,
  });

  return db.transaction((tx) => {
    assertPotExists(tx, input.fromPotId);
    assertPotExists(tx, input.toPotId);
    const inserted = tx
      .insert(transfers)
      .values({
        fromPotId: input.fromPotId,
        toPotId: input.toPotId,
        amountPence: input.amountPence,
        occurredAt: occurred.occurredAt,
        occurredDate: occurred.occurredDate,
        enteredBy: actor,
        note,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (inserted === undefined) {
      throw new Error('insert transfer returned no row');
    }
    recordAudit(tx, {
      actor,
      action: 'transfer.create',
      entity: 'transfer',
      entityId: inserted.id,
      summary: `Moved ${formatPence(inserted.amountPence)} between pots`,
      after: inserted,
      now,
    });
    return inserted;
  });
}

export interface EditTransferPatch {
  fromPotId?: number;
  toPotId?: number;
  amountPence?: number;
  occurredAt?: Date;
  occurredDate?: string;
  /** undefined = unchanged; null = clear the note. */
  note?: string | null;
}

export interface EditTransferInput {
  id: number;
  expectedVersion: number;
  actor: string;
  now?: Date;
  patch: EditTransferPatch;
}

export function editTransfer(db: Db, input: EditTransferInput): Transfer {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const patch = input.patch;
  return db.transaction((tx) => {
    const current = tx.select().from(transfers).where(eq(transfers.id, input.id)).get();
    if (current === undefined) {
      throw new TransferNotFoundError(input.id);
    }
    if (current.voidedAt !== null) {
      throw new RecordVoidedError('transfer', input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('transfer', input.id, input.expectedVersion, current.version);
    }
    const effectiveFrom = patch.fromPotId ?? current.fromPotId;
    const effectiveTo = patch.toPotId ?? current.toPotId;
    if (effectiveFrom === effectiveTo) {
      throw new InvalidTransferInputError('A transfer moves money between two different pots.');
    }
    assertPotExists(tx, effectiveFrom);
    assertPotExists(tx, effectiveTo);
    const effectiveAmount = patch.amountPence ?? current.amountPence;
    assertPositiveAmount(effectiveAmount);
    const occurred =
      patch.occurredAt !== undefined || patch.occurredDate !== undefined
        ? resolveOccurred({ occurredAt: patch.occurredAt, occurredDate: patch.occurredDate, now })
        : { occurredAt: current.occurredAt, occurredDate: current.occurredDate };
    const note = patch.note === undefined ? current.note : checkedNote(patch.note);

    const updated = tx
      .update(transfers)
      .set({
        fromPotId: effectiveFrom,
        toPotId: effectiveTo,
        amountPence: effectiveAmount,
        occurredAt: occurred.occurredAt,
        occurredDate: occurred.occurredDate,
        note,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(transfers.id, current.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update transfer returned no row');
    }
    recordAudit(tx, {
      actor,
      action: 'transfer.edit',
      entity: 'transfer',
      entityId: current.id,
      summary: `Edited transfer #${current.id} (${formatPence(effectiveAmount)})`,
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export interface VoidTransferInput {
  id: number;
  expectedVersion: number;
  actor: string;
  reason?: string | null;
  now?: Date;
}

export function voidTransfer(db: Db, input: VoidTransferInput): Transfer {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const reason = checkedVoidReason(input.reason);
  return db.transaction((tx) => {
    const current = tx.select().from(transfers).where(eq(transfers.id, input.id)).get();
    if (current === undefined) {
      throw new TransferNotFoundError(input.id);
    }
    if (current.voidedAt !== null) {
      throw new AlreadyVoidError('transfer', input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('transfer', input.id, input.expectedVersion, current.version);
    }
    const updated = tx
      .update(transfers)
      .set({
        voidedAt: now,
        voidedBy: actor,
        voidReason: reason,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(transfers.id, current.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update transfer returned no row');
    }
    recordAudit(tx, {
      actor,
      action: 'transfer.void',
      entity: 'transfer',
      entityId: current.id,
      summary:
        `Voided transfer #${current.id} (${formatPence(current.amountPence)})` +
        (reason === null ? '' : ` — ${reason}`),
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export function getTransfer(db: Db | DbTx, transferId: number): Transfer {
  const row = db.select().from(transfers).where(eq(transfers.id, transferId)).get();
  if (row === undefined) {
    throw new TransferNotFoundError(transferId);
  }
  return row;
}

export interface TransferFilters {
  /** Either side of the transfer. */
  potId?: number;
  dateFrom?: string;
  dateTo?: string;
  includeVoided?: boolean;
  limit?: number;
}

export function listTransfers(db: Db | DbTx, filters: TransferFilters = {}): Transfer[] {
  if (filters.dateFrom !== undefined && !isValidLocalDate(filters.dateFrom)) {
    throw new InvalidTransferInputError(`Invalid dateFrom filter: ${filters.dateFrom}`);
  }
  if (filters.dateTo !== undefined && !isValidLocalDate(filters.dateTo)) {
    throw new InvalidTransferInputError(`Invalid dateTo filter: ${filters.dateTo}`);
  }
  const conditions = [];
  if (filters.potId !== undefined) {
    conditions.push(
      or(eq(transfers.fromPotId, filters.potId), eq(transfers.toPotId, filters.potId)),
    );
  }
  if (filters.dateFrom !== undefined) {
    conditions.push(gte(transfers.occurredDate, filters.dateFrom));
  }
  if (filters.dateTo !== undefined) {
    conditions.push(lte(transfers.occurredDate, filters.dateTo));
  }
  if (filters.includeVoided !== true) {
    conditions.push(isNull(transfers.voidedAt));
  }
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  const base = db
    .select()
    .from(transfers)
    .orderBy(desc(transfers.occurredAt), desc(transfers.id))
    .limit(limit);
  return (conditions.length === 0 ? base : base.where(and(...conditions))).all();
}

function assertPositiveAmount(amountPence: number): void {
  if (!isValidPenceAmount(amountPence) || amountPence <= 0) {
    throw new InvalidTransferInputError('A transfer amount is a positive whole-pence figure.');
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
    throw new InvalidTransferInputError('Every transfer records who entered it.');
  }
  return raw.trim();
}

function checkedNote(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const note = raw.trim();
  if (note === '') return null;
  if (note.length > MAX_TRANSFER_NOTE_LENGTH) {
    throw new InvalidTransferInputError(
      `Keep the note to ${MAX_TRANSFER_NOTE_LENGTH} characters or fewer.`,
    );
  }
  return note;
}

function checkedVoidReason(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const reason = raw.trim();
  if (reason === '') return null;
  if (reason.length > MAX_TRANSFER_VOID_REASON_LENGTH) {
    throw new InvalidTransferInputError(
      `Keep the void reason to ${MAX_TRANSFER_VOID_REASON_LENGTH} characters or fewer.`,
    );
  }
  return reason;
}
