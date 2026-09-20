import { desc, eq } from 'drizzle-orm';
import { recordAudit } from '../audit';
import type { Db } from '../db/client';
import { checkpoints, pots } from '../db/schema';
import { formatPence, isValidPenceAmount } from '../money';
import { InvalidOccurredError, resolveOccurred } from './occurred';

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

export function listPots(db: Db): Pot[] {
  return db
    .select()
    .from(pots)
    .orderBy(pots.sortOrder, pots.label)
    .all()
    .filter((pot) => pot.archivedAt === null);
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
