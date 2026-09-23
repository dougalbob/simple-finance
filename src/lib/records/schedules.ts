import { and, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import {
  categories,
  people,
  pots,
  purchases,
  receipts,
  scheduleInstances,
  schedules,
  suppliers,
  vehicles,
} from '../db/schema';
import { formatPence, isValidPenceAmount, MAX_ABS_PENCE } from '../money';
import { isValidLocalDate, startOfLocalDate, toLocalDateString } from '../time';
import {
  addDaysLocal,
  checkedLocalDate,
  clampedDueDate,
  daysBetween,
  shiftIncomeOffWeekend,
} from './dates';
import { VersionConflictError } from './errors';
import { PersonNotFoundError } from './people';
import { PotNotFoundError } from './pots';
import { createPurchase, type TargetKind } from './purchases';
import { createReceipt } from './receipts';
import {
  cleanSupplierName,
  createSupplierRecord,
  normalizeSupplierName,
  SupplierNotFoundError,
} from './suppliers';
import { VehicleNotFoundError } from './vehicles';

/**
 * Schedules and instances (docs/SPEC.md §11, §22.1): direct debits,
 * standing orders and expected receipts with the upcoming→converted
 * lifecycle (SPEC §11.2).
 *
 * Invariants enforced here and covered by tests (scenario E3):
 * - each instance is in exactly one state at any moment (the database
 *   CHECK constraint plus the read-check-update below, safe under the
 *   synchronous single-writer transaction assumption — decision 42);
 * - UNIQUE(schedule_id, due_date): one instance per schedule per date;
 * - conversion happens at local midnight on the due date, lazily — the app
 *   is not a cron daemon, so the read path (money-view.ts) runs the due
 *   pass first; conversion is idempotent and self-healing through the
 *   back-reference columns;
 * - edits apply from the next instance onward; converted history is never
 *   rewritten (SPEC §11.1);
 * - cancellation with an effective date: instances from that date stop
 *   existing, instances before it remain history (SPEC §11.2);
 * - a contract end date is informational + alert only — instances never
 *   auto-stop (SPEC §22.1);
 * - **income due dates shift off the weekend** (plan OQ2, resolved
 *   2026-09-23): an expected receipt whose configured day lands on a
 *   Saturday or Sunday is expected on the **previous Friday**, because pay
 *   lands before the weekend. Direct debits and standing orders keep the
 *   configured date.
 */

export type ScheduleKind = 'dd' | 'so' | 'receipt';
export type ScheduleFrequency = 'monthly' | 'annual';
export type Schedule = typeof schedules.$inferSelect;
export type ScheduleInstance = typeof scheduleInstances.$inferSelect;

/** Actor recorded on auto-converted records and conversion audits. */
export const SCHEDULE_ACTOR = 'system';
/** How far ahead instances are materialized (a little over a year: annual
 * schedules need next year's instance reachable for the projection). */
export const MATERIALIZATION_HORIZON_DAYS = 400;

export class ScheduleNotFoundError extends Error {
  constructor(scheduleId: number) {
    super(`No schedule with id ${scheduleId}`);
    this.name = 'ScheduleNotFoundError';
  }
}

export class InvalidScheduleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScheduleInputError';
  }
}

export class ScheduleCancelledError extends Error {
  constructor(scheduleId: number) {
    super(`Schedule ${scheduleId} is cancelled.`);
    this.name = 'ScheduleCancelledError';
  }
}

export const MAX_SCHEDULE_NAME_LENGTH = 60;

export interface CreateScheduleInput {
  name: string;
  kind: ScheduleKind;
  frequency: ScheduleFrequency;
  dueDayOfMonth: number;
  /** Required for annual schedules (which month it renews in). */
  dueMonth?: number | null;
  amountPence: number;
  potId: number;
  /** Leaf category for dd/so; null (required) for receipts. */
  categoryId?: number | null;
  /**
   * Canonical supplier for dd/so. Prefer an existing id; otherwise pass a
   * supplierName and the domain creates (or reuses) the supplier record.
   * Required for direct debits. Standing orders may omit both (household
   * transfer). Receipts must leave both null.
   */
  supplierId?: number | null;
  /** Inline new-supplier name from the recurring form (mutually exclusive with supplierId). */
  supplierName?: string | null;
  targetKind?: TargetKind;
  targetId?: number | null;
  /** Informational + alert only (SPEC §22.1); instances never auto-stop. */
  contractEndsOn?: string | null;
  /** Local date; defaults to today. May be backdated or future-dated. */
  activeFrom?: string;
  activeUntil?: string | null;
  actor: string;
  now?: Date;
}

export interface CreateScheduleResult {
  schedule: Schedule;
  /** Instances materialised by the immediate sync (informational). */
  materializedInstances: number;
}

export function createSchedule(db: Db, input: CreateScheduleInput): CreateScheduleResult {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const today = toLocalDateString(now);
  const activeFrom = input.activeFrom ?? today;

  const inserted = db.transaction((tx) => {
    const supplierId = resolveSupplierForSchedule(tx, {
      kind: input.kind,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      actor,
      now,
    });
    const effective = checkedScheduleFields(tx, {
      name: input.name,
      kind: input.kind,
      frequency: input.frequency,
      dueDayOfMonth: input.dueDayOfMonth,
      dueMonth: input.dueMonth ?? null,
      amountPence: input.amountPence,
      potId: input.potId,
      categoryId: input.categoryId ?? null,
      supplierId,
      targetKind: input.targetKind ?? 'household',
      targetId: input.targetId ?? null,
      contractEndsOn: input.contractEndsOn ?? null,
      activeFrom,
      activeUntil: input.activeUntil ?? null,
    });
    const row = tx
      .insert(schedules)
      .values({
        name: effective.name,
        kind: effective.kind,
        frequency: effective.frequency,
        dueDayOfMonth: effective.dueDayOfMonth,
        dueMonth: effective.dueMonth,
        amountPence: effective.amountPence,
        potId: effective.potId,
        categoryId: effective.categoryId,
        supplierId: effective.supplierId,
        targetKind: effective.targetKind,
        targetId: effective.targetId,
        contractEndsOn: effective.contractEndsOn,
        activeFrom: effective.activeFrom,
        activeUntil: effective.activeUntil,
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (row === undefined) throw new Error('insert schedule returned no row');
    recordAudit(tx, {
      actor,
      action: 'schedule.create',
      entity: 'schedule',
      entityId: row.id,
      summary: `Created ${effective.kind} schedule “${effective.name}” ${formatPence(effective.amountPence)} due day ${effective.dueDayOfMonth}${effective.frequency === 'annual' ? ` in month ${effective.dueMonth}` : ' every month'}`,
      after: row,
      now,
    });
    return row;
  });

  const materialized = syncScheduleInstances(db, inserted, now);
  return { schedule: inserted, materializedInstances: materialized };
}

export interface EditSchedulePatch {
  name?: string;
  amountPence?: number;
  dueDayOfMonth?: number;
  dueMonth?: number | null;
  frequency?: ScheduleFrequency;
  potId?: number;
  categoryId?: number | null;
  /** undefined = unchanged; null clears (standing order household transfer only). */
  supplierId?: number | null;
  /** Inline new-supplier name (mutually exclusive with supplierId). */
  supplierName?: string | null;
  targetKind?: TargetKind;
  targetId?: number | null;
  contractEndsOn?: string | null;
  /** undefined = unchanged; null = remove. */
  activeUntil?: string | null;
}

export interface EditScheduleInput {
  id: number;
  expectedVersion: number;
  actor: string;
  now?: Date;
  patch: EditSchedulePatch;
}

/**
 * Correct a schedule (SPEC §11.1): a changed amount/due day/category
 * applies **from the next instance onward** — converted history is never
 * rewritten. The upcoming instance set is regenerated; converted instances
 * are untouched.
 */
export function editSchedule(db: Db, input: EditScheduleInput): Schedule {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const patch = input.patch;

  const updated = db.transaction((tx) => {
    const current = tx.select().from(schedules).where(eq(schedules.id, input.id)).get();
    if (current === undefined) throw new ScheduleNotFoundError(input.id);
    if (current.cancelledAt !== null) throw new ScheduleCancelledError(input.id);
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('schedule', input.id, input.expectedVersion, current.version);
    }
    const supplierId = resolveSupplierForScheduleEdit(tx, current, patch, actor, now);
    const effective = checkedScheduleFields(tx, {
      name: patch.name ?? current.name,
      kind: current.kind,
      frequency: patch.frequency ?? current.frequency,
      dueDayOfMonth: patch.dueDayOfMonth ?? current.dueDayOfMonth,
      dueMonth: patch.dueMonth === undefined ? current.dueMonth : patch.dueMonth,
      amountPence: patch.amountPence ?? current.amountPence,
      potId: patch.potId ?? current.potId,
      categoryId: patch.categoryId === undefined ? current.categoryId : patch.categoryId,
      supplierId,
      targetKind: patch.targetKind ?? current.targetKind,
      targetId: patch.targetId === undefined ? current.targetId : patch.targetId,
      contractEndsOn:
        patch.contractEndsOn === undefined ? current.contractEndsOn : patch.contractEndsOn,
      activeFrom: current.activeFrom,
      activeUntil: patch.activeUntil === undefined ? current.activeUntil : patch.activeUntil,
    });
    const row = tx
      .update(schedules)
      .set({
        name: effective.name,
        frequency: effective.frequency,
        dueDayOfMonth: effective.dueDayOfMonth,
        dueMonth: effective.dueMonth,
        amountPence: effective.amountPence,
        potId: effective.potId,
        categoryId: effective.categoryId,
        supplierId: effective.supplierId,
        targetKind: effective.targetKind,
        targetId: effective.targetId,
        contractEndsOn: effective.contractEndsOn,
        activeUntil: effective.activeUntil,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(schedules.id, current.id))
      .returning()
      .get();
    if (row === undefined) throw new Error('update schedule returned no row');
    recordAudit(tx, {
      actor,
      action: 'schedule.edit',
      entity: 'schedule',
      entityId: current.id,
      summary: `Edited schedule “${current.name}” (applies from the next instance)`,
      before: current,
      after: row,
      now,
    });
    return row;
  });

  syncScheduleInstances(db, updated, now, { regenerateFromToday: true }); // a cadence change moves the NEXT instance (SPEC §11.1), no backfill
  return updated;
}

export interface CancelScheduleInput {
  id: number;
  expectedVersion: number;
  /** Local date; instances from this date stop existing (SPEC §11.2). */
  effectiveOn: string;
  actor: string;
  now?: Date;
}

export function cancelSchedule(db: Db, input: CancelScheduleInput): Schedule {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const effectiveOn = checkedDate(input.effectiveOn, 'cancellation date');

  const updated = db.transaction((tx) => {
    const current = tx.select().from(schedules).where(eq(schedules.id, input.id)).get();
    if (current === undefined) throw new ScheduleNotFoundError(input.id);
    if (current.cancelledAt !== null) throw new ScheduleCancelledError(input.id);
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('schedule', input.id, input.expectedVersion, current.version);
    }
    const row = tx
      .update(schedules)
      .set({
        cancelledAt: now,
        cancelledEffectiveOn: effectiveOn,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(schedules.id, current.id))
      .returning()
      .get();
    if (row === undefined) throw new Error('update schedule returned no row');
    recordAudit(tx, {
      actor,
      action: 'schedule.cancel',
      entity: 'schedule',
      entityId: current.id,
      summary: `Cancelled schedule “${current.name}” effective ${effectiveOn} (instances from that date stop; history kept)`,
      before: current,
      after: row,
      now,
    });
    return row;
  });

  syncScheduleInstances(db, updated, now);
  return updated;
}

export function getSchedule(db: Db, scheduleId: number): Schedule {
  const row = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
  if (row === undefined) throw new ScheduleNotFoundError(scheduleId);
  return row;
}

export interface ScheduleWithNext {
  schedule: Schedule;
  /** Next due date strictly after today, or null when cancelled/expired. */
  nextDueDate: string | null;
}

export function listSchedules(db: Db, nowArg?: Date): ScheduleWithNext[] {
  const now = nowArg ?? new Date();
  const today = toLocalDateString(now);
  return db
    .select()
    .from(schedules)
    .all()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((schedule) => ({ schedule, nextDueDate: nextDueDateAfter(schedule, today) }));
}

/**
 * Schedules carrying a fixed-term contract end (SPEC §22.1), soonest end date
 * first, for the Contracts & Renewals page. Cancelled schedules are excluded:
 * once cancelled they no longer generate instances, so their end date is
 * history rather than something to act on.
 */
export interface ScheduleContractEnd {
  id: number;
  name: string;
  kind: 'dd' | 'so' | 'receipt';
  frequency: 'monthly' | 'annual';
  amountPence: number;
  contractEndsOn: string;
  supplierId: number | null;
}

export function listSchedulesWithContractEnds(db: Db): ScheduleContractEnd[] {
  return db
    .select({
      id: schedules.id,
      name: schedules.name,
      kind: schedules.kind,
      frequency: schedules.frequency,
      amountPence: schedules.amountPence,
      contractEndsOn: schedules.contractEndsOn,
      supplierId: schedules.supplierId,
    })
    .from(schedules)
    .where(and(isNotNull(schedules.contractEndsOn), isNull(schedules.cancelledAt)))
    .orderBy(schedules.contractEndsOn)
    .all()
    .filter((row): row is ScheduleContractEnd => row.contractEndsOn !== null);
}

export interface InstanceFilters {
  from?: string;
  through?: string;
  state?: 'upcoming' | 'converted';
  scheduleId?: number;
  /** Default 500, capped at 2000 — household scale. */
  limit?: number;
}

export interface InstanceWithSchedule {
  instance: ScheduleInstance;
  scheduleName: string;
  scheduleKind: ScheduleKind;
  potId: number;
  amountPence: number;
}

export function listInstances(db: Db, filters: InstanceFilters = {}): InstanceWithSchedule[] {
  if (filters.from !== undefined && !isValidLocalDate(filters.from)) {
    throw new InvalidScheduleInputError(`Invalid from date: ${filters.from}`);
  }
  if (filters.through !== undefined && !isValidLocalDate(filters.through)) {
    throw new InvalidScheduleInputError(`Invalid through date: ${filters.through}`);
  }
  const conditions = [];
  if (filters.scheduleId !== undefined) {
    conditions.push(eq(scheduleInstances.scheduleId, filters.scheduleId));
  }
  if (filters.state !== undefined) {
    conditions.push(eq(scheduleInstances.state, filters.state));
  }
  if (filters.from !== undefined) {
    conditions.push(gte(scheduleInstances.dueDate, filters.from));
  }
  if (filters.through !== undefined) {
    conditions.push(lte(scheduleInstances.dueDate, filters.through));
  }
  const limit = Math.min(Math.max(filters.limit ?? 500, 1), 2000);
  const rows = db
    .select({
      instance: scheduleInstances,
      scheduleName: schedules.name,
      scheduleKind: schedules.kind,
      potId: schedules.potId,
      amountPence: schedules.amountPence,
    })
    .from(scheduleInstances)
    .innerJoin(schedules, eq(schedules.id, scheduleInstances.scheduleId))
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(scheduleInstances.dueDate)
    .limit(limit)
    .all();
  return rows;
}

/**
 * The next due date of a schedule strictly after `afterDate`, honouring the
 * active window and cancellation. Pure date arithmetic with plan OQ1/OQ13
 * clamping. Bounded search: 14 months for monthly, 3 years for annual.
 */
export function nextDueDateAfter(schedule: Schedule, afterDate: string): string | null {
  const start = checkedLocalDate(afterDate);
  const upper = scheduleUpperBound(schedule, null);
  if (upper !== null && upper <= afterDate) return null;

  if (schedule.frequency === 'monthly') {
    for (let step = 0; step <= 14; step += 1) {
      const year = start.year + Math.floor((start.month - 1 + step) / 12);
      const month = ((start.month - 1 + step) % 12) + 1;
      const candidate = dueDateForPeriod(schedule, year, month);
      if (candidate > afterDate && (upper === null || candidate <= upper)) return candidate;
    }
    return null;
  }
  if (schedule.dueMonth === null) return null; // annual without a month: malformed row
  for (let year = start.year; year <= start.year + 3; year += 1) {
    const candidate = dueDateForPeriod(schedule, year, schedule.dueMonth);
    if (candidate > afterDate && (upper === null || candidate <= upper)) return candidate;
  }
  return null;
}

/**
 * Materialize a schedule's instances: idempotent inserts of missing due
 * dates inside the effective window, and removal of stale upcoming rows
 * (after an edit or cancellation). Converted instances are never touched —
 * history is history (SPEC §11.1).
 *
 * Rows are derived data (re-derivable from the schedule), so deletion is
 * the honest form of "instances stop existing" (SPEC §11.2); the schedule's
 * own cancel/edit audit entries are the retained record.
 *
 * Returns the number of rows inserted.
 */
/**
 * @param options.regenerateFromToday When true (schedule EDITS), the
 *   upcoming set is regenerated from the schedule's CURRENT cadence
 *   starting today — so a changed due day moves the next instance
 *   (SPEC §11.1 "applies from the next instance onward") and no past
 *   dates are backfilled under the new cadence. Creation and the daily
 *   pass keep history-based materialization (an activeFrom in the past
 *   still yields its real, already-occurred instances).
 */
export function syncScheduleInstances(
  db: Db,
  schedule: Schedule,
  nowArg?: Date,
  options: { regenerateFromToday?: boolean } = {},
): number {
  const now = nowArg ?? new Date();
  const today = toLocalDateString(now);
  const upper = scheduleUpperBound(schedule, today);

  // First due date that can still matter: after the latest converted
  // instance (history) and never before the schedule became active.
  const lastConverted = db
    .select({ dueDate: scheduleInstances.dueDate })
    .from(scheduleInstances)
    .where(
      and(eq(scheduleInstances.scheduleId, schedule.id), eq(scheduleInstances.state, 'converted')),
    )
    .all()
    .map((row) => row.dueDate)
    .sort()
    .at(-1);
  const lower =
    lastConverted === undefined
      ? schedule.activeFrom
      : addDaysLocal(lastConverted, 1) > schedule.activeFrom
        ? addDaysLocal(lastConverted, 1)
        : schedule.activeFrom;

  const existing = db
    .select({ dueDate: scheduleInstances.dueDate })
    .from(scheduleInstances)
    .where(
      and(eq(scheduleInstances.scheduleId, schedule.id), eq(scheduleInstances.state, 'upcoming')),
    )
    .all()
    .map((row) => row.dueDate)
    .sort();

  if (options.regenerateFromToday === true) {
    // A cadence change must reach the next instance: generate the whole
    // remaining window from the CURRENT fields. Dates strictly before
    // today are never materialised on an edit — the old cadence already
    // ran (or never ran) there, and backfilling would invent history.
    const startForNew = today > lower ? today : lower;
    const desired =
      upper === null || startForNew > upper ? [] : dueDatesBetween(schedule, startForNew, upper);
    const existingSet = new Set(existing);
    const desiredSet = new Set(desired);
    const toInsert = desired.filter((date) => !existingSet.has(date));
    const toDelete = existing.filter((date) => !desiredSet.has(date));
    if (toInsert.length === 0 && toDelete.length === 0) return 0;
    return db.transaction((tx) => {
      if (toDelete.length > 0) {
        tx.delete(scheduleInstances)
          .where(
            and(
              eq(scheduleInstances.scheduleId, schedule.id),
              inArray(scheduleInstances.dueDate, toDelete),
            ),
          )
          .run();
      }
      for (const dueDate of toInsert) {
        tx.insert(scheduleInstances)
          .values({ scheduleId: schedule.id, dueDate })
          .onConflictDoNothing()
          .run();
      }
      recordAudit(tx, {
        actor: SCHEDULE_ACTOR,
        action: 'schedule.sync',
        entity: 'schedule',
        entityId: schedule.id,
        summary: `Resynced instances for “${schedule.name}” after edit: +${toInsert.length} upcoming, −${toDelete.length}`,
        after: { toInsert, toDelete },
        now,
      });
      return toInsert.length;
    });
  }

  // The desired set = what already exists inside the window plus new due
  // dates AFTER the last existing instance. Generating only the tail keeps
  // the window bounded by the horizon even when the schedule started far
  // in the past (its history is already materialized).
  const inWindow =
    upper === null
      ? existing.filter((date) => date >= lower)
      : existing.filter((date) => date >= lower && date <= upper);
  // Income only: an upcoming instance still sitting on a Saturday or Sunday
  // was materialized before the payday rule, or before a due-day edit moved
  // the configured day onto a weekend. Move it to its Friday here — upcoming
  // rows are derived data, and leaving one would expect money on a day the
  // app no longer believes in. Converted instances are never touched.
  const relevantExisting =
    schedule.kind === 'receipt'
      ? [...new Set(inWindow.map((date) => shiftIncomeOffWeekend(date)))]
      : inWindow;
  const lastExisting = relevantExisting.at(-1);
  const startForNew = lastExisting === undefined ? lower : addDaysLocal(lastExisting, 1);
  let desired: string[] = [...relevantExisting];
  if (upper !== null && startForNew <= upper) {
    desired.push(...dueDatesBetween(schedule, startForNew, upper));
  }
  desired = [...new Set(desired)];
  const existingSet = new Set(existing);
  const desiredSet = new Set(desired);
  const toInsert = desired.filter((date) => !existingSet.has(date));
  const toDelete = existing.filter((date) => !desiredSet.has(date));
  if (toInsert.length === 0 && toDelete.length === 0) return 0;

  return db.transaction((tx) => {
    if (toDelete.length > 0) {
      tx.delete(scheduleInstances)
        .where(
          and(
            eq(scheduleInstances.scheduleId, schedule.id),
            inArray(scheduleInstances.dueDate, toDelete),
          ),
        )
        .run();
    }
    for (const dueDate of toInsert) {
      tx.insert(scheduleInstances)
        .values({ scheduleId: schedule.id, dueDate })
        .onConflictDoNothing()
        .run();
    }
    recordAudit(tx, {
      actor: SCHEDULE_ACTOR,
      action: 'schedule.sync',
      entity: 'schedule',
      entityId: schedule.id,
      summary: `Synced instances for “${schedule.name}”: +${toInsert.length} upcoming, −${toDelete.length}`,
      after: { toInsert, toDelete },
      now,
    });
    return toInsert.length;
  });
}

/**
 * The lazy due pass (SPEC §11.2): materialize instances for every
 * schedule, then convert every upcoming instance whose local midnight has
 * arrived. Conversion is idempotent: a record already back-referencing the
 * instance (e.g. the previous run crashed between the two writes) repairs
 * the link instead of converting twice.
 *
 * Returns the number of instances converted this pass.
 */
export function materializeAndConvert(db: Db, nowArg?: Date): number {
  const now = nowArg ?? new Date();
  const today = toLocalDateString(now);
  const all = db.select().from(schedules).all();
  for (const schedule of all) {
    syncScheduleInstances(db, schedule, now);
  }
  const due = db
    .select()
    .from(scheduleInstances)
    .where(and(eq(scheduleInstances.state, 'upcoming'), lte(scheduleInstances.dueDate, today)))
    .all();
  let converted = 0;
  for (const instance of due) {
    if (convertInstance(db, instance, now)) converted += 1;
  }
  return converted;
}

function convertInstance(db: Db, instance: ScheduleInstance, now: Date): boolean {
  const schedule = getSchedule(db, instance.scheduleId);
  const dueInstant = startOfLocalDate(instance.dueDate);

  if (schedule.kind === 'receipt') {
    const existing = db
      .select()
      .from(receipts)
      .where(eq(receipts.scheduleInstanceId, instance.id))
      .get();
    if (existing !== undefined) {
      return markConverted(db, instance.id, 'receipt', existing.id, now);
    }
    const receipt = createReceipt(db, {
      scheduleInstanceId: instance.id,
      potId: schedule.potId,
      amountPence: schedule.amountPence,
      occurredAt: dueInstant,
      occurredDate: instance.dueDate,
      note: `From schedule “${schedule.name}”`,
      actor: SCHEDULE_ACTOR,
      now,
    });
    return markConverted(db, instance.id, 'receipt', receipt.id, now);
  }

  const existing = db
    .select()
    .from(purchases)
    .where(eq(purchases.scheduleInstanceId, instance.id))
    .get();
  if (existing !== undefined) {
    return markConverted(db, instance.id, 'purchase', existing.id, now);
  }
  if (schedule.categoryId === null) {
    throw new InvalidScheduleInputError(
      `Schedule “${schedule.name}” has no category — a direct debit or standing order must point at a leaf category before it can convert.`,
    );
  }
  const purchase = createPurchase(db, {
    supplierId: schedule.supplierId,
    potId: schedule.potId,
    totalPence: schedule.amountPence,
    paidByPersonId: null,
    occurredAt: dueInstant,
    occurredDate: instance.dueDate,
    note: `From schedule “${schedule.name}”`,
    scheduleInstanceId: instance.id,
    lines: [
      {
        amountPence: schedule.amountPence,
        categoryId: schedule.categoryId,
        targetKind: schedule.targetKind,
        targetId: schedule.targetId,
      },
    ],
    actor: SCHEDULE_ACTOR,
    now,
  });
  return markConverted(db, instance.id, 'purchase', purchase.purchase.id, now);
}

function markConverted(
  db: Db,
  instanceId: number,
  kind: 'purchase' | 'receipt',
  recordId: number,
  now: Date,
): boolean {
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(scheduleInstances)
      .where(eq(scheduleInstances.id, instanceId))
      .get();
    if (current === undefined) return false;
    if (current.state === 'converted') {
      // Idempotent: the link already points at this record — nothing to do.
      return current.convertedRecordKind === kind && current.convertedRecordId === recordId;
    }
    tx.update(scheduleInstances)
      .set({
        state: 'converted',
        convertedRecordKind: kind,
        convertedRecordId: recordId,
        convertedAt: now,
      })
      .where(eq(scheduleInstances.id, instanceId))
      .run();
    const schedule = tx.select().from(schedules).where(eq(schedules.id, current.scheduleId)).get();
    recordAudit(tx, {
      actor: SCHEDULE_ACTOR,
      action: 'schedule.convert',
      entity: 'schedule_instance',
      entityId: instanceId,
      summary: `Converted “${schedule?.name ?? `schedule ${current.scheduleId}`}” due ${current.dueDate} into a ${kind} #${recordId}`,
      before: current,
      after: { state: 'converted', convertedRecordKind: kind, convertedRecordId: recordId },
      now,
    });
    return true;
  });
}

/**
 * The date one period's instance actually carries: the configured day
 * clamped into the month (plan OQ1), then — for income only — moved off a
 * weekend onto the previous Friday (plan OQ2, resolved 2026-09-23).
 */
function dueDateForPeriod(schedule: Schedule, year: number, month: number): string {
  const clamped = clampedDueDate(schedule.dueDayOfMonth, year, month);
  return schedule.kind === 'receipt' ? shiftIncomeOffWeekend(clamped) : clamped;
}

/**
 * `dueDateForPeriod` gated by a window. Membership is decided by the
 * **configured** date, never the shifted one, so a payday that moves back
 * onto the previous Friday is never dropped for falling just before the
 * window's start — one instance per period, always.
 */
function candidateForPeriod(
  schedule: Schedule,
  year: number,
  month: number,
  fromDate: string,
  throughDate: string,
): string[] {
  const configured = clampedDueDate(schedule.dueDayOfMonth, year, month);
  if (configured < fromDate || configured > throughDate) return [];
  return [dueDateForPeriod(schedule, year, month)];
}

function dueDatesBetween(schedule: Schedule, fromDate: string, throughDate: string): string[] {
  const start = checkedLocalDate(fromDate);
  const end = checkedLocalDate(throughDate);
  if (daysBetween(fromDate, throughDate) > 1500) {
    throw new InvalidScheduleInputError('Schedule window is too large to materialize.');
  }
  const result: string[] = [];
  const guardLimit = 1500;
  if (schedule.frequency === 'monthly') {
    let year = start.year;
    let month = start.month;
    let guard = 0;
    while ((year < end.year || (year === end.year && month <= end.month)) && guard < guardLimit) {
      result.push(...candidateForPeriod(schedule, year, month, fromDate, throughDate));
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      guard += 1;
    }
  } else {
    if (schedule.dueMonth === null) return result;
    let guard = 0;
    for (let year = start.year; year <= end.year + 1 && guard < guardLimit; year += 1) {
      result.push(...candidateForPeriod(schedule, year, schedule.dueMonth, fromDate, throughDate));
      guard += 1;
    }
  }
  return result;
}

/**
 * The last date instances may exist for: the earlier of the active-window
 * end and the day before the cancellation effective date (instances from
 * that date stop existing — SPEC §11.2). `today` additionally bounds the
 * materialization look-ahead to the horizon.
 */
function scheduleUpperBound(schedule: Schedule, today: string | null): string | null {
  let upper: string | null = null;
  if (schedule.activeUntil !== null) upper = schedule.activeUntil;
  if (schedule.cancelledEffectiveOn !== null) {
    const cancelBound = addDaysLocal(schedule.cancelledEffectiveOn, -1);
    if (upper === null || cancelBound < upper) upper = cancelBound;
  }
  if (today === null) return upper; // pure next-due queries: no end → unbounded (search is bounded)
  // Materialization always stops at the horizon, even for open-ended
  // schedules — that is what "no activeUntil" means in practice.
  const horizon = addDaysLocal(today, MATERIALIZATION_HORIZON_DAYS);
  return upper === null ? horizon : upper < horizon ? upper : horizon;
}

interface CheckedFields {
  name: string;
  kind: ScheduleKind;
  frequency: ScheduleFrequency;
  dueDayOfMonth: number;
  dueMonth: number | null;
  amountPence: number;
  potId: number;
  categoryId: number | null;
  supplierId: number | null;
  targetKind: TargetKind;
  targetId: number | null;
  contractEndsOn: string | null;
  activeFrom: string;
  activeUntil: string | null;
}

function checkedScheduleFields(
  db: Db | DbTx,
  input: {
    name: string;
    kind: ScheduleKind;
    frequency: ScheduleFrequency;
    dueDayOfMonth: number;
    dueMonth: number | null;
    amountPence: number;
    potId: number;
    categoryId: number | null;
    supplierId: number | null;
    targetKind: TargetKind;
    targetId: number | null;
    contractEndsOn: string | null;
    activeFrom: string;
    activeUntil: string | null;
  },
): CheckedFields {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name === '') throw new InvalidScheduleInputError('Give the schedule a name.');
  if (name.length > MAX_SCHEDULE_NAME_LENGTH) {
    throw new InvalidScheduleInputError(
      `Keep the name to ${MAX_SCHEDULE_NAME_LENGTH} characters or fewer.`,
    );
  }
  if (input.kind !== 'dd' && input.kind !== 'so' && input.kind !== 'receipt') {
    throw new InvalidScheduleInputError(
      'Choose a schedule type: direct debit, standing order or expected receipt.',
    );
  }
  if (input.frequency !== 'monthly' && input.frequency !== 'annual') {
    throw new InvalidScheduleInputError('Choose monthly or annual.');
  }
  if (
    !Number.isInteger(input.dueDayOfMonth) ||
    input.dueDayOfMonth < 1 ||
    input.dueDayOfMonth > 31
  ) {
    throw new InvalidScheduleInputError('The due day must be between 1 and 31.');
  }
  if (
    input.frequency === 'annual' &&
    (input.dueMonth === null || input.dueMonth < 1 || input.dueMonth > 12)
  ) {
    throw new InvalidScheduleInputError('Annual schedules need a due month.');
  }
  if (input.frequency === 'monthly' && input.dueMonth !== null) {
    throw new InvalidScheduleInputError(
      'Monthly schedules are due every month — no due month needed.',
    );
  }
  if (
    !isValidPenceAmount(input.amountPence) ||
    input.amountPence <= 0 ||
    input.amountPence > MAX_ABS_PENCE
  ) {
    throw new InvalidScheduleInputError('The amount must be a positive whole-pence figure.');
  }
  const activeFrom = checkedDate(input.activeFrom, 'active-from date');
  const activeUntil =
    input.activeUntil === null ? null : checkedDate(input.activeUntil, 'active-until date');
  if (activeUntil !== null && activeUntil < activeFrom) {
    throw new InvalidScheduleInputError(
      'The active-until date cannot be before the active-from date.',
    );
  }
  const contractEndsOn =
    input.contractEndsOn === null ? null : checkedDate(input.contractEndsOn, 'contract end date');

  assertPotExists(db, input.potId);
  if (input.kind === 'receipt') {
    if (input.categoryId !== null) {
      throw new InvalidScheduleInputError(
        'Expected receipts have no category — income is not spending.',
      );
    }
    if (input.supplierId !== null) {
      throw new InvalidScheduleInputError(
        'Expected receipts have no supplier — income is not spending.',
      );
    }
  } else {
    assertLiveLeafCategory(db, input.categoryId);
    if (input.kind === 'dd' && input.supplierId === null) {
      throw new InvalidScheduleInputError(
        'Choose a supplier for the direct debit, or add a new one by name.',
      );
    }
    if (input.supplierId !== null) {
      assertSupplierExists(db, input.supplierId);
    }
  }
  assertTarget(db, input.targetKind, input.targetId);

  return {
    name,
    kind: input.kind,
    frequency: input.frequency,
    dueDayOfMonth: input.dueDayOfMonth,
    dueMonth: input.frequency === 'annual' ? (input.dueMonth as number) : null,
    amountPence: input.amountPence,
    potId: input.potId,
    categoryId: input.categoryId,
    supplierId: input.kind === 'receipt' ? null : input.supplierId,
    targetKind: input.targetKind,
    targetId: input.targetKind === 'household' ? null : input.targetId,
    contractEndsOn,
    activeFrom,
    activeUntil,
  };
}

/**
 * Resolve the canonical supplier for a new schedule. Direct debits need one
 * (by id or by inline name); standing orders may omit both for a household
 * transfer; receipts never carry a supplier.
 */
function resolveSupplierForSchedule(
  tx: DbTx,
  input: {
    kind: ScheduleKind;
    supplierId?: number | null;
    supplierName?: string | null;
    actor: string;
    now: Date;
  },
): number | null {
  if (input.kind === 'receipt') {
    if (
      (input.supplierId !== undefined && input.supplierId !== null) ||
      (input.supplierName !== undefined &&
        input.supplierName !== null &&
        input.supplierName.trim() !== '')
    ) {
      throw new InvalidScheduleInputError(
        'Expected receipts have no supplier — income is not spending.',
      );
    }
    return null;
  }
  const hasId = input.supplierId !== undefined && input.supplierId !== null;
  const cleanName = cleanSupplierName(input.supplierName);
  if (hasId && cleanName !== null) {
    throw new InvalidScheduleInputError('Give the supplier by name or by id, not both.');
  }
  if (cleanName !== null) {
    const existing = tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.normalizedName, normalizeSupplierName(cleanName)))
      .get();
    if (existing !== undefined) return existing.id;
    return createSupplierRecord(tx, { name: cleanName, actor: input.actor, now: input.now }).id;
  }
  if (hasId) {
    assertSupplierExists(tx, input.supplierId as number);
    return input.supplierId as number;
  }
  return null;
}

function resolveSupplierForScheduleEdit(
  tx: DbTx,
  current: Schedule,
  patch: EditSchedulePatch,
  actor: string,
  now: Date,
): number | null {
  if (patch.supplierId === undefined && patch.supplierName === undefined) {
    return current.supplierId;
  }
  return resolveSupplierForSchedule(tx, {
    kind: current.kind,
    supplierId: patch.supplierId,
    supplierName: patch.supplierName,
    actor,
    now,
  });
}

function assertSupplierExists(db: Db | DbTx, supplierId: number): void {
  const row = db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .get();
  if (row === undefined) throw new SupplierNotFoundError(supplierId);
}

function assertPotExists(db: Db | DbTx, potId: number): void {
  const row = db.select({ id: pots.id }).from(pots).where(eq(pots.id, potId)).get();
  if (row === undefined) throw new PotNotFoundError(potId);
}

function assertLiveLeafCategory(db: Db | DbTx, categoryId: number | null): void {
  if (categoryId === null) {
    throw new InvalidScheduleInputError(
      'Choose a category for the direct debit or standing order.',
    );
  }
  const category = db.select().from(categories).where(eq(categories.id, categoryId)).get();
  if (category === undefined) {
    throw new InvalidScheduleInputError('The chosen category does not exist.');
  }
  if (category.parentId === null) {
    throw new InvalidScheduleInputError(
      'Choose a child (leaf) category — schedules pay into one specific category.',
    );
  }
  if (category.retiredAt !== null) {
    throw new InvalidScheduleInputError(`“${category.name}” is retired — pick a current category.`);
  }
}

function assertTarget(db: Db | DbTx, targetKind: TargetKind, targetId: number | null): void {
  if (targetKind === 'household') return;
  if (targetId === null) {
    throw new InvalidScheduleInputError(
      'A schedule that is for a person or vehicle needs that person or vehicle chosen.',
    );
  }
  if (targetKind === 'person') {
    const person = db.select({ id: people.id }).from(people).where(eq(people.id, targetId)).get();
    if (person === undefined) throw new PersonNotFoundError(targetId);
  } else {
    const vehicle = db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, targetId))
      .get();
    if (vehicle === undefined) throw new VehicleNotFoundError(targetId);
  }
}

function checkedDate(raw: string, label: string): string {
  if (!isValidLocalDate(raw)) {
    throw new InvalidScheduleInputError(`The ${label} must be a date like 2026-09-20.`);
  }
  return raw;
}

function checkedActor(raw: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new InvalidScheduleInputError('Every schedule records who created it.');
  }
  return raw.trim();
}
