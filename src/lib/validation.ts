import { z } from 'zod';
import { MAX_ABS_PENCE } from './money';

/**
 * Zod schemas at the server boundary (blueprint §3). Browser validation is
 * assistance, never authority — server actions revalidate everything here.
 *
 * Amounts arrive as typed strings and are converted to integer pence by
 * parsePence before these schemas see them (money is never floating point).
 */
export const potLabelSchema = z
  .string()
  .trim()
  .min(1, 'Give the pot a name')
  .max(60, 'Keep the name to 60 characters or fewer');

export const potKindSchema = z.enum(['bank', 'cash'], {
  error: 'Choose either bank or cash',
});

/** ±MAX_ABS_PENCE — matches parsePence bounds; bank balances may be negative (overdraft). */
export const penceAmountSchema = z
  .number()
  .int('Amount must be whole pence')
  .refine((v) => Math.abs(v) <= MAX_ABS_PENCE, 'Amount is out of range');

export const checkpointNoteSchema = z
  .string()
  .trim()
  .max(280, 'Keep the note to 280 characters or fewer')
  .transform((v) => (v === '' ? null : v));

export const potIdSchema = z.coerce
  .number({ error: 'Choose a pot' })
  .int('Choose a pot')
  .positive('Choose a pot');

export const backupPasswordSchema = z
  .string()
  .min(1, 'A backup password is required')
  .max(1024, 'That password is too long');
