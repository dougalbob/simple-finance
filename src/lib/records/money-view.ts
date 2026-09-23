import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  externalMovements,
  pots,
  purchases,
  receipts,
  scheduleInstances,
  schedules,
  transfers,
} from '../db/schema';
import { toLocalDateString } from '../time';
import { addDaysLocal, daysBetween } from './dates';
import {
  estimatePot,
  householdEstimatePence,
  type PotEstimateResult,
  type SignedMovement,
} from './estimates';
import { computeKeyDateAlerts, type KeyDateAlert, type KeyDateItem } from './keydates';
import {
  projectToPayday,
  type PotWatchInput,
  type ProjectionResult,
  type ProjectionScheduleLine,
} from './projection';
import {
  getMonthlyFuelByVehicle,
  getContractEndWarningLeadDays,
  getWeeklyGroceriesPence,
} from './settings';
import { advanceDueRenewals, listRenewals } from './renewals';
import { debtsSummary, type DebtsSummary } from './debts';
import { listSchedules, materializeAndConvert, type ScheduleKind } from './schedules';
import { latestCheckpointPerPot, listPots, type Checkpoint, type Pot } from './pots';
import { listPeople } from './people';
import { listVehicles } from './vehicles';

/**
 * The read-side money view (docs/SPEC.md §7, §15.2): assembles pure engine
 * inputs from the database and runs the lazy due pass first, so the
 * estimate, projection, due lists and key dates the UI renders always
 * reflect the converted state (SPEC §11.2: "at no instant is the instance
 * in two states").
 *
 * Everything here is a pure query + engine call — no writes except the
 * idempotent due pass (conversions + renewal advances), which is what the
 * app does instead of a cron daemon.
 */

export interface PotMoneyView {
  pot: Pot;
  estimatePence: number | null;
  latestCheckpoint: Checkpoint | null;
  estimate: PotEstimateResult;
}

export interface MoneySnapshot {
  asOf: Date;
  pots: PotMoneyView[];
  householdAvailablePence: number | null;
  /** Pots that have never been checkpointed — no estimate, ever. */
  uncheckpointedPotIds: number[];
  /** What the household owes others / is owed — beside "available now", never netted (SPEC §10.2). */
  debts: DebtsSummary;
}

export interface EnsureStateResult {
  convertedInstances: number;
  advancedRenewals: number;
}

/**
 * Run the lazy due pass (SPEC §11.2): convert every schedule instance whose
 * local midnight has arrived and advance every due repeating renewal.
 * Idempotent — safe to call on every read.
 */
export function ensureScheduleState(db: Db, nowArg?: Date): EnsureStateResult {
  const now = nowArg ?? new Date();
  const convertedInstances = materializeAndConvert(db, now);
  const advancedRenewals = advanceDueRenewals(db, now);
  return { convertedInstances, advancedRenewals };
}

/**
 * The per-pot and household "available now" estimates (SPEC §7.1).
 * Runs the due pass first so converted schedule records are included.
 */
export function getMoneySnapshot(db: Db, nowArg?: Date): MoneySnapshot {
  const now = nowArg ?? new Date();
  ensureScheduleState(db, now);

  const potList = listPots(db);
  const latest = latestCheckpointPerPot(db);

  const purchaseRows = db
    .select({
      potId: purchases.potId,
      totalPence: purchases.totalPence,
      occurredAt: purchases.occurredAt,
      occurredDate: purchases.occurredDate,
    })
    .from(purchases)
    .where(isNull(purchases.voidedAt))
    .all();
  const transferRows = db.select().from(transfers).where(isNull(transfers.voidedAt)).all();
  const receiptRows = db
    .select({
      potId: receipts.potId,
      amountPence: receipts.amountPence,
      occurredAt: receipts.occurredAt,
      occurredDate: receipts.occurredDate,
    })
    .from(receipts)
    .where(isNull(receipts.voidedAt))
    .all();

  const byPot = new Map<number, SignedMovement[]>();
  const push = (potId: number, movement: SignedMovement) => {
    const list = byPot.get(potId) ?? [];
    list.push(movement);
    byPot.set(potId, list);
  };
  // Spending: purchases add, refunds subtract → signed = −totalPence.
  for (const row of purchaseRows) {
    push(row.potId, {
      signedPence: -row.totalPence,
      occurredAt: row.occurredAt,
      occurredDate: row.occurredDate,
    });
  }
  // Transfers: two legs, household net zero by construction (SPEC §10).
  for (const row of transferRows) {
    push(row.fromPotId, {
      signedPence: -row.amountPence,
      occurredAt: row.occurredAt,
      occurredDate: row.occurredDate,
    });
    push(row.toPotId, {
      signedPence: row.amountPence,
      occurredAt: row.occurredAt,
      occurredDate: row.occurredDate,
    });
  }
  // Receipts: income adds (SPEC §11.3).
  for (const row of receiptRows) {
    push(row.potId, {
      signedPence: row.amountPence,
      occurredAt: row.occurredAt,
      occurredDate: row.occurredDate,
    });
  }
  // External movements: money in adds like a receipt, money out subtracts
  // like spending (SPEC §10.2) — the household total genuinely moves.
  const externalRows = db
    .select({
      potId: externalMovements.potId,
      direction: externalMovements.direction,
      amountPence: externalMovements.amountPence,
      occurredAt: externalMovements.occurredAt,
      occurredDate: externalMovements.occurredDate,
    })
    .from(externalMovements)
    .where(isNull(externalMovements.voidedAt))
    .all();
  for (const row of externalRows) {
    push(row.potId, {
      signedPence: row.direction === 'in' ? row.amountPence : -row.amountPence,
      occurredAt: row.occurredAt,
      occurredDate: row.occurredDate,
    });
  }

  const pots: PotMoneyView[] = potList.map((pot) => {
    const checkpoint = latest.get(pot.id) ?? null;
    const estimate = estimatePot({
      potId: pot.id,
      checkpoint:
        checkpoint === null
          ? null
          : { amountPence: checkpoint.amountPence, effectiveAt: checkpoint.effectiveAt },
      movements: byPot.get(pot.id) ?? [],
    });
    return { pot, estimatePence: estimate.estimatePence, latestCheckpoint: checkpoint, estimate };
  });

  return {
    asOf: now,
    pots,
    householdAvailablePence: householdEstimatePence(pots.map((pot) => pot.estimate)),
    uncheckpointedPotIds: pots.filter((pot) => pot.estimatePence === null).map((pot) => pot.pot.id),
    debts: debtsSummary(db),
  };
}

export interface ProjectionLine extends ProjectionScheduleLine {
  potLabel: string;
  scheduleKind: ScheduleKind;
}

export interface ProjectionView {
  snapshot: MoneySnapshot;
  result: ProjectionResult;
  /** The income schedule defining the planning cycle (SPEC §11.3). */
  paydayScheduleName: string | null;
  paydayScheduleId: number | null;
  commitmentLines: ProjectionLine[];
  receiptLines: ProjectionLine[];
  /** Estimates of pots other than each watch pot — for the "Salary account holds £X" clause. */
  potLabels: Map<number, string>;
  otherPotEstimates: Map<number, number>;
}

/**
 * The to-payday projection view (SPEC §7.2–§7.5, §8). Returns null when no
 * pot has been checkpointed — with no estimate there is nothing to project
 * and the UI must say so rather than imply a figure.
 */
export function getProjectionView(db: Db, nowArg?: Date): ProjectionView | null {
  const now = nowArg ?? new Date();
  const snapshot = getMoneySnapshot(db, now);
  if (snapshot.householdAvailablePence === null) return null;

  const today = toLocalDateString(now);
  const potLabel = new Map(snapshot.pots.map((pot) => [pot.pot.id, pot.pot.label]));

  // The payday is the next expected-receipt due date (SPEC §11.3). After the
  // due pass, every unconverted instance is strictly in the future.
  const receiptInstances = db
    .select({
      instance: scheduleInstances,
      scheduleName: schedules.name,
      scheduleId: schedules.id,
      potId: schedules.potId,
      amountPence: schedules.amountPence,
    })
    .from(scheduleInstances)
    .innerJoin(schedules, eq(schedules.id, scheduleInstances.scheduleId))
    .where(
      and(
        eq(scheduleInstances.state, 'upcoming'),
        eq(schedules.kind, 'receipt'),
        gte(scheduleInstances.dueDate, addDaysLocal(today, 1)),
      ),
    )
    .orderBy(asc(scheduleInstances.dueDate), asc(scheduleInstances.id))
    .all();
  const payday = receiptInstances[0] ?? null;
  if (payday === null) {
    // No expected-receipt schedule → no planning cycle → no projection.
    // The estimate still exists; the UI says exactly what is missing.
    return null;
  }
  const paydayDate = payday.instance.dueDate;

  const windowUpper = paydayDate;
  const windowLower = addDaysLocal(today, 1);
  const inWindow =
    windowUpper === null
      ? undefined
      : and(
          gte(scheduleInstances.dueDate, windowLower),
          lte(scheduleInstances.dueDate, windowUpper),
        );

  const toLines = (
    rows: Array<{
      instance: typeof scheduleInstances.$inferSelect;
      scheduleName: string;
      scheduleId: number;
      scheduleKind: ScheduleKind;
      potId: number;
      amountPence: number;
    }>,
  ): ProjectionLine[] =>
    rows.map((row) => ({
      scheduleId: row.scheduleId,
      name: row.scheduleName,
      potId: row.potId,
      amountPence: row.amountPence,
      dueDate: row.instance.dueDate,
      potLabel: potLabel.get(row.potId) ?? `Pot ${row.potId}`,
      scheduleKind: row.scheduleKind,
    }));

  const commitmentRows = db
    .select({
      instance: scheduleInstances,
      scheduleName: schedules.name,
      scheduleId: schedules.id,
      scheduleKind: schedules.kind,
      potId: schedules.potId,
      amountPence: schedules.amountPence,
    })
    .from(scheduleInstances)
    .innerJoin(schedules, eq(schedules.id, scheduleInstances.scheduleId))
    .where(
      and(
        eq(scheduleInstances.state, 'upcoming'),
        or(eq(schedules.kind, 'dd'), eq(schedules.kind, 'so')),
        ...(inWindow === undefined ? [] : [inWindow]),
      ),
    )
    .orderBy(asc(scheduleInstances.dueDate), asc(schedules.name))
    .all();
  const receiptRows = db
    .select({
      instance: scheduleInstances,
      scheduleName: schedules.name,
      scheduleId: schedules.id,
      scheduleKind: schedules.kind,
      potId: schedules.potId,
      amountPence: schedules.amountPence,
    })
    .from(scheduleInstances)
    .innerJoin(schedules, eq(schedules.id, scheduleInstances.scheduleId))
    .where(
      and(
        eq(scheduleInstances.state, 'upcoming'),
        eq(schedules.kind, 'receipt'),
        ...(inWindow === undefined ? [] : [inWindow]),
      ),
    )
    .orderBy(asc(scheduleInstances.dueDate), asc(schedules.name))
    .all();

  const commitments = commitmentRows.map((row) => ({
    scheduleId: row.scheduleId,
    name: row.scheduleName,
    potId: row.potId,
    amountPence: row.amountPence,
    dueDate: row.instance.dueDate,
  }));
  const receiptLines = receiptRows.map((row) => ({
    scheduleId: row.scheduleId,
    name: row.scheduleName,
    potId: row.potId,
    amountPence: row.amountPence,
    dueDate: row.instance.dueDate,
  }));

  // Warning threshold (SPEC §8): the most protective configured value.
  const thresholds = snapshot.pots
    .map((pot) => pot.pot.warningThresholdPence)
    .filter((value): value is number => value !== null);
  const warningThresholdPence = thresholds.length === 0 ? null : Math.min(...thresholds);

  // Projected day-to-day figures (SPEC §7.3): configured privately.
  const weeklyGroceriesPence = getWeeklyGroceriesPence(db) ?? 0;
  const vehicles = listVehicles(db);
  const fuelByVehicle = getMonthlyFuelByVehicle(db);
  const monthlyFuelPence = vehicles.map((vehicle) => fuelByVehicle.get(vehicle.id) ?? 0);

  const potWatches: PotWatchInput[] = snapshot.pots
    .filter((pot) => pot.estimatePence !== null)
    .map((pot) => ({
      potId: pot.pot.id,
      estimatePence: pot.estimatePence,
      commitments: commitments.filter((line) => line.potId === pot.pot.id),
    }));

  const result = projectToPayday({
    now,
    availableNowPence: snapshot.householdAvailablePence,
    paydayDate,
    commitments,
    receipts: receiptLines,
    weeklyGroceriesPence,
    monthlyFuelPence,
    warningThresholdPence,
    potWatches,
  });

  return {
    snapshot,
    result,
    paydayScheduleName: payday === null ? null : payday.scheduleName,
    paydayScheduleId: payday === null ? null : payday.scheduleId,
    commitmentLines: toLines(commitmentRows),
    receiptLines: toLines(receiptRows),
    potLabels: potLabel,
    otherPotEstimates: new Map(
      snapshot.pots
        .filter((pot) => pot.estimatePence !== null)
        .map((pot) => [pot.pot.id, pot.estimatePence as number]),
    ),
  };
}

/**
 * Upcoming commitments and receipts between now and `throughDate` (the
 * "due this week" list, SPEC §15.2).
 */
export function getUpcomingCommitments(
  db: Db,
  throughDate: string,
  nowArg?: Date,
): ProjectionLine[] {
  const now = nowArg ?? new Date();
  const today = toLocalDateString(now);
  if (throughDate <= today) return [];
  const potList = listPots(db);
  const potLabel = new Map(potList.map((pot) => [pot.id, pot.label]));
  const rows = db
    .select({
      instance: scheduleInstances,
      scheduleName: schedules.name,
      scheduleId: schedules.id,
      scheduleKind: schedules.kind,
      potId: schedules.potId,
      amountPence: schedules.amountPence,
    })
    .from(scheduleInstances)
    .innerJoin(schedules, eq(schedules.id, scheduleInstances.scheduleId))
    .where(
      and(
        eq(scheduleInstances.state, 'upcoming'),
        gte(scheduleInstances.dueDate, addDaysLocal(today, 1)),
        lte(scheduleInstances.dueDate, throughDate),
      ),
    )
    .orderBy(asc(scheduleInstances.dueDate), asc(schedules.name))
    .limit(100)
    .all();
  return rows.map((row) => ({
    scheduleId: row.scheduleId,
    name: row.scheduleName,
    potId: row.potId,
    amountPence: row.amountPence,
    dueDate: row.instance.dueDate,
    potLabel: potLabel.get(row.potId) ?? `Pot ${row.potId}`,
    scheduleKind: row.scheduleKind,
  }));
}

/**
 * Key-date items for the Overview panel (SPEC §22.3): renewals with their
 * per-item leads, and schedules' contract end dates with the configured
 * default lead. Runs the due pass first (renewal advances shift dates).
 */
export function getKeyDateAlerts(db: Db, nowArg?: Date): KeyDateAlert[] {
  const now = nowArg ?? new Date();
  ensureScheduleState(db, now);
  const today = toLocalDateString(now);

  const people = listPeople(db);
  const vehicles = listVehicles(db);
  const targetLabel = (kind: string, targetId: number | null): string | null => {
    if (targetId === null) return null;
    if (kind === 'person') return people.find((person) => person.id === targetId)?.label ?? null;
    if (kind === 'vehicle')
      return vehicles.find((vehicle) => vehicle.id === targetId)?.label ?? null;
    return null;
  };

  const items: KeyDateItem[] = [];
  for (const renewal of listRenewals(db)) {
    items.push({
      id: renewal.id,
      kind: 'renewal',
      label: renewal.label,
      date: renewal.nextRenewalDate,
      leadDays: renewal.warnDaysBefore,
      supplierId: renewal.supplierId,
      targetLabel: targetLabel(renewal.targetKind, renewal.targetId),
    });
  }
  const contractLead = getContractEndWarningLeadDays(db);
  for (const { schedule } of listSchedules(db, now)) {
    if (schedule.contractEndsOn === null) continue;
    items.push({
      id: schedule.id,
      kind: 'contract-end',
      label: `${schedule.name} contract`,
      date: schedule.contractEndsOn,
      leadDays: contractLead,
      scheduleId: schedule.id,
    });
  }
  return computeKeyDateAlerts(items, today);
}

/**
 * Converted-instance history for a schedule (the "history of converted
 * instances" on the Recurring Payments page, SPEC §15.2).
 */
export function listConvertedInstances(
  db: Db,
  scheduleId: number,
  limit = 24,
): Array<{
  dueDate: string;
  convertedAt: Date;
  recordKind: 'purchase' | 'receipt';
  recordId: number;
}> {
  const rows = db
    .select()
    .from(scheduleInstances)
    .where(
      and(eq(scheduleInstances.scheduleId, scheduleId), eq(scheduleInstances.state, 'converted')),
    )
    .orderBy(desc(scheduleInstances.dueDate))
    .limit(Math.min(Math.max(limit, 1), 200))
    .all();
  return rows.map((row) => ({
    dueDate: row.dueDate,
    convertedAt: row.convertedAt as Date,
    recordKind: row.convertedRecordKind as 'purchase' | 'receipt',
    recordId: row.convertedRecordId as number,
  }));
}
