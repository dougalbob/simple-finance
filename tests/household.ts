import path from 'node:path';
import { openDatabase, type Db, type DbHandle } from '../src/lib/db/client';
import { applyMigrations } from '../src/lib/db/migrate';
import { findChildCategory } from '../src/lib/records/categories';
import { createPerson, type Person } from '../src/lib/records/people';
import { createPot, type Pot } from '../src/lib/records/pots';
import { createVehicle, type Vehicle } from '../src/lib/records/vehicles';
import { makeTempDir } from './helpers';

/**
 * Isolated household fixture for Phase 2a integration tests: a fresh
 * migrated database with the SPEC §4 pots, the fictional personas Alex and
 * Sam (SPEC §3), and their vehicles. Category ids resolve from the seeded
 * SPEC §12 tree — tests never hard-code them.
 */
export interface HouseholdFixture {
  handle: DbHandle;
  db: Db;
  pots: {
    main: Pot;
    salary: Pot;
    alexWallet: Pot;
    samWallet: Pot;
    jar: Pot;
  };
  people: {
    alex: Person;
    sam: Person;
  };
  vehicles: {
    vehicleA: Vehicle;
    vehicleB: Vehicle;
  };
  categoryId(parentName: string, childName: string): number;
  close(): void;
}

export async function createHouseholdFixture(
  actor = 'alex@example.com',
  now = new Date('2026-09-20T17:00:00Z'),
): Promise<HouseholdFixture> {
  const dir = await makeTempDir('sf-household-');
  const handle = openDatabase(path.join(dir, 'household.sqlite'));
  applyMigrations(handle.db);
  const db = handle.db;

  const main = createPot(handle.db, {
    label: 'Main account',
    kind: 'bank',
    sortOrder: 0,
    overdraftLimitPence: 80000,
    warningThresholdPence: 25000,
    actor,
    now,
  });
  const salary = createPot(handle.db, {
    label: 'Salary account',
    kind: 'bank',
    sortOrder: 1,
    actor,
    now,
  });
  const alexWallet = createPot(handle.db, {
    label: "Alex's wallet",
    kind: 'cash',
    sortOrder: 2,
    actor,
    now,
  });
  const samWallet = createPot(handle.db, {
    label: "Sam's wallet",
    kind: 'cash',
    sortOrder: 3,
    actor,
    now,
  });
  const jar = createPot(handle.db, { label: 'Shared jar', kind: 'cash', sortOrder: 4, actor, now });

  const alex = createPerson(handle.db, { label: 'Alex', actor, now });
  const sam = createPerson(handle.db, { label: 'Sam', actor, now });

  const vehicleA = createVehicle(handle.db, {
    label: 'Vehicle A',
    ownerPersonId: alex.id,
    actor,
    now,
  });
  const vehicleB = createVehicle(handle.db, {
    label: 'Vehicle B',
    ownerPersonId: sam.id,
    actor,
    now,
  });

  return {
    handle,
    db,
    pots: { main, salary, alexWallet, samWallet, jar },
    people: { alex, sam },
    vehicles: { vehicleA, vehicleB },
    categoryId(parentName: string, childName: string): number {
      const category = findChildCategory(db, parentName, childName);
      if (category === null) {
        throw new Error(`Seeded category missing: ${parentName} / ${childName}`);
      }
      return category.id;
    },
    close(): void {
      handle.raw.close();
    },
  };
}
