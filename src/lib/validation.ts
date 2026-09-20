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

const positiveIdSchema = z.number().int('Choose an option').positive('Choose an option');
const positivePenceSchema = penceAmountSchema.refine((value) => value > 0, {
  message: 'Enter a positive amount.',
});
const nonZeroPenceSchema = penceAmountSchema.refine((value) => value !== 0, {
  message: 'Enter an amount other than zero.',
});

/** A strict business-local date used by backdatable entry forms. */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-20.')
  .refine((value) => {
    // Keep the schema dependency-free from the database/domain layer while
    // still rejecting impossible dates such as 2026-02-30.
    const [year, month, day] = value.split('-').map(Number);
    const probe = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
    return (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === (month ?? 0) - 1 &&
      probe.getUTCDate() === day
    );
  }, 'That is not a real calendar date.');

const nullableText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()
    .default(null);

export const entryAllocationLineSchema = z
  .object({
    amountPence: nonZeroPenceSchema,
    categoryId: positiveIdSchema,
    targetKind: z.enum(['household', 'person', 'vehicle']),
    targetId: positiveIdSchema.nullable().default(null),
  })
  .superRefine((line, context) => {
    if (line.targetKind === 'household' && line.targetId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'A household line does not have a person or vehicle target.',
      });
    }
    if (line.targetKind !== 'household' && line.targetId === null) {
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'Choose the person or vehicle this line is for.',
      });
    }
  });

/** Parsed, server-authoritative shape for the Add Purchase flow. */
export const purchaseEntrySchema = z.object({
  supplierName: nullableText(120, 'Supplier name'),
  potId: positiveIdSchema,
  totalPence: positivePenceSchema,
  paidByPersonId: positiveIdSchema.nullable().default(null),
  occurredDate: localDateSchema.nullable().default(null),
  note: nullableText(280, 'Note'),
  lines: z.array(entryAllocationLineSchema).min(1, 'Add at least one allocation line.'),
});

/** Parsed, server-authoritative shape for the two-tap Add Fuel flow. */
export const fuelEntrySchema = z.object({
  supplierName: nullableText(120, 'Supplier name'),
  potId: positiveIdSchema,
  vehicleId: positiveIdSchema,
  paidByPersonId: positiveIdSchema.nullable().default(null),
  amountPence: positivePenceSchema,
  occurredDate: localDateSchema.nullable().default(null),
  note: nullableText(280, 'Note'),
});

/** Parsed, server-authoritative shape for Update Balance. */
export const checkpointEntrySchema = z.object({
  potId: positiveIdSchema,
  amountPence: penceAmountSchema,
  effectiveDate: localDateSchema.nullable().default(null),
  note: nullableText(280, 'Note'),
});
