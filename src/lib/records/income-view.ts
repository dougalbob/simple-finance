import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { receipts, scheduleInstances, schedules } from '../db/schema';
import { isValidLocalDate, toLocalDateString } from '../time';
import { checkedLocalDate, clampedDueDate, shiftIncomeOffWeekend } from './dates';
import { listPotsIncludingArchived } from './pots';
import { getReceipt, ReceiptNotFoundError, type Receipt } from './receipts';
import { listSchedules, type Schedule } from './schedules';

/**
 * The Income page's view model (SPEC §6, §11.3, §15.2 — plan decisions
 * 109–113, v0.4.0).
 *
 * It is **read-only projection of existing records**, like `activity.ts`:
 * it writes nothing and invents nothing. Two families meet here:
 *
 * - **scheduled income** (expected receipts, one schedule → many converted
 *   receipt records); the schedule is the plan, the receipts are what
 *   actually landed;
 * - **one-off income** (manual receipts: a sold bicycle, a refund from a
 *   third party, a gift), each with an optional free-text `source`.
 *
 * Deliberately absent: any income *analysis*. No income-vs-spending, no
 * categories for income, no charts (SPEC §12/§16, plan decision 103). This
 * module exists so the household can record and see income; comparing it to
 * spending is not this app's job.
 *
 * Source resolution is the one piece of joinery worth naming: a receipt
 * shows its typed `source` when it has one, otherwise the **schedule's
 * current name** (so a renamed salary reads correctly in history),
 * otherwise "Income".
 */

/** Rows the income list shows before it says so (household scale). */
export const INCOME_ROW_LIMIT = 200;

export interface IncomeScheduleView {
  scheduleId: number;
  name: string;
  amountPence: number;
  frequency: Schedule['frequency'];
  dueDayOfMonth: number;
  dueMonth: number | null;
  potId: number;
  potLabel: string;
  activeFrom: string;
  activeUntil: string | null;
  cancelledAt: Date | null;
  cancelledEffectiveOn: string | null;
  /** The next date the app expects this money, or null when it will not come. */
  nextDueDate: string | null;
  /**
   * True when the next due date is earlier than the configured day because
   * that day fell on a weekend — payday moved to the previous Friday
   * (plan OQ2). The page says so rather than silently showing a new date.
   */
  nextDueDateShifted: boolean;
  /** The most recent converted receipt from this schedule, if any. */
  lastReceivedDate: string | null;
  receivedCount: number;
  version: number;
}

export interface IncomeRecordView {
  id: number;
  occurredDate: string;
  amountPence: number;
  potId: number;
  potLabel: string;
  /** What the list shows: typed source, else the schedule's name, else "Income". */
  source: string;
  /** The typed source only — null for a converted expected receipt. */
  typedSource: string | null;
  scheduleId: number | null;
  scheduleName: string | null;
  note: string | null;
  enteredBy: string;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
  version: number;
}

export interface IncomeSummary {
  /** Live receipts recorded in the current calendar month (all pots). */
  monthToDatePence: number;
  /** The soonest expected receipt among the household's income schedules. */
  nextPayday: {
    date: string;
    amountPence: number;
    scheduleName: string;
    potLabel: string;
    shifted: boolean;
  } | null;
}

export interface IncomeFilters {
  potId?: number;
  dateFrom?: string;
  dateTo?: string;
  includeVoided?: boolean;
  limit?: number;
}

export function listIncomeSchedules(db: Db, nowArg?: Date): IncomeScheduleView[] {
  const now = nowArg ?? new Date();
  const potLabels = new Map(listPotsIncludingArchived(db).map((pot) => [pot.id, pot.label]));
  const schedulesWithNext = listSchedules(db, now).filter((row) => row.schedule.kind === 'receipt');

  // One pass over the converted receipts: the last date each schedule paid
  // out and how many times it has. Grouped in SQL so the page stays a read.
  const converted = db
    .select({
      scheduleId: schedules.id,
      lastDate: sql<string>`max(${receipts.occurredDate})`,
      count: sql<number>`count(*)`,
    })
    .from(receipts)
    .innerJoin(scheduleInstances, eq(scheduleInstances.id, receipts.scheduleInstanceId))
    .innerJoin(schedules, eq(schedules.id, scheduleInstances.scheduleId))
    .where(and(eq(schedules.kind, 'receipt'), isNull(receipts.voidedAt)))
    .groupBy(schedules.id)
    .all();
  const convertedBySchedule = new Map(converted.map((row) => [row.scheduleId, row]));

  return schedulesWithNext
    .map(({ schedule, nextDueDate }) => {
      const paid = convertedBySchedule.get(schedule.id);
      return {
        scheduleId: schedule.id,
        name: schedule.name,
        amountPence: schedule.amountPence,
        frequency: schedule.frequency,
        dueDayOfMonth: schedule.dueDayOfMonth,
        dueMonth: schedule.dueMonth,
        potId: schedule.potId,
        potLabel: potLabels.get(schedule.potId) ?? 'a pot',
        activeFrom: schedule.activeFrom,
        activeUntil: schedule.activeUntil,
        cancelledAt: schedule.cancelledAt,
        cancelledEffectiveOn: schedule.cancelledEffectiveOn,
        nextDueDate,
        nextDueDateShifted: configuredDueDateFor(schedule, nextDueDate) !== null,
        lastReceivedDate: paid?.lastDate ?? null,
        receivedCount: paid?.count ?? 0,
        version: schedule.version,
      };
    })
    .sort((a, b) => {
      // Live schedules first, then by how soon the money is expected.
      const aLive = a.cancelledAt === null ? 0 : 1;
      const bLive = b.cancelledAt === null ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      const aDate = a.nextDueDate ?? '9999-12-31';
      const bDate = b.nextDueDate ?? '9999-12-31';
      return aDate.localeCompare(bDate) || a.name.localeCompare(b.name);
    });
}

/**
 * Recent income records, newest first (SPEC §6): converted expected receipts
 * and one-off entries together, because both are money that arrived. Voided
 * rows are excluded unless asked for — the list is "what we received".
 */
export function listIncomeRecords(db: Db, filters: IncomeFilters = {}): IncomeRecordView[] {
  if (filters.dateFrom !== undefined && !isValidLocalDate(filters.dateFrom)) {
    throw new Error(`Invalid dateFrom filter: ${filters.dateFrom}`);
  }
  if (filters.dateTo !== undefined && !isValidLocalDate(filters.dateTo)) {
    throw new Error(`Invalid dateTo filter: ${filters.dateTo}`);
  }
  const conditions = [];
  if (filters.potId !== undefined) conditions.push(eq(receipts.potId, filters.potId));
  if (filters.dateFrom !== undefined) conditions.push(gte(receipts.occurredDate, filters.dateFrom));
  if (filters.dateTo !== undefined) conditions.push(lte(receipts.occurredDate, filters.dateTo));
  if (filters.includeVoided !== true) conditions.push(isNull(receipts.voidedAt));
  const limit = Math.min(Math.max(filters.limit ?? INCOME_ROW_LIMIT, 1), 1000);

  const rows = db
    .select({
      receipt: receipts,
      scheduleId: schedules.id,
      scheduleName: schedules.name,
    })
    .from(receipts)
    .leftJoin(scheduleInstances, eq(scheduleInstances.id, receipts.scheduleInstanceId))
    .leftJoin(schedules, eq(schedules.id, scheduleInstances.scheduleId))
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(receipts.occurredAt), desc(receipts.id))
    .limit(limit)
    .all();

  const potLabels = new Map(listPotsIncludingArchived(db).map((pot) => [pot.id, pot.label]));
  return rows.map((row) => toRecordView(row.receipt, row.scheduleId, row.scheduleName, potLabels));
}

/** One income record by id, or null — a deep link may name a voided row. */
export function getIncomeRecord(db: Db, receiptId: number): IncomeRecordView | null {
  let receipt: Receipt;
  try {
    receipt = getReceipt(db, receiptId);
  } catch (error) {
    if (error instanceof ReceiptNotFoundError) return null;
    throw error;
  }
  const potLabels = new Map(listPotsIncludingArchived(db).map((pot) => [pot.id, pot.label]));
  if (receipt.scheduleInstanceId === null) {
    return toRecordView(receipt, null, null, potLabels);
  }
  const row = db
    .select({ scheduleId: schedules.id, scheduleName: schedules.name })
    .from(scheduleInstances)
    .innerJoin(schedules, eq(schedules.id, scheduleInstances.scheduleId))
    .where(eq(scheduleInstances.id, receipt.scheduleInstanceId))
    .get();
  return toRecordView(receipt, row?.scheduleId ?? null, row?.scheduleName ?? null, potLabels);
}

/**
 * Two plain figures for the page header — record-keeping, not analysis:
 * what has been received this calendar month, and the next date the app is
 * expecting income. Both are derived live, never stored.
 */
export function incomeSummary(db: Db, nowArg?: Date): IncomeSummary {
  const now = nowArg ?? new Date();
  const monthStart = `${toLocalDateString(now).slice(0, 7)}-01`;
  const row = db
    .select({ total: sql<number>`coalesce(sum(${receipts.amountPence}), 0)` })
    .from(receipts)
    .where(and(isNull(receipts.voidedAt), gte(receipts.occurredDate, monthStart)))
    .get();
  const monthToDatePence = row?.total ?? 0;

  const potLabels = new Map(listPotsIncludingArchived(db).map((pot) => [pot.id, pot.label]));
  const upcoming = listSchedules(db, now)
    .filter((entry) => entry.schedule.kind === 'receipt' && entry.nextDueDate !== null)
    .sort((a, b) => (a.nextDueDate ?? '').localeCompare(b.nextDueDate ?? ''))[0];

  const nextPayday =
    upcoming === undefined || upcoming.nextDueDate === null
      ? null
      : {
          date: upcoming.nextDueDate,
          amountPence: upcoming.schedule.amountPence,
          scheduleName: upcoming.schedule.name,
          potLabel: potLabels.get(upcoming.schedule.potId) ?? 'a pot',
          shifted: configuredDueDateFor(upcoming.schedule, upcoming.nextDueDate) !== null,
        };
  return { monthToDatePence, nextPayday };
}

/** How a receipt is labelled in a list, All Transactions and a void confirm. */
export function describeIncome(view: IncomeRecordView): string {
  return `${view.source} · ${view.occurredDate}`;
}

function toRecordView(
  receipt: Receipt,
  scheduleId: number | null,
  scheduleName: string | null,
  potLabels: Map<number, string>,
): IncomeRecordView {
  return {
    id: receipt.id,
    occurredDate: receipt.occurredDate,
    amountPence: receipt.amountPence,
    potId: receipt.potId,
    potLabel: potLabels.get(receipt.potId) ?? 'a pot',
    source: receipt.source ?? scheduleName ?? 'Income',
    typedSource: receipt.source,
    scheduleId,
    scheduleName,
    note: receipt.note,
    enteredBy: receipt.enteredBy,
    voidedAt: receipt.voidedAt,
    voidedBy: receipt.voidedBy,
    voidReason: receipt.voidReason,
    version: receipt.version,
  };
}

/**
 * Did this due date move? Returns the **configured** date when the schedule's
 * due day lands on a weekend in that period (so the page can print "the 26th
 * is a Saturday — expected Friday the 25th"), and null when the date stands
 * as configured.
 *
 * The shifted date can fall in a different month from its configured day
 * (the 1st on a Saturday pays on the last Friday of the previous month), so
 * the neighbouring months are searched and the match is made by comparing
 * shift(configured) with the date the app actually expects.
 */
function configuredDueDateFor(schedule: Schedule, nextDueDate: string | null): string | null {
  if (nextDueDate === null) return null;
  const base = checkedLocalDate(nextDueDate);
  for (let offset = -1; offset <= 1; offset += 1) {
    const total = base.month - 1 + offset;
    const year = base.year + Math.floor(total / 12);
    const month = (((total % 12) + 12) % 12) + 1;
    const candidate = clampedDueDate(schedule.dueDayOfMonth, year, month);
    if (shiftIncomeOffWeekend(candidate) === nextDueDate && candidate !== nextDueDate) {
      return candidate;
    }
  }
  return null;
}
