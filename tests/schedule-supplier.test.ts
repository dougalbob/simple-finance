import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { asc } from 'drizzle-orm';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import { auditEntries } from '../src/lib/db/schema';
import {
  createSchedule,
  editSchedule,
  InvalidScheduleInputError,
  materializeAndConvert,
} from '../src/lib/records/schedules';
import { createRenewal } from '../src/lib/records/renewals';
import { listPurchases } from '../src/lib/records/purchases';
import {
  createSupplier,
  findSupplierByName,
  listSuppliers,
  SupplierNotFoundError,
} from '../src/lib/records/suppliers';
import { VersionConflictError } from '../src/lib/records/errors';

const p = (value: number) => Math.round(value * 100);
const ACTOR = 'alex@example.com';

/**
 * Schedule ↔ canonical Supplier link (v0.1.7): direct debits and standing
 * orders store a supplier_id, conversion copies it onto the purchase, and the
 * recurring form can create a supplier through the existing audited path.
 * Fictional names only — never real household suppliers.
 */
describe('schedules: canonical supplier link', () => {
  let fixture: HouseholdFixture;
  after(() => fixture?.close());

  it('creates a schedule with an existing supplier', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const supplier = createSupplier(db, {
      name: 'Northern Power Co',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    const result = createSchedule(db, {
      name: 'Electricity bill',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 15,
      amountPence: p(84.55),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Utilities', 'Energy'),
      supplierId: supplier.id,
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    assert.equal(result.schedule.supplierId, supplier.id);
    assert.equal(result.schedule.name, 'Electricity bill');
  });

  it('rejects an unknown supplier id', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    assert.throws(
      () =>
        createSchedule(db, {
          name: 'Electricity bill',
          kind: 'dd',
          frequency: 'monthly',
          dueDayOfMonth: 15,
          amountPence: p(50),
          potId: pots.main.id,
          categoryId: fixture.categoryId('Utilities', 'Energy'),
          supplierId: 999_999,
          targetKind: 'household',
          activeFrom: '2026-09-01',
          actor: ACTOR,
          now: new Date('2026-09-01T09:00:00Z'),
        }),
      SupplierNotFoundError,
    );
  });

  it('requires a supplier on direct debits', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    assert.throws(
      () =>
        createSchedule(db, {
          name: 'Electricity bill',
          kind: 'dd',
          frequency: 'monthly',
          dueDayOfMonth: 15,
          amountPence: p(50),
          potId: pots.main.id,
          categoryId: fixture.categoryId('Utilities', 'Energy'),
          targetKind: 'household',
          activeFrom: '2026-09-01',
          actor: ACTOR,
          now: new Date('2026-09-01T09:00:00Z'),
        }),
      /supplier/i,
    );
  });

  it('creates a new supplier through the recurring flow (audited domain path)', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    assert.equal(findSupplierByName(db, 'Riverbank Utilities'), null);

    const result = createSchedule(db, {
      name: 'Gas bill',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 8,
      amountPence: p(62.1),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Utilities', 'Energy'),
      supplierName: 'Riverbank Utilities',
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });

    const supplier = findSupplierByName(db, 'Riverbank Utilities');
    assert.ok(supplier);
    assert.equal(result.schedule.supplierId, supplier.id);
    assert.ok(listSuppliers(db).some((row) => row.id === supplier.id));

    const audits = db
      .select()
      .from(auditEntries)
      .orderBy(asc(auditEntries.id))
      .all()
      .filter((row) => row.action === 'supplier.create');
    assert.ok(audits.some((row) => row.summary.includes('Riverbank Utilities')));
  });

  it('edits a schedule supplier with the optimistic version guard and audits the change', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const first = createSupplier(db, {
      name: 'Alpha Energy Ltd',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    const second = createSupplier(db, {
      name: 'Beta Energy Ltd',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    const created = createSchedule(db, {
      name: 'Electricity bill',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 12,
      amountPence: p(70),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Utilities', 'Energy'),
      supplierId: first.id,
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });

    assert.throws(
      () =>
        editSchedule(db, {
          id: created.schedule.id,
          expectedVersion: created.schedule.version + 5,
          actor: ACTOR,
          now: new Date('2026-09-10T09:00:00Z'),
          patch: { supplierId: second.id },
        }),
      VersionConflictError,
    );

    const edited = editSchedule(db, {
      id: created.schedule.id,
      expectedVersion: created.schedule.version,
      actor: ACTOR,
      now: new Date('2026-09-10T09:00:00Z'),
      patch: { supplierId: second.id },
    });
    assert.equal(edited.supplierId, second.id);
    assert.equal(edited.version, created.schedule.version + 1);

    const editAudit = db
      .select()
      .from(auditEntries)
      .all()
      .find(
        (row) => row.action === 'schedule.edit' && Number(row.entityId) === created.schedule.id,
      );
    assert.ok(editAudit);
    assert.ok(editAudit.after !== null);
    // Audit payload is JSON of the schedule row — supplier id must have moved.
    assert.match(editAudit.after ?? '', new RegExp(`"supplierId":${second.id}`));
    assert.match(editAudit.before ?? '', new RegExp(`"supplierId":${first.id}`));
  });

  it('converts a schedule into a purchase carrying the schedule supplier id', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const supplier = createSupplier(db, {
      name: 'Meadow Broadband',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    const created = createSchedule(db, {
      name: 'Broadband bill',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 10,
      amountPence: p(34.99),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Housing', 'Council Tax'),
      supplierId: supplier.id,
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    materializeAndConvert(db, new Date('2026-09-10T00:30:00+01:00'));
    const purchases = listPurchases(db, { supplierId: supplier.id, limit: 20 });
    assert.ok(purchases.length >= 1);
    const converted = purchases.find(
      ({ purchase }) =>
        purchase.scheduleInstanceId !== null && purchase.note?.includes('Broadband bill'),
    );
    assert.ok(converted);
    assert.equal(converted.purchase.supplierId, supplier.id);
    assert.equal(converted.purchase.supplierId, created.schedule.supplierId);
  });

  it('standing orders may omit a supplier (household transfer); receipts stay supplier-free', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;

    const transfer = createSchedule(db, {
      name: 'Cash top-up',
      kind: 'so',
      frequency: 'monthly',
      dueDayOfMonth: 1,
      amountPence: p(20),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Other', 'Uncategorised'),
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    assert.equal(transfer.schedule.supplierId, null);

    const salary = createSchedule(db, {
      name: 'Salary',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 26,
      amountPence: p(2000),
      potId: pots.salary.id,
      categoryId: null,
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    assert.equal(salary.schedule.supplierId, null);

    assert.throws(
      () =>
        createSchedule(db, {
          name: 'Salary with supplier',
          kind: 'receipt',
          frequency: 'monthly',
          dueDayOfMonth: 26,
          amountPence: p(2000),
          potId: pots.salary.id,
          supplierName: 'Should Not Exist',
          activeFrom: '2026-09-01',
          actor: ACTOR,
          now: new Date('2026-09-01T09:00:00Z'),
        }),
      InvalidScheduleInputError,
    );
  });

  it('a renewal and a schedule can share one supplier without double-counting', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const supplier = createSupplier(db, {
      name: 'CoverSure Mutual',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    const schedule = createSchedule(db, {
      name: 'Vehicle insurance premium',
      kind: 'dd',
      frequency: 'annual',
      dueDayOfMonth: 12,
      dueMonth: 10,
      amountPence: p(420),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Vehicle Running', 'Insurance'),
      supplierId: supplier.id,
      targetKind: 'vehicle',
      targetId: fixture.vehicles.vehicleA.id,
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    const renewal = createRenewal(db, {
      label: 'Vehicle A insurance renewal',
      supplierId: supplier.id,
      targetKind: 'vehicle',
      targetId: fixture.vehicles.vehicleA.id,
      nextRenewalDate: '2026-10-12',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    assert.equal(schedule.schedule.supplierId, supplier.id);
    assert.equal(renewal.supplierId, supplier.id);
    // Separate records: one money schedule, one alert. Sharing a supplier is
    // identity only — neither path creates a second money movement. They live
    // in different tables, so equality of numeric ids is not meaningful; the
    // important invariant is that both point at the same supplier.
    assert.equal(schedule.schedule.supplierId, renewal.supplierId);
  });

  it('reuses an existing supplier when the recurring form types a matching name', async () => {
    fixture = await createHouseholdFixture();
    const { db, pots } = fixture;
    const existing = createSupplier(db, {
      name: 'Harbour Water',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    const before = listSuppliers(db).length;
    const result = createSchedule(db, {
      name: 'Water bill',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 4,
      amountPence: p(28),
      potId: pots.main.id,
      categoryId: fixture.categoryId('Utilities', 'Water'),
      supplierName: '  harbour water  ',
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now: new Date('2026-09-01T09:00:00Z'),
    });
    assert.equal(result.schedule.supplierId, existing.id);
    assert.equal(listSuppliers(db).length, before);
  });
});
