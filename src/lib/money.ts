/**
 * Money handling for Simple Finance.
 *
 * Binding rules (docs/SPEC.md §6, AGENT_APP_BLUEPRINT.md §3):
 * - All amounts are integer pence. No binary floating-point arithmetic on
 *   money, ever.
 * - Parsing accepts the loose forms people actually type (£, commas, ".5",
 *   "12.3") but produces exact integers; anything with more than two decimal
 *   places or unparseable content is rejected.
 */
const AMOUNT_PATTERN = /^[+-]?(\d{1,10}(\.\d{1,2})?|\.\d{1,2})$/;

/** £9,999,999,999.99 — far beyond household scale; shared by domain and Zod validation. */
export const MAX_ABS_PENCE = 999_999_999_999;

/** True when the value is a whole-pence amount inside the representable range. */
export function isValidPenceAmount(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_ABS_PENCE
  );
}

/**
 * Parse a user-typed amount into integer pence.
 * Returns null when the input is not an exact two-decimal amount.
 */
export function parsePence(input: string): number | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[£,\s]/g, '');
  if (cleaned === '' || !AMOUNT_PATTERN.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/^[+-]/, '');
  const [poundsPart, pencePart] = unsigned.split('.');
  const pounds = poundsPart === '' ? 0 : Number.parseInt(poundsPart as string, 10);
  const pence = pencePart === undefined ? 0 : Number.parseInt(pencePart.padEnd(2, '0'), 10);
  const total = pounds * 100 + pence;
  if (!Number.isSafeInteger(total) || total > MAX_ABS_PENCE) return null;
  if (total === 0) return 0; // never hand back -0
  return negative ? -total : total;
}

/**
 * Render whole pence as the exact decimal string an amount field shows:
 * 8500 -> "85.00". The field-side mirror of `parsePence`, so a mirrored value
 * and a typed value are the same string (no thousands separators, no
 * locale drift) and re-parsing one gives the same integer back.
 */
export function penceInput(pence: number): string {
  if (!Number.isSafeInteger(pence)) {
    throw new Error(`penceInput expects an integer pence amount, received ${pence}`);
  }
  const negative = pence < 0;
  const abs = Math.abs(pence);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Integer half-up division: round(numerator / denominator) to the nearest
 * integer, halves away from zero. Pure integer arithmetic — the projection
 * engine's period-level rounding (SPEC §6, §7.3: "round once, half-up to
 * the nearest penny") must never pass through binary floating point.
 */
export function roundHalfUpDivide(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new Error(
      `roundHalfUpDivide expects whole integers, received ${numerator} / ${denominator}`,
    );
  }
  if (denominator <= 0) {
    throw new Error(`roundHalfUpDivide denominator must be positive, received ${denominator}`);
  }
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  // floor((2*n + d) / (2*d)) is exact integer half-up for n >= 0.
  return sign * Math.floor((2 * abs + denominator) / (2 * denominator));
}

/**
 * Format integer pence for display, e.g. 41235 -> "£412.35", -6608 -> "-£66.08".
 * Deterministic (no floating point, no locale drift between server and client).
 */
export function formatPence(pence: number): string {
  if (!Number.isSafeInteger(pence)) {
    throw new Error(`formatPence expects an integer pence amount, received ${pence}`);
  }
  const negative = pence < 0;
  const abs = Math.abs(pence);
  const pounds = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, '0');
  const poundsText = pounds.toLocaleString('en-GB');
  return `${negative ? '-' : ''}£${poundsText}.${remainder}`;
}
