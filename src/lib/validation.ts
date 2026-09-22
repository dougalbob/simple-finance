import { z } from 'zod';
import { MAX_ABS_PENCE } from './money';
import { MIN_BACKUP_PASSWORD_LENGTH } from './backup/policy';

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

/**
 * Password strength for a NEW archive (see lib/backup/policy.ts). Restoring
 * deliberately accepts any non-empty password, but creating one with a single
 * character would make the household's only copy of their data trivially
 * guessable: scrypt slows a brute-force attack, it does not rescue a weak
 * passphrase.
 */
export const backupPasswordCreateSchema = z
  .string()
  .min(
    MIN_BACKUP_PASSWORD_LENGTH,
    `Use a passphrase of at least ${MIN_BACKUP_PASSWORD_LENGTH} characters — this password is the only thing protecting the archive.`,
  )
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

/** Parsed, server-authoritative shape for adding a schedule (Phase 3, SPEC §11). */
export const scheduleEntrySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Give the schedule a name')
      .max(60, 'Keep the name to 60 characters or fewer'),
    kind: z.enum(['dd', 'so', 'receipt']),
    frequency: z.enum(['monthly', 'annual']),
    dueDayOfMonth: z.number().int('Whole day').min(1, 'Day 1–31').max(31, 'Day 1–31'),
    dueMonth: positiveIdSchema
      .refine((v) => v >= 1 && v <= 12, 'Month 1–12')
      .nullable()
      .default(null),
    amountPence: positivePenceSchema,
    potId: positiveIdSchema,
    categoryId: positiveIdSchema.nullable().default(null),
    /** Existing supplier id, or null for standing-order household transfer / receipts. */
    supplierId: positiveIdSchema.nullable().default(null),
    /** Inline new supplier name from the recurring form (mutually exclusive with supplierId). */
    supplierName: nullableText(120, 'Supplier name'),
    targetKind: z.enum(['household', 'person', 'vehicle']).default('household'),
    targetId: positiveIdSchema.nullable().default(null),
    contractEndsOn: localDateSchema.nullable().default(null),
    activeFrom: localDateSchema,
    activeUntil: localDateSchema.nullable().default(null),
  })
  .superRefine((value, context) => {
    if (value.frequency === 'annual' && value.dueMonth === null) {
      context.addIssue({
        code: 'custom',
        path: ['dueMonth'],
        message: 'Annual schedules need a due month.',
      });
    }
    if (value.kind === 'receipt' && value.categoryId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['categoryId'],
        message: 'Expected receipts have no category — income is not spending.',
      });
    }
    if (value.kind !== 'receipt' && value.categoryId === null) {
      context.addIssue({
        code: 'custom',
        path: ['categoryId'],
        message: 'Choose a category for the direct debit or standing order.',
      });
    }
    if (value.kind === 'receipt' && (value.supplierId !== null || value.supplierName !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['supplierId'],
        message: 'Expected receipts have no supplier — income is not spending.',
      });
    }
    if (value.kind === 'dd' && value.supplierId === null && value.supplierName === null) {
      context.addIssue({
        code: 'custom',
        path: ['supplierId'],
        message: 'Choose a supplier for the direct debit, or add a new one by name.',
      });
    }
    if (value.supplierId !== null && value.supplierName !== null) {
      context.addIssue({
        code: 'custom',
        path: ['supplierId'],
        message: 'Give the supplier by name or by selection, not both.',
      });
    }
    if (value.targetKind === 'household' && value.targetId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'A household schedule has no person or vehicle target.',
      });
    }
    if (value.targetKind !== 'household' && value.targetId === null) {
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'Choose the person or vehicle this schedule is for.',
      });
    }
  });

/** Parsed shape for cancelling a schedule with an effective date (SPEC §11.2). */
export const cancelScheduleEntrySchema = z.object({
  scheduleId: positiveIdSchema,
  expectedVersion: positiveIdSchema,
  effectiveOn: localDateSchema,
});

/** Parsed shape for adding a renewal (SPEC §22.2). */
export const renewalEntrySchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Give the renewal a label')
    .max(60, 'Keep the label to 60 characters or fewer'),
  nextRenewalDate: localDateSchema,
  warnDaysBefore: z
    .number()
    .int('Whole days')
    .min(0, '0 days or more')
    .max(365, '365 days or fewer')
    .default(21),
  repeatsAnnually: z.boolean().default(true),
  supplierId: positiveIdSchema.nullable().default(null),
  targetKind: z.enum(['household', 'person', 'vehicle']).default('household'),
  targetId: positiveIdSchema.nullable().default(null),
  notes: nullableText(280, 'Notes'),
});

const nonNegativePenceSchema = penceAmountSchema.refine((value) => value >= 0, {
  message: 'Enter zero or a positive amount.',
});

/**
 * Parsed shape for the projection figures (SPEC §7.3). Fuel figures arrive
 * per vehicle as a record of vehicle id → pence (empty string = cleared).
 */
export const projectionSettingsEntrySchema = z.object({
  weeklyGroceriesPence: nonNegativePenceSchema.nullable(),
  monthlyFuelPence: z.record(z.string(), nonNegativePenceSchema.nullable()).default({}),
});

/* ------------------------------------------------------------------ */
/* Phase 4a — desktop review pages (SPEC §15.2, §16)                   */
/* ------------------------------------------------------------------ */

/** Version-guarded void of a correctable record (purchase or transfer). */
export const voidRecordEntrySchema = z.object({
  recordId: positiveIdSchema,
  expectedVersion: positiveIdSchema,
  reason: nullableText(280, 'Void reason'),
});

/**
 * Inline edit of a purchase (Purchases page, SPEC §15.2): the editable fields
 * this form owns (date, note and full replacement allocation lines). The
 * action derives the total from those lines and leaves the supplier / pot /
 * payer unchanged.
 */
export const editPurchaseEntrySchema = z.object({
  purchaseId: positiveIdSchema,
  expectedVersion: positiveIdSchema,
  occurredDate: localDateSchema.nullable().default(null),
  note: nullableText(280, 'Note'),
  lines: z.array(entryAllocationLineSchema).min(1, 'Add at least one allocation line.'),
});

/**
 * Refund entry (SPEC §9.5): total is typed as a positive magnitude and the
 * server hands the domain the negative record. Lines must (category,
 * target)-match the original and total the refund exactly — the domain
 * re-validates both, plus the cumulative-refund cap.
 */
export const refundEntrySchema = z.object({
  refundOfPurchaseId: positiveIdSchema,
  totalPence: positivePenceSchema,
  potId: positiveIdSchema,
  supplierName: nullableText(120, 'Supplier name'),
  paidByPersonId: positiveIdSchema.nullable().default(null),
  occurredDate: localDateSchema.nullable().default(null),
  note: nullableText(280, 'Note'),
  lines: z.array(entryAllocationLineSchema).min(1, 'A refund needs at least one line.'),
});

/**
 * Schedule correction (SPEC §11.1): applies from the next instance onward;
 * converted history is never rewritten. The kind is immutable (a direct
 * debit does not become income) — the domain edit path does not accept it.
 */
export const editScheduleEntrySchema = z
  .object({
    scheduleId: positiveIdSchema,
    expectedVersion: positiveIdSchema,
    name: z
      .string()
      .trim()
      .min(1, 'Give the schedule a name')
      .max(60, 'Keep the name to 60 characters or fewer'),
    frequency: z.enum(['monthly', 'annual']),
    dueDayOfMonth: z.number().int('Whole day').min(1, 'Day 1–31').max(31, 'Day 1–31'),
    dueMonth: positiveIdSchema
      .refine((v) => v >= 1 && v <= 12, 'Month 1–12')
      .nullable()
      .default(null),
    amountPence: positivePenceSchema,
    potId: positiveIdSchema,
    categoryId: positiveIdSchema.nullable().default(null),
    /** Existing supplier id; null clears on standing orders. Receipt schedules omit the field. */
    supplierId: positiveIdSchema.nullable().default(null),
    supplierName: nullableText(120, 'Supplier name'),
    targetKind: z.enum(['household', 'person', 'vehicle']).default('household'),
    targetId: positiveIdSchema.nullable().default(null),
    contractEndsOn: localDateSchema.nullable().default(null),
    activeUntil: localDateSchema.nullable().default(null),
  })
  .superRefine((value, context) => {
    if (value.frequency === 'annual' && value.dueMonth === null) {
      context.addIssue({
        code: 'custom',
        path: ['dueMonth'],
        message: 'Annual schedules need a due month.',
      });
    }
    if (value.supplierId !== null && value.supplierName !== null) {
      context.addIssue({
        code: 'custom',
        path: ['supplierId'],
        message: 'Give the supplier by name or by selection, not both.',
      });
    }
    if (value.targetKind === 'household' && value.targetId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'A household schedule has no person or vehicle target.',
      });
    }
    if (value.targetKind !== 'household' && value.targetId === null) {
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'Choose the person or vehicle this schedule is for.',
      });
    }
  });

/** Renewal correction (SPEC §22.2 — visible, editable, audited). */
export const editRenewalEntrySchema = z.object({
  renewalId: positiveIdSchema,
  expectedVersion: positiveIdSchema,
  label: z
    .string()
    .trim()
    .min(1, 'Give the renewal a label')
    .max(60, 'Keep the label to 60 characters or fewer'),
  nextRenewalDate: localDateSchema,
  warnDaysBefore: z
    .number()
    .int('Whole days')
    .min(0, '0 days or more')
    .max(365, '365 days or fewer'),
  repeatsAnnually: z.boolean(),
  supplierId: positiveIdSchema.nullable().default(null),
  targetKind: z.enum(['household', 'person', 'vehicle']).default('household'),
  targetId: positiveIdSchema.nullable().default(null),
  notes: nullableText(280, 'Notes'),
});

/** Pot-to-pot transfer record (SPEC §10 — never spending). */
export const transferEntrySchema = z.object({
  fromPotId: positiveIdSchema,
  toPotId: positiveIdSchema,
  amountPence: positivePenceSchema,
  occurredDate: localDateSchema.nullable().default(null),
  note: nullableText(280, 'Note'),
});

/**
 * Pot context edit (Settings page, SPEC §15.2): label, type and the
 * overdraft context. Blanks clear the optional figures; the threshold-
 * inside-limit rule is the domain's to enforce (SPEC §8).
 */
export const editPotEntrySchema = z.object({
  potId: positiveIdSchema,
  expectedVersion: positiveIdSchema,
  label: z
    .string()
    .trim()
    .min(1, 'Give the pot a name')
    .max(60, 'Keep the name to 60 characters or fewer'),
  kind: z.enum(['bank', 'cash']),
  overdraftLimitPence: nonNegativePenceSchema.nullable(),
  warningThresholdPence: nonNegativePenceSchema.nullable(),
});

/** Household label rename (Settings page): person or vehicle, version-guarded. */
export const renameTargetEntrySchema = z.object({
  kind: z.enum(['person', 'vehicle']),
  targetId: positiveIdSchema,
  expectedVersion: positiveIdSchema,
  label: z
    .string()
    .trim()
    .min(1, 'Give it a name')
    .max(60, 'Keep the name to 60 characters or fewer'),
});

/**
 * Category tree editor operations (Settings page, SPEC §12): add a parent
 * or a child, rename a node (parent or child), retire a child (parents stay
 * while history points at them). The domain enforces two levels, sibling
 * name uniqueness and retire rules.
 */
export const categoryEntrySchema = z
  .object({
    op: z.enum(['add-parent', 'add-child', 'rename', 'retire']),
    parentId: positiveIdSchema.nullable().default(null),
    categoryId: positiveIdSchema.nullable().default(null),
    expectedVersion: positiveIdSchema.nullable().default(null),
    name: z.string().trim().max(60, 'Keep the name to 60 characters or fewer').default(''),
  })
  .superRefine((value, context) => {
    if (value.op === 'add-parent' && value.name === '') {
      context.addIssue({ code: 'custom', path: ['name'], message: 'Give the parent a name.' });
    }
    if (value.op === 'add-child') {
      if (value.parentId === null) {
        context.addIssue({ code: 'custom', path: ['parentId'], message: 'Choose the parent.' });
      }
      if (value.name === '') {
        context.addIssue({ code: 'custom', path: ['name'], message: 'Give the child a name.' });
      }
    }
    if (value.op === 'rename') {
      if (value.categoryId === null) {
        context.addIssue({ code: 'custom', path: ['categoryId'], message: 'Choose the category.' });
      }
      if (value.expectedVersion === null) {
        context.addIssue({
          code: 'custom',
          path: ['expectedVersion'],
          message: 'The rename link is incomplete — refresh.',
        });
      }
      if (value.name === '') {
        context.addIssue({ code: 'custom', path: ['name'], message: 'Give the category a name.' });
      }
    }
    if (value.op === 'retire') {
      if (value.categoryId === null) {
        context.addIssue({ code: 'custom', path: ['categoryId'], message: 'Choose the category.' });
      }
      if (value.expectedVersion === null) {
        context.addIssue({
          code: 'custom',
          path: ['expectedVersion'],
          message: 'The retire link is incomplete — refresh.',
        });
      }
    }
  });

/** Default warning leads for key dates (SPEC §22, decision 23). */
export const warningLeadsEntrySchema = z.object({
  renewalLeadDays: z
    .number()
    .int('Whole days')
    .min(0, '0 days or more')
    .max(365, '365 days or fewer'),
  contractEndLeadDays: z
    .number()
    .int('Whole days')
    .min(0, '0 days or more')
    .max(365, '365 days or fewer'),
});

/**
 * Supplier contact card (SPEC §21.1). Empty strings arrive as null; the domain
 * still enforces lengths and shape, this is the boundary that stops obvious
 * nonsense (a 5,000-character phone number) before it reaches it.
 */
export const supplierContactEntrySchema = z.object({
  id: z.number().int().positive('Unknown supplier'),
  expectedVersion: z.number().int().positive('The edit link is incomplete — refresh.'),
  contactPhone: z.string().max(254, 'Keep the phone number to 254 characters.').nullable(),
  contactEmail: z
    .string()
    .max(254, 'Keep the email to 254 characters.')
    .refine(
      (value) => value === null || value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      'That does not look like an email address.',
    )
    .nullable(),
  website: z.string().max(254, 'Keep the website to 254 characters.').nullable(),
  address: z.string().max(254, 'Keep the address to 254 characters.').nullable(),
  notes: z.string().max(2000, 'Keep the notes to 2000 characters.').nullable(),
});

/** Supplier reference pair (SPEC §21.1). */
export const supplierReferenceEntrySchema = z.object({
  supplierId: z.number().int().positive('Unknown supplier'),
  label: z.string().trim().min(1, 'Give the reference a label.').max(100, 'Label too long.'),
  value: z.string().trim().min(1, 'Give the reference a value.').max(500, 'Value too long.'),
});

/** Interaction log entry (SPEC §21.2). */
export const supplierInteractionEntrySchema = z.object({
  supplierId: z.number().int().positive('Unknown supplier'),
  channel: z.enum(['call', 'email', 'letter', 'in_person', 'other'], {
    error: 'Choose how the conversation happened.',
  }),
  summary: z.string().trim().min(1, 'Say what happened.').max(1000, 'Summary too long.'),
  outcome: z.string().max(1000, 'Outcome too long.').nullable(),
  followUpDate: z.string().nullable(),
});
