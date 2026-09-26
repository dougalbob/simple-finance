import { isDateOnlyInstant, toLocalDateString } from '../time';

/**
 * The "available now" estimate engine (docs/SPEC.md §7.1) — pure,
 * framework-free and shared by the UI, the projection engine and tests.
 *
 * For pot P with latest checkpoint C (amount, effective instant t):
 *
 *   estimate(P) = C.amount
 *               − Σ signed spending on P whose effective instant is after t
 *               − Σ transfers out of P after t
 *               + Σ transfers into P after t
 *               + Σ receipts into P after t
 *               + Σ external money in to P after t
 *               − Σ external money out of P after t
 *
 * "Signed spending": purchases add, refunds subtract (a refund therefore
 * increases the estimate). Schedule-generated records are ordinary records
 * and appear here once converted (SPEC §11.2). External movements (SPEC
 * §10.2) genuinely move the household total — unlike internal transfers —
 * because the money really entered or left. Neither number is ever
 * called a bank balance (SPEC §7).
 *
 * Comparison precision (SPEC §7.1): where both record and checkpoint carry
 * real times of day, compare by timestamp. Where a record is date-only and
 * shares the checkpoint's local date, the date alone does not say which
 * happened first:
 *
 * - a date-only debit (spending, money out) counts as *after* — subtracting
 *   it can only understate, and the next later-dated checkpoint resets it;
 * - a date-only credit (receipt, transfer-in, refund, money in) is decided
 *   by entry order. Written down *before* the checkpoint, it is *absorbed*:
 *   the count was taken after the movement was recorded, so the reported
 *   figure already includes it. Counting it again is the v0.2.0 "£180" bug
 *   (E13). Written down *after* the checkpoint, it is *counted*: a movement
 *   that did not exist when the figure was reported cannot already be inside
 *   it (the bank-transfer case — checkpoint, then move money in). Entry time
 *   unknown → absorb, the safe direction.
 *
 * A date-only fact is recognised by the end-of-local-date marker
 * (src/lib/time.ts: endOfLocalDate), which cannot collide with a real timed
 * entry (mobile entry stamps whole seconds on a tap).
 */

export interface OccurredFacts {
  occurredAt: Date;
  occurredDate: string;
}

export interface CheckpointFacts {
  amountPence: number;
  effectiveAt: Date;
  /**
   * When the checkpoint was written down. Used only for the same-day
   * date-only credit tie-break (SPEC §7.1). Absent means the order is
   * unknown — a same-day credit is absorbed, the safe direction.
   */
  enteredAt?: Date;
}

/** True when the record was entered date-only (end-of-local-date marker). */
export function isRecordDateOnly(record: OccurredFacts): boolean {
  return isDateOnlyInstant(record.occurredAt, record.occurredDate);
}

/**
 * Does the record count as *after* the checkpoint (i.e. against the
 * reported balance)? SPEC §7.1: a same-day date-only debit always counts
 * (subtracting can only understate). A same-day date-only credit counts
 * only when it was written down after the checkpoint — it cannot already
 * be inside a figure reported before the record existed. A credit written
 * down earlier, or whose entry time is unknown, is absorbed (E13).
 */
export function recordIsAfterCheckpoint(
  record: SignedMovement,
  checkpoint: CheckpointFacts,
): boolean {
  if (isRecordDateOnly(record)) {
    const checkpointDate = toLocalDateString(checkpoint.effectiveAt);
    if (record.occurredDate < checkpointDate) return false; // inside the checkpoint
    if (record.occurredDate > checkpointDate) return true; // after the checkpoint
    // Same local date. A debit always counts: subtracting can only
    // understate, and the next later-dated checkpoint resets it.
    if (record.signedPence <= 0) return true;
    // A credit written down after the checkpoint cannot already be inside
    // the reported figure. One written down before it (or with no entry
    // time to compare) is absorbed, so a later same-day count does not
    // double-count money already in hand (E13).
    if (record.enteredAt === undefined || checkpoint.enteredAt === undefined) return false;
    return record.enteredAt.getTime() > checkpoint.enteredAt.getTime();
  }
  // Timed record: the order is known, so plain instant comparison.
  return record.occurredAt.getTime() > checkpoint.effectiveAt.getTime();
}

/**
 * A signed movement against one pot's estimate. Sign convention:
 * spending = −totalPence (a refund's negative total becomes positive),
 * transfer out = −amount, transfer in = +amount, receipt = +amount,
 * external in = +amount, external out = −amount.
 */
export interface SignedMovement extends OccurredFacts {
  signedPence: number;
  /**
   * When the movement was recorded (`createdAt`). Same role as
   * `CheckpointFacts.enteredAt`: only the same-day date-only credit
   * tie-break reads it.
   */
  enteredAt?: Date;
}

export interface PotEstimateInput {
  potId: number;
  /** The pot's latest checkpoint, or null when the pot has never been reported. */
  checkpoint: CheckpointFacts | null;
  /** All non-void signed movements for the pot (the engine filters by checkpoint). */
  movements: SignedMovement[];
}

export interface PotEstimateResult {
  potId: number;
  /** null when the pot has no checkpoint — an unreported pot has no estimate, ever. */
  estimatePence: number | null;
  checkpoint: CheckpointFacts | null;
  /** How many movements were counted against the checkpoint (debug/insights). */
  countedMovements: number;
}

export function estimatePot(input: PotEstimateInput): PotEstimateResult {
  if (input.checkpoint === null) {
    return { potId: input.potId, estimatePence: null, checkpoint: null, countedMovements: 0 };
  }
  let total = input.checkpoint.amountPence;
  let counted = 0;
  for (const movement of input.movements) {
    if (recordIsAfterCheckpoint(movement, input.checkpoint)) {
      total += movement.signedPence;
      counted += 1;
    }
  }
  return {
    potId: input.potId,
    estimatePence: total,
    checkpoint: input.checkpoint,
    countedMovements: counted,
  };
}

/**
 * The headline figure (SPEC §7.1): the sum of per-pot estimates. Summing
 * pots means internal transfers can never distort it. Returns null when no
 * pot has been checkpointed yet.
 */
export function householdEstimatePence(results: readonly PotEstimateResult[]): number | null {
  const known = results.filter((result) => result.estimatePence !== null);
  if (known.length === 0) return null;
  return known.reduce((sum, result) => sum + (result.estimatePence as number), 0);
}
