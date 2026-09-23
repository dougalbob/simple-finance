import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import { debts, externalMovements, pots } from '../db/schema';
import { formatPence, isValidPenceAmount } from '../money';
import { isValidLocalDate } from '../time';
import { DebtNotFoundError } from './debts';
import { AlreadyVoidError, RecordVoidedError, VersionConflictError } from './errors';
import { resolveOccurred } from './occurred';
import { PotNotFoundError } from './pots';

/**
 * Money crossing the household boundary that is neither salary nor spending
 * (SPEC §10.2): borrowing and repayments (`loan`, always linked to a debt),
 * the two legs of a cash-for-bank style swap (`swap`, always created as a
 * pair sharing one exchange key), and anything else with a note saying what
 * it was (`other`).
 *
 * Estimate behaviour (SPEC §7.1): money in adds like a receipt, money out
 * subtracts like spending — the household total genuinely moves, unlike an
 * internal transfer. Insights behaviour: never spending, never income — the
 * join over `allocations` excludes external movements by construction.
 */

export type ExternalMovement = typeof externalMovements.$inferSelect;
export type ExternalDirection = 'in' | 'out';
export type ExternalKind = 'loan' | 'swap' | 'other';

export class ExternalMovementNotFoundError extends Error {
  constructor(movementId: number) {
    super(`No external movement with id ${movementId}`);
    this.name = 'ExternalMovementNotFoundError';
  }
}

export class InvalidExternalMovementInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExternalMovementInputError';
  }
}

export const MAX_EXTERNAL_COUNTERPARTY_LENGTH = 120;
export const MAX_EXTERNAL_NOTE_LENGTH = 280;
export const MAX_EXTERNAL_VOID_REASON_LENGTH = 280;

export interface CreateExternalMovementInput {
  potId: number;
  direction: ExternalDirection;
  /** `swap` legs are created only through createSwap (an atomic pair). */
  kind: 'loan' | 'other';
  amountPence: number;
  occurredAt?: Date;
  occurredDate?: string;
  /** Required for `other`; taken from the debt for `loan`. */
  counterparty?: string;
  /** Required for `loan`; forbidden for `other`. */
  debtId?: number;
  /** Required for `other` — say what the money was. */
  note?: string | null;
  actor: string;
  now?: Date;
}

export function createExternalMovement(
  db: Db,
  input: CreateExternalMovementInput,
): ExternalMovement {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const direction = checkedDirection(input.direction);
  assertPositiveAmount(input.amountPence);
  const occurred = resolveOccurred({
    occurredAt: input.occurredAt,
    occurredDate: input.occurredDate,
    now,
  });

  return db.transaction((tx) => {
    assertPotExists(tx, input.potId);
    let counterparty: string;
    let debtId: number | null;
    let note: string | null;
    if (input.kind === 'loan') {
      if (input.debtId === undefined) {
        throw new InvalidExternalMovementInputError(
          'Borrowing and repayments link to a debt — pick who it is owed to or by.',
        );
      }
      const debt = tx.select().from(debts).where(eq(debts.id, input.debtId)).get();
      if (debt === undefined) {
        throw new DebtNotFoundError(input.debtId);
      }
      counterparty = debt.counterparty;
      debtId = debt.id;
      note = checkedNote(input.note);
    } else {
      if (input.debtId !== undefined) {
        throw new InvalidExternalMovementInputError(
          'Only borrowing and repayments link to a debt — this one does not.',
        );
      }
      if (input.counterparty === undefined) {
        throw new InvalidExternalMovementInputError('Say who the money came from or went to.');
      }
      counterparty = checkedCounterparty(input.counterparty);
      debtId = null;
      note = checkedNote(input.note);
      if (note === null) {
        throw new InvalidExternalMovementInputError(
          'Say what the money was — a note is required for other money in and out.',
        );
      }
    }
    const inserted = tx
      .insert(externalMovements)
      .values({
        potId: input.potId,
        direction,
        kind: input.kind,
        amountPence: input.amountPence,
        occurredAt: occurred.occurredAt,
        occurredDate: occurred.occurredDate,
        counterparty,
        debtId,
        exchangeKey: null,
        note,
        enteredBy: actor,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (inserted === undefined) {
      throw new Error('insert external movement returned no row');
    }
    recordAudit(tx, {
      actor,
      action: 'external.create',
      entity: 'external_movement',
      entityId: inserted.id,
      summary: describeMovement(direction, input.kind, inserted.amountPence, counterparty),
      after: inserted,
      now,
    });
    return inserted;
  });
}

export interface CreateSwapInput {
  /** The pot the money arrives in (e.g. a cash pot when your son hands over cash). */
  inPotId: number;
  /** The pot the money leaves from (e.g. Main when you transfer to his bank). */
  outPotId: number;
  amountPence: number;
  counterparty: string;
  occurredAt?: Date;
  occurredDate?: string;
  note?: string | null;
  actor: string;
  now?: Date;
}

export interface SwapPair {
  exchangeKey: string;
  inLeg: ExternalMovement;
  outLeg: ExternalMovement;
}

/**
 * Record a swap with someone outside the household (SPEC §10.2): two legs
 * created atomically in one transaction — money in to one pot, the same
 * amount out of another — so the household total provably does not move and
 * the two halves can never be orphaned from each other. Each leg stays an
 * independent correctable record afterwards (void one leg and the other
 * says so, honestly, rather than vanishing by cascade).
 */
export function createSwap(db: Db, input: CreateSwapInput): SwapPair {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  assertPositiveAmount(input.amountPence);
  if (input.inPotId === input.outPotId) {
    throw new InvalidExternalMovementInputError(
      'A swap moves money between two different pots — pick where it arrived and where it left.',
    );
  }
  const counterparty = checkedCounterparty(input.counterparty);
  const note = checkedNote(input.note);
  const occurred = resolveOccurred({
    occurredAt: input.occurredAt,
    occurredDate: input.occurredDate,
    now,
  });
  const exchangeKey = randomUUID();

  return db.transaction((tx) => {
    assertPotExists(tx, input.inPotId);
    assertPotExists(tx, input.outPotId);
    const inLeg = tx
      .insert(externalMovements)
      .values({
        potId: input.inPotId,
        direction: 'in',
        kind: 'swap',
        amountPence: input.amountPence,
        occurredAt: occurred.occurredAt,
        occurredDate: occurred.occurredDate,
        counterparty,
        debtId: null,
        exchangeKey,
        note,
        enteredBy: actor,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const outLeg = tx
      .insert(externalMovements)
      .values({
        potId: input.outPotId,
        direction: 'out',
        kind: 'swap',
        amountPence: input.amountPence,
        occurredAt: occurred.occurredAt,
        occurredDate: occurred.occurredDate,
        counterparty,
        debtId: null,
        exchangeKey,
        note,
        enteredBy: actor,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (inLeg === undefined || outLeg === undefined) {
      throw new Error('insert swap legs returned no rows');
    }
    recordAudit(tx, {
      actor,
      action: 'external.create',
      entity: 'external_movement',
      entityId: inLeg.id,
      summary: `Swapped ${formatPence(inLeg.amountPence)} with ${counterparty} (money in)`,
      after: inLeg,
      now,
    });
    recordAudit(tx, {
      actor,
      action: 'external.create',
      entity: 'external_movement',
      entityId: outLeg.id,
      summary: `Swapped ${formatPence(outLeg.amountPence)} with ${counterparty} (money out)`,
      after: outLeg,
      now,
    });
    return { exchangeKey, inLeg, outLeg };
  });
}

export interface EditExternalMovementPatch {
  potId?: number;
  amountPence?: number;
  occurredAt?: Date;
  occurredDate?: string;
  /**
   * Loan legs keep the debt's counterparty (rename the debt instead);
   * swap/other legs may correct theirs. undefined = unchanged.
   */
  counterparty?: string;
  /** undefined = unchanged; null clears — except `other`, which must keep a note. */
  note?: string | null;
}

export interface EditExternalMovementInput {
  id: number;
  expectedVersion: number;
  actor: string;
  now?: Date;
  patch: EditExternalMovementPatch;
}

/**
 * Correct a movement's pot, amount, date, counterparty or note. Kind,
 * direction, debt link and exchange key are immutable — a repayment does
 * not become borrowing, and a swap leg does not leave its pair. To fix
 * those, void and re-record (for a swap, void both legs and record it anew).
 */
export function editExternalMovement(db: Db, input: EditExternalMovementInput): ExternalMovement {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const patch = input.patch;
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(externalMovements)
      .where(eq(externalMovements.id, input.id))
      .get();
    if (current === undefined) {
      throw new ExternalMovementNotFoundError(input.id);
    }
    if (current.voidedAt !== null) {
      throw new RecordVoidedError('external movement', input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError(
        'external movement',
        input.id,
        input.expectedVersion,
        current.version,
      );
    }
    const effectivePotId = patch.potId ?? current.potId;
    assertPotExists(tx, effectivePotId);
    const effectiveAmount = patch.amountPence ?? current.amountPence;
    assertPositiveAmount(effectiveAmount);
    const occurred =
      patch.occurredAt !== undefined || patch.occurredDate !== undefined
        ? resolveOccurred({ occurredAt: patch.occurredAt, occurredDate: patch.occurredDate, now })
        : { occurredAt: current.occurredAt, occurredDate: current.occurredDate };
    let counterparty = current.counterparty;
    if (patch.counterparty !== undefined) {
      if (current.kind === 'loan') {
        throw new InvalidExternalMovementInputError(
          'Borrowing and repayments carry the debt’s name — rename the debt instead.',
        );
      }
      counterparty = checkedCounterparty(patch.counterparty);
    }
    const note = patch.note === undefined ? current.note : checkedNote(patch.note);
    if (current.kind === 'other' && note === null) {
      throw new InvalidExternalMovementInputError(
        'Say what the money was — a note is required for other money in and out.',
      );
    }
    const updated = tx
      .update(externalMovements)
      .set({
        potId: effectivePotId,
        amountPence: effectiveAmount,
        occurredAt: occurred.occurredAt,
        occurredDate: occurred.occurredDate,
        counterparty,
        note,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(externalMovements.id, current.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update external movement returned no row');
    }
    recordAudit(tx, {
      actor,
      action: 'external.edit',
      entity: 'external_movement',
      entityId: current.id,
      summary: `Edited external movement #${current.id} (${formatPence(effectiveAmount)})`,
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export interface VoidExternalMovementInput {
  id: number;
  expectedVersion: number;
  actor: string;
  reason?: string | null;
  now?: Date;
}

export function voidExternalMovement(db: Db, input: VoidExternalMovementInput): ExternalMovement {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const reason = checkedVoidReason(input.reason);
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(externalMovements)
      .where(eq(externalMovements.id, input.id))
      .get();
    if (current === undefined) {
      throw new ExternalMovementNotFoundError(input.id);
    }
    if (current.voidedAt !== null) {
      throw new AlreadyVoidError('external movement', input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError(
        'external movement',
        input.id,
        input.expectedVersion,
        current.version,
      );
    }
    const updated = tx
      .update(externalMovements)
      .set({
        voidedAt: now,
        voidedBy: actor,
        voidReason: reason,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(externalMovements.id, current.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update external movement returned no row');
    }
    recordAudit(tx, {
      actor,
      action: 'external.void',
      entity: 'external_movement',
      entityId: current.id,
      summary:
        `Voided external movement #${current.id} (${formatPence(current.amountPence)})` +
        (reason === null ? '' : ` — ${reason}`),
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export interface VoidSwapInput {
  /** The pair's shared exchange key (both legs carry it). */
  exchangeKey: string;
  inLegId: number;
  outLegId: number;
  expectedInVersion: number;
  expectedOutVersion: number;
  reason?: string | null;
  actor: string;
  now?: Date;
}

/**
 * Void a swap as a pair — both legs in ONE transaction, with one shared
 * reason (SPEC §10.2). The v0.2.0 workaround for a wrong swap was to void
 * both legs by hand; the household must never be left with an orphaned leg
 * (a lone in-leg is a −£X lie about the household). Each leg keeps its own
 * version guard, so a pair voided over a stale form fails visibly rather
 * than half-applying. For a single-leg correction (the cash never arrived,
 * the transfer went to the wrong account) use voidExternalMovement on the
 * one leg instead — the survivor stays visible, honestly.
 */
export function voidSwap(
  db: Db,
  input: VoidSwapInput,
): { inLeg: ExternalMovement; outLeg: ExternalMovement } {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const reason = checkedVoidReason(input.reason);
  return db.transaction((tx) => {
    const inLeg = readSwapLeg(tx, input.inLegId, 'in', input.exchangeKey, input.expectedInVersion);
    const outLeg = readSwapLeg(
      tx,
      input.outLegId,
      'out',
      input.exchangeKey,
      input.expectedOutVersion,
    );
    const voided = (leg: ExternalMovement): ExternalMovement => {
      const updated = tx
        .update(externalMovements)
        .set({
          voidedAt: now,
          voidedBy: actor,
          voidReason: reason,
          updatedAt: now,
          version: leg.version + 1,
        })
        .where(eq(externalMovements.id, leg.id))
        .returning()
        .get();
      if (updated === undefined) {
        throw new Error(`void swap leg ${leg.id} returned no row`);
      }
      recordAudit(tx, {
        actor,
        action: 'external.void',
        entity: 'external_movement',
        entityId: leg.id,
        summary:
          `Voided swap (both legs) — ${describeExternalMovement(leg)}` +
          (reason === null ? '' : ` — ${reason}`),
        before: leg,
        after: updated,
        now,
      });
      return updated;
    };
    return { inLeg: voided(inLeg), outLeg: voided(outLeg) };
  });
}

function readSwapLeg(
  tx: DbTx,
  legId: number,
  expectedDirection: ExternalDirection,
  exchangeKey: string,
  expectedVersion: number,
): ExternalMovement {
  const leg = tx.select().from(externalMovements).where(eq(externalMovements.id, legId)).get();
  if (leg === undefined) {
    throw new ExternalMovementNotFoundError(legId);
  }
  if (
    leg.kind !== 'swap' ||
    leg.direction !== expectedDirection ||
    leg.exchangeKey !== exchangeKey
  ) {
    throw new InvalidExternalMovementInputError(
      'That record is not the expected swap leg — refresh and try again.',
    );
  }
  if (leg.voidedAt !== null) {
    throw new AlreadyVoidError('external movement', legId);
  }
  if (leg.version !== expectedVersion) {
    throw new VersionConflictError('external movement', legId, expectedVersion, leg.version);
  }
  return leg;
}

export function getExternalMovement(db: Db | DbTx, movementId: number): ExternalMovement {
  const row = db.select().from(externalMovements).where(eq(externalMovements.id, movementId)).get();
  if (row === undefined) {
    throw new ExternalMovementNotFoundError(movementId);
  }
  return row;
}

export interface ExternalMovementFilters {
  potId?: number;
  debtId?: number;
  exchangeKey?: string;
  kind?: ExternalKind;
  direction?: ExternalDirection;
  dateFrom?: string;
  dateTo?: string;
  includeVoided?: boolean;
  limit?: number;
}

export function listExternalMovements(
  db: Db | DbTx,
  filters: ExternalMovementFilters = {},
): ExternalMovement[] {
  if (filters.dateFrom !== undefined && !isValidLocalDate(filters.dateFrom)) {
    throw new InvalidExternalMovementInputError(`Invalid dateFrom filter: ${filters.dateFrom}`);
  }
  if (filters.dateTo !== undefined && !isValidLocalDate(filters.dateTo)) {
    throw new InvalidExternalMovementInputError(`Invalid dateTo filter: ${filters.dateTo}`);
  }
  const conditions = [];
  if (filters.potId !== undefined) {
    conditions.push(eq(externalMovements.potId, filters.potId));
  }
  if (filters.debtId !== undefined) {
    conditions.push(eq(externalMovements.debtId, filters.debtId));
  }
  if (filters.exchangeKey !== undefined) {
    conditions.push(eq(externalMovements.exchangeKey, filters.exchangeKey));
  }
  if (filters.kind !== undefined) {
    conditions.push(eq(externalMovements.kind, filters.kind));
  }
  if (filters.direction !== undefined) {
    conditions.push(eq(externalMovements.direction, filters.direction));
  }
  if (filters.dateFrom !== undefined) {
    conditions.push(gte(externalMovements.occurredDate, filters.dateFrom));
  }
  if (filters.dateTo !== undefined) {
    conditions.push(lte(externalMovements.occurredDate, filters.dateTo));
  }
  if (filters.includeVoided !== true) {
    conditions.push(isNull(externalMovements.voidedAt));
  }
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  const base = db
    .select()
    .from(externalMovements)
    .orderBy(desc(externalMovements.occurredAt), desc(externalMovements.id))
    .limit(limit);
  return (conditions.length === 0 ? base : base.where(and(...conditions))).all();
}

export interface ExchangeView {
  exchangeKey: string;
  inLeg: ExternalMovement | null;
  outLeg: ExternalMovement | null;
}

/**
 * Swaps grouped by exchange key, newest first. A leg voided on its own
 * stays visible as voided inside its pair — the pair is never silently
 * half a swap.
 */
export function listExchanges(
  db: Db | DbTx,
  options: { includeVoided?: boolean; limit?: number } = {},
): ExchangeView[] {
  const legs = listExternalMovements(db, {
    kind: 'swap',
    includeVoided: true,
    limit: 1000,
  });
  const grouped = new Map<string, ExchangeView>();
  for (const leg of legs) {
    const key = leg.exchangeKey ?? '';
    const view = grouped.get(key) ?? { exchangeKey: key, inLeg: null, outLeg: null };
    if (leg.direction === 'in') view.inLeg = view.inLeg ?? leg;
    else view.outLeg = view.outLeg ?? leg;
    grouped.set(key, view);
  }
  const views = [...grouped.values()];
  views.sort((a, b) => {
    const aAt = Math.max(a.inLeg?.occurredAt.getTime() ?? 0, a.outLeg?.occurredAt.getTime() ?? 0);
    const bAt = Math.max(b.inLeg?.occurredAt.getTime() ?? 0, b.outLeg?.occurredAt.getTime() ?? 0);
    return bAt - aAt;
  });
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  if (options.includeVoided === true) return views.slice(0, limit);
  return views
    .filter((view) => view.inLeg?.voidedAt === null || view.outLeg?.voidedAt === null)
    .slice(0, limit);
}

/**
 * Human-readable label for one boundary movement — shared by the Pots page
 * (boundary history + swap pair list) so the wording cannot drift.
 */
export function describeExternalMovement(movement: ExternalMovement): string {
  const amount = formatPence(movement.amountPence);
  if (movement.kind === 'loan') {
    return movement.direction === 'in'
      ? `Borrowed ${amount} from ${movement.counterparty}`
      : `Repaid ${amount} to ${movement.counterparty}`;
  }
  if (movement.kind === 'swap') {
    return movement.direction === 'in'
      ? `Swap in ${amount} with ${movement.counterparty}`
      : `Swap out ${amount} with ${movement.counterparty}`;
  }
  return movement.direction === 'in'
    ? `Received ${amount} from ${movement.counterparty}`
    : `Paid ${amount} to ${movement.counterparty}`;
}

function describeMovement(
  direction: ExternalDirection,
  kind: 'loan' | 'other',
  amountPence: number,
  counterparty: string,
): string {
  const amount = formatPence(amountPence);
  if (kind === 'loan') {
    return direction === 'in'
      ? `Borrowed ${amount} from ${counterparty}`
      : `Repaid ${amount} to ${counterparty}`;
  }
  return direction === 'in'
    ? `Received ${amount} from ${counterparty}`
    : `Paid ${amount} to ${counterparty}`;
}

function assertPositiveAmount(amountPence: number): void {
  if (!isValidPenceAmount(amountPence) || amountPence <= 0) {
    throw new InvalidExternalMovementInputError('The amount is a positive whole-pence figure.');
  }
}

function assertPotExists(db: Db | DbTx, potId: number): void {
  const row = db.select({ id: pots.id }).from(pots).where(eq(pots.id, potId)).get();
  if (row === undefined) {
    throw new PotNotFoundError(potId);
  }
}

function checkedDirection(raw: string): ExternalDirection {
  if (raw !== 'in' && raw !== 'out') {
    throw new InvalidExternalMovementInputError('Choose whether the money came in or went out.');
  }
  return raw;
}

function checkedActor(raw: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new InvalidExternalMovementInputError('Every movement records who entered it.');
  }
  return raw.trim();
}

function checkedCounterparty(raw: string): string {
  const counterparty = raw.trim().replace(/\s+/g, ' ');
  if (counterparty === '') {
    throw new InvalidExternalMovementInputError('Say who the money came from or went to.');
  }
  if (counterparty.length > MAX_EXTERNAL_COUNTERPARTY_LENGTH) {
    throw new InvalidExternalMovementInputError(
      `Keep the name to ${MAX_EXTERNAL_COUNTERPARTY_LENGTH} characters or fewer.`,
    );
  }
  return counterparty;
}

function checkedNote(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const note = raw.trim();
  if (note === '') return null;
  if (note.length > MAX_EXTERNAL_NOTE_LENGTH) {
    throw new InvalidExternalMovementInputError(
      `Keep the note to ${MAX_EXTERNAL_NOTE_LENGTH} characters or fewer.`,
    );
  }
  return note;
}

function checkedVoidReason(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const reason = raw.trim();
  if (reason === '') return null;
  if (reason.length > MAX_EXTERNAL_VOID_REASON_LENGTH) {
    throw new InvalidExternalMovementInputError(
      `Keep the void reason to ${MAX_EXTERNAL_VOID_REASON_LENGTH} characters or fewer.`,
    );
  }
  return reason;
}
