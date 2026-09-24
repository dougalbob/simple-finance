import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import { editPot, InvalidPotInputError } from '../src/lib/records/pots';
import {
  createChildCategory,
  createParentCategory,
  renameCategory,
  retireCategory,
  CategoryAlreadyRetiredError,
  CategoryLevelError,
  DuplicateCategoryNameError,
} from '../src/lib/records/categories';
import { renamePerson, DuplicatePersonLabelError } from '../src/lib/records/people';
import { renameVehicle, DuplicateVehicleLabelError } from '../src/lib/records/vehicles';
import {
  getContractEndWarningLeadDays,
  getDefaultPurchasePotId,
  getRenewalWarningLeadDays,
  InvalidSettingValueError,
  setContractEndWarningLeadDays,
  setDefaultPurchasePotId,
  setRenewalWarningLeadDays,
} from '../src/lib/records/settings';
import { createPurchase } from '../src/lib/records/purchases';
import { and, eq } from 'drizzle-orm';
import { auditEntries } from '../src/lib/db/schema';
import { VersionConflictError } from '../src/lib/records/errors';

/**
 * Phase 4a Settings (SPEC §12, §15.2, decisions 68/73): the domain-layer
 * rules behind the settings page — pot edits (overdraft context), category
 * tree operations, target renames, and warning-lead settings.
 */

const ACTOR = 'alex@example.com';
const NOW = new Date('2026-09-20T17:00:00Z');

describe('settings: pot edits', () => {
  let fixture: HouseholdFixture;
  after(() => fixture.close());
  before(async () => {
    fixture = await createHouseholdFixture();
  });

  it('edits label/kind/limit/threshold with a version guard and audit bump', () => {
    const { db, pots } = fixture;
    const edited = editPot(db, {
      id: pots.main.id,
      expectedVersion: pots.main.version,
      actor: ACTOR,
      now: NOW,
      patch: {
        label: '  Main  account ',
        kind: 'bank',
        overdraftLimitPence: 90000,
        warningThresholdPence: 30000,
      },
    });
    assert.equal(edited.label, 'Main account'); // collapsed whitespace
    assert.equal(edited.overdraftLimitPence, 90000);
    assert.equal(edited.warningThresholdPence, 30000);
    assert.equal(edited.version, pots.main.version + 1);

    assert.throws(
      () =>
        editPot(db, {
          id: pots.main.id,
          expectedVersion: pots.main.version, // stale
          actor: ACTOR,
          now: NOW,
          patch: { label: 'X' },
        }),
      VersionConflictError,
    );
  });

  it('enforces the overdraft context: threshold needs a limit and sits inside it', () => {
    const { db, pots } = fixture;
    // Threshold without a limit.
    assert.throws(
      () =>
        editPot(db, {
          id: pots.alexCash.id,
          expectedVersion: pots.alexCash.version,
          actor: ACTOR,
          now: NOW,
          patch: { overdraftLimitPence: null, warningThresholdPence: 1000 },
        }),
      InvalidPotInputError,
    );
    // Threshold above the limit.
    assert.throws(
      () =>
        editPot(db, {
          id: pots.alexCash.id,
          expectedVersion: pots.alexCash.version,
          actor: ACTOR,
          now: NOW,
          patch: { overdraftLimitPence: 5000, warningThresholdPence: 6000 },
        }),
      InvalidPotInputError,
    );
    // Non-positive values.
    assert.throws(
      () =>
        editPot(db, {
          id: pots.alexCash.id,
          expectedVersion: pots.alexCash.version,
          actor: ACTOR,
          now: NOW,
          patch: { overdraftLimitPence: 0 },
        }),
      InvalidPotInputError,
    );
    // Blank = cleared, and equal is allowed (threshold == limit).
    const cleared = editPot(db, {
      id: pots.alexCash.id,
      expectedVersion: pots.alexCash.version,
      actor: ACTOR,
      now: NOW,
      patch: { overdraftLimitPence: null, warningThresholdPence: null },
    });
    assert.equal(cleared.overdraftLimitPence, null);
    assert.equal(cleared.warningThresholdPence, null);
    const equal = editPot(db, {
      id: pots.alexCash.id,
      expectedVersion: cleared.version,
      actor: ACTOR,
      now: NOW,
      patch: { overdraftLimitPence: 20000, warningThresholdPence: 20000 },
    });
    assert.equal(equal.warningThresholdPence, 20000);
  });
});

describe('settings: category tree operations', () => {
  let fixture: HouseholdFixture;
  after(() => fixture.close());
  before(async () => {
    fixture = await createHouseholdFixture();
  });

  it('adds parents and children; renames keep sibling uniqueness', () => {
    const { db } = fixture;
    const parent = createParentCategory(db, { name: 'Pet Care', actor: ACTOR });
    const child = createChildCategory(db, { parentId: parent.id, name: 'Food', actor: ACTOR });
    assert.equal(child.parentId, parent.id);

    // Duplicate child name under the same parent is refused.
    assert.throws(
      () => createChildCategory(db, { parentId: parent.id, name: 'Food', actor: ACTOR }),
      DuplicateCategoryNameError,
    );
    // The same name under another parent is fine (uniqueness is per parent).
    const secondParent = createParentCategory(db, { name: 'Kitchen', actor: ACTOR });
    const sameName = createChildCategory(db, {
      parentId: secondParent.id,
      name: 'Food',
      actor: ACTOR,
    });
    assert.equal(sameName.parentId, secondParent.id);

    const renamed = renameCategory(db, {
      id: child.id,
      expectedVersion: child.version,
      name: 'Dry Food',
      actor: ACTOR,
      now: NOW,
    });
    assert.equal(renamed.name, 'Dry Food');
    assert.equal(renamed.version, child.version + 1);
  });

  it('retires children (never parents) and blocks new assignments after retirement', () => {
    const { db, pots, people } = fixture;
    const parent = createParentCategory(db, { name: 'Work From Home', actor: ACTOR });
    const child = createChildCategory(db, { parentId: parent.id, name: 'Chairs', actor: ACTOR });

    assert.throws(
      () =>
        retireCategory(db, {
          id: parent.id,
          expectedVersion: parent.version,
          actor: ACTOR,
          now: NOW,
        }),
      CategoryLevelError,
    );

    const retired = retireCategory(db, {
      id: child.id,
      expectedVersion: child.version,
      actor: ACTOR,
      now: NOW,
    });
    assert.ok(retired.retiredAt);
    assert.throws(
      () =>
        retireCategory(db, {
          id: child.id,
          expectedVersion: retired.version,
          actor: ACTOR,
          now: NOW,
        }),
      CategoryAlreadyRetiredError,
    );

    // A retired category can no longer be assigned to a new line.
    assert.throws(
      () =>
        createPurchase(db, {
          potId: pots.main.id,
          totalPence: 1000,
          paidByPersonId: people.alex.id,
          occurredDate: '2026-09-20',
          lines: [{ amountPence: 1000, categoryId: child.id, targetKind: 'household' }],
          actor: ACTOR,
          now: NOW,
        }),
      /retired/i,
    );
  });
});

describe('settings: target renames and warning leads', () => {
  let fixture: HouseholdFixture;
  after(() => fixture.close());
  before(async () => {
    fixture = await createHouseholdFixture();
  });

  it('renames people and vehicles with duplicate and version guards', () => {
    const { db, people, vehicles } = fixture;
    const renamed = renamePerson(db, {
      id: people.sam.id,
      expectedVersion: people.sam.version,
      label: 'Sam O.',
      actor: ACTOR,
      now: NOW,
    });
    assert.equal(renamed.label, 'Sam O.');

    assert.throws(
      () =>
        renamePerson(db, {
          id: people.alex.id,
          expectedVersion: people.alex.version,
          label: 'Sam O.',
          actor: ACTOR,
          now: NOW,
        }),
      DuplicatePersonLabelError,
    );
    assert.throws(
      () =>
        renameVehicle(db, {
          id: vehicles.vehicleA.id,
          expectedVersion: vehicles.vehicleA.version,
          label: vehicles.vehicleB.label,
          actor: ACTOR,
          now: NOW,
        }),
      DuplicateVehicleLabelError,
    );
    assert.throws(
      () =>
        renamePerson(db, {
          id: people.sam.id,
          expectedVersion: people.sam.version, // stale
          label: 'Sam Again',
          actor: ACTOR,
          now: NOW,
        }),
      VersionConflictError,
    );
  });

  it('warning leads are settable and read back (defaults 21/21)', () => {
    const { db } = fixture;
    assert.equal(getRenewalWarningLeadDays(db), 21);
    assert.equal(getContractEndWarningLeadDays(db), 21);
    setRenewalWarningLeadDays(db, 30, ACTOR, NOW);
    setContractEndWarningLeadDays(db, 0, ACTOR, NOW);
    assert.equal(getRenewalWarningLeadDays(db), 30);
    assert.equal(getContractEndWarningLeadDays(db), 0);
  });
});

/**
 * The default pot for purchases (SPEC §15.1, v0.9.0). The household's
 * daily-spend pot is not called "Main account", so the old label match chose
 * the wrong pot every time. The setting is explicit, validated against the
 * live pots, and clearable back to "pick one each time".
 */
describe('settings: default pot for purchases', () => {
  let fixture: HouseholdFixture;
  after(() => fixture.close());
  before(async () => {
    fixture = await createHouseholdFixture();
  });

  it('is unset until the household chooses one', () => {
    assert.equal(getDefaultPurchasePotId(fixture.db), null);
  });

  it('stores the choice, reads it back and clears it', () => {
    const { db, pots } = fixture;
    setDefaultPurchasePotId(db, pots.salary.id, ACTOR, NOW);
    assert.equal(getDefaultPurchasePotId(db), pots.salary.id);

    setDefaultPurchasePotId(db, pots.alexCash.id, ACTOR, NOW);
    assert.equal(getDefaultPurchasePotId(db), pots.alexCash.id);

    setDefaultPurchasePotId(db, null, ACTOR, NOW);
    assert.equal(getDefaultPurchasePotId(db), null);
  });

  it('refuses a pot that does not exist', () => {
    assert.throws(
      () => setDefaultPurchasePotId(fixture.db, 9999, ACTOR, NOW),
      InvalidSettingValueError,
    );
    assert.throws(
      () => setDefaultPurchasePotId(fixture.db, 0, ACTOR, NOW),
      InvalidSettingValueError,
    );
  });

  it('audits every change with the previous value', () => {
    const { db, pots } = fixture;
    setDefaultPurchasePotId(db, pots.main.id, ACTOR, NOW);
    const rows = db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, 'default_purchase_pot_id'))
      .all();
    assert.ok(rows.length > 0);
    const last = rows[rows.length - 1];
    assert.ok(last !== undefined);
    assert.equal(last.action, 'setting.update');
    assert.equal(last.actor, ACTOR);
  });
});
