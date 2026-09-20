import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import { people, renewals, suppliers, vehicles } from '../db/schema';
import { isValidLocalDate, toLocalDateString } from '../time';
import { addYearsClamped } from './dates';
import { VersionConflictError } from './errors';
import { PersonNotFoundError } from './people';
import { SupplierNotFoundError } from './suppliers';
import { VehicleNotFoundError } from './vehicles';

/**
 * Renewals (docs/SPEC.md §22.2): insurance and anything else that
 * auto-renews. A renewal is an alert plus context — where the money also
 * moves (an annual premium), that is a separate annual schedule (plan
 * decision 24); reminder and money stay separate and never double-count
 * (SPEC §22.2, E9).
 *
 * Annual advance (pure date arithmetic, OQ13): when a repeating renewal
 * date reaches or passes, it advances a year automatically — visible via
 * the audit trail and the `advancedFrom` history column, and always
 * editable by hand. 29 February lands on 28 February in non-leap years.
 */

export type Renewal = typeof renewals.$inferSelect;

export class RenewalNotFoundError extends Error {
  constructor(renewalId: number) {
    super(`No renewal with id ${renewalId}`);
    this.name = 'RenewalNotFoundError';
  }
}

export class InvalidRenewalInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRenewalInputError';
  }
}

export const MAX_RENEWAL_LABEL_LENGTH = 60;
export const MAX_RENEWAL_NOTES_LENGTH = 280;
export const DEFAULT_RENEWAL_WARN_DAYS = 21;
export const MAX_WARN_DAYS = 365;

/** SPEC §22.2: optional target is a vehicle or the household. */
export type RenewalTargetKind = 'household' | 'person' | 'vehicle';

export interface CreateRenewalInput {
  label: string;
  supplierId?: number | null;
  targetKind?: RenewalTargetKind;
  targetId?: number | null;
  /** 'YYYY-MM-DD'. */
  nextRenewalDate: string;
  warnDaysBefore?: number;
  repeatsAnnually?: boolean;
  notes?: string | null;
  actor: string;
  now?: Date;
}

export function createRenewal(db: Db, input: CreateRenewalInput): Renewal {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const effective = checkedRenewalFields(db, {
    label: input.label,
    supplierId: input.supplierId ?? null,
    targetKind: input.targetKind ?? 'household',
    targetId: input.targetId ?? null,
    nextRenewalDate: input.nextRenewalDate,
    warnDaysBefore: input.warnDaysBefore ?? DEFAULT_RENEWAL_WARN_DAYS,
    repeatsAnnually: input.repeatsAnnually ?? true,
    notes: input.notes ?? null,
  });
  return db.transaction((tx) => {
    const inserted = tx
      .insert(renewals)
      .values({
        label: effective.label,
        supplierId: effective.supplierId,
        targetKind: effective.targetKind,
        targetId: effective.targetId,
        nextRenewalDate: effective.nextRenewalDate,
        warnDaysBefore: effective.warnDaysBefore,
        repeatsAnnually: effective.repeatsAnnually,
        notes: effective.notes,
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (inserted === undefined) throw new Error('insert renewal returned no row');
    recordAudit(tx, {
      actor,
      action: 'renewal.create',
      entity: 'renewal',
      entityId: inserted.id,
      summary: `Added renewal “${effective.label}” due ${effective.nextRenewalDate} (warn ${effective.warnDaysBefore} days before)`,
      after: inserted,
      now,
    });
    return inserted;
  });
}

export interface EditRenewalPatch {
  label?: string;
  supplierId?: number | null;
  targetKind?: RenewalTargetKind;
  targetId?: number | null;
  nextRenewalDate?: string;
  warnDaysBefore?: number;
  repeatsAnnually?: boolean;
  /** undefined = unchanged; null = clear. */
  notes?: string | null;
}

export interface EditRenewalInput {
  id: number;
  expectedVersion: number;
  actor: string;
  now?: Date;
  patch: EditRenewalPatch;
}

export function editRenewal(db: Db, input: EditRenewalInput): Renewal {
  const now = input.now ?? new Date();
  const actor = checkedActor(input.actor);
  const patch = input.patch;
  return db.transaction((tx) => {
    const current = tx.select().from(renewals).where(eq(renewals.id, input.id)).get();
    if (current === undefined) throw new RenewalNotFoundError(input.id);
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('renewal', input.id, input.expectedVersion, current.version);
    }
    const effective = checkedRenewalFields(tx, {
      label: patch.label ?? current.label,
      supplierId: patch.supplierId === undefined ? current.supplierId : patch.supplierId,
      targetKind: patch.targetKind ?? current.targetKind,
      targetId: patch.targetId === undefined ? current.targetId : patch.targetId,
      nextRenewalDate: patch.nextRenewalDate ?? current.nextRenewalDate,
      warnDaysBefore: patch.warnDaysBefore ?? current.warnDaysBefore,
      repeatsAnnually: patch.repeatsAnnually ?? current.repeatsAnnually,
      notes: patch.notes === undefined ? current.notes : patch.notes,
    });
    const updated = tx
      .update(renewals)
      .set({
        label: effective.label,
        supplierId: effective.supplierId,
        targetKind: effective.targetKind,
        targetId: effective.targetId,
        nextRenewalDate: effective.nextRenewalDate,
        warnDaysBefore: effective.warnDaysBefore,
        repeatsAnnually: effective.repeatsAnnually,
        notes: effective.notes,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(renewals.id, current.id))
      .returning()
      .get();
    if (updated === undefined) throw new Error('update renewal returned no row');
    recordAudit(tx, {
      actor,
      action: 'renewal.edit',
      entity: 'renewal',
      entityId: current.id,
      summary: `Edited renewal “${current.label}”`,
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export function getRenewal(db: Db, renewalId: number): Renewal {
  const row = db.select().from(renewals).where(eq(renewals.id, renewalId)).get();
  if (row === undefined) throw new RenewalNotFoundError(renewalId);
  return row;
}

export function listRenewals(db: Db): Renewal[] {
  return db.select().from(renewals).orderBy(asc(renewals.nextRenewalDate), asc(renewals.id)).all();
}

/**
 * The lazy annual advance (SPEC §22.2): a repeating renewal whose date has
 * reached or passed moves a year forward — visible (audit + advancedFrom)
 * and editable. Non-repeating renewals are left in place; the key-date
 * engine shows them as past. Runs in one transaction; returns the count.
 */
export function advanceDueRenewals(db: Db, nowArg?: Date): number {
  const now = nowArg ?? new Date();
  const today = toLocalDateString(now);
  return db.transaction((tx) => {
    let advancedCount = 0;
    // Fully catch up in one pass: a renewal that missed several cycles
    // (e.g. the household created it late) steps one year at a time until
    // its date is in the future — each year its own audited step. Bounded:
    // a renewal older than 50 cycles is a data problem, not a loop.
    let guard = 0;
    for (;;) {
      if (guard >= 50) break;
      guard += 1;
      const dueRows = tx
        .select()
        .from(renewals)
        .where(and(eq(renewals.repeatsAnnually, true), lte(renewals.nextRenewalDate, today)))
        .all();
      if (dueRows.length === 0) break;
      for (const renewal of dueRows) {
        const previous = renewal.nextRenewalDate;
        const advancedTo = addYearsClamped(previous, 1);
        tx.update(renewals)
          .set({
            nextRenewalDate: advancedTo,
            advancedFrom: previous,
            updatedAt: now,
            version: renewal.version + 1,
          })
          .where(eq(renewals.id, renewal.id))
          .run();
        recordAudit(tx, {
          actor: 'system',
          action: 'renewal.advance',
          entity: 'renewal',
          entityId: renewal.id,
          summary: `Renewal “${renewal.label}” advanced from ${previous} to ${advancedTo}`,
          before: { nextRenewalDate: previous },
          after: { nextRenewalDate: advancedTo, advancedFrom: previous },
          now,
        });
        advancedCount += 1;
      }
    }
    return advancedCount;
  });
}

interface CheckedRenewalFields {
  label: string;
  supplierId: number | null;
  targetKind: RenewalTargetKind;
  targetId: number | null;
  nextRenewalDate: string;
  warnDaysBefore: number;
  repeatsAnnually: boolean;
  notes: string | null;
}

function checkedRenewalFields(
  db: Db | DbTx,
  input: {
    label: string;
    supplierId: number | null;
    targetKind: RenewalTargetKind;
    targetId: number | null;
    nextRenewalDate: string;
    warnDaysBefore: number;
    repeatsAnnually: boolean;
    notes: string | null;
  },
): CheckedRenewalFields {
  const label = input.label.trim().replace(/\s+/g, ' ');
  if (label === '') throw new InvalidRenewalInputError('Give the renewal a label.');
  if (label.length > MAX_RENEWAL_LABEL_LENGTH) {
    throw new InvalidRenewalInputError(
      `Keep the label to ${MAX_RENEWAL_LABEL_LENGTH} characters or fewer.`,
    );
  }
  if (!isValidLocalDate(input.nextRenewalDate)) {
    throw new InvalidRenewalInputError('The renewal date must be a date like 2026-10-12.');
  }
  if (
    !Number.isInteger(input.warnDaysBefore) ||
    input.warnDaysBefore < 0 ||
    input.warnDaysBefore > MAX_WARN_DAYS
  ) {
    throw new InvalidRenewalInputError(
      `The warning lead must be a whole number of days between 0 and ${MAX_WARN_DAYS}.`,
    );
  }
  if (input.supplierId !== null) {
    const supplier = db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, input.supplierId))
      .get();
    if (supplier === undefined) throw new SupplierNotFoundError(input.supplierId);
  }
  if (input.targetKind === 'household') {
    if (input.targetId !== null) {
      throw new InvalidRenewalInputError('A household renewal has no person or vehicle target.');
    }
  } else if (input.targetKind === 'person') {
    if (input.targetId === null)
      throw new InvalidRenewalInputError('Choose which person this renewal is for.');
    const person = db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.id, input.targetId))
      .get();
    if (person === undefined) throw new PersonNotFoundError(input.targetId);
  } else if (input.targetKind === 'vehicle') {
    if (input.targetId === null)
      throw new InvalidRenewalInputError('Choose which vehicle this renewal is for.');
    const vehicle = db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, input.targetId))
      .get();
    if (vehicle === undefined) throw new VehicleNotFoundError(input.targetId);
  } else {
    throw new InvalidRenewalInputError(`Unknown target “${input.targetKind}”.`);
  }
  let notes: string | null = null;
  if (input.notes !== null) {
    notes = input.notes.trim();
    if (notes === '') notes = null;
    else if (notes.length > MAX_RENEWAL_NOTES_LENGTH) {
      throw new InvalidRenewalInputError(
        `Keep the notes to ${MAX_RENEWAL_NOTES_LENGTH} characters or fewer.`,
      );
    }
  }
  return {
    label,
    supplierId: input.supplierId,
    targetKind: input.targetKind,
    targetId: input.targetKind === 'household' ? null : input.targetId,
    nextRenewalDate: input.nextRenewalDate,
    warnDaysBefore: input.warnDaysBefore,
    repeatsAnnually: input.repeatsAnnually,
    notes,
  };
}

function checkedActor(raw: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new InvalidRenewalInputError('Every renewal records who added it.');
  }
  return raw.trim();
}
