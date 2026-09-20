import { isValidPenceAmount } from '../money';

/**
 * Pure split validation (SPEC §9.3): allocation lines must total the payment
 * exactly. Framework-free and database-free so the mobile save control, the
 * server domain modules and the tests all share one rule (blueprint §3).
 *
 * Rules enforced here:
 * - a purchase has at least one allocation line; amounts are whole pence;
 * - no zero-amount lines (a line that moves nothing is not a line);
 * - every line carries the same sign as the payment total — purchases split
 *   into positive lines, refunds into negative lines. Instant till discounts
 *   simply reduce a line amount; a mixed-sign \"split\" would be refundable
 *   and analysable only with fraction-style reconciliation, which SPEC §9.4
 *   deliberately keeps out of v1;
 * - the lines sum to the total exactly (integer arithmetic — no rounding
 *   residue, no unallocated bucket).
 */

export interface SplitLineAmount {
  amountPence: number;
}

export class SplitValidationError extends Error {
  /** Machine-readable reason; the message is written for display. */
  readonly code:
    | 'invalid_total'
    | 'no_lines'
    | 'invalid_line_amount'
    | 'zero_line_amount'
    | 'mixed_sign_line'
    | 'total_mismatch';
  readonly lineIndex: number | null;

  constructor(
    code: SplitValidationError['code'],
    message: string,
    lineIndex: number | null = null,
  ) {
    super(message);
    this.name = 'SplitValidationError';
    this.code = code;
    this.lineIndex = lineIndex;
  }
}

/**
 * How many pence are still unallocated: total minus the sum of the lines.
 * Positive means \"assign remaining £X to…\" (SPEC §9.3); zero means balanced.
 * Throws SplitValidationError when the inputs are not whole-pence integers.
 */
export function splitRemainder(
  totalPence: number,
  lineAmounts: readonly number[] | readonly SplitLineAmount[],
): number {
  const amounts = normalizeLineAmounts(lineAmounts);
  assertValidTotal(totalPence);
  let sum = 0;
  amounts.forEach((amount, index) => {
    assertValidLineAmount(amount, index);
    sum += amount;
  });
  if (!Number.isSafeInteger(sum)) {
    throw new SplitValidationError('total_mismatch', 'Those lines do not add up safely.');
  }
  return totalPence - sum;
}

/** True only when the lines total the payment exactly (SPEC §9.3). */
export function isSplitBalanced(
  totalPence: number,
  lineAmounts: readonly number[] | readonly SplitLineAmount[],
): boolean {
  try {
    return splitRemainder(totalPence, lineAmounts) === 0;
  } catch {
    return false;
  }
}

/**
 * Full split validation: throws the first SplitValidationError found, or
 * returns silently when the split is complete. A purchase is complete or it
 * does not exist — there are no draft/incomplete split records (SPEC §9.3).
 */
export function assertSplitBalanced(
  totalPence: number,
  lineAmounts: readonly number[] | readonly SplitLineAmount[],
): void {
  const amounts = normalizeLineAmounts(lineAmounts);
  assertValidTotal(totalPence);
  if (amounts.length === 0) {
    throw new SplitValidationError('no_lines', 'Add at least one allocation line.');
  }
  const totalIsNegative = totalPence < 0;
  amounts.forEach((amount, index) => {
    assertValidLineAmount(amount, index);
    if (amount === 0) {
      throw new SplitValidationError(
        'zero_line_amount',
        `Line ${index + 1} moves £0.00 — remove it or give it an amount.`,
        index,
      );
    }
    if (amount < 0 !== totalIsNegative) {
      throw new SplitValidationError(
        'mixed_sign_line',
        totalIsNegative
          ? `Line ${index + 1} is positive but this is a refund — refund lines are negative.`
          : `Line ${index + 1} is negative but this is a purchase — record money back as a refund instead.`,
        index,
      );
    }
  });
  const remainder = totalPence - amounts.reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(remainder) || remainder !== 0) {
    throw new SplitValidationError(
      'total_mismatch',
      remainder > 0
        ? `The lines are ${formatRemainder(remainder)} short of the payment total.`
        : `The lines exceed the payment total by ${formatRemainder(-remainder)}.`,
    );
  }
}

function normalizeLineAmounts(
  lineAmounts: readonly number[] | readonly SplitLineAmount[],
): readonly number[] {
  return lineAmounts.map((entry) => (typeof entry === 'number' ? entry : entry.amountPence));
}

function assertValidTotal(totalPence: number): void {
  if (!isValidPenceAmount(totalPence) || totalPence === 0) {
    throw new SplitValidationError(
      'invalid_total',
      'The payment total must be a non-zero whole-pence amount.',
    );
  }
}

function assertValidLineAmount(amount: number, index: number): void {
  if (!isValidPenceAmount(amount)) {
    throw new SplitValidationError(
      'invalid_line_amount',
      `Line ${index + 1} is not a valid whole-pence amount.`,
      index,
    );
  }
}

/** £X.XX rendering without importing the display formatter into the rule. */
function formatRemainder(pence: number): string {
  const pounds = Math.floor(pence / 100);
  const remainder = String(pence % 100).padStart(2, '0');
  return `£${pounds.toLocaleString('en-GB')}.${remainder}`;
}
