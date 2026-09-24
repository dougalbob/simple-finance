import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { recordAudit } from '../audit';
import type { Db } from '../db/client';
import { debts, externalMovements } from '../db/schema';
import { formatPence, isValidPenceAmount } from '../money';
import { isValidLocalDate } from '../time';
import { VersionConflictError } from './errors';
import {
  addDaysLocal,
  checkedLocalDate,
  clampedDueDate,
  incomeOccurrencesBetween,
  shiftIncomeOffWeekend,
} from './dates';
import { listPots } from './pots';

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
  /**
   * undefined = unchanged; null = stop expecting an inflow. The amount and
   * day ride as a pair; `untilDate` (v0.7.0) is optional and inclusive —
   * omitted/null means open-ended.
   */
  expectedInflow?: {
    amountPence: number;
    dayOfMonth: number;
    untilDate?: string | null;
  } | null;
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
 *
 * The expected inflow (v0.5.0, extended v0.7.0) is a read-only expectation:
 * amount and day ride along as a pair or not at all, with an optional
 * inclusive until date. It feeds the projections and All Transactions only
 * — the actual deposit still goes through Borrow and Repay.
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
    const inflow =
      input.patch.expectedInflow === undefined
        ? currentExpectedInflow(current)
        : checkedExpectedInflow(input.patch.expectedInflow);
    const updated = tx
      .update(debts)
      .set({
        counterparty,
        note,
        expectedInflowAmountPence: inflow.amountPence,
        expectedInflowDayOfMonth: inflow.dayOfMonth,
        expectedInflowUntilDate: inflow.untilDate,
        updatedAt: now,
        version: current.version + 1,
      })
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
    const inflowChanged =
      inflow.amountPence !== current.expectedInflowAmountPence ||
      inflow.dayOfMonth !== current.expectedInflowDayOfMonth ||
      inflow.untilDate !== current.expectedInflowUntilDate;
    recordAudit(tx, {
      actor,
      action: 'debt.edit',
      entity: 'debt',
      entityId: current.id,
      summary:
        `Edited debt “${current.counterparty}” → “${counterparty}”` +
        (touchedMovements === 0 ? '' : ` (${touchedMovements} linked movements updated)`) +
        (inflowChanged
          ? inflow.amountPence === null
            ? ' (expected inflow cleared)'
            : ` (expects ${formatPence(inflow.amountPence)} on day ${inflow.dayOfMonth}` +
              `${inflow.untilDate === null ? '' : ` until ${inflow.untilDate}`})`
          : ''),
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

export interface ExpectedInflowOccurrence {
  debtId: number;
  counterparty: string;
  amountPence: number;
  potId: number;
  /** The date the money is expected: the configured day, moved off a weekend. */
  dueDate: string;
  /** Shifted onto a Friday when day-of-month fell on a weekend (decision 7). */
  shifted: boolean;
  /**
   * The configured (clamped, unshifted) day-of-month date this occurrence
   * answers — the date the household thinks in ("the 10th"), which the
   * until-date is compared against.
   */
  configuredDate: string;
}

/**
 * A borrowing recorded up to this many days before an occurrence's expected
 * date still answers that month's expectation: the weekend shift can move
 * the expected date up to two days earlier than the configured day, and the
 * money may land on the configured day itself (SPEC §10.2, v0.7.0).
 */
const OCCURRENCE_ANSWER_LEAD_DAYS = 2;

/**
 * The once-a-month occurrences of a debt's expected inflow inside an
 * (after, through] window of local dates (SPEC §10.2, v0.5.0 — feature 2,
 * extended v0.7.0). Nothing is materialized: the dates are derived from the
 * day-of-month with the income weekend shift, exactly like
 * `nextDueDateAfter`.
 *
 * Three rules decide what projects (v0.7.0):
 *
 *  1. **Not started yet (no movements at all) projects.** The whole point of
 *     the expectation is the payment that has not arrived.
 *  2. **Settled stops.** A debt with movements and nothing outstanding
 *     (repaid to zero, or overpaid) expects nothing — the arrangement is
 *     over, however it was configured.
 *  3. **An answered month stops projecting.** A live money-in movement for
 *     the debt recorded from up to two days before an occurrence's expected
 *     date and before the next one is that month's money: projecting it
 *     again would count the same payment twice.
 *
 * An optional inclusive `untilDate` ends the arrangement: an occurrence whose
 * configured date is on or before it counts, the next month does not.
 */
export function expectedInflowOccurrences(
  db: Db,
  debt: Debt,
  afterDate: string,
  throughDate: string,
  potId: number,
): ExpectedInflowOccurrence[] {
  if (debt.expectedInflowAmountPence === null || debt.expectedInflowDayOfMonth === null) {
    return [];
  }
  const { balancePence, movementCount } = debtBalance(db, debt);
  if (movementCount > 0 && balancePence <= 0) return []; // settled (or overpaid) since v0.7.0
  const dayOfMonth = debt.expectedInflowDayOfMonth;
  const untilDate = debt.expectedInflowUntilDate;
  const inflowDates = liveInflowDates(db, debt);
  const occurrences: ExpectedInflowOccurrence[] = [];
  for (const date of incomeOccurrencesBetween(dayOfMonth, afterDate, throughDate)) {
    const configured = clampedOccurrenceDay(dayOfMonth, date);
    if (untilDate !== null && configured > untilDate) continue; // past the end of the arrangement
    if (isAnswered(inflowDates, date, configured, dayOfMonth)) continue;
    occurrences.push({
      debtId: debt.id,
      counterparty: debt.counterparty,
      amountPence: debt.expectedInflowAmountPence,
      potId,
      dueDate: date,
      shifted: date !== configured,
      configuredDate: configured,
    });
  }
  return occurrences;
}

/**
 * The pot a debt's expectation belongs to (SPEC §10.2): the pot its most
 * recent live loan movement travelled through — the expectation must
 * describe the same money the real records do. A debt that has not borrowed
 * or lent yet pins no pot, so its expectation falls back to the household's
 * default pot (the one labelled "Main account", else the first live pot);
 * once the first movement is recorded the expectation follows reality
 * automatically. null only when no live pot exists at all.
 */
export function expectedInflowPotId(db: Db, debt: Debt): number | null {
  const rows = db
    .select({ potId: externalMovements.potId })
    .from(externalMovements)
    .where(and(eq(externalMovements.debtId, debt.id), isNull(externalMovements.voidedAt)))
    .orderBy(desc(externalMovements.id))
    .limit(1)
    .all();
  const movementPot = rows[0]?.potId;
  if (movementPot !== undefined) return movementPot;
  const live = listPots(db);
  const main = live.find((pot) => pot.label.toLowerCase() === 'main account');
  return main?.id ?? live[0]?.id ?? null;
}

/**
 * The local dates of a debt's live money-in movements: borrowing for a
 * `we_owe` debt, repayments to us for a `they_owe` debt. Either way the money
 * arrives in a pot, which is what answers an expected inflow.
 */
function liveInflowDates(db: Db, debt: Debt): string[] {
  return db
    .select({ occurredDate: externalMovements.occurredDate })
    .from(externalMovements)
    .where(
      and(
        eq(externalMovements.debtId, debt.id),
        eq(externalMovements.direction, 'in'),
        isNull(externalMovements.voidedAt),
      ),
    )
    .all()
    .map((row) => row.occurredDate);
}

/**
 * True when the month this occurrence belongs to has already been paid:
 * a live money-in movement recorded from `OCCURRENCE_ANSWER_LEAD_DAYS` before
 * the expected date up to (not including) the next expected date.
 */
function isAnswered(
  inflowDates: string[],
  dueDate: string,
  configuredDate: string,
  dayOfMonth: number,
): boolean {
  const answerFrom = addDaysLocal(dueDate, -OCCURRENCE_ANSWER_LEAD_DAYS);
  const answerUntil = nextExpectedDate(dayOfMonth, configuredDate);
  return inflowDates.some((date) => date >= answerFrom && date < answerUntil);
}

/** The next month's expected date for the same configured day-of-month. */
function nextExpectedDate(dayOfMonth: number, configuredDate: string): string {
  const base = checkedLocalDate(configuredDate);
  const total = base.month; // month - 1 + 1
  const year = base.year + Math.floor(total / 12);
  const month = (total % 12) + 1;
  return shiftIncomeOffWeekend(clampedDueDate(dayOfMonth, year, month));
}

/**
 * The configured (clamped) date for an occurrence's shifted date — so the UI
 * can say "the 12th is a Saturday, expected on the Friday before". Searched
 * over the neighbouring months, the same way income-view resolves shifted
 * paydays (a day-of-month on the 1st can shift into the previous month).
 */
function clampedOccurrenceDay(day: number, dueDate: string): string {
  const base = checkedLocalDate(dueDate);
  for (let offset = -1; offset <= 1; offset += 1) {
    const total = base.month - 1 + offset;
    const year = base.year + Math.floor(total / 12);
    const month = (((total % 12) + 12) % 12) + 1;
    const candidate = clampedDueDate(day, year, month);
    if (shiftIncomeOffWeekend(candidate) === dueDate) return candidate;
  }
  return dueDate;
}

interface CheckedInflow {
  amountPence: number | null;
  dayOfMonth: number | null;
  untilDate: string | null;
}

function currentExpectedInflow(debt: Debt): CheckedInflow {
  return {
    amountPence: debt.expectedInflowAmountPence,
    dayOfMonth: debt.expectedInflowDayOfMonth,
    untilDate: debt.expectedInflowUntilDate,
  };
}

function checkedExpectedInflow(
  inflow: { amountPence: number; dayOfMonth: number; untilDate?: string | null } | null,
): CheckedInflow {
  if (inflow === null) return { amountPence: null, dayOfMonth: null, untilDate: null };
  // `isValidPenceAmount` rejects non-integers and out-of-range values; a
  // debt's expected support must then also be a strictly positive amount.
  if (!isValidPenceAmount(inflow.amountPence) || inflow.amountPence <= 0) {
    throw new InvalidDebtInputError('The expected amount must be a positive whole-pence figure.');
  }
  if (!Number.isInteger(inflow.dayOfMonth) || inflow.dayOfMonth < 1 || inflow.dayOfMonth > 31) {
    throw new InvalidDebtInputError('The expected day must be between 1 and 31.');
  }
  const untilDate = inflow.untilDate ?? null;
  if (untilDate !== null && !isValidLocalDate(untilDate)) {
    throw new InvalidDebtInputError(
      'The “until” date must be a real calendar date like 2027-02-10.',
    );
  }
  return { amountPence: inflow.amountPence, dayOfMonth: inflow.dayOfMonth, untilDate };
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
