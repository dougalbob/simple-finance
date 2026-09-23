import { and, asc, eq, isNull } from 'drizzle-orm';
import { recordAudit } from '../audit';
import type { Db } from '../db/client';
import { debts, externalMovements } from '../db/schema';
import { formatPence } from '../money';
import { VersionConflictError } from './errors';

/**
 * Informal debts (SPEC §10.2): money the household owes someone outside it
 * (`we_owe` — a family loan to pay back) or is owed by them (`they_owe` —
 * money lent out). A debt is a named IOU; its outstanding balance is always
 * derived from the linked loan movements, never stored, so the figure can
 * never drift from the movements it claims to summarise. No interest, no
 * schedules — repayments simply reduce the balance.
 *
 * Debts are never deleted: a settled debt (zero balance) stays as history.
 */

export type Debt = typeof debts.$inferSelect;
export type DebtDirection = 'we_owe' | 'they_owe';

export class DebtNotFoundError extends Error {
  constructor(debtId: number) {
    super(`No debt with id ${debtId}`);
    this.name = 'DebtNotFoundError';
  }
}

export class InvalidDebtInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDebtInputError';
  }
}

export const MAX_DEBT_COUNTERPARTY_LENGTH = 120;
export const MAX_DEBT_NOTE_LENGTH = 280;

export interface CreateDebtInput {
  counterparty: string;
  direction: DebtDirection;
  note?: string | null;
  actor: string;
  now?: Date;
}

export function createDebt(db: Db, input: CreateDebtInput): Debt {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const counterparty = checkedCounterparty(input.counterparty);
  const direction = checkedDirection(input.direction);
  const note = checkedNote(input.note);
  return db.transaction((tx) => {
    const inserted = tx
      .insert(debts)
      .values({ counterparty, direction, note, createdBy: actor, createdAt: now, updatedAt: now })
      .returning()
      .get();
    if (inserted === undefined) {
      throw new Error('insert debt returned no row');
    }
    recordAudit(tx, {
      actor,
      action: 'debt.create',
      entity: 'debt',
      entityId: inserted.id,
      summary:
        direction === 'we_owe'
          ? `Started owing ${counterparty} (repayments will reduce it)`
          : `${counterparty} started owing us (repayments will reduce it)`,
      after: inserted,
      now,
    });
    return inserted;
  });
}

export interface EditDebtPatch {
  counterparty?: string;
  /** undefined = unchanged; null = clear the note. */
  note?: string | null;
}

export interface EditDebtInput {
  id: number;
  expectedVersion: number;
  actor: string;
  now?: Date;
  patch: EditDebtPatch;
}

/**
 * Correct a debt's counterparty name or note. The direction is immutable —
 * a debt that was "we owe" does not become "they owe us"; that would flip
 * the meaning of every linked movement. Linked loan movements carry a
 * display copy of the counterparty, so a rename updates those copies in the
 * same transaction and says so in the audit line.
 */
export function editDebt(db: Db, input: EditDebtInput): Debt {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  return db.transaction((tx) => {
    const current = tx.select().from(debts).where(eq(debts.id, input.id)).get();
    if (current === undefined) {
      throw new DebtNotFoundError(input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('debt', input.id, input.expectedVersion, current.version);
    }
    const counterparty =
      input.patch.counterparty === undefined
        ? current.counterparty
        : checkedCounterparty(input.patch.counterparty);
    const note = input.patch.note === undefined ? current.note : checkedNote(input.patch.note);
    const updated = tx
      .update(debts)
      .set({ counterparty, note, updatedAt: now, version: current.version + 1 })
      .where(eq(debts.id, current.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update debt returned no row');
    }
    let touchedMovements = 0;
    if (counterparty !== current.counterparty) {
      const linked = tx
        .select({ id: externalMovements.id })
        .from(externalMovements)
        .where(eq(externalMovements.debtId, current.id))
        .all();
      for (const row of linked) {
        tx.update(externalMovements)
          .set({ counterparty, updatedAt: now })
          .where(eq(externalMovements.id, row.id))
          .run();
        touchedMovements += 1;
      }
    }
    recordAudit(tx, {
      actor,
      action: 'debt.edit',
      entity: 'debt',
      entityId: current.id,
      summary:
        `Edited debt “${current.counterparty}” → “${counterparty}”` +
        (touchedMovements === 0 ? '' : ` (${touchedMovements} linked movements updated)`),
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export function getDebt(db: Db, debtId: number): Debt {
  const row = db.select().from(debts).where(eq(debts.id, debtId)).get();
  if (row === undefined) {
    throw new DebtNotFoundError(debtId);
  }
  return row;
}

export function listDebts(db: Db): Debt[] {
  return db.select().from(debts).orderBy(asc(debts.counterparty), asc(debts.id)).all();
}

export interface DebtWithBalance {
  debt: Debt;
  /** Outstanding pence: positive = still owed, zero = settled, negative = overpaid. */
  balancePence: number;
  /** Non-void loan movements linked to this debt. */
  movementCount: number;
}

/**
 * The outstanding balance of one debt, derived from its non-void loan
 * movements (voided rows never count): for `we_owe`, money in (borrowed)
 * minus money out (repaid); for `they_owe`, money out (lent) minus money
 * in (repaid to us).
 */
export function debtBalance(db: Db, debt: Debt): { balancePence: number; movementCount: number } {
  const rows = db
    .select({
      direction: externalMovements.direction,
      amountPence: externalMovements.amountPence,
    })
    .from(externalMovements)
    .where(and(eq(externalMovements.debtId, debt.id), isNull(externalMovements.voidedAt)))
    .all();
  let balancePence = 0;
  for (const row of rows) {
    if (debt.direction === 'we_owe') {
      balancePence += row.direction === 'in' ? row.amountPence : -row.amountPence;
    } else {
      balancePence += row.direction === 'out' ? row.amountPence : -row.amountPence;
    }
  }
  return { balancePence, movementCount: rows.length };
}

export function listDebtsWithBalances(db: Db): DebtWithBalance[] {
  return listDebts(db).map((debt) => ({ debt, ...debtBalance(db, debt) }));
}

export interface DebtsSummary {
  /** What the household owes others across all `we_owe` debts (never negative). */
  owedByHouseholdPence: number;
  /** What others owe the household across all `they_owe` debts (never negative). */
  owedToHouseholdPence: number;
  debtCount: number;
}

/**
 * The household-level owed/owing figures shown beside "available now"
 * (SPEC §10.2): borrowed money is visible as owed, never as income. Only
 * positive outstanding balances contribute — a settled or overpaid debt
 * adds nothing to what is owed.
 */
export function debtsSummary(db: Db): DebtsSummary {
  let owedByHouseholdPence = 0;
  let owedToHouseholdPence = 0;
  let debtCount = 0;
  for (const { debt, balancePence } of listDebtsWithBalances(db)) {
    debtCount += 1;
    if (balancePence <= 0) continue;
    if (debt.direction === 'we_owe') owedByHouseholdPence += balancePence;
    else owedToHouseholdPence += balancePence;
  }
  return { owedByHouseholdPence, owedToHouseholdPence, debtCount };
}

/**
 * Honest one-line label for a debt balance, e.g. "we owe £200.00" /
 * "settled" / "overpaid £5.00".
 */
export function debtBalanceLabel(debt: Debt, balancePence: number): string {
  if (balancePence === 0) return 'settled';
  if (balancePence < 0) return `overpaid ${formatPence(-balancePence)}`;
  return debt.direction === 'we_owe'
    ? `we owe ${formatPence(balancePence)}`
    : `owed to us ${formatPence(balancePence)}`;
}

function checkedActor(raw: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new InvalidDebtInputError('Every debt records who entered it.');
  }
  return raw.trim();
}

function checkedCounterparty(raw: string): string {
  const counterparty = raw.trim().replace(/\s+/g, ' ');
  if (counterparty === '') {
    throw new InvalidDebtInputError('Say who the money is owed to or by.');
  }
  if (counterparty.length > MAX_DEBT_COUNTERPARTY_LENGTH) {
    throw new InvalidDebtInputError(
      `Keep the name to ${MAX_DEBT_COUNTERPARTY_LENGTH} characters or fewer.`,
    );
  }
  return counterparty;
}

function checkedDirection(raw: string): DebtDirection {
  if (raw !== 'we_owe' && raw !== 'they_owe') {
    throw new InvalidDebtInputError('Choose whether we owe them or they owe us.');
  }
  return raw;
}

function checkedNote(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const note = raw.trim();
  if (note === '') return null;
  if (note.length > MAX_DEBT_NOTE_LENGTH) {
    throw new InvalidDebtInputError(
      `Keep the note to ${MAX_DEBT_NOTE_LENGTH} characters or fewer.`,
    );
  }
  return note;
}
