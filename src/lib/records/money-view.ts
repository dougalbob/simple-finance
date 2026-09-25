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
import { expectedInflowOccurrences, expectedInflowPotId, listDebts } from './debts';
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
  const income = nextExpectedIncome(db, today);
  if (income === null) {
    // No expected-receipt schedule and no expected debt inflow → no planning
    // cycle → no projection. The estimate still exists; the UI says exactly
    // what is missing.
    return null;
  }
  const paydayDate = income.date;
  const payday = income.scheduleId === null ? null : { scheduleId: income.scheduleId };

  const windowUpper = paydayDate;
  const windowLower = addDaysLocal(today, 1);
  const inWindow =
    windowUpper === null
      ? undefined
      : and(
          gte(scheduleInstances.dueDate, windowLower),
          lte(scheduleInstances.dueDate, windowUpper),
        );

  const toLines = (rows: WindowLineRow[]): ProjectionLine[] =>
    rows.map((row) => ({
      scheduleId: row.scheduleId,
      name: row.name,
      potId: row.potId,
      amountPence: row.amountPence,
      dueDate: row.dueDate,
      potLabel: potLabel.get(row.potId) ?? `Pot ${row.potId}`,
      scheduleKind: row.scheduleKind,
    }));

  const commitmentRows = windowLines(db, 'commitment', today, paydayDate);
  const receiptRows = windowLines(db, 'receipt', today, paydayDate);

  const commitments = commitmentRows.map((row) => ({
    scheduleId: row.scheduleId,
    name: row.name,
    potId: row.potId,
    amountPence: row.amountPence,
    dueDate: row.dueDate,
  }));
  const receiptLines = [
    ...receiptRows.map((row) => ({
      scheduleId: row.scheduleId,
      name: row.name,
      potId: row.potId,
      amountPence: row.amountPence,
      dueDate: row.dueDate,
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
    paydayScheduleName: income.scheduleName,
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

/* ------------------------------------------------------------------ */
/* The cycle outlook: what is safe to spend before income lands (v0.9.0) */
/* ------------------------------------------------------------------ */

export interface CycleOutlookPot {
  potId: number;
  estimatePence: number | null;
  /** Σ of this pot's unconverted commitments due before income lands. */
  commitmentsPence: number;
  /** estimate − commitments; null when the pot has no estimate (no checkpoint). */
  spendablePence: number | null;
  /** How far short of its own bills the pot would be; null when it covers them. */
  shortfallPence: number | null;
  /** The bills counted in the figure, soonest first — never invisible arithmetic. */
  outgoing: Array<{ name: string; amountPence: number; dueDate: string }>;
}

/**
 * "What is left before income lands" (SPEC §7.7, v0.9.0). The Quick Entry
 * balance is two figures, not one: the last reported checkpoint (what the
 * bank said) and this outlook — everything already expected to leave between
 * now and the next expected income, so standing in a shop with a healthy
 * checkpoint cannot hide next week's direct debit.
 *
 * `freeToSpendPence` deliberately counts **no income**: it is the dip just
 * before the money lands, which is the moment that decides whether a card
 * bounces. Adding the salary in would turn a £500-with-a-£600-mortgage-
 * pending day into a comfortable £1,800 picture and hide exactly the risk
 * the household asked to see.
 *
 * The household figure includes projected day-to-day events (§7.3), because
 * the weekly shop and the fuel fill will really happen. The per-pot figures
 * exclude them (§7.5's reasoning: groceries vary by pot and payment method,
 * and a pot-scoped figure is a transfer-planning signal). Per pot, the number
 * is `pot_watch` (SPEC §7.5) with the window taken to the next expected
 * income rather than a named payday.
 */
export interface CycleOutlook {
  asOf: Date;
  /** The next expected income (SPEC §11.3) — null when none is scheduled. */
  incomeDate: string | null;
  incomeSource: string | null;
  /** Whole days from today to income; 0 when nothing is expected. */
  days: number;
  /** household_available_now (SPEC §7.1); null when no pot is checkpointed. */
  householdAvailablePence: number | null;
  commitmentsPence: number;
  dayToDayPence: number;
  /** available − commitments − projected shops/fills inside the window. */
  freeToSpendPence: number | null;
  /** The day the money bottoms out (the last outgoing before income); null when nothing is due. */
  lowDate: string | null;
  pots: CycleOutlookPot[];
  commitments: Array<{
    name: string;
    amountPence: number;
    dueDate: string;
    potId: number;
    potLabel: string;
  }>;
  dayToDayEvents: Array<{ name: string; amountPence: number; dueDate: string }>;
}

/**
 * The cycle outlook read model. Callers that have already built the money
 * snapshot (the home page) pass it in rather than paying for it twice.
 */
export function getCycleOutlook(db: Db, nowArg?: Date, snapshotArg?: MoneySnapshot): CycleOutlook {
  const now = nowArg ?? new Date();
  const snapshot = snapshotArg ?? getMoneySnapshot(db, now);
  const today = toLocalDateString(now);
  const income = nextExpectedIncome(db, today);
  const potLabel = new Map(snapshot.pots.map((entry) => [entry.pot.id, entry.pot.label]));

  const commitmentRows = income === null ? [] : windowLines(db, 'commitment', today, income.date);
  const dayToDayEvents = income === null ? [] : projectDayToDayEvents(db, today, income.date);
  const commitments = commitmentRows.map((row) => ({
    name: row.name,
    amountPence: row.amountPence,
    dueDate: row.dueDate,
    potId: row.potId,
    potLabel: potLabel.get(row.potId) ?? `Pot ${row.potId}`,
  }));
  const commitmentsPence = sumPence(commitments);
  const dayToDayPence = sumPence(dayToDayEvents);

  const pots: CycleOutlookPot[] = snapshot.pots.map((entry) => {
    const own = commitments.filter((line) => line.potId === entry.pot.id);
    const ownPence = sumPence(own);
    // No expected income → no window → no "before income lands" figure. The
    // estimate still shows on the review pages; this one stays silent rather
    // than pretending an endless window.
    const spendablePence =
      income === null || entry.estimatePence === null ? null : entry.estimatePence - ownPence;
    return {
      potId: entry.pot.id,
      estimatePence: entry.estimatePence,
      commitmentsPence: ownPence,
      spendablePence,
      shortfallPence:
        spendablePence !== null && spendablePence < 0 ? Math.abs(spendablePence) : null,
      outgoing: own.map(({ name, amountPence, dueDate }) => ({ name, amountPence, dueDate })),
    };
  });

  const dueDates = [
    ...commitments.map((line) => line.dueDate),
    ...dayToDayEvents.map((event) => event.dueDate),
  ].sort((a, b) => a.localeCompare(b));

  return {
    asOf: now,
    incomeDate: income?.date ?? null,
    incomeSource: income?.source ?? null,
    days: income === null ? 0 : daysBetween(today, income.date),
    householdAvailablePence: snapshot.householdAvailablePence,
    commitmentsPence,
    dayToDayPence,
    freeToSpendPence:
      income === null || snapshot.householdAvailablePence === null
        ? null
        : snapshot.householdAvailablePence - commitmentsPence - dayToDayPence,
    lowDate: dueDates[dueDates.length - 1] ?? null,
    pots,
    commitments,
    dayToDayEvents: dayToDayEvents.map(({ name, amountPence, dueDate }) => ({
      name,
      amountPence,
      dueDate,
    })),
  };
}

function sumPence(lines: Array<{ amountPence: number }>): number {
  return lines.reduce((total, line) => total + line.amountPence, 0);
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
 * Every debt with an expectation is considered (v0.7.0): a debt that has not
 * borrowed yet projects against the household's default pot — that is the
 * whole point of setting the expectation before the first payment. The
 * settled/answered rules live in `expectedInflowOccurrences`, and the dates
 * carry the income weekend shift (decision 7). Passing null bounds widens
 * the window for payday selection.
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
  const lines: ProjectionLine[] = [];
  for (const debt of listDebts(db)) {
    const potId = expectedInflowPotId(db, debt);
    if (potId === null) continue; // no live pot exists to hold the money
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
 * One schedule instance inside the payday window, flattened for the UI
 * helpers below. Both the projection panel and the cycle outlook (SPEC §7.7)
 * read the window through these two functions, so the two views can never
 * disagree about which commitments are counted.
 */
interface WindowLineRow {
  scheduleId: number;
  name: string;
  potId: number;
  amountPence: number;
  dueDate: string;
  scheduleKind: ScheduleKind;
}

/**
 * Unconverted dd/so instances (commitments) or receipt instances inside
 * (today, throughDate]. The lazy due pass has already run, so every
 * unconverted instance is strictly in the future.
 */
function windowLines(
  db: Db,
  kind: 'commitment' | 'receipt',
  today: string,
  throughDate: string,
): WindowLineRow[] {
  const kindFilter =
    kind === 'commitment'
      ? or(eq(schedules.kind, 'dd'), eq(schedules.kind, 'so'))
      : eq(schedules.kind, 'receipt');
  return db
    .select({
      dueDate: scheduleInstances.dueDate,
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
        kindFilter,
        gte(scheduleInstances.dueDate, addDaysLocal(today, 1)),
        lte(scheduleInstances.dueDate, throughDate),
      ),
    )
    .orderBy(asc(scheduleInstances.dueDate), asc(schedules.name))
    .all()
    .map((row) => ({
      scheduleId: row.scheduleId,
      name: row.scheduleName,
      potId: row.potId,
      amountPence: row.amountPence,
      dueDate: row.dueDate,
      scheduleKind: row.scheduleKind,
    }));
}

/**
 * The next money the household expects in (SPEC §11.3, §10.2): the earliest
 * of the unconverted receipt instances and a debt's expected support — the
 * planning-cycle payday. null when nothing is expected at all.
 */
interface NextIncome {
  date: string;
  /** The schedule's name, or "support from {counterparty}" for a debt. */
  source: string;
  /** Set only when the next income is an income schedule, not an expectation. */
  scheduleId: number | null;
  scheduleName: string | null;
}

/**
 * The earliest unconverted **receipt schedule** instance strictly after
 * today — scheduled income only (the salary), already weekend-shifted.
 * Shared by `nextExpectedIncome` and `nextScheduledIncomeDate` so there is
 * one query for "the next payday on a schedule".
 */
function nextReceiptScheduleInstance(
  db: Db,
  today: string,
): { dueDate: string; scheduleId: number; scheduleName: string } | undefined {
  return db
    .select({
      dueDate: scheduleInstances.dueDate,
      scheduleId: schedules.id,
      scheduleName: schedules.name,
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
    .limit(1)
    .get();
}

/**
 * The next **scheduled income** date (Horizon's default, SPEC §7.6, decision
 * 150): receipt schedules only. Unlike `nextExpectedIncome` (§7.2/§7.7) a
 * debt's expected support never counts — the household anchors the horizon
 * on the salary, and borrowed money is never income (§10.2). null when no
 * receipt schedule has an upcoming instance.
 */
export function nextScheduledIncomeDate(db: Db, today: string): string | null {
  return nextReceiptScheduleInstance(db, today)?.dueDate ?? null;
}

function nextExpectedIncome(db: Db, today: string): NextIncome | null {
  const schedule = nextReceiptScheduleInstance(db, today);
  const inflow = expectedInflowLines(db, today, null, null)[0] ?? null;

  const scheduleOption: NextIncome | null =
    schedule === undefined
      ? null
      : {
          date: schedule.dueDate,
          source: schedule.scheduleName,
          scheduleId: schedule.scheduleId,
          scheduleName: schedule.scheduleName,
        };
  const inflowOption: NextIncome | null =
    inflow === null
      ? null
      : { date: inflow.dueDate, source: inflow.name, scheduleId: null, scheduleName: null };
  if (scheduleOption === null) return inflowOption;
  if (inflowOption === null) return scheduleOption;
  return scheduleOption.date <= inflowOption.date ? scheduleOption : inflowOption;
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

  // A debt's expectation lands in the pot its movements travel through, or —
  // for a debt that has not borrowed yet (v0.7.0) — the household's default
  // pot. A deselected pot's expectation is left out, like every other
  // movement on that pot.
  const movementPotByDebt = new Map<number, number>();
  for (const debt of listDebts(db)) {
    movementPotByDebt.set(debt.id, expectedInflowPotId(db, debt) ?? 0);
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
