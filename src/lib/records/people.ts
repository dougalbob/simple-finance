import { asc, eq } from 'drizzle-orm';
import { recordAudit } from '../audit';
import type { Db } from '../db/client';
import { people } from '../db/schema';
import { VersionConflictError } from './errors';

/**
 * Household members (SPEC §3): the people behind paid-by and for-person
 * attribution. Labels are configured privately; exactly two in this
 * household, but the table does not hard-code that cardinality.
 */

export type Person = typeof people.$inferSelect;

export class PersonNotFoundError extends Error {
  constructor(personId: number) {
    super(`No person with id ${personId}`);
    this.name = 'PersonNotFoundError';
  }
}

export class InvalidPersonLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPersonLabelError';
  }
}

export class DuplicatePersonLabelError extends Error {
  constructor(label: string) {
    super(`There is already a person called “${label}”.`);
    this.name = 'DuplicatePersonLabelError';
  }
}

export const MAX_PERSON_LABEL_LENGTH = 60;

export function listPeople(db: Db): Person[] {
  return db.select().from(people).orderBy(asc(people.sortOrder), asc(people.label)).all();
}

export function getPerson(db: Db, personId: number): Person {
  const row = db.select().from(people).where(eq(people.id, personId)).get();
  if (row === undefined) {
    throw new PersonNotFoundError(personId);
  }
  return row;
}

export interface CreatePersonInput {
  label: string;
  actor: string;
  sortOrder?: number;
  now?: Date;
}

export function createPerson(db: Db, input: CreatePersonInput): Person {
  const now = input.now ?? new Date();
  const label = checkedLabel(input.label);
  return db.transaction((tx) => {
    assertLabelFree(tx.select().from(people).all(), label, null);
    const existing = tx.select().from(people).all();
    const inserted = tx
      .insert(people)
      .values({
        label,
        sortOrder: input.sortOrder ?? existing.length,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (inserted === undefined) {
      throw new Error('insert person returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'person.create',
      entity: 'person',
      entityId: inserted.id,
      summary: `Added person “${inserted.label}”`,
      after: inserted,
      now,
    });
    return inserted;
  });
}

export interface RenamePersonInput {
  id: number;
  expectedVersion: number;
  label: string;
  actor: string;
  now?: Date;
}

export function renamePerson(db: Db, input: RenamePersonInput): Person {
  const now = input.now ?? new Date();
  const label = checkedLabel(input.label);
  return db.transaction((tx) => {
    const current = tx.select().from(people).where(eq(people.id, input.id)).get();
    if (current === undefined) {
      throw new PersonNotFoundError(input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('person', input.id, input.expectedVersion, current.version);
    }
    assertLabelFree(tx.select().from(people).all(), label, current.id);
    const updated = tx
      .update(people)
      .set({ label, updatedAt: now, version: current.version + 1 })
      .where(eq(people.id, input.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update person returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'person.rename',
      entity: 'person',
      entityId: input.id,
      summary: `Renamed person “${current.label}” to “${label}”`,
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

function checkedLabel(raw: string): string {
  const label = raw.trim().replace(/\s+/g, ' ');
  if (label === '') {
    throw new InvalidPersonLabelError('Give the person a name.');
  }
  if (label.length > MAX_PERSON_LABEL_LENGTH) {
    throw new InvalidPersonLabelError(
      `Keep the name to ${MAX_PERSON_LABEL_LENGTH} characters or fewer.`,
    );
  }
  return label;
}

function assertLabelFree(rows: Person[], label: string, selfId: number | null): void {
  const clash = rows.some(
    (row) => row.id !== selfId && row.label.toLowerCase() === label.toLowerCase(),
  );
  if (clash) {
    throw new DuplicatePersonLabelError(label);
  }
}
