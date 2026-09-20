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

const MAX_ABS_PENCE = 999_999_999_999; // £9,999,999,999.99 — far beyond household scale

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
