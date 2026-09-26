import { z } from 'zod';

export const PAYMENT_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Calendar months, before any income weekend adjustment. */
export const excludedMonthsSchema = z
  .array(z.number().int().min(1).max(12))
  .max(11, 'Leave at least one month with a payment.')
  .refine((months) => new Set(months).size === months.length, 'Choose each month only once.')
  .transform((months) => [...months].sort((a, b) => a - b));
