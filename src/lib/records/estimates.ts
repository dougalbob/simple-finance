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
 *
 * "Signed spending": purchases add, refunds subtract (a refund therefore
 * increases the estimate). Schedule-generated records are ordinary records
 * and appear here once converted (SPEC §11.2). Neither number is ever
 * called a bank balance (SPEC §7).
 *
 * Comparison precision (SPEC §7.1): where both record and checkpoint carry
 * real times of day, compare by timestamp. Where a record is date-only and
 * shares the checkpoint's local date, the record counts as *after*
 * (subtracted) — the conservative direction; it self-corrects at the next
 * checkpoint. A date-only fact is recognised by the end-of-local-date marker
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
}

/** True when the record was entered date-only (end-of-local-date marker). */
export function isRecordDateOnly(record: OccurredFacts): boolean {
  return isDateOnlyInstant(record.occurredAt, record.occurredDate);
}

/**
 * Does the record count as *after* the checkpoint (i.e. against the
 * reported balance)? The conservative rule per SPEC §7.1.
 */
export function recordIsAfterCheckpoint(
  record: OccurredFacts,
  checkpoint: CheckpointFacts,
): boolean {
  if (isRecordDateOnly(record)) {
    // Date-only: the record takes effect at the end of its local date. It
    // counts from the checkpoint's local date onward — sharing the date
    // counts as "after" (SPEC §7.1).
    return record.occurredDate >= toLocalDateString(checkpoint.effectiveAt);
  }
  // Timed record: plain instant comparison.
  return record.occurredAt.getTime() > checkpoint.effectiveAt.getTime();
}

/**
 * A signed movement against one pot's estimate. Sign convention:
 * spending = −totalPence (a refund's negative total becomes positive),
 * transfer out = −amount, transfer in = +amount, receipt = +amount.
 */
export interface SignedMovement extends OccurredFacts {
  signedPence: number;
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
