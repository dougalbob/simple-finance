import { asc, eq } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import { people, vehicles } from '../db/schema';
import { VersionConflictError } from './errors';
import { PersonNotFoundError } from './people';

/**
 * Vehicles as first-class running-cost targets (SPEC §13). Costs stay with
 * the vehicle regardless of who paid or drove; the owner exists only for
 * reporting roll-ups.
 */

export type Vehicle = typeof vehicles.$inferSelect;

export class VehicleNotFoundError extends Error {
  constructor(vehicleId: number) {
    super(`No vehicle with id ${vehicleId}`);
    this.name = 'VehicleNotFoundError';
  }
}

export class InvalidVehicleLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidVehicleLabelError';
  }
}

export class DuplicateVehicleLabelError extends Error {
  constructor(label: string) {
    super(`There is already a vehicle called “${label}”.`);
    this.name = 'DuplicateVehicleLabelError';
  }
}

export const MAX_VEHICLE_LABEL_LENGTH = 60;

export function listVehicles(db: Db): Vehicle[] {
  return db.select().from(vehicles).orderBy(asc(vehicles.sortOrder), asc(vehicles.label)).all();
}

export function getVehicle(db: Db, vehicleId: number): Vehicle {
  const row = db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).get();
  if (row === undefined) {
    throw new VehicleNotFoundError(vehicleId);
  }
  return row;
}

export interface CreateVehicleInput {
  label: string;
  ownerPersonId?: number | null;
  actor: string;
  sortOrder?: number;
  now?: Date;
}

export function createVehicle(db: Db, input: CreateVehicleInput): Vehicle {
  const now = input.now ?? new Date();
  const label = checkedLabel(input.label);
  return db.transaction((tx) => {
    if (input.ownerPersonId !== undefined && input.ownerPersonId !== null) {
      assertPersonExists(tx, input.ownerPersonId);
    }
    assertLabelFree(tx.select().from(vehicles).all(), label, null);
    const existing = tx.select().from(vehicles).all();
    const inserted = tx
      .insert(vehicles)
      .values({
        label,
        ownerPersonId: input.ownerPersonId ?? null,
        sortOrder: input.sortOrder ?? existing.length,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (inserted === undefined) {
      throw new Error('insert vehicle returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'vehicle.create',
      entity: 'vehicle',
      entityId: inserted.id,
      summary: `Added vehicle “${inserted.label}”`,
      after: inserted,
      now,
    });
    return inserted;
  });
}

export interface RenameVehicleInput {
  id: number;
  expectedVersion: number;
  label: string;
  actor: string;
  now?: Date;
}

export function renameVehicle(db: Db, input: RenameVehicleInput): Vehicle {
  const now = input.now ?? new Date();
  const label = checkedLabel(input.label);
  return db.transaction((tx) => {
    const current = tx.select().from(vehicles).where(eq(vehicles.id, input.id)).get();
    if (current === undefined) {
      throw new VehicleNotFoundError(input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('vehicle', input.id, input.expectedVersion, current.version);
    }
    assertLabelFree(tx.select().from(vehicles).all(), label, current.id);
    const updated = tx
      .update(vehicles)
      .set({ label, updatedAt: now, version: current.version + 1 })
      .where(eq(vehicles.id, input.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update vehicle returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'vehicle.rename',
      entity: 'vehicle',
      entityId: input.id,
      summary: `Renamed vehicle “${current.label}” to “${label}”`,
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export interface SetVehicleOwnerInput {
  id: number;
  expectedVersion: number;
  ownerPersonId: number | null;
  actor: string;
  now?: Date;
}

export function setVehicleOwner(db: Db, input: SetVehicleOwnerInput): Vehicle {
  const now = input.now ?? new Date();
  return db.transaction((tx) => {
    const current = tx.select().from(vehicles).where(eq(vehicles.id, input.id)).get();
    if (current === undefined) {
      throw new VehicleNotFoundError(input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('vehicle', input.id, input.expectedVersion, current.version);
    }
    if (input.ownerPersonId !== null) {
      assertPersonExists(tx, input.ownerPersonId);
    }
    const updated = tx
      .update(vehicles)
      .set({ ownerPersonId: input.ownerPersonId, updatedAt: now, version: current.version + 1 })
      .where(eq(vehicles.id, input.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update vehicle returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'vehicle.owner',
      entity: 'vehicle',
      entityId: input.id,
      summary: `Changed the owner of vehicle “${current.label}”`,
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
    throw new InvalidVehicleLabelError('Give the vehicle a name.');
  }
  if (label.length > MAX_VEHICLE_LABEL_LENGTH) {
    throw new InvalidVehicleLabelError(
      `Keep the name to ${MAX_VEHICLE_LABEL_LENGTH} characters or fewer.`,
    );
  }
  return label;
}

function assertLabelFree(rows: Vehicle[], label: string, selfId: number | null): void {
  const clash = rows.some(
    (row) => row.id !== selfId && row.label.toLowerCase() === label.toLowerCase(),
  );
  if (clash) {
    throw new DuplicateVehicleLabelError(label);
  }
}

function assertPersonExists(tx: DbTx, personId: number): void {
  const row = tx.select({ id: people.id }).from(people).where(eq(people.id, personId)).get();
  if (row === undefined) {
    throw new PersonNotFoundError(personId);
  }
}
