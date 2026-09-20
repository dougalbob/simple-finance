import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { auditEntries } from '../src/lib/db/schema';
import {
  categoryTree,
  createChildCategory,
  createParentCategory,
  findChildCategory,
  findParentCategory,
  getCategory,
  listCategories,
  renameCategory,
  retireCategory,
  CategoryAlreadyRetiredError,
  CategoryLevelError,
  CategoryNotFoundError,
  CategoryRetiredError,
  DuplicateCategoryNameError,
  InvalidCategoryNameError,
} from '../src/lib/records/categories';
import { VersionConflictError } from '../src/lib/records/errors';
import { createPurchase, getPurchaseWithLines } from '../src/lib/records/purchases';
import { createHouseholdFixture } from './household';

/** The approved initial tree, verbatim from SPEC §12. */
const SPEC_TREE: Array<[string, string[]]> = [
  [
    'Housing',
    [
      'Mortgage/Rent',
      'Council Tax',
      'Buildings & Contents Insurance',
      'DIY & Improvements',
      'Gardening',
    ],
  ],
  ['Utilities', ['Energy', 'Water', 'Broadband', 'Mobile Phones']],
  ['Groceries', ['Weekly Shop', 'Top-up Shops']],
  ['Household Goods', ['Cleaning & Consumables', 'Homeware & Furnishings', 'Appliances']],
  [
    'Vehicle Running',
    ['Fuel', 'Insurance', 'Maintenance & Repairs', 'Road Tax', 'Parking & Tolls'],
  ],
  ['Personal', ['Clothing & Shoes', 'Health & Toiletries', 'Hair & Grooming', 'Hobbies']],
  [
    'Entertainment & Eating Out',
    [
      'Dining Out & Takeaways',
      'Cinema & Events',
      'Holidays & Day Trips',
      'Subscriptions & Streaming',
    ],
  ],
  ['Gifts & Donations', ['Gifts', 'Charity']],
  ['Other', ['Uncategorised']],
];

describe('category tree (SPEC §12)', () => {
  it('seeds the approved two-level tree via migration', async () => {
    const fx = await createHouseholdFixture();
    try {
      const tree = categoryTree(fx.db);
      assert.equal(tree.length, 9);
      assert.deepEqual(
        tree.map((parent) => [parent.name, parent.children.map((child) => child.name)]),
        SPEC_TREE,
      );
      // 9 parents + 30 children, every child on exactly one parent.
      assert.equal(listCategories(fx.db).length, 39);
      for (const parent of tree) {
        assert.equal(parent.parentId, null);
        assert.equal(parent.retiredAt, null);
        for (const child of parent.children) {
          assert.equal(child.parentId, parent.id);
          assert.equal(child.retiredAt, null);
        }
      }
    } finally {
      fx.close();
    }
  });

  it('enforces exactly two levels', async () => {
    const fx = await createHouseholdFixture();
    try {
      const parent = createParentCategory(fx.db, { name: 'Pets', actor: 'alex@example.com' });
      assert.equal(parent.parentId, null);
      const child = createChildCategory(fx.db, {
        parentId: parent.id,
        name: 'Vet Bills',
        actor: 'alex@example.com',
      });
      assert.equal(child.parentId, parent.id);
      // No third level.
      assert.throws(
        () =>
          createChildCategory(fx.db, {
            parentId: child.id,
            name: 'Grandchild',
            actor: 'alex@example.com',
          }),
        CategoryLevelError,
      );
      assert.throws(
        () =>
          createChildCategory(fx.db, {
            parentId: parent.id + child.id + 9999,
            name: 'Orphan',
            actor: 'alex@example.com',
          }),
        CategoryNotFoundError,
      );
      assert.throws(() => getCategory(fx.db, 999999), CategoryNotFoundError);
    } finally {
      fx.close();
    }
  });

  it('keeps sibling names unique (case-insensitive) and validates names', async () => {
    const fx = await createHouseholdFixture();
    try {
      assert.throws(
        () => createParentCategory(fx.db, { name: 'groceries', actor: 'alex@example.com' }),
        DuplicateCategoryNameError,
      );
      const groceries = findParentCategory(fx.db, 'Groceries');
      assert.ok(groceries);
      assert.throws(
        () =>
          createChildCategory(fx.db, {
            parentId: groceries.id,
            name: 'WEEKLY SHOP',
            actor: 'alex@example.com',
          }),
        DuplicateCategoryNameError,
      );
      // Same child name under a different parent is fine.
      const housing = findParentCategory(fx.db, 'Housing');
      assert.ok(housing);
      const other = createChildCategory(fx.db, {
        parentId: housing.id,
        name: 'Weekly Shop',
        actor: 'alex@example.com',
      });
      assert.equal(other.name, 'Weekly Shop');

      assert.throws(
        () => createParentCategory(fx.db, { name: '   ', actor: 'alex@example.com' }),
        InvalidCategoryNameError,
      );
      assert.throws(
        () => createParentCategory(fx.db, { name: 'x'.repeat(61), actor: 'alex@example.com' }),
        InvalidCategoryNameError,
      );
      assert.equal(findParentCategory(fx.db, 'No Such Parent'), null);
      assert.equal(findChildCategory(fx.db, 'Groceries', 'No Such Child'), null);
      assert.equal(findChildCategory(fx.db, 'No Such Parent', 'Weekly Shop'), null);
    } finally {
      fx.close();
    }
  });

  it('renames with optimistic concurrency and an audit trail', async () => {
    const fx = await createHouseholdFixture();
    try {
      const child = findChildCategory(fx.db, 'Groceries', 'Top-up Shops');
      assert.ok(child);
      const renamed = renameCategory(fx.db, {
        id: child.id,
        expectedVersion: child.version,
        name: 'Top-up shops',
        actor: 'sam@example.com',
      });
      assert.equal(renamed.name, 'Top-up shops');
      assert.equal(renamed.version, child.version + 1);
      // Stale form fails visibly instead of overwriting.
      assert.throws(
        () =>
          renameCategory(fx.db, {
            id: child.id,
            expectedVersion: child.version,
            name: 'Corner Shop Runs',
            actor: 'alex@example.com',
          }),
        VersionConflictError,
      );
      assert.equal(getCategory(fx.db, child.id).name, 'Top-up shops');

      const audit = fx.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, String(child.id)))
        .all()
        .filter((row) => row.entity === 'category');
      assert.ok(audit.some((row) => row.action === 'category.rename'));
      const rename = audit.find((row) => row.action === 'category.rename');
      assert.equal(rename?.actor, 'sam@example.com');
      assert.ok(rename?.before !== null && rename?.after !== null);
    } finally {
      fx.close();
    }
  });

  it('retires a child: new lines blocked, history preserved', async () => {
    const fx = await createHouseholdFixture();
    try {
      const childId = fx.categoryId('Personal', 'Hobbies');
      const before = createPurchase(fx.db, {
        supplierName: 'Hobby Shop',
        potId: fx.pots.main.id,
        totalPence: 1500,
        paidByPersonId: fx.people.alex.id,
        occurredDate: '2026-09-18',
        lines: [
          {
            amountPence: 1500,
            categoryId: childId,
            targetKind: 'person',
            targetId: fx.people.alex.id,
          },
        ],
        actor: 'alex@example.com',
        now: new Date('2026-09-20T17:00:00Z'),
      });
      assert.equal(before.allocations[0]?.categoryId, childId);

      const retired = retireCategory(fx.db, {
        id: childId,
        expectedVersion: 1,
        actor: 'sam@example.com',
        now: new Date('2026-09-20T18:00:00Z'),
      });
      assert.ok(retired.retiredAt !== null);

      // History still reads through the retired category.
      const reread = getPurchaseWithLines(fx.db, before.purchase.id);
      assert.equal(reread.allocations[0]?.categoryId, childId);
      assert.equal(getCategory(fx.db, childId).retiredAt !== null, true);

      // But no new line may take it.
      assert.throws(
        () =>
          createPurchase(fx.db, {
            supplierName: 'Hobby Shop',
            potId: fx.pots.main.id,
            totalPence: 500,
            paidByPersonId: fx.people.alex.id,
            occurredDate: '2026-09-19',
            lines: [
              {
                amountPence: 500,
                categoryId: childId,
                targetKind: 'person',
                targetId: fx.people.alex.id,
              },
            ],
            actor: 'alex@example.com',
            now: new Date('2026-09-20T19:00:00Z'),
          }),
        CategoryRetiredError,
      );

      // Retiring twice, or retiring a parent, is rejected explicitly.
      assert.throws(
        () =>
          retireCategory(fx.db, {
            id: childId,
            expectedVersion: retired.version,
            actor: 'sam@example.com',
          }),
        CategoryAlreadyRetiredError,
      );
      const parent = findParentCategory(fx.db, 'Personal');
      assert.ok(parent);
      assert.throws(
        () =>
          retireCategory(fx.db, {
            id: parent.id,
            expectedVersion: parent.version,
            actor: 'sam@example.com',
          }),
        CategoryLevelError,
      );
    } finally {
      fx.close();
    }
  });
});
