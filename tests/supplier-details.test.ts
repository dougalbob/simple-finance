import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { auditEntries } from '../src/lib/db/schema';
import {
  InvalidSupplierDetailError,
  addSupplierInteraction,
  addSupplierReference,
  listSupplierInteractions,
  listSupplierReferences,
  upcomingSupplierFollowUps,
} from '../src/lib/records/supplier-details';
import {
  SupplierNotFoundError,
  createSupplier,
  updateSupplierContact,
} from '../src/lib/records/suppliers';
import { VersionConflictError } from '../src/lib/records/errors';
import { createHouseholdFixture } from './household';

/**
 * Suppliers: contact card, reference pairs and the interaction log
 * (SPEC §21). These writes used to go straight into the tables with no
 * validation and no audit entry; they are domain operations now, so the rules
 * below are the ones the page and the tests share.
 */

const ACTOR = 'alex@example.com';

function withSupplier() {
  return createHouseholdFixture(ACTOR).then((fx) => {
    const supplier = createSupplier(fx.db, {
      name: 'InsurerCo',
      contactPhone: '01632 960111',
      contactEmail: 'policies@insurerco.example',
      actor: ACTOR,
    });
    return { fx, supplier };
  });
}

describe('supplier reference pairs (SPEC §21.1)', () => {
  it('stores a label and value, trimmed, with an audit entry', async () => {
    const { fx, supplier } = await withSupplier();
    try {
      const reference = addSupplierReference(fx.db, {
        supplierId: supplier.id,
        label: '  Policy number — Vehicle A ',
        value: ' ABC123 ',
        actor: ACTOR,
      });
      assert.equal(reference.label, 'Policy number — Vehicle A');
      assert.equal(reference.value, 'ABC123');
      assert.deepEqual(
        listSupplierReferences(fx.db, supplier.id).map((row) => row.value),
        ['ABC123'],
      );
      const audit = fx.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.action, 'supplier.reference'))
        .all();
      assert.equal(audit.length, 1);
      assert.equal(audit[0]!.actor, ACTOR);
      assert.equal(audit[0]!.entity, 'supplier');
    } finally {
      fx.close();
    }
  });

  it('rejects an empty label or value, and an unknown supplier', async () => {
    const { fx, supplier } = await withSupplier();
    try {
      assert.throws(
        () =>
          addSupplierReference(fx.db, {
            supplierId: supplier.id,
            label: '  ',
            value: 'x',
            actor: ACTOR,
          }),
        InvalidSupplierDetailError,
      );
      assert.throws(
        () =>
          addSupplierReference(fx.db, {
            supplierId: supplier.id,
            label: 'Policy',
            value: ' ',
            actor: ACTOR,
          }),
        InvalidSupplierDetailError,
      );
      assert.throws(
        () =>
          addSupplierReference(fx.db, {
            supplierId: 9999,
            label: 'Policy',
            value: 'x',
            actor: ACTOR,
          }),
        SupplierNotFoundError,
      );
      assert.equal(listSupplierReferences(fx.db, supplier.id).length, 0);
    } finally {
      fx.close();
    }
  });
});

describe('supplier interaction log (SPEC §21.2)', () => {
  it('records channel, summary, outcome and a follow-up date', async () => {
    const { fx, supplier } = await withSupplier();
    try {
      const interaction = addSupplierInteraction(fx.db, {
        supplierId: supplier.id,
        channel: 'call',
        summary: '  Asked about the renewal premium  ',
        outcome: 'Quoted £312.40',
        followUpDate: '2026-10-01',
        actor: ACTOR,
        now: new Date('2026-09-20T09:15:00Z'),
      });
      assert.equal(interaction.summary, 'Asked about the renewal premium');
      assert.equal(interaction.outcome, 'Quoted £312.40');
      assert.equal(interaction.createdBy, ACTOR);
      assert.equal(interaction.followUpDate, '2026-10-01');
      assert.equal(interaction.occurredAt.toISOString(), '2026-09-20T09:15:00.000Z');

      const audit = fx.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.action, 'supplier.interaction'))
        .all();
      assert.equal(audit.length, 1);
      assert.match(audit[0]!.summary, /call/);
    } finally {
      fx.close();
    }
  });

  it('rejects an unknown channel, an empty summary and a malformed follow-up date', async () => {
    const { fx, supplier } = await withSupplier();
    try {
      assert.throws(
        () =>
          addSupplierInteraction(fx.db, {
            supplierId: supplier.id,
            channel: 'telepathy',
            summary: 'something',
            actor: ACTOR,
          }),
        InvalidSupplierDetailError,
      );
      assert.throws(
        () =>
          addSupplierInteraction(fx.db, {
            supplierId: supplier.id,
            channel: 'email',
            summary: '   ',
            actor: ACTOR,
          }),
        InvalidSupplierDetailError,
      );
      assert.throws(
        () =>
          addSupplierInteraction(fx.db, {
            supplierId: supplier.id,
            channel: 'email',
            summary: 'Sent the claim form',
            followUpDate: '2026-02-30',
            actor: ACTOR,
          }),
        InvalidSupplierDetailError,
      );
      assert.equal(listSupplierInteractions(fx.db, supplier.id).length, 0);
    } finally {
      fx.close();
    }
  });

  it('lists newest first and surfaces only future follow-ups, soonest first', async () => {
    const { fx, supplier } = await withSupplier();
    try {
      const other = createSupplier(fx.db, { name: 'BroadbandCo', actor: ACTOR });
      addSupplierInteraction(fx.db, {
        supplierId: supplier.id,
        channel: 'letter',
        summary: 'Sent the paperwork',
        followUpDate: '2026-09-25',
        occurredAt: new Date('2026-09-18T09:00:00Z'),
        actor: ACTOR,
      });
      addSupplierInteraction(fx.db, {
        supplierId: supplier.id,
        channel: 'email',
        summary: 'Chased again',
        followUpDate: '2026-10-05',
        occurredAt: new Date('2026-09-20T09:00:00Z'),
        actor: 'sam@example.com',
      });
      addSupplierInteraction(fx.db, {
        supplierId: other.id,
        channel: 'call',
        summary: 'Booked the engineer',
        followUpDate: '2026-09-22',
        occurredAt: new Date('2026-09-20T10:00:00Z'),
        actor: ACTOR,
      });
      addSupplierInteraction(fx.db, {
        supplierId: other.id,
        channel: 'other',
        summary: 'Older note with a past follow-up',
        followUpDate: '2026-09-01',
        occurredAt: new Date('2026-08-30T10:00:00Z'),
        actor: ACTOR,
      });
      addSupplierInteraction(fx.db, {
        supplierId: other.id,
        channel: 'other',
        summary: 'No follow-up at all',
        occurredAt: new Date('2026-08-29T10:00:00Z'),
        actor: ACTOR,
      });

      const listed = listSupplierInteractions(fx.db, supplier.id);
      assert.deepEqual(
        listed.map((row) => row.summary),
        ['Chased again', 'Sent the paperwork'],
      );

      const followUps = upcomingSupplierFollowUps(fx.db, '2026-09-20');
      assert.deepEqual(
        followUps.map((row) => `${row.followUpDate}:${row.supplierName}`),
        ['2026-09-22:BroadbandCo', '2026-09-25:InsurerCo', '2026-10-05:InsurerCo'],
      );
      assert.equal(followUps[0]!.channel, 'call');
    } finally {
      fx.close();
    }
  });
});

describe('supplier contact card (SPEC §21.1)', () => {
  it('updates fields with a version guard and an audit trail', async () => {
    const { fx, supplier } = await withSupplier();
    try {
      const updated = updateSupplierContact(fx.db, {
        id: supplier.id,
        expectedVersion: supplier.version,
        contactPhone: '01632 960222',
        notes: 'Renewal quote pending',
        actor: 'sam@example.com',
      });
      assert.equal(updated.contactPhone, '01632 960222');
      assert.equal(updated.notes, 'Renewal quote pending');
      assert.equal(updated.contactEmail, 'policies@insurerco.example', 'untouched fields stay');
      assert.equal(updated.version, supplier.version + 1);

      assert.throws(
        () =>
          updateSupplierContact(fx.db, {
            id: supplier.id,
            expectedVersion: supplier.version,
            notes: 'stale edit',
            actor: 'alex@example.com',
          }),
        VersionConflictError,
      );

      const audit = fx.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.action, 'supplier.contact'))
        .all();
      assert.equal(audit.length, 1);
      assert.equal(audit[0]!.actor, 'sam@example.com');
    } finally {
      fx.close();
    }
  });
});
