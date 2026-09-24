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
import { expectedInflowOccurrences, listDebts, type Debt } from './debts';
import {
  projectDayToDayEvents,
  splitDayToDayEvents,
  type ProjectedDayToDayEvent,
} from './day-to-day';
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
import { getContractEndWarningLeadDays } from './settings';
import { advanceDueRenewals, listRenewals } from './renewals';
import { debtsSummary, type DebtsSummary } from './debts';
import {
  listSchedules,
  materializeAndConvert,
  MATERIALIZATION_HORIZON_DAYS,
  type ScheduleKind,
} from './schedules';
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
  /** 'dd' | 'so' | 'receipt' for schedule lines; null for debt expected inflows. */
  scheduleKind: ScheduleKind | null;
}

export interface ProjectionView {
  snapshot: MoneySnapshot;
  result: ProjectionResult;
  /** The income schedule defining the planning cycle (SPEC §11.3). */
  paydayScheduleName: string | null;
  paydayScheduleId: number | null;
  commitmentLines: ProjectionLine[];
  receiptLines: ProjectionLine[];
  /**
   * The projected shops/fills in the window (SPEC §7.3, v0.6.0): derived by
   * the anchor-reset model from the configured figures and the ledger, so
   * the panel can list exactly which events it is counting and when.
   */
  dayToDayEvents: ProjectedDayToDayEvent[];
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

  // The payday is the next expected-receipt due date (SPEC §11.3), now
  // combined with the earliest expected debt inflow — earliest wins (the
  // planning cycle flips to whichever money is expected next, v0.5.0). After
  // the due pass, every unconverted instance is strictly in the future.
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
  const expectedInflowDates = expectedInflowLines(db, today, null, null).map(
    (line) => line.dueDate,
  );
  const paydayDate =
    receiptInstances[0] !== undefined && expectedInflowDates[0] !== undefined
      ? minDate(receiptInstances[0].instance.dueDate, expectedInflowDates[0])
      : receiptInstances[0] !== undefined
        ? receiptInstances[0].instance.dueDate
        : expectedInflowDates[0] !== undefined
          ? expectedInflowDates[0]
          : null;
  const payday = receiptInstances[0] ?? null;
  if (paydayDate === null) {
    // No expected-receipt schedule and no expected debt inflow → no planning
    // cycle → no projection. The estimate still exists; the UI says exactly
    // what is missing.
    return null;
  }

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
  const receiptLines = [
    ...receiptRows.map((row) => ({
      scheduleId: row.scheduleId,
      name: row.scheduleName,
      potId: row.potId,
      amountPence: row.amountPence,
      dueDate: row.instance.dueDate,
    })),
    // Debt expected inflows join the window as receipts flagged expected —
    // "expected support" is a planning figure, never received income
    // (SPEC §10.2 stays true: borrowed money is never income). The anchor is
    // today (exclusive) so a support day due tomorrow (= windowLower) lands
    // exactly like a receipt instance due tomorrow (gte).
    ...expectedInflowLines(db, today, today, windowUpper),
  ];

  // Warning threshold (SPEC §8): the most protective configured value.
  const thresholds = snapshot.pots
    .map((pot) => pot.pot.warningThresholdPence)
    .filter((value): value is number => value !== null);
  const warningThresholdPence = thresholds.length === 0 ? null : Math.min(...thresholds);

  // Projected day-to-day spending (SPEC §7.3, v0.6.0): episodic events
  // anchored on when the household last actually shopped or filled up, so a
  // fresh £55 at the pumps suppresses projected fuel for its cooldown
  // instead of being double-counted alongside a smooth allowance.
  const dayToDayEvents = projectDayToDayEvents(db, today, windowUpper);
  const dayToDaySplit = splitDayToDayEvents(dayToDayEvents);

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
    projectedGroceries: dayToDayEventsToLines(dayToDaySplit.groceries),
    projectedFuel: dayToDayEventsToLines(dayToDaySplit.fuel),
    warningThresholdPence,
    potWatches,
  });

  return {
    snapshot,
    result,
    paydayScheduleName: payday === null ? null : payday.scheduleName,
    paydayScheduleId: payday === null ? null : payday.scheduleId,
    commitmentLines: toLines(commitmentRows),
    receiptLines: [...toLines(receiptRows), ...expectedInflowLines(db, today, today, windowUpper)],
    dayToDayEvents,
    potLabels: potLabel,
    otherPotEstimates: new Map(
      snapshot.pots
        .filter((pot) => pot.estimatePence !== null)
        .map((pot) => [pot.pot.id, pot.estimatePence as number]),
    ),
  };
}

/** Engine-shaped lines for projected day-to-day events (pot-less, id-less). */
function dayToDayEventsToLines(events: ProjectedDayToDayEvent[]): ProjectionScheduleLine[] {
  return events.map((event) => ({
    scheduleId: 0,
    name: event.name,
    potId: 0,
    amountPence: event.amountPence,
    dueDate: event.dueDate,
  }));
}

/**
 * The debt expected-inflow occurrence lines inside an (after, upTo] window,
 * shaped as `ProjectionLine`s for the UI (the engine takes the same list
 * with `scheduleKind` ignored). Each carries an `expected` flag and a
 * "support from {counterparty}" name so the UI never reads it as received.
 *
 * Only debts with a live (outstanding > 0) balance and the shared movement
 * pot are considered; `expectedInflowOccurrences` derives the dates with the
 * income weekend shift (decision 7). Passing null bounds widens the window
 * for payday selection.
 */
function expectedInflowLines(
  db: Db,
  today: string,
  lower: string | null,
  upper: string | null,
): ProjectionLine[] {
  const after = lower ?? today;
  const through = upper ?? addDaysLocal(today, MATERIALIZATION_HORIZON_DAYS);
  const potLabel = new Map(listPots(db).map((pot) => [pot.id, pot.label]));
  const movementPotByDebt = new Map<number, number>();
  for (const debt of listDebts(db)) {
    movementPotByDebt.set(debt.id, firstMovementPotOf(db, debt) ?? 0);
  }
  const lines: ProjectionLine[] = [];
  for (const debt of listDebts(db)) {
    const potId = movementPotByDebt.get(debt.id) ?? 0;
    if (potId === 0) continue; // a debt no movement / pot can pin has no home pot
    for (const occurrence of expectedInflowOccurrences(db, debt, after, through, potId)) {
      lines.push({
        scheduleId: debt.id,
        name: `support from ${debt.counterparty}`,
        potId: occurrence.potId,
        amountPence: occurrence.amountPence,
        dueDate: occurrence.dueDate,
        potLabel: potLabel.get(occurrence.potId) ?? `Pot ${occurrence.potId}`,
        scheduleKind: null,
        expected: true,
      });
    }
  }
  lines.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
  return lines;
}

/**
 * The pot a debt's money actually travels through — the most recent non-void
 * loan movement's pot. The expectation must land in the same pot the real
 * deposit uses, or the two layers (expectation vs. actual borrowing) would
 * describe different money. null when the debt has no live movements yet.
 */
function firstMovementPotOf(db: Db, debt: Debt): number | null {
  const rows = db
    .select({ potId: externalMovements.potId })
    .from(externalMovements)
    .where(and(eq(externalMovements.debtId, debt.id), isNull(externalMovements.voidedAt)))
    .orderBy(desc(externalMovements.id))
    .limit(1)
    .all();
  return rows[0]?.potId ?? null;
}

function minDate(a: string, b: string): string {
  return a <= b ? a : b;
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

/* ------------------------------------------------------------------ */
/* Horizon projection (SPEC §7.6, v0.5.0)                              */
/* ------------------------------------------------------------------ */

export interface HorizonLine extends ProjectionLine {
  /** True for debt expected inflows, false for receipt schedules. */
  expected: boolean;
}

export interface HorizonProjectionView {
  asOf: Date;
  throughDate: string;
  result: ProjectionResult;
  /** The selected pots (all existing pots when none are specified). */
  selection: { pot: Pot; selected: boolean }[];
  includeDayToDay: boolean;
  /** Every pots' id → label for the selected set. */
  potLabels: Map<number, string>;
  commitmentLines: HorizonLine[];
  receiptLines: HorizonLine[];
  /**
   * The projected shops/fills inside the horizon window (SPEC §7.3, v0.6.0),
   * derived by the anchor-reset model — empty when day-to-day is toggled
   * off or nothing is configured. Displayed as their own detail block: the
   * figure is never invisible arithmetic.
   */
  dayToDayEvents: ProjectedDayToDayEvent[];
  totalCommitmentsPence: number;
  totalReceiptsPence: number;
  /** False when day-to-day is excluded — the page relabels the headline. */
  dayToDayIncluded: boolean;
  /** The household's own `availableNowPence` across the selected pots. */
  availableNowPence: number;
}

/**
 * The horizon projection read model (SPEC §7.6): the same pure engine as the
 * payday panel, given `paydayDate = throughDate` and only the selected pots'
 * data. Reuses the engine untouched; the window is the days strictly after
 * today up to and including `throughDate`; expected debt inflows join the
 * receipt list flagged `expected` so the UI can label them, and day-to-day
 * is passed as zero when excluded (the "bills only" headline).
 */
export function getHorizonProjectionView(
  db: Db,
  throughDate: string,
  potIds: number[],
  includeDayToDay: boolean,
  nowArg?: Date,
): HorizonProjectionView {
  const now = nowArg ?? new Date();
  const snapshot = getMoneySnapshot(db, now);
  const today = toLocalDateString(now);

  const potsAll = listPots(db);
  const selection =
    potIds.length === 0
      ? potsAll.map((pot) => ({ pot, selected: true }))
      : potsAll.map((pot) => ({ pot, selected: potIds.includes(pot.id) }));

  const selectedIdSet = new Set(
    potsAll
      .filter((pot) => selection.find((entry) => entry.pot.id === pot.id)?.selected)
      .map((pot) => pot.id),
  );
  const selectedPots = potsAll.filter((pot) => selectedIdSet.has(pot.id));
  const potLabels = new Map(selectedPots.map((pot) => [pot.id, pot.label]));

  // A debt's expectation lands in its shared movement pot. A selected-pot
  // debt whose movements live in a deselected pot has no home in this
  // horizon and is left out (like every other movement on that pot).
  const movementPotByDebt = new Map<number, number>();
  for (const debt of listDebts(db)) {
    movementPotByDebt.set(debt.id, firstMovementPotOf(db, debt) ?? 0);
  }

  const windowLower = addDaysLocal(today, 1);
  const windowUpper = throughDate;

  // Projected day-to-day spending (SPEC §7.3, v0.6.0): episodic events
  // anchored on actual shops/fills, household-level like the configured
  // figures were — pot scoping filters commitments and receipts, never the
  // day-to-day events. "Bills only" passes no events at all.
  const dayToDayEvents = includeDayToDay ? projectDayToDayEvents(db, today, windowUpper) : [];
  const dayToDaySplit = splitDayToDayEvents(dayToDayEvents);

  // Commitments: unconverted dd/so instances in (today, through].
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
        gte(scheduleInstances.dueDate, windowLower),
        lte(scheduleInstances.dueDate, windowUpper),
      ),
    )
    .orderBy(asc(scheduleInstances.dueDate), asc(schedules.name))
    .all();

  // Receipts: unconverted receipt instances in the window.
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
        gte(scheduleInstances.dueDate, windowLower),
        lte(scheduleInstances.dueDate, windowUpper),
      ),
    )
    .orderBy(asc(scheduleInstances.dueDate), asc(schedules.name))
    .all();

  const commitmentLines: HorizonLine[] = commitmentRows
    .filter((row) => selectedIdSet.has(row.potId))
    .map((row) => ({
      scheduleId: row.scheduleId,
      name: row.scheduleName,
      potId: row.potId,
      amountPence: row.amountPence,
      dueDate: row.instance.dueDate,
      potLabel: potLabels.get(row.potId) ?? `Pot ${row.potId}`,
      scheduleKind: row.scheduleKind,
      expected: false,
    }));

  const receiptScheduleLines: HorizonLine[] = receiptRows
    .filter((row) => selectedIdSet.has(row.potId))
    .map((row) => ({
      scheduleId: row.scheduleId,
      name: row.scheduleName,
      potId: row.potId,
      amountPence: row.amountPence,
      dueDate: row.instance.dueDate,
      potLabel: potLabels.get(row.potId) ?? `Pot ${row.potId}`,
      scheduleKind: row.scheduleKind as ScheduleKind,
      expected: false,
    }));

  const inflowLines: HorizonLine[] = [];
  for (const debt of listDebts(db)) {
    const potId = movementPotByDebt.get(debt.id) ?? 0;
    if (!selectedIdSet.has(potId)) continue;
    for (const occurrence of expectedInflowOccurrences(db, debt, today, windowUpper, potId)) {
      inflowLines.push({
        scheduleId: debt.id,
        name: `support from ${debt.counterparty}`,
        potId: occurrence.potId,
        amountPence: occurrence.amountPence,
        dueDate: occurrence.dueDate,
        potLabel: potLabels.get(occurrence.potId) ?? `Pot ${occurrence.potId}`,
        scheduleKind: null,
        expected: true,
      });
    }
  }

  const receiptLines = [...receiptScheduleLines, ...inflowLines].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name),
  );
  const commitments = commitmentLines.map(toBatchLine);
  const receipts = receiptLines.map(toBatchLine);

  const availablePence = selectedPots
    .map((pot) => snapshot.pots.find((entry) => entry.pot.id === pot.id)?.estimatePence ?? null)
    .filter((value): value is number => value !== null);
  const availableNowPence =
    availablePence.length === 0 ? 0 : availablePence.reduce((a, b) => a + b, 0);

  const thresholds = selectedPots
    .map((pot) => pot.warningThresholdPence)
    .filter((value): value is number => value !== null);
  const warningThresholdPence = thresholds.length === 0 ? null : Math.min(...thresholds);

  const potWatches: PotWatchInput[] = selectedPots
    .filter((pot) => snapshot.pots.find((entry) => entry.pot.id === pot.id)?.estimatePence != null)
    .map((pot) => ({
      potId: pot.id,
      estimatePence: snapshot.pots.find((entry) => entry.pot.id === pot.id)
        ?.estimatePence as number,
      commitments: commitments.filter((line) => line.potId === pot.id),
    }));

  const result = projectToPayday({
    now,
    availableNowPence,
    paydayDate: throughDate,
    commitments,
    receipts,
    projectedGroceries: dayToDayEventsToLines(dayToDaySplit.groceries),
    projectedFuel: dayToDayEventsToLines(dayToDaySplit.fuel),
    warningThresholdPence,
    potWatches,
  });

  return {
    asOf: now,
    throughDate,
    result,
    selection,
    includeDayToDay,
    potLabels,
    commitmentLines,
    receiptLines,
    dayToDayEvents,
    totalCommitmentsPence: result.totalCommitmentsPence,
    totalReceiptsPence: result.totalReceiptsPence,
    dayToDayIncluded: includeDayToDay,
    availableNowPence,
  };
}

/** The where-we'd-land figure: the final day's running total. */
export function landPenceOf(result: ProjectionResult): number {
  const last = result.perDay.at(-1);
  if (last === undefined) return result.availableNowPence - result.dayToDayPence;
  return last.runningPence;
}

function toBatchLine(line: ProjectionLine): ProjectionScheduleLine {
  return {
    scheduleId: line.scheduleId,
    name: line.name,
    potId: line.potId,
    amountPence: line.amountPence,
    dueDate: line.dueDate,
    ...(line.expected === true ? { expected: true } : {}),
  };
}
