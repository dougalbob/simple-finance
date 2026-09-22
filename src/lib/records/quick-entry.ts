import { parsePence, penceInput } from '../money';

/**
 * Quick Entry Line 1 following the payment amount (mobile flow, SPEC §15.1).
 *
 * The household types the till amount once. Line 1 of "Split the payment"
 * mirrors it until they take that line over, so Save can light up from the
 * amount alone; the category dropdown stays where it always was, in the split
 * panel above Save. Pure and framework-free, so the mirroring rule is testable
 * without a browser — the takeover flag itself is client state in
 * `PurchaseForm` and is covered in the Playwright suite.
 */
export type FollowedLineAmount =
  /** Write this amount into Line 1. */
  | { action: 'set'; amount: string }
  /** The total was deleted or is zero: the mirrored amount must not linger. */
  | { action: 'clear' }
  /**
   * The total is half-typed ("85.") or negative, so it is not a number yet:
   * leave Line 1 at its last valid mirrored value. Save stays disabled anyway —
   * `balanced` already requires a positive parsed total.
   */
  | { action: 'hold' };

/**
 * What the followed Line 1 amount should become when the Quick Entry amount
 * changes. `parsePence("8")` is already £8.00, so every valid intermediate
 * keystroke is mirrored (typing "8" then "5" ends at £85.00, never frozen on
 * the first valid number) and a correction from 85 to 84.50 arrives too.
 */
export function followedLineAmount(total: string): FollowedLineAmount {
  const parsed = parsePence(total);
  if (parsed === null) {
    // An empty total is a deletion; anything else unparseable is a keystroke
    // in flight ("85.", "12.345", "12."), which must not clear the line.
    return total.trim() === '' ? { action: 'clear' } : { action: 'hold' };
  }
  if (parsed === 0) return { action: 'clear' };
  if (parsed < 0) return { action: 'hold' };
  return { action: 'set', amount: penceInput(parsed) };
}
