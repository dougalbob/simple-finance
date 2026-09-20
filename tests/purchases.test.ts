import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { auditEntries } from '../src/lib/db/schema';
import { CategoryLevelError, CategoryNotFoundError } from '../src/lib/records/categories';
import {
  AlreadyVoidError,
  RecordVoidedError,
  VersionConflictError,
} from '../src/lib/records/errors';
import { InvalidOccurredError } from '../src/lib/records/occurred';
import { PersonNotFoundError } from '../src/lib/records/people';
import { PotNotFoundError } from '../src/lib/records/pots';
import {
  createPurchase,
  createRefund,
  editPurchase,
  findPossibleDuplicates,
  getPurchaseWithLines,
  listPurchases,
  voidPurchase,
  InvalidPurchaseInputError,
  PurchaseNotFoundError,
  RefundLinkError,
  VoidBlockedError,
} from '../src/lib/records/purchases';
import { SplitValidationError } from '../src/lib/records/splits';
import {
  findSupplierByName,
  mostUsedCategoryForSupplier,
  SupplierNotFoundError,
} from '../src/lib/records/suppliers';
import { endOfLocalDate } from '../src/lib/time';
import { VehicleNotFoundError } from '../src/lib/records/vehicles';
import { createHouseholdFixture } from './household';

describe('E1 — mixed Tesco receipt (SPEC §17)', () => {
  it('records one £63.47 payment split across household groceries and Sam’s clothing', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-27T13:10:00Z'); // Saturday 27th, 14:10 BST
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const clothing = fx.categoryId('Personal', 'Clothing & Shoes');

      const saved = createPurchase(fx.db, {
        supplierName: 'Tesco',
        potId: fx.pots.main.id,
        totalPence: 6347,
        paidByPersonId: fx.people.alex.id,
        occurredAt: at,
        lines: [
          { amountPence: 4198, categoryId: groceries, targetKind: 'household' },
          {
            amountPence: 2149,
            categoryId: clothing,
            targetKind: 'person',
            targetId: fx.people.sam.id,
          },
        ],
        actor: 'alex@example.com',
        now: at,
      });

      // entered_by / paid_by / for_whom stay distinct.
      assert.equal(saved.purchase.totalPence, 6347);
      assert.equal(saved.purchase.potId, fx.pots.main.id);
      assert.equal(saved.purchase.paidByPersonId, fx.people.alex.id);
      assert.equal(saved.purchase.enteredBy, 'alex@example.com');
      assert.equal(saved.purchase.occurredDate, '2026-09-27');
      assert.equal(saved.purchase.version, 1);
      assert.equal(saved.purchase.voidedAt, null);
      assert.equal(saved.duplicateNotice, null); // first of its kind — no hint

      assert.equal(saved.allocations.length, 2);
      const [food, clothes] = saved.allocations;
      assert.deepEqual(
        [food?.amountPence, food?.categoryId, food?.targetKind, food?.targetId],
        [4198, groceries, 'household', null],
      );
      assert.deepEqual(
        [clothes?.amountPence, clothes?.categoryId, clothes?.targetKind, clothes?.targetId],
        [2149, clothing, 'person', fx.people.sam.id],
      );

      // Insight effect: £41.98 to household groceries, £21.49 to Sam — not Alex.
      const samLines = listPurchases(fx.db, {
        targetKind: 'person',
        targetId: fx.people.sam.id,
      });
      assert.equal(samLines.length, 1);
      assert.equal(samLines[0]?.allocations.length, 2); // the purchase carries both lines
      const samShare = (samLines[0]?.allocations ?? [])
        .filter((line) => line.targetKind === 'person' && line.targetId === fx.people.sam.id)
        .reduce((sum, line) => sum + line.amountPence, 0);
      assert.equal(samShare, 2149);
      assert.equal(
        listPurchases(fx.db, { targetKind: 'person', targetId: fx.people.alex.id }).length,
        0,
      );

      // Supplier memory: Tesco now preselects Groceries.
      const tesco = findSupplierByName(fx.db, 'tesco');
      assert.ok(tesco);
      assert.equal(saved.purchase.supplierId, tesco.id);
      assert.equal(mostUsedCategoryForSupplier(fx.db, tesco.id)?.categoryId, groceries);
    } finally {
      fx.close();
    }
  });

  it('refuses to save until the lines total the payment exactly', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-27T13:10:00Z');
      assert.throws(
        () =>
          createPurchase(fx.db, {
            supplierName: 'Tesco',
            potId: fx.pots.main.id,
            totalPence: 6347,
            paidByPersonId: fx.people.alex.id,
            occurredAt: at,
            lines: [
              {
                amountPence: 4198,
                categoryId: fx.categoryId('Groceries', 'Weekly Shop'),
                targetKind: 'household',
              },
            ],
            actor: 'alex@example.com',
            now: at,
          }),
        SplitValidationError,
      );
      // The refused save leaves nothing behind — not even the supplier.
      assert.equal(findSupplierByName(fx.db, 'Tesco'), null);
      assert.equal(listPurchases(fx.db).length, 0);
    } finally {
      fx.close();
    }
  });
});

describe('E2 — fuel stop (SPEC §17)', () => {
  it('records £58.20 of fuel against Vehicle A, then flips to Vehicle B in one edit', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-27T09:05:00Z');
      const fuel = fx.categoryId('Vehicle Running', 'Fuel');
      const saved = createPurchase(fx.db, {
        supplierName: 'Petrol Station',
        potId: fx.pots.main.id,
        totalPence: 5820,
        paidByPersonId: fx.people.alex.id,
        occurredAt: at,
        lines: [
          {
            amountPence: 5820,
            categoryId: fuel,
            targetKind: 'vehicle',
            targetId: fx.vehicles.vehicleA.id,
          },
        ],
        actor: 'alex@example.com',
        now: at,
      });
      assert.equal(saved.allocations[0]?.targetId, fx.vehicles.vehicleA.id);

      // One-tap vehicle flip: same money, same category, other vehicle.
      const flipped = editPurchase(fx.db, {
        id: saved.purchase.id,
        expectedVersion: 1,
        actor: 'alex@example.com',
        now: new Date('2026-09-27T09:06:00Z'),
        patch: {
          lines: [
            {
              amountPence: 5820,
              categoryId: fuel,
              targetKind: 'vehicle',
              targetId: fx.vehicles.vehicleB.id,
            },
          ],
        },
      });
      assert.equal(flipped.purchase.version, 2);
      assert.equal(flipped.allocations[0]?.targetId, fx.vehicles.vehicleB.id);
      assert.equal(flipped.purchase.totalPence, 5820);

      const audit = fx.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, String(saved.purchase.id)))
        .all()
        .filter((row) => row.entity === 'purchase');
      assert.deepEqual(audit.map((row) => row.action).sort(), ['purchase.create', 'purchase.edit']);
    } finally {
      fx.close();
    }
  });
});

describe('E6 — backdated entry is absorbed, never double-subtracted (SPEC §17)', () => {
  it('orders a Tuesday 24th purchase after the Sunday checkpoint and before the Wednesday one', async () => {
    const fx = await createHouseholdFixture();
    try {
      // (SPEC weekdays are illustrative; the test pins the dates, not the weekdays.)
      const { addCheckpoint } = await import('../src/lib/records/pots');
      const sunday = addCheckpoint(fx.db, {
        potId: fx.pots.main.id,
        amountPence: 41235,
        effectiveAt: new Date('2026-09-22T16:00:00Z'), // Sunday 22nd, 17:00 BST
        actor: 'alex@example.com',
        now: new Date('2026-09-22T16:05:00Z'),
      });

      // Wednesday 25th: Alex remembers Tuesday 24th's £12.50 and backdates it.
      const wednesday = new Date('2026-09-25T19:00:00Z');
      const remembered = createPurchase(fx.db, {
        supplierName: 'Corner Shop',
        potId: fx.pots.main.id,
        totalPence: 1250,
        paidByPersonId: fx.people.alex.id,
        occurredDate: '2026-09-24',
        lines: [
          {
            amountPence: 1250,
            categoryId: fx.categoryId('Groceries', 'Top-up Shops'),
            targetKind: 'household',
          },
        ],
        actor: 'alex@example.com',
        now: wednesday,
      });
      assert.equal(remembered.purchase.occurredDate, '2026-09-24');
      assert.equal(
        remembered.purchase.occurredAt.toISOString(),
        endOfLocalDate('2026-09-24').toISOString(),
      );
      // After the Sunday checkpoint → the estimate subtracts it (Phase 3 engine input).
      assert.ok(remembered.purchase.occurredAt.getTime() > sunday.effectiveAt.getTime());

      // Wednesday evening's checkpoint absorbs it: now it predates the balance.
      const wednesdayCheckpoint = addCheckpoint(fx.db, {
        potId: fx.pots.main.id,
        amountPence: 38000,
        effectiveAt: new Date('2026-09-25T20:00:00Z'),
        actor: 'alex@example.com',
        now: new Date('2026-09-25T20:01:00Z'),
      });
      assert.ok(
        remembered.purchase.occurredAt.getTime() < wednesdayCheckpoint.effectiveAt.getTime(),
      );
    } finally {
      fx.close();
    }
  });

  it('supports date-only checkpoints at the end of the local date (SPEC §5)', async () => {
    const fx = await createHouseholdFixture();
    try {
      const { addCheckpoint, InvalidCheckpointInputError } =
        await import('../src/lib/records/pots');
      const checkpoint = addCheckpoint(fx.db, {
        potId: fx.pots.main.id,
        amountPence: 41235,
        effectiveDate: '2026-09-22',
        actor: 'alex@example.com',
        now: new Date('2026-09-23T08:00:00Z'),
      });
      assert.equal(
        checkpoint.effectiveAt.toISOString(),
        endOfLocalDate('2026-09-22').toISOString(),
      );
      assert.throws(
        () =>
          addCheckpoint(fx.db, {
            potId: fx.pots.main.id,
            amountPence: 100,
            effectiveDate: '2026-09-24', // in the future relative to `now`
            actor: 'alex@example.com',
            now: new Date('2026-09-23T08:00:00Z'),
          }),
        InvalidCheckpointInputError,
      );
    } finally {
      fx.close();
    }
  });
});

describe('E7 — both users record the same purchase (SPEC §17)', () => {
  it('warns non-blockingly, then resolves by voiding one copy', async () => {
    const fx = await createHouseholdFixture();
    try {
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const clothing = fx.categoryId('Personal', 'Clothing & Shoes');
      const lines = [
        { amountPence: 4198, categoryId: groceries, targetKind: 'household' as const },
        {
          amountPence: 2149,
          categoryId: clothing,
          targetKind: 'person' as const,
          targetId: fx.people.sam.id,
        },
      ];

      const alexAt = new Date('2026-09-27T13:10:00Z');
      const alex = createPurchase(fx.db, {
        supplierName: 'Tesco',
        potId: fx.pots.main.id,
        totalPence: 6347,
        paidByPersonId: fx.people.alex.id,
        occurredAt: alexAt,
        lines,
        actor: 'alex@example.com',
        now: alexAt,
      });
      assert.equal(alex.duplicateNotice, null);

      const samAt = new Date('2026-09-27T13:31:00Z');
      const sam = createPurchase(fx.db, {
        supplierName: 'Tesco',
        potId: fx.pots.main.id,
        totalPence: 6347,
        paidByPersonId: fx.people.sam.id,
        occurredAt: samAt,
        lines,
        actor: 'sam@example.com',
        now: samAt,
      });
      // The save succeeds — the notice never blocks a legitimate second purchase.
      assert.ok(sam.duplicateNotice);
      assert.equal(sam.duplicateNotice.purchaseId, alex.purchase.id);
      assert.equal(sam.duplicateNotice.enteredBy, 'alex@example.com');
      assert.equal(sam.duplicateNotice.totalPence, 6347);
      assert.equal(sam.duplicateNotice.minutesAgo, 21);

      // Sam confirms the duplicate and voids their copy.
      const voided = voidPurchase(fx.db, {
        id: sam.purchase.id,
        expectedVersion: 1,
        actor: 'sam@example.com',
        reason: 'Duplicate of Alex’s entry',
        now: new Date('2026-09-27T13:35:00Z'),
      });
      assert.ok(voided.voidedAt !== null);
      assert.equal(voided.voidedBy, 'sam@example.com');
      assert.equal(voided.version, 2);

      // Totals see one copy; history still shows both.
      assert.equal(listPurchases(fx.db).length, 1);
      assert.equal(listPurchases(fx.db)[0]?.purchase.id, alex.purchase.id);
      assert.equal(listPurchases(fx.db, { includeVoided: true }).length, 2);

      // A voided copy no longer triggers the notice for later lookalikes.
      const again = createPurchase(fx.db, {
        supplierName: 'Tesco',
        potId: fx.pots.main.id,
        totalPence: 6347,
        paidByPersonId: fx.people.sam.id,
        occurredAt: new Date('2026-09-27T14:00:00Z'),
        lines,
        actor: 'sam@example.com',
        now: new Date('2026-09-27T14:00:00Z'),
      });
      assert.ok(again.duplicateNotice);
      assert.equal(again.duplicateNotice.purchaseId, alex.purchase.id);
    } finally {
      fx.close();
    }
  });

  it('only matches same pot, supplier-or-category and amount inside ~2 hours', async () => {
    const fx = await createHouseholdFixture();
    try {
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const first = createPurchase(fx.db, {
        supplierName: 'Tesco',
        potId: fx.pots.main.id,
        totalPence: 6347,
        paidByPersonId: fx.people.alex.id,
        occurredAt: new Date('2026-09-27T13:10:00Z'),
        lines: [{ amountPence: 6347, categoryId: groceries, targetKind: 'household' }],
        actor: 'alex@example.com',
        now: new Date('2026-09-27T13:10:00Z'),
      });
      assert.equal(first.duplicateNotice, null);

      const attempt = (overrides: Partial<Parameters<typeof createPurchase>[1]>) =>
        createPurchase(fx.db, {
          supplierName: 'Tesco',
          potId: fx.pots.main.id,
          totalPence: 6347,
          paidByPersonId: fx.people.sam.id,
          occurredAt: new Date('2026-09-27T13:31:00Z'),
          lines: [{ amountPence: 6347, categoryId: groceries, targetKind: 'household' }],
          actor: 'sam@example.com',
          now: new Date('2026-09-27T13:31:00Z'),
          ...overrides,
        });

      // Different amount, different pot, or outside the window: silence.
      assert.equal(
        attempt({
          totalPence: 6348,
          lines: [{ amountPence: 6348, categoryId: groceries, targetKind: 'household' }],
        }).duplicateNotice,
        null,
      );
      assert.equal(attempt({ potId: fx.pots.salary.id }).duplicateNotice, null);
      assert.equal(
        attempt({
          occurredAt: new Date('2026-09-27T16:11:00Z'),
          now: new Date('2026-09-27T16:11:00Z'),
        }).duplicateNotice,
        null,
      );
      // Unknown supplier but same category and amount: still flagged.
      const categoryMatch = attempt({ supplierName: null, supplierId: null });
      assert.ok(categoryMatch.duplicateNotice);
      assert.equal(categoryMatch.duplicateNotice.purchaseId, first.purchase.id);

      // The standalone search backs the review UI with the same rule.
      const candidates = findPossibleDuplicates(fx.db, {
        potId: fx.pots.main.id,
        supplierId: first.purchase.supplierId,
        categoryIds: [groceries],
        totalPence: 6347,
        excludePurchaseId: first.purchase.id,
        now: new Date('2026-09-27T13:31:00Z'),
      });
      assert.ok(candidates.length >= 1);
    } finally {
      fx.close();
    }
  });
});

describe('purchase validation', () => {
  it('rejects unknown pots, suppliers, categories, people and vehicles', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-20T17:00:00Z');
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const base = {
        supplierName: 'Tesco',
        potId: fx.pots.main.id,
        totalPence: 1000,
        paidByPersonId: fx.people.alex.id,
        occurredAt: at,
        lines: [{ amountPence: 1000, categoryId: groceries, targetKind: 'household' as const }],
        actor: 'alex@example.com',
        now: at,
      };
      assert.throws(() => createPurchase(fx.db, { ...base, potId: 999999 }), PotNotFoundError);
      assert.throws(
        () => createPurchase(fx.db, { ...base, supplierName: null, supplierId: 999999 }),
        SupplierNotFoundError,
      );
      assert.throws(
        () =>
          createPurchase(fx.db, {
            ...base,
            lines: [{ amountPence: 1000, categoryId: 999999, targetKind: 'household' }],
          }),
        CategoryNotFoundError,
      );
      assert.throws(
        () => createPurchase(fx.db, { ...base, paidByPersonId: 999999 }),
        PersonNotFoundError,
      );
      assert.throws(
        () =>
          createPurchase(fx.db, {
            ...base,
            lines: [
              { amountPence: 1000, categoryId: groceries, targetKind: 'person', targetId: 999999 },
            ],
          }),
        PersonNotFoundError,
      );
      assert.throws(
        () =>
          createPurchase(fx.db, {
            ...base,
            lines: [
              { amountPence: 1000, categoryId: groceries, targetKind: 'vehicle', targetId: 999999 },
            ],
          }),
        VehicleNotFoundError,
      );
      assert.throws(
        () =>
          createPurchase(fx.db, {
            ...base,
            supplierName: 'Tesco',
            supplierId: findSupplierByName(fx.db, 'Tesco')?.id ?? 1,
          }),
        InvalidPurchaseInputError,
      );
    } finally {
      fx.close();
    }
  });

  it('lands allocations on leaves with coherent targets', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-20T17:00:00Z');
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const { findParentCategory } = await import('../src/lib/records/categories');
      const parent = findParentCategory(fx.db, 'Groceries');
      assert.ok(parent);
      const base = {
        potId: fx.pots.main.id,
        totalPence: 1000,
        paidByPersonId: fx.people.alex.id,
        occurredAt: at,
        actor: 'alex@example.com',
        now: at,
      };
      // Parent categories are for roll-ups, not allocations.
      assert.throws(
        () =>
          createPurchase(fx.db, {
            ...base,
            lines: [{ amountPence: 1000, categoryId: parent.id, targetKind: 'household' }],
          }),
        CategoryLevelError,
      );
      // Household lines carry no target; person/vehicle lines must name one.
      assert.throws(
        () =>
          createPurchase(fx.db, {
            ...base,
            lines: [
              {
                amountPence: 1000,
                categoryId: groceries,
                targetKind: 'household',
                targetId: fx.people.alex.id,
              },
            ],
          }),
        InvalidPurchaseInputError,
      );
      assert.throws(
        () =>
          createPurchase(fx.db, {
            ...base,
            lines: [{ amountPence: 1000, categoryId: groceries, targetKind: 'person' }],
          }),
        InvalidPurchaseInputError,
      );
      assert.throws(
        () =>
          createPurchase(fx.db, {
            ...base,
            lines: [{ amountPence: 1000, categoryId: groceries, targetKind: 'vehicle' }],
          }),
        InvalidPurchaseInputError,
      );
    } finally {
      fx.close();
    }
  });

  it('rejects future and incoherent timings', async () => {
    const fx = await createHouseholdFixture();
    try {
      const now = new Date('2026-09-20T17:00:00Z');
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const base = {
        potId: fx.pots.main.id,
        totalPence: 1000,
        paidByPersonId: fx.people.alex.id,
        lines: [{ amountPence: 1000, categoryId: groceries, targetKind: 'household' as const }],
        actor: 'alex@example.com',
        now,
      };
      assert.throws(
        () => createPurchase(fx.db, { ...base, occurredDate: '2026-09-21' }),
        InvalidOccurredError,
      );
      assert.throws(
        () => createPurchase(fx.db, { ...base, occurredDate: '2026-02-30' }),
        InvalidOccurredError,
      );
      assert.throws(
        () => createPurchase(fx.db, { ...base, occurredAt: new Date('2026-09-20T17:00:01Z') }),
        InvalidOccurredError,
      );
      assert.throws(
        () =>
          createPurchase(fx.db, {
            ...base,
            occurredAt: new Date('2026-09-20T16:00:00Z'),
            occurredDate: '2026-09-19',
          }),
        InvalidOccurredError,
      );
    } finally {
      fx.close();
    }
  });

  it('treats a blank supplier as unknown and reuses inline names', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-20T17:00:00Z');
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const base = {
        potId: fx.pots.main.id,
        totalPence: 1000,
        paidByPersonId: fx.people.alex.id,
        occurredAt: at,
        lines: [{ amountPence: 1000, categoryId: groceries, targetKind: 'household' as const }],
        actor: 'alex@example.com',
        now: at,
      };
      const unknown = createPurchase(fx.db, { ...base, supplierName: '   ' });
      assert.equal(unknown.purchase.supplierId, null);
      const first = createPurchase(fx.db, { ...base, supplierName: 'Tesco' });
      const second = createPurchase(fx.db, { ...base, supplierName: '  TESCO ' });
      assert.equal(second.purchase.supplierId, first.purchase.supplierId);
      assert.equal((await import('../src/lib/records/suppliers')).listSuppliers(fx.db).length, 1);
    } finally {
      fx.close();
    }
  });

  it('bounds notes and requires an actor', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-20T17:00:00Z');
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const base = {
        potId: fx.pots.main.id,
        totalPence: 1000,
        paidByPersonId: fx.people.alex.id,
        occurredAt: at,
        lines: [{ amountPence: 1000, categoryId: groceries, targetKind: 'household' as const }],
        now: at,
      };
      assert.throws(
        () => createPurchase(fx.db, { ...base, note: 'x'.repeat(281), actor: 'alex@example.com' }),
        InvalidPurchaseInputError,
      );
      assert.throws(
        () => createPurchase(fx.db, { ...base, actor: '  ' }),
        InvalidPurchaseInputError,
      );
    } finally {
      fx.close();
    }
  });
});

describe('purchase editing', () => {
  it('edits fields and replaces lines under optimistic concurrency', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-20T17:00:00Z');
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const topup = fx.categoryId('Groceries', 'Top-up Shops');
      const saved = createPurchase(fx.db, {
        supplierName: 'Tesco',
        potId: fx.pots.main.id,
        totalPence: 6347,
        paidByPersonId: fx.people.alex.id,
        occurredAt: at,
        note: 'weekly shop',
        lines: [{ amountPence: 6347, categoryId: groceries, targetKind: 'household' }],
        actor: 'alex@example.com',
        now: at,
      });

      const edited = editPurchase(fx.db, {
        id: saved.purchase.id,
        expectedVersion: 1,
        actor: 'sam@example.com',
        now: new Date('2026-09-20T18:00:00Z'),
        patch: {
          totalPence: 6000,
          lines: [
            { amountPence: 4000, categoryId: groceries, targetKind: 'household' },
            { amountPence: 2000, categoryId: topup, targetKind: 'household' },
          ],
          note: 'weekly shop (corrected)',
          supplierName: 'Tesco Superstore',
        },
      });
      assert.equal(edited.purchase.version, 2);
      assert.equal(edited.purchase.totalPence, 6000);
      assert.equal(edited.allocations.length, 2);
      assert.equal(edited.purchase.note, 'weekly shop (corrected)');
      assert.equal(findSupplierByName(fx.db, 'Tesco Superstore')?.id, edited.purchase.supplierId);

      // Stale versions fail visibly; nothing is overwritten.
      assert.throws(
        () =>
          editPurchase(fx.db, {
            id: saved.purchase.id,
            expectedVersion: 1,
            actor: 'alex@example.com',
            patch: { note: 'stale write' },
          }),
        VersionConflictError,
      );
      assert.equal(
        getPurchaseWithLines(fx.db, saved.purchase.id).purchase.note,
        'weekly shop (corrected)',
      );

      // Clearing the supplier and the note.
      const cleared = editPurchase(fx.db, {
        id: saved.purchase.id,
        expectedVersion: 2,
        actor: 'sam@example.com',
        patch: { supplierName: null, note: null },
      });
      assert.equal(cleared.purchase.supplierId, null);
      assert.equal(cleared.purchase.note, null);
    } finally {
      fx.close();
    }
  });

  it('holds the exact-total rule on every edit', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-20T17:00:00Z');
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const saved = createPurchase(fx.db, {
        potId: fx.pots.main.id,
        totalPence: 6347,
        paidByPersonId: fx.people.alex.id,
        occurredAt: at,
        lines: [{ amountPence: 6347, categoryId: groceries, targetKind: 'household' }],
        actor: 'alex@example.com',
        now: at,
      });
      // A new total without matching lines is refused.
      assert.throws(
        () =>
          editPurchase(fx.db, {
            id: saved.purchase.id,
            expectedVersion: 1,
            actor: 'alex@example.com',
            patch: { totalPence: 6000 },
          }),
        SplitValidationError,
      );
      // As are unbalanced replacement lines.
      assert.throws(
        () =>
          editPurchase(fx.db, {
            id: saved.purchase.id,
            expectedVersion: 1,
            actor: 'alex@example.com',
            patch: {
              lines: [{ amountPence: 6000, categoryId: groceries, targetKind: 'household' }],
            },
          }),
        SplitValidationError,
      );
      assert.throws(
        () =>
          editPurchase(fx.db, {
            id: saved.purchase.id,
            expectedVersion: 1,
            actor: 'alex@example.com',
            patch: { supplierId: 1, supplierName: 'Tesco' },
          }),
        InvalidPurchaseInputError,
      );
      assert.throws(
        () =>
          editPurchase(fx.db, {
            id: 999999,
            expectedVersion: 1,
            actor: 'alex@example.com',
            patch: { note: 'missing' },
          }),
        PurchaseNotFoundError,
      );
    } finally {
      fx.close();
    }
  });

  it('freezes voided records: no edits, no second void', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-20T17:00:00Z');
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const saved = createPurchase(fx.db, {
        potId: fx.pots.main.id,
        totalPence: 1000,
        paidByPersonId: fx.people.alex.id,
        occurredAt: at,
        lines: [{ amountPence: 1000, categoryId: groceries, targetKind: 'household' }],
        actor: 'alex@example.com',
        now: at,
      });
      voidPurchase(fx.db, {
        id: saved.purchase.id,
        expectedVersion: 1,
        actor: 'alex@example.com',
        now: at,
      });
      assert.throws(
        () =>
          editPurchase(fx.db, {
            id: saved.purchase.id,
            expectedVersion: 2,
            actor: 'alex@example.com',
            patch: { note: 'too late' },
          }),
        RecordVoidedError,
      );
      assert.throws(
        () =>
          voidPurchase(fx.db, {
            id: saved.purchase.id,
            expectedVersion: 2,
            actor: 'alex@example.com',
          }),
        AlreadyVoidError,
      );
      assert.throws(
        () => voidPurchase(fx.db, { id: 999999, expectedVersion: 1, actor: 'alex@example.com' }),
        PurchaseNotFoundError,
      );
      assert.throws(
        () =>
          voidPurchase(fx.db, {
            id: saved.purchase.id,
            expectedVersion: 2,
            actor: 'alex@example.com',
            reason: 'x'.repeat(281),
          }),
        InvalidPurchaseInputError,
      );
    } finally {
      fx.close();
    }
  });
});

describe('refunds (SPEC §9.5)', () => {
  it('records partial and full refunds that net off, linked to the original', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-20T17:00:00Z');
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const clothing = fx.categoryId('Personal', 'Clothing & Shoes');
      const original = createPurchase(fx.db, {
        supplierName: 'Tesco',
        potId: fx.pots.main.id,
        totalPence: 6347,
        paidByPersonId: fx.people.alex.id,
        occurredAt: at,
        lines: [
          { amountPence: 4198, categoryId: groceries, targetKind: 'household' },
          {
            amountPence: 2149,
            categoryId: clothing,
            targetKind: 'person',
            targetId: fx.people.sam.id,
          },
        ],
        actor: 'alex@example.com',
        now: at,
      });

      // Partial refund: the clothes go back. Pot/supplier/payer default from the original.
      const partial = createRefund(fx.db, {
        refundOfPurchaseId: original.purchase.id,
        totalPence: -2149,
        lines: [
          {
            amountPence: -2149,
            categoryId: clothing,
            targetKind: 'person',
            targetId: fx.people.sam.id,
          },
        ],
        occurredDate: '2026-09-20',
        actor: 'sam@example.com',
        now: new Date('2026-09-20T18:00:00Z'),
      });
      assert.equal(partial.purchase.refundOfPurchaseId, original.purchase.id);
      assert.equal(partial.purchase.potId, original.purchase.potId);
      assert.equal(partial.purchase.supplierId, original.purchase.supplierId);
      assert.equal(partial.purchase.paidByPersonId, original.purchase.paidByPersonId);

      // Net effect across the pair: £41.98 of live spending.
      const live = listPurchases(fx.db, { includeVoided: false });
      assert.equal(
        live.reduce((sum, row) => sum + row.purchase.totalPence, 0),
        4198,
      );

      // The rest can still be refunded; a penny more cannot.
      const rest = createRefund(fx.db, {
        refundOfPurchaseId: original.purchase.id,
        totalPence: -4198,
        lines: [{ amountPence: -4198, categoryId: groceries, targetKind: 'household' }],
        actor: 'alex@example.com',
        now: new Date('2026-09-20T19:00:00Z'),
      });
      assert.equal(rest.purchase.totalPence, -4198);
      assert.throws(
        () =>
          createRefund(fx.db, {
            refundOfPurchaseId: original.purchase.id,
            totalPence: -1,
            lines: [{ amountPence: -1, categoryId: groceries, targetKind: 'household' }],
            actor: 'alex@example.com',
            now: new Date('2026-09-20T19:30:00Z'),
          }),
        RefundLinkError,
      );
    } finally {
      fx.close();
    }
  });

  it('keeps refunds honest: same category/target, capped, never on voids or refunds', async () => {
    const fx = await createHouseholdFixture();
    try {
      const at = new Date('2026-09-20T17:00:00Z');
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const fuel = fx.categoryId('Vehicle Running', 'Fuel');
      const original = createPurchase(fx.db, {
        potId: fx.pots.main.id,
        totalPence: 5000,
        paidByPersonId: fx.people.alex.id,
        occurredAt: at,
        lines: [{ amountPence: 5000, categoryId: groceries, targetKind: 'household' }],
        actor: 'alex@example.com',
        now: at,
      });

      // Wrong category/target for what it refunds.
      assert.throws(
        () =>
          createRefund(fx.db, {
            refundOfPurchaseId: original.purchase.id,
            totalPence: -100,
            lines: [{ amountPence: -100, categoryId: fuel, targetKind: 'household' }],
            actor: 'alex@example.com',
            now: at,
          }),
        RefundLinkError,
      );
      // Positive totals are purchases, not refunds.
      assert.throws(
        () =>
          createRefund(fx.db, {
            refundOfPurchaseId: original.purchase.id,
            totalPence: 100,
            lines: [{ amountPence: 100, categoryId: groceries, targetKind: 'household' }],
            actor: 'alex@example.com',
            now: at,
          }),
        InvalidPurchaseInputError,
      );
      // Missing original.
      assert.throws(
        () =>
          createRefund(fx.db, {
            refundOfPurchaseId: 999999,
            totalPence: -100,
            lines: [{ amountPence: -100, categoryId: groceries, targetKind: 'household' }],
            actor: 'alex@example.com',
            now: at,
          }),
        PurchaseNotFoundError,
      );

      const refund = createRefund(fx.db, {
        refundOfPurchaseId: original.purchase.id,
        totalPence: -1000,
        lines: [{ amountPence: -1000, categoryId: groceries, targetKind: 'household' }],
        actor: 'alex@example.com',
        now: at,
      });
      // A refund of a refund is just a purchase.
      assert.throws(
        () =>
          createRefund(fx.db, {
            refundOfPurchaseId: refund.purchase.id,
            totalPence: -100,
            lines: [{ amountPence: -100, categoryId: groceries, targetKind: 'household' }],
            actor: 'alex@example.com',
            now: at,
          }),
        RefundLinkError,
      );
      // Editing the refund past the cap is refused.
      assert.throws(
        () =>
          editPurchase(fx.db, {
            id: refund.purchase.id,
            expectedVersion: 1,
            actor: 'alex@example.com',
            patch: {
              totalPence: -5001,
              lines: [{ amountPence: -5001, categoryId: groceries, targetKind: 'household' }],
            },
          }),
        RefundLinkError,
      );
      // Lowering the original below the refunded amount is refused.
      assert.throws(
        () =>
          editPurchase(fx.db, {
            id: original.purchase.id,
            expectedVersion: 1,
            actor: 'alex@example.com',
            patch: {
              totalPence: 999,
              lines: [{ amountPence: 999, categoryId: groceries, targetKind: 'household' }],
            },
          }),
        RefundLinkError,
      );
      // Removing the refunded (category, target) from the original is refused.
      assert.throws(
        () =>
          editPurchase(fx.db, {
            id: original.purchase.id,
            expectedVersion: 1,
            actor: 'alex@example.com',
            patch: {
              lines: [{ amountPence: 5000, categoryId: fuel, targetKind: 'household' }],
            },
          }),
        RefundLinkError,
      );
      // Voiding the original while the refund stands is refused — void the refund first.
      assert.throws(
        () =>
          voidPurchase(fx.db, {
            id: original.purchase.id,
            expectedVersion: 1,
            actor: 'alex@example.com',
          }),
        VoidBlockedError,
      );
      voidPurchase(fx.db, {
        id: refund.purchase.id,
        expectedVersion: 1,
        actor: 'alex@example.com',
        now: at,
      });
      const voidedOriginal = voidPurchase(fx.db, {
        id: original.purchase.id,
        expectedVersion: 1,
        actor: 'alex@example.com',
        now: at,
      });
      assert.ok(voidedOriginal.voidedAt !== null);
      // And a voided purchase has nothing left to refund.
      assert.throws(
        () =>
          createRefund(fx.db, {
            refundOfPurchaseId: original.purchase.id,
            totalPence: -100,
            lines: [{ amountPence: -100, categoryId: groceries, targetKind: 'household' }],
            actor: 'alex@example.com',
            now: at,
          }),
        RefundLinkError,
      );
    } finally {
      fx.close();
    }
  });
});

describe('purchase history queries', () => {
  it('filters by pot, supplier, category, target, payer and date range', async () => {
    const fx = await createHouseholdFixture();
    try {
      const groceries = fx.categoryId('Groceries', 'Weekly Shop');
      const fuel = fx.categoryId('Vehicle Running', 'Fuel');
      const tescoAt = new Date('2026-09-18T10:00:00Z');
      const fuelAt = new Date('2026-09-19T10:00:00Z');
      const tesco = createPurchase(fx.db, {
        supplierName: 'Tesco',
        potId: fx.pots.main.id,
        totalPence: 4000,
        paidByPersonId: fx.people.alex.id,
        occurredAt: tescoAt,
        lines: [{ amountPence: 4000, categoryId: groceries, targetKind: 'household' }],
        actor: 'alex@example.com',
        now: tescoAt,
      });
      createPurchase(fx.db, {
        supplierName: 'Petrol Station',
        potId: fx.pots.main.id,
        totalPence: 5820,
        paidByPersonId: fx.people.sam.id,
        occurredAt: fuelAt,
        lines: [
          {
            amountPence: 5820,
            categoryId: fuel,
            targetKind: 'vehicle',
            targetId: fx.vehicles.vehicleB.id,
          },
        ],
        actor: 'sam@example.com',
        now: fuelAt,
      });

      assert.equal(listPurchases(fx.db, { potId: fx.pots.main.id }).length, 2);
      assert.equal(listPurchases(fx.db, { potId: fx.pots.salary.id }).length, 0);
      assert.equal(
        listPurchases(fx.db, { supplierId: tesco.purchase.supplierId as number }).length,
        1,
      );
      assert.equal(listPurchases(fx.db, { categoryId: groceries }).length, 1);
      assert.equal(listPurchases(fx.db, { categoryId: fuel }).length, 1);
      assert.equal(
        listPurchases(fx.db, { targetKind: 'vehicle', targetId: fx.vehicles.vehicleB.id }).length,
        1,
      );
      assert.equal(listPurchases(fx.db, { paidByPersonId: fx.people.sam.id }).length, 1);
      assert.equal(
        listPurchases(fx.db, { dateFrom: '2026-09-19', dateTo: '2026-09-19' }).length,
        1,
      );
      assert.equal(listPurchases(fx.db, { limit: 1 }).length, 1);
      // Newest first.
      assert.equal(listPurchases(fx.db)[0]?.purchase.occurredDate, '2026-09-19');
      assert.throws(
        () => listPurchases(fx.db, { dateFrom: 'not-a-date' }),
        InvalidPurchaseInputError,
      );

      // Voided records hide by default and show on request.
      voidPurchase(fx.db, {
        id: tesco.purchase.id,
        expectedVersion: 1,
        actor: 'alex@example.com',
        now: fuelAt,
      });
      assert.equal(listPurchases(fx.db).length, 1);
      assert.equal(listPurchases(fx.db, { includeVoided: true }).length, 2);
    } finally {
      fx.close();
    }
  });
});
