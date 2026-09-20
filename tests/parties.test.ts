import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { auditEntries } from '../src/lib/db/schema';
import { VersionConflictError } from '../src/lib/records/errors';
import {
  createPerson,
  getPerson,
  listPeople,
  renamePerson,
  DuplicatePersonLabelError,
  InvalidPersonLabelError,
  PersonNotFoundError,
} from '../src/lib/records/people';
import { createPurchase, voidPurchase } from '../src/lib/records/purchases';
import {
  createSupplier,
  findSupplierByName,
  getSupplier,
  listSuppliers,
  mostUsedCategoryForSupplier,
  normalizeSupplierName,
  renameSupplier,
  updateSupplierContact,
  DuplicateSupplierError,
  InvalidSupplierContactError,
  InvalidSupplierNameError,
  SupplierNotFoundError,
} from '../src/lib/records/suppliers';
import {
  createVehicle,
  getVehicle,
  listVehicles,
  renameVehicle,
  setVehicleOwner,
  DuplicateVehicleLabelError,
  VehicleNotFoundError,
} from '../src/lib/records/vehicles';
import { createHouseholdFixture } from './household';

describe('people and vehicles', () => {
  it('creates, lists and renames people with unique labels', async () => {
    const fx = await createHouseholdFixture();
    try {
      assert.deepEqual(
        listPeople(fx.db).map((person) => person.label),
        ['Alex', 'Sam'],
      );
      assert.throws(
        () => createPerson(fx.db, { label: 'alex', actor: 'alex@example.com' }),
        DuplicatePersonLabelError,
      );
      assert.throws(
        () => createPerson(fx.db, { label: '  ', actor: 'alex@example.com' }),
        InvalidPersonLabelError,
      );
      const renamed = renamePerson(fx.db, {
        id: fx.people.alex.id,
        expectedVersion: 1,
        label: 'Alex R.',
        actor: 'alex@example.com',
      });
      assert.equal(renamed.label, 'Alex R.');
      assert.equal(renamed.version, 2);
      assert.throws(
        () =>
          renamePerson(fx.db, {
            id: fx.people.alex.id,
            expectedVersion: 1,
            label: 'Stale',
            actor: 'sam@example.com',
          }),
        VersionConflictError,
      );
      assert.throws(() => getPerson(fx.db, 999999), PersonNotFoundError);
    } finally {
      fx.close();
    }
  });

  it('creates vehicles with owners and moves ownership explicitly', async () => {
    const fx = await createHouseholdFixture();
    try {
      assert.deepEqual(
        listVehicles(fx.db).map((vehicle) => vehicle.label),
        ['Vehicle A', 'Vehicle B'],
      );
      assert.equal(getVehicle(fx.db, fx.vehicles.vehicleA.id).ownerPersonId, fx.people.alex.id);
      assert.throws(
        () => createVehicle(fx.db, { label: 'vehicle a', actor: 'alex@example.com' }),
        DuplicateVehicleLabelError,
      );
      assert.throws(
        () =>
          createVehicle(fx.db, {
            label: 'Mystery Car',
            ownerPersonId: 999999,
            actor: 'alex@example.com',
          }),
        PersonNotFoundError,
      );
      const moved = setVehicleOwner(fx.db, {
        id: fx.vehicles.vehicleA.id,
        expectedVersion: 1,
        ownerPersonId: fx.people.sam.id,
        actor: 'alex@example.com',
      });
      assert.equal(moved.ownerPersonId, fx.people.sam.id);
      assert.equal(moved.version, 2);
      const renamed = renameVehicle(fx.db, {
        id: fx.vehicles.vehicleB.id,
        expectedVersion: 1,
        label: 'Vehicle B (Sam)',
        actor: 'sam@example.com',
      });
      assert.equal(renamed.version, 2);
      assert.throws(() => getVehicle(fx.db, 999999), VehicleNotFoundError);
    } finally {
      fx.close();
    }
  });
});

describe('suppliers', () => {
  it('normalizes names so “Tesco” and “  TESCO ” are one supplier', () => {
    assert.equal(normalizeSupplierName('  TESCO '), 'tesco');
    assert.equal(normalizeSupplierName('Marks\t&   Spencer'), 'marks & spencer');
  });

  it('creates suppliers once and reuses them case-insensitively', async () => {
    const fx = await createHouseholdFixture();
    try {
      const created = createSupplier(fx.db, { name: 'Tesco', actor: 'alex@example.com' });
      assert.equal(created.name, 'Tesco');
      assert.equal(created.normalizedName, 'tesco');
      assert.equal(findSupplierByName(fx.db, '  tesco ')?.id, created.id);
      assert.equal(findSupplierByName(fx.db, 'No Such Shop'), null);
      assert.equal(findSupplierByName(fx.db, '   '), null);
      assert.throws(
        () => createSupplier(fx.db, { name: 'TESCO', actor: 'sam@example.com' }),
        DuplicateSupplierError,
      );
      assert.throws(
        () => createSupplier(fx.db, { name: '', actor: 'sam@example.com' }),
        InvalidSupplierNameError,
      );
      assert.throws(() => getSupplier(fx.db, 999999), SupplierNotFoundError);
      assert.deepEqual(
        listSuppliers(fx.db).map((supplier) => supplier.name),
        ['Tesco'],
      );
    } finally {
      fx.close();
    }
  });

  it('renames suppliers with optimistic concurrency', async () => {
    const fx = await createHouseholdFixture();
    try {
      const tesco = createSupplier(fx.db, { name: 'Tesco', actor: 'alex@example.com' });
      createSupplier(fx.db, { name: 'InsurerCo', actor: 'alex@example.com' });
      const renamed = renameSupplier(fx.db, {
        id: tesco.id,
        expectedVersion: 1,
        name: 'Tesco Superstore',
        actor: 'sam@example.com',
      });
      assert.equal(renamed.name, 'Tesco Superstore');
      assert.equal(renamed.normalizedName, 'tesco superstore');
      assert.throws(
        () =>
          renameSupplier(fx.db, {
            id: tesco.id,
            expectedVersion: 1,
            name: 'Stale',
            actor: 'alex@example.com',
          }),
        VersionConflictError,
      );
      assert.throws(
        () =>
          renameSupplier(fx.db, {
            id: tesco.id,
            expectedVersion: 2,
            name: 'insurerco',
            actor: 'alex@example.com',
          }),
        DuplicateSupplierError,
      );
    } finally {
      fx.close();
    }
  });

  it('holds a contact card (SPEC §21.1) with audited edits', async () => {
    const fx = await createHouseholdFixture();
    try {
      const insurer = createSupplier(fx.db, {
        name: 'InsurerCo',
        contactPhone: '0800 000 000',
        contactEmail: 'help@insurerco.example',
        notes: 'Vehicle A policy renews in October.',
        actor: 'alex@example.com',
      });
      assert.equal(insurer.contactPhone, '0800 000 000');
      const updated = updateSupplierContact(fx.db, {
        id: insurer.id,
        expectedVersion: 1,
        contactPhone: '0800 000 001',
        website: 'https://insurerco.example',
        notes: null, // explicit clear
        actor: 'sam@example.com',
      });
      assert.equal(updated.contactPhone, '0800 000 001');
      assert.equal(updated.website, 'https://insurerco.example');
      assert.equal(updated.notes, null);
      assert.equal(updated.contactEmail, 'help@insurerco.example'); // untouched
      assert.throws(
        () =>
          updateSupplierContact(fx.db, {
            id: insurer.id,
            expectedVersion: 1,
            contactPhone: 'stale',
            actor: 'alex@example.com',
          }),
        VersionConflictError,
      );
      assert.throws(
        () =>
          updateSupplierContact(fx.db, {
            id: insurer.id,
            expectedVersion: 2,
            notes: 'x'.repeat(2001),
            actor: 'alex@example.com',
          }),
        InvalidSupplierContactError,
      );
      const audit = fx.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, String(insurer.id)))
        .all()
        .filter((row) => row.entity === 'supplier');
      assert.ok(audit.some((row) => row.action === 'supplier.create'));
      assert.ok(audit.some((row) => row.action === 'supplier.contact'));
    } finally {
      fx.close();
    }
  });

  it('derives the most-used category live — never a stale cache (SPEC §9.2)', async () => {
    const fx = await createHouseholdFixture();
    try {
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const fuel = fx.categoryId('Vehicle Running', 'Fuel');
      const now = new Date('2026-09-20T17:00:00Z');

      // Unknown supplier and unused supplier: no memory yet.
      assert.equal(mostUsedCategoryForSupplier(fx.db, 999999), null);
      const tesco = createSupplier(fx.db, { name: 'Tesco', actor: 'alex@example.com', now });
      assert.equal(mostUsedCategoryForSupplier(fx.db, tesco.id), null);

      const buy = (categoryId: number, targetKind: 'household' | 'vehicle', at: string) =>
        createPurchase(fx.db, {
          supplierId: tesco.id,
          potId: fx.pots.main.id,
          totalPence: 1000,
          paidByPersonId: fx.people.alex.id,
          occurredAt: new Date(at),
          lines: [
            {
              amountPence: 1000,
              categoryId,
              targetKind,
              targetId: targetKind === 'vehicle' ? fx.vehicles.vehicleA.id : null,
            },
          ],
          actor: 'alex@example.com',
          now: new Date(at),
        });

      buy(groceries, 'household', '2026-09-18T10:00:00Z');
      buy(groceries, 'household', '2026-09-19T10:00:00Z');
      buy(fuel, 'vehicle', '2026-09-19T12:00:00Z');
      voidPurchase(fx.db, {
        id: buy(groceries, 'household', '2026-09-19T14:00:00Z').purchase.id,
        expectedVersion: 1,
        actor: 'alex@example.com',
        now,
      });

      // Two live grocery runs beat one fuel stop; the voided run is ignored.
      const memory = mostUsedCategoryForSupplier(fx.db, tesco.id);
      assert.ok(memory);
      assert.equal(memory.categoryId, groceries);
      assert.equal(memory.purchaseCount, 2);

      // A tie breaks towards the most recently used category.
      buy(fuel, 'vehicle', '2026-09-19T16:00:00Z');
      const tied = mostUsedCategoryForSupplier(fx.db, tesco.id);
      assert.ok(tied);
      assert.equal(tied.categoryId, fuel);
      assert.equal(tied.purchaseCount, 2);
    } finally {
      fx.close();
    }
  });
});
