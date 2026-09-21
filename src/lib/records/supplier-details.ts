import { asc, desc, eq, isNotNull } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import { supplierInteractions, supplierReferences, suppliers } from '../db/schema';
import { SupplierNotFoundError } from './suppliers';
import { isValidLocalDate } from '../time';

/**
 * Supplier reference pairs and the interaction log (SPEC §21.1–21.2).
 *
 * These used to be written straight into the tables by the form actions: no
 * validation, no actor in the audit trail. They are domain operations now, for
 * the same reason every other record is: one code path shared by the page, the
 * tests and the audit trail, with every write attributed to the person who
 * made it (blueprint §3).
 */

export const INTERACTION_CHANNELS = ['call', 'email', 'letter', 'in_person', 'other'] as const;
export type InteractionChannel = (typeof INTERACTION_CHANNELS)[number];

export const MAX_REFERENCE_LABEL_LENGTH = 100;
export const MAX_REFERENCE_VALUE_LENGTH = 500;
export const MAX_INTERACTION_SUMMARY_LENGTH = 1000;
export const MAX_INTERACTION_OUTCOME_LENGTH = 1000;

export class InvalidSupplierDetailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSupplierDetailError';
  }
}

export type SupplierReference = typeof supplierReferences.$inferSelect;
export type SupplierInteraction = typeof supplierInteractions.$inferSelect;

function requireSupplier(tx: DbTx, supplierId: number): { id: number; name: string } {
  const supplier = tx
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .get();
  if (supplier === undefined) throw new SupplierNotFoundError(supplierId);
  return supplier;
}

function cleanText(value: string, max: number, label: string, required: boolean): string | null {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) {
    if (required) throw new InvalidSupplierDetailError(`${label} is required.`);
    return null;
  }
  if (trimmed.length > max) {
    throw new InvalidSupplierDetailError(`Keep the ${label.toLowerCase()} to ${max} characters.`);
  }
  return trimmed;
}

export interface AddSupplierReferenceInput {
  supplierId: number;
  label: string;
  value: string;
  actor: string;
  now?: Date;
}

/** Label→value pair, e.g. "Policy number — Vehicle A" → "ABC123" (SPEC §21.1). */
export function addSupplierReference(db: Db, input: AddSupplierReferenceInput): SupplierReference {
  const now = input.now ?? new Date();
  const label = cleanText(input.label, MAX_REFERENCE_LABEL_LENGTH, 'A reference label', true)!;
  const value = cleanText(input.value, MAX_REFERENCE_VALUE_LENGTH, 'A reference value', true)!;
  return db.transaction((tx) => {
    const supplier = requireSupplier(tx, input.supplierId);
    const inserted = tx
      .insert(supplierReferences)
      .values({
        supplierId: input.supplierId,
        label,
        value,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    recordAudit(tx, {
      actor: input.actor,
      action: 'supplier.reference',
      entity: 'supplier',
      entityId: input.supplierId,
      summary: `Added reference “${label}” to supplier “${supplier.name}”`,
      after: { label, value },
      now,
    });
    return inserted;
  });
}

export interface AddSupplierInteractionInput {
  supplierId: number;
  channel: string;
  summary: string;
  outcome?: string | null;
  /** Local date ('YYYY-MM-DD') of a promised follow-up, or null. */
  followUpDate?: string | null;
  occurredAt?: Date;
  relatedPurchaseId?: number | null;
  relatedRenewalId?: number | null;
  actor: string;
  now?: Date;
}

/**
 * One interaction: what was said or sent, who recorded it and when, and the
 * optional follow-up date the Contracts & renewals panel can surface
 * (SPEC §21.2 — no notification, decision 19).
 */
export function addSupplierInteraction(
  db: Db,
  input: AddSupplierInteractionInput,
): SupplierInteraction {
  const now = input.now ?? new Date();
  if (!INTERACTION_CHANNELS.includes(input.channel as InteractionChannel)) {
    throw new InvalidSupplierDetailError('Choose how the conversation happened.');
  }
  const summary = cleanText(
    input.summary,
    MAX_INTERACTION_SUMMARY_LENGTH,
    'A summary of the interaction',
    true,
  )!;
  const outcome = input.outcome
    ? cleanText(input.outcome, MAX_INTERACTION_OUTCOME_LENGTH, 'The outcome', false)
    : null;
  const followUpDate = input.followUpDate?.trim() ? input.followUpDate.trim() : null;
  if (followUpDate !== null && !isValidLocalDate(followUpDate)) {
    throw new InvalidSupplierDetailError('Enter the follow-up date as a calendar date.');
  }
  const occurredAt = input.occurredAt ?? now;

  return db.transaction((tx) => {
    const supplier = requireSupplier(tx, input.supplierId);
    const inserted = tx
      .insert(supplierInteractions)
      .values({
        supplierId: input.supplierId,
        occurredAt,
        channel: input.channel,
        summary,
        outcome,
        followUpDate,
        relatedPurchaseId: input.relatedPurchaseId ?? null,
        relatedRenewalId: input.relatedRenewalId ?? null,
        createdBy: input.actor,
        createdAt: now,
      })
      .returning()
      .get();
    recordAudit(tx, {
      actor: input.actor,
      action: 'supplier.interaction',
      entity: 'supplier',
      entityId: input.supplierId,
      summary: `Logged a ${input.channel.replace('_', ' ')} with supplier “${supplier.name}”`,
      after: { summary, outcome, followUpDate },
      now,
    });
    return inserted;
  });
}

export function listSupplierReferences(db: Db, supplierId: number): SupplierReference[] {
  return db
    .select()
    .from(supplierReferences)
    .where(eq(supplierReferences.supplierId, supplierId))
    .orderBy(asc(supplierReferences.id))
    .all();
}

/** Newest first; the same order the Suppliers page reads. */
export function listSupplierInteractions(
  db: Db,
  supplierId: number,
  limit = 50,
): SupplierInteraction[] {
  const top = Math.min(Math.max(limit, 1), 200);
  return db
    .select()
    .from(supplierInteractions)
    .where(eq(supplierInteractions.supplierId, supplierId))
    .orderBy(desc(supplierInteractions.occurredAt), desc(supplierInteractions.id))
    .limit(top)
    .all();
}

/**
 * Follow-up dates still ahead of `today` (inclusive), soonest first — the
 * "promises do not evaporate" line SPEC §21.2 puts in the Contracts &
 * renewals panel.
 */
export interface UpcomingSupplierFollowUp {
  supplierId: number;
  supplierName: string;
  followUpDate: string;
  summary: string;
  channel: string;
}

export function upcomingSupplierFollowUps(db: Db, today: string): UpcomingSupplierFollowUp[] {
  return db
    .select({
      supplierId: supplierInteractions.supplierId,
      supplierName: suppliers.name,
      followUpDate: supplierInteractions.followUpDate,
      summary: supplierInteractions.summary,
      channel: supplierInteractions.channel,
    })
    .from(supplierInteractions)
    .innerJoin(suppliers, eq(suppliers.id, supplierInteractions.supplierId))
    .where(isNotNull(supplierInteractions.followUpDate))
    .all()
    .filter((row): row is UpcomingSupplierFollowUp => row.followUpDate !== null)
    .filter((row) => row.followUpDate >= today)
    .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
}
