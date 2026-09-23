import { desc, eq, or } from 'drizzle-orm';
import { recordAudit } from '../audit';
import type { Db } from '../db/client';
import {
  checkpoints,
  externalMovements,
  pots,
  purchases,
  receipts,
  schedules,
  transfers,
} from '../db/schema';
import { formatPence, isValidPenceAmount } from '../money';
import { InvalidOccurredError, resolveOccurred } from './occurred';
import { VersionConflictError } from './errors';

/**
 * Domain functions for pots and balance checkpoints (SPEC §4–§5).
 * Used by server actions and by tests — one code path, no drift.
 * Checkpoints are immutable: there is no update or delete path, by design.
 */

export type PotKind = 'bank' | 'cash';

export interface Pot {
  id: number;
  label: string;
  kind: PotKind;
  sortOrder: number;
  overdraftLimitPence: number | null;
  warningThresholdPence: number | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export class PotNotFoundError extends Error {
  constructor(potId: number) {
    super(`No pot with id ${potId}`);
    this.name = 'PotNotFoundError';
  }
}

export class InvalidCheckpointInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCheckpointInputError';
  }
}

export const MAX_CHECKPOINT_NOTE_LENGTH = 280;

export interface CreatePotInput {
  label: string;
  kind: PotKind;
  sortOrder?: number;
  overdraftLimitPence?: number | null;
  warningThresholdPence?: number | null;
  actor: string;
  now?: Date;
}

export function createPot(db: Db, input: CreatePotInput): Pot {
  const now = input.now ?? new Date();
  return db.transaction((tx) => {
    const inserted = tx
      .insert(pots)
      .values({
        label: input.label,
        kind: input.kind,
        sortOrder: input.sortOrder ?? 0,
        overdraftLimitPence: input.overdraftLimitPence ?? null,
        warningThresholdPence: input.warningThresholdPence ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const pot = inserted;
    if (pot === undefined) {
      throw new Error('insert pot returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'pot.create',
      entity: 'pot',
      entityId: pot.id,
      summary: `Created pot "${pot.label}" (${pot.kind})`,
      after: pot,
      now,
    });
    return pot;
  });
}

export interface Checkpoint {
  id: number;
  potId: number;
  amountPence: number;
  effectiveAt: Date;
  note: string | null;
  enteredBy: string;
  createdAt: Date;
}

export interface AddCheckpointInput {
  potId: number;
  amountPence: number;
  /**
   * Exactly one timing, or neither for \"now\": an explicit instant, or a
   * date-only backdate ('YYYY-MM-DD', today or earlier) that takes effect at
   * the end of that local date (SPEC §5).
   */
  effectiveAt?: Date;
  effectiveDate?: string;
  note?: string | null;
  actor: string;
  now?: Date;
}

/**
 * Record a balance checkpoint — the user saying "this is how much is in this
 * pot at this moment" (SPEC §5). Never edits or deletes anything.
 */
export function addCheckpoint(db: Db, input: AddCheckpointInput): Checkpoint {
  const now = input.now ?? new Date();
  if (!isValidPenceAmount(input.amountPence)) {
    throw new InvalidCheckpointInputError('The checkpoint figure must be a whole-pence amount.');
  }
  let effectiveAt: Date;
  try {
    effectiveAt = resolveOccurred({
      occurredAt: input.effectiveAt,
      occurredDate: input.effectiveDate,
      now,
    }).occurredAt;
  } catch (err) {
    if (err instanceof InvalidOccurredError) {
      throw new InvalidCheckpointInputError(err.message);
    }
    throw err;
  }
  const note = checkedCheckpointNote(input.note);
  return db.transaction((tx) => {
    const potRow = tx.select().from(pots).where(eq(pots.id, input.potId)).get();
    if (potRow === undefined) {
      throw new PotNotFoundError(input.potId);
    }
    const inserted = tx
      .insert(checkpoints)
      .values({
        potId: input.potId,
        amountPence: input.amountPence,
        effectiveAt,
        note,
        enteredBy: input.actor,
        createdAt: now,
      })
      .returning()
      .get();
    const checkpoint = inserted;
    if (checkpoint === undefined) {
      throw new Error('insert checkpoint returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'checkpoint.create',
      entity: 'checkpoint',
      entityId: checkpoint.id,
      summary: `Checkpoint ${formatPence(checkpoint.amountPence)} for pot "${potRow.label}"`,
      after: checkpoint,
      now,
    });
    return checkpoint;
  });
}

export interface EditPotPatch {
  label?: string;
  kind?: PotKind;
  /** undefined = unchanged; null = no authorised overdraft. */
  overdraftLimitPence?: number | null;
  /** undefined = unchanged; null = no warning threshold. */
  warningThresholdPence?: number | null;
}

export interface EditPotInput {
  id: number;
  expectedVersion: number;
  actor: string;
  now?: Date;
  patch: EditPotPatch;
}

export class InvalidPotInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPotInputError';
  }
}

/**
 * Correct a pot's context (Settings page, SPEC §15.2): label, type and the
 * overdraft context (authorised limit + warning threshold, SPEC §4, §8).
 * Version-guarded and audited like every other shared edit; the threshold
 * must sit inside the limit — a threshold with no limit is a threshold for
 * nothing.
 */
export function editPot(db: Db, input: EditPotInput): Pot {
  const now = input.now ?? new Date();
  const patch = input.patch;
  return db.transaction((tx) => {
    const current = tx.select().from(pots).where(eq(pots.id, input.id)).get();
    if (current === undefined) throw new PotNotFoundError(input.id);
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('pot', input.id, input.expectedVersion, current.version);
    }
    const label = patch.label === undefined ? current.label : checkedPotLabel(patch.label);
    const kind: PotKind =
      patch.kind === undefined ? current.kind : (checkedPotKind(patch.kind) as PotKind);
    const limit =
      patch.overdraftLimitPence === undefined
        ? current.overdraftLimitPence
        : patch.overdraftLimitPence;
    const threshold =
      patch.warningThresholdPence === undefined
        ? current.warningThresholdPence
        : patch.warningThresholdPence;
    assertOverdraftContext(label, limit, threshold);
    const updated = tx
      .update(pots)
      .set({
        label,
        kind,
        overdraftLimitPence: limit,
        warningThresholdPence: threshold,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(pots.id, current.id))
      .returning()
      .get();
    if (updated === undefined) throw new Error('update pot returned no row');
    recordAudit(tx, {
      actor: input.actor,
      action: 'pot.edit',
      entity: 'pot',
      entityId: current.id,
      summary: `Edited pot “${current.label}” → “${label}” (${kind})`,
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

function checkedPotLabel(raw: string): string {
  const label = raw.trim().replace(/\s+/g, ' ');
  if (label === '') throw new InvalidPotInputError('Give the pot a name.');
  if (label.length > 60) {
    throw new InvalidPotInputError('Keep the name to 60 characters or fewer.');
  }
  return label;
}

function checkedPotKind(raw: string): string {
  if (raw !== 'bank' && raw !== 'cash') {
    throw new InvalidPotInputError('Choose either bank or cash.');
  }
  return raw;
}

function assertOverdraftContext(
  label: string,
  limit: number | null,
  threshold: number | null,
): void {
  const check = (value: number | null, what: string) => {
    if (value === null) return;
    if (!isValidPenceAmount(value) || value <= 0) {
      throw new InvalidPotInputError(`The ${what} must be a positive amount like 800.00.`);
    }
  };
  check(limit, 'overdraft limit');
  check(threshold, 'warning threshold');
  if (threshold !== null && limit === null) {
    throw new InvalidPotInputError(
      `Set the authorised overdraft limit on “${label}” first — the warning threshold must sit inside a limit (SPEC §8).`,
    );
  }
  if (threshold !== null && limit !== null && threshold > limit) {
    throw new InvalidPotInputError(
      'The warning threshold must sit inside the authorised overdraft limit — it is the point to warn, the limit is the edge.',
    );
  }
}

export interface ArchivePotInput {
  id: number;
  expectedVersion: number;
  actor: string;
  now?: Date;
}

/**
 * Archive an empty pot — it leaves every list and takes no new records.
 * Only a pot with no records at all (no checkpoints, purchases, transfers,
 * receipts, external movements or schedules) may be archived: hiding a pot
 * with history would silently remove its records from the estimates, which
 * is exactly the kind of quiet lie the app never tells. The row stays, so
 * nothing is ever deleted.
 */
export function archivePot(db: Db, input: ArchivePotInput): Pot {
  const now = input.now ?? new Date();
  return db.transaction((tx) => {
    const current = tx.select().from(pots).where(eq(pots.id, input.id)).get();
    if (current === undefined) throw new PotNotFoundError(input.id);
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('pot', input.id, input.expectedVersion, current.version);
    }
    if (current.archivedAt !== null) {
      throw new InvalidPotInputError(`“${current.label}” is already archived.`);
    }
    const hasCheckpoint =
      tx
        .select({ id: checkpoints.id })
        .from(checkpoints)
        .where(eq(checkpoints.potId, current.id))
        .get() !== undefined;
    const hasPurchase =
      tx
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.potId, current.id))
        .get() !== undefined;
    const hasTransfer =
      tx
        .select({ id: transfers.id })
        .from(transfers)
        .where(or(eq(transfers.fromPotId, current.id), eq(transfers.toPotId, current.id)))
        .get() !== undefined;
    const hasReceipt =
      tx.select({ id: receipts.id }).from(receipts).where(eq(receipts.potId, current.id)).get() !==
      undefined;
    const hasExternal =
      tx
        .select({ id: externalMovements.id })
        .from(externalMovements)
        .where(eq(externalMovements.potId, current.id))
        .get() !== undefined;
    const hasSchedule =
      tx
        .select({ id: schedules.id })
        .from(schedules)
        .where(eq(schedules.potId, current.id))
        .get() !== undefined;
    if (hasCheckpoint || hasPurchase || hasTransfer || hasReceipt || hasExternal || hasSchedule) {
      throw new InvalidPotInputError(
        `“${current.label}” has records against it, so it cannot be archived — its history stays visible.`,
      );
    }
    const updated = tx
      .update(pots)
      .set({ archivedAt: now, updatedAt: now, version: current.version + 1 })
      .where(eq(pots.id, current.id))
      .returning()
      .get();
    if (updated === undefined) throw new Error('update pot returned no row');
    recordAudit(tx, {
      actor: input.actor,
      action: 'pot.archive',
      entity: 'pot',
      entityId: current.id,
      summary: `Archived empty pot “${current.label}”`,
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export function listPots(db: Db): Pot[] {
  return db
    .select()
    .from(pots)
    .orderBy(pots.sortOrder, pots.label)
    .all()
    .filter((pot) => pot.archivedAt === null);
}

/**
 * Every pot, archived ones included. Read-only surfaces need this: the
 * "All Transactions" target selector must still reach an archived pot's
 * history, and a transfer or swap leg can name a pot that has since been
 * archived (SPEC §15.3). Never use it where the live-pot list is meant.
 */
export function listPotsIncludingArchived(db: Db): Pot[] {
  return db.select().from(pots).orderBy(pots.sortOrder, pots.label).all();
}

/** Latest checkpoint per pot (SPEC §5: the freshest user-reported balance). */
export function latestCheckpointPerPot(db: Db): Map<number, Checkpoint> {
  const latest = new Map<number, Checkpoint>();
  const rows = db
    .select()
    .from(checkpoints)
    .orderBy(desc(checkpoints.effectiveAt), desc(checkpoints.id))
    .all();
  for (const row of rows) {
    if (!latest.has(row.potId)) {
      latest.set(row.potId, row);
    }
  }
  return latest;
}

function checkedCheckpointNote(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const note = raw.trim();
  if (note === '') return null;
  if (note.length > MAX_CHECKPOINT_NOTE_LENGTH) {
    throw new InvalidCheckpointInputError(
      `Keep the note to ${MAX_CHECKPOINT_NOTE_LENGTH} characters or fewer.`,
    );
  }
  return note;
}

export interface CheckpointWithPotLabel extends Checkpoint {
  potLabel: string;
}

/**
 * The checkpoint timeline for one pot (Accounts & Pots page, SPEC §15.2):
 * newest first, immutable history — every reported balance ever recorded.
 */
export function checkpointsForPot(db: Db, potId: number, limit = 30): Checkpoint[] {
  return db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.potId, potId))
    .orderBy(desc(checkpoints.effectiveAt), desc(checkpoints.id))
    .limit(Math.min(Math.max(limit, 1), 200))
    .all();
}

export function recentCheckpoints(db: Db, limit = 10): CheckpointWithPotLabel[] {
  const rows = db
    .select({ checkpoint: checkpoints, potLabel: pots.label })
    .from(checkpoints)
    .innerJoin(pots, eq(pots.id, checkpoints.potId))
    .orderBy(desc(checkpoints.effectiveAt), desc(checkpoints.id))
    .limit(limit)
    .all();
  return rows.map((row) => ({ ...row.checkpoint, potLabel: row.potLabel }));
}
