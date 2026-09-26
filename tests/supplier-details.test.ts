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
import { categoryTree } from '../src/lib/records/categories';
import { createPerson, listPeople } from '../src/lib/records/people';
import { createPurchase, listPurchases } from '../src/lib/records/purchases';
import { purchaseLineSummary, targetLabel, targetNames } from '../src/lib/records/targets';
import { listVehicles } from '../src/lib/records/vehicles';
import { formatPence } from '../src/lib/money';
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

describe('supplier card: recent purchases say who each one was for (SPEC §21.4)', () => {
  /**
   * Decision 161. The modelling the household landed on for three mobile
   * contracts with one carrier is **one supplier, three schedules**, each with
   * its own target. Every other list already says who a payment was for; the
   * supplier card showed `date · amount`, so the three contracts were told
   * apart by amount alone. These tests drive the exact chain `/suppliers`
   * runs — `listPurchases` → `purchaseLineSummary` — so the card's contract
   * cannot drift from the page that builds it.
   */
  async function withCarrier() {
    const fx = await createHouseholdFixture(ACTOR);
    const carrier = createSupplier(fx.db, { name: 'Vodafone', actor: ACTOR });
    const robin = createPerson(fx.db, { label: 'Robin', actor: ACTOR });
    const mobile = fx.categoryId('Utilities', 'Mobile Phones');
    const names = targetNames({ people: listPeople(fx.db), vehicles: listVehicles(fx.db) });
    const categoryNames = new Map(
      categoryTree(fx.db).flatMap((parent) =>
        parent.children.map((child) => [child.id, child.name] as const),
      ),
    );
    /** The page's own mapping, minus the JSX and the attachment lookup. */
    const cardRows = () =>
      listPurchases(fx.db, { supplierId: carrier.id, limit: 5 }).map(
        ({ purchase, allocations }) => {
          const summary = purchaseLineSummary(allocations, categoryNames, names);
          return {
            amount: formatPence(purchase.totalPence),
            label: summary.label,
            extraLines: summary.extraLines,
          };
        },
      );
    return { fx, carrier, robin, mobile, names, categoryNames, cardRows };
  }

  it('names the person on each of one carrier’s three contracts', async () => {
    const { fx, carrier, robin, mobile, cardRows } = await withCarrier();
    try {
      const contracts: Array<[number, number, string]> = [
        [2899, fx.people.alex.id, '2026-09-10T09:00:00Z'],
        [1599, fx.people.sam.id, '2026-09-11T09:00:00Z'],
        [3450, robin.id, '2026-09-12T09:00:00Z'],
      ];
      for (const [amountPence, personId, when] of contracts) {
        createPurchase(fx.db, {
          potId: fx.pots.main.id,
          totalPence: amountPence,
          occurredAt: new Date(when),
          paidByPersonId: fx.people.alex.id,
          supplierId: carrier.id,
          actor: ACTOR,
          lines: [{ amountPence, categoryId: mobile, targetKind: 'person', targetId: personId }],
        });
      }

      // Newest first, and every row says who it was for — no two rows are
      // distinguishable only by their amount.
      assert.deepEqual(
        cardRows().map((row) => `${row.amount} · ${row.label}`),
        [
          '£34.50 · Mobile Phones (Robin)',
          '£15.99 · Mobile Phones (Sam)',
          '£28.99 · Mobile Phones (Alex)',
        ],
      );
      const labels = cardRows().map((row) => row.label);
      assert.equal(new Set(labels).size, labels.length, 'each contract reads distinctly');
      assert.deepEqual(
        cardRows().map((row) => row.extraLines),
        [0, 0, 0],
        'a one-line purchase never says "+N more"',
      );
    } finally {
      fx.close();
    }
  });

  it('shows the first line and counts the rest when a purchase is split', async () => {
    const { fx, carrier, mobile, cardRows } = await withCarrier();
    try {
      createPurchase(fx.db, {
        potId: fx.pots.main.id,
        totalPence: 5000,
        occurredAt: new Date('2026-09-13T09:00:00Z'),
        paidByPersonId: fx.people.alex.id,
        supplierId: carrier.id,
        actor: ACTOR,
        lines: [
          {
            amountPence: 2899,
            categoryId: mobile,
            targetKind: 'person',
            targetId: fx.people.alex.id,
          },
          { amountPence: 1101, categoryId: mobile, targetKind: 'household' },
          {
            amountPence: 1000,
            categoryId: mobile,
            targetKind: 'vehicle',
            targetId: fx.vehicles.vehicleA.id,
          },
        ],
      });

      assert.deepEqual(cardRows(), [
        { amount: '£50.00', label: 'Mobile Phones (Alex)', extraLines: 2 },
      ]);
    } finally {
      fx.close();
    }
  });

  it('labels household and vehicle targets, and survives a removed person', async () => {
    const { fx, mobile, categoryNames } = await withCarrier();
    try {
      const empty = targetNames({ people: [], vehicles: [] });
      const full = targetNames({ people: listPeople(fx.db), vehicles: listVehicles(fx.db) });
      const line = (targetKind: string, targetId: number | null) => ({
        categoryId: mobile,
        targetKind,
        targetId,
      });

      assert.equal(targetLabel(line('household', null), full), 'household');
      assert.equal(targetLabel(line('vehicle', fx.vehicles.vehicleB.id), full), 'Vehicle B');
      // A person the household has since removed degrades to the bare kind
      // rather than throwing or printing a bare id — history keeps rendering.
      assert.equal(targetLabel(line('person', fx.people.sam.id), empty), 'person');
      assert.equal(targetLabel(line('vehicle', 999), empty), 'vehicle');

      // An empty purchase is not a thing the split rules allow, but a list
      // should not explode if one ever appears.
      assert.deepEqual(purchaseLineSummary([], categoryNames, full), {
        label: '',
        extraLines: 0,
      });
      // An unknown category still names the target.
      assert.equal(
        purchaseLineSummary([line('household', null)], new Map(), full).label,
        'Category (household)',
      );
    } finally {
      fx.close();
    }
  });
});
