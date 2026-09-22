import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { asc, eq } from 'drizzle-orm';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import {
  advanceDueRenewals,
  createRenewal,
  DEFAULT_RENEWAL_WARN_DAYS,
  editRenewal,
} from '../src/lib/records/renewals';
import { computeKeyDateAlerts, keyDateMessage } from '../src/lib/records/keydates';
import { getKeyDateAlerts } from '../src/lib/records/money-view';
import { createSchedule, materializeAndConvert } from '../src/lib/records/schedules';
import { auditEntries, renewals, scheduleInstances } from '../src/lib/db/schema';

/**
 * Scenario E9 (docs/SPEC.md §17): renewals and key-date alerts.
 * - "Vehicle A insurance — InsurerCo", renews 12 October, default 21-day
 *   lead, repeats annually, target Vehicle A. From 21 September the panel
 *   shows "renews in 21 days" (inclusive boundary).
 * - On 12 October the date advances a year automatically (visible,
 *   editable; 29 Feb → 28 Feb).
 * - Contract end: the Broadband DD carries contract_ends_on 3 November;
 *   from 13 October (21-day lead) "time to shop around"; instances never
 *   auto-stop; a past end date shows "rolled / awaiting review".
 */
describe('renewals: E9 key-date behaviour', () => {
  let fixture: HouseholdFixture;
  after(() => fixture.close());

  it('shows from exactly the 21st day before (inclusive window), today first', async () => {
    fixture = await createHouseholdFixture();
    const { db } = fixture;

    const renewal = createRenewal(db, {
      label: 'Vehicle A insurance — InsurerCo',
      supplierId: null,
      targetKind: 'vehicle',
      targetId: fixture.vehicles.vehicleA.id,
      nextRenewalDate: '2026-10-12',
      actor: 'alex@example.com',
      now: new Date('2026-09-01T09:00:00Z'),
    });
    assert.equal(renewal.warnDaysBefore, DEFAULT_RENEWAL_WARN_DAYS);

    const item = {
      id: renewal.id,
      kind: 'renewal' as const,
      label: renewal.label,
      date: renewal.nextRenewalDate,
      leadDays: 21,
    };

    // 20 September: 22 days out → outside the 21-day window → quiet.
    assert.deepEqual(computeKeyDateAlerts([item], '2026-09-20'), []);

    // 21 September: exactly 21 days → inside the window (E9).
    const atWindowEdge = computeKeyDateAlerts([item], '2026-09-21');
    assert.equal(atWindowEdge.length, 1);
    assert.equal(atWindowEdge[0]?.state, 'in-window');
    assert.equal(atWindowEdge[0]?.daysUntil, 21);
    assert.match(keyDateMessage(atWindowEdge[0]!), /renews in 21 days/);

    // The day itself: "renews today".
    const onDay = computeKeyDateAlerts([item], '2026-10-12');
    assert.equal(onDay[0]?.state, 'today');
    assert.match(keyDateMessage(onDay[0]!), /renews today/);
  });

  it('advances a year on its day (visible + audited), and 29 Feb → 28 Feb', async () => {
    fixture = await createHouseholdFixture();
    const { db } = fixture;

    const renewal = createRenewal(db, {
      label: 'Vehicle A insurance — InsurerCo',
      targetKind: 'vehicle',
      targetId: fixture.vehicles.vehicleA.id,
      nextRenewalDate: '2026-10-12',
      actor: 'alex@example.com',
      now: new Date('2026-09-01T09:00:00Z'),
    });
    const leap = createRenewal(db, {
      label: 'Leap certificate',
      nextRenewalDate: '2024-02-29',
      actor: 'alex@example.com',
      now: new Date('2024-02-01T09:00:00Z'),
    });
    const oneOff = createRenewal(db, {
      label: 'One-off permit',
      nextRenewalDate: '2026-10-01',
      repeatsAnnually: false,
      actor: 'alex@example.com',
      now: new Date('2026-09-01T09:00:00Z'),
    });

    // 22 September: the stale leap renewal (created in 2024) is caught up
    // one audited step per missed year: 2024-02-29 → 2025-02-28 →
    // 2026-02-28 → 2027-02-28 (29 Feb → 28 Feb each non-leap year, OQ13).
    // The others are not yet due.
    assert.equal(advanceDueRenewals(db, new Date('2026-09-22T09:00:00Z')), 3);
    const leapCaughtUp = db.select().from(renewals).where(eq(renewals.id, leap.id)).get();
    assert.equal(leapCaughtUp?.nextRenewalDate, '2027-02-28');
    assert.equal(leapCaughtUp?.advancedFrom, '2026-02-28');

    // 12 October: the insurance advances one year. The one-off does NOT —
    // non-repeating dates are left in place.
    assert.equal(advanceDueRenewals(db, new Date('2026-10-12T09:00:00Z')), 1);
    const advanced = db.select().from(renewals).where(eq(renewals.id, renewal.id)).get();
    assert.equal(advanced?.nextRenewalDate, '2027-10-12');
    assert.equal(advanced?.advancedFrom, '2026-10-12');
    assert.equal(advanced?.version, 2);
    const oneOffRow = db.select().from(renewals).where(eq(renewals.id, oneOff.id)).get();
    assert.equal(oneOffRow?.nextRenewalDate, '2026-10-01');
    assert.equal(oneOffRow?.advancedFrom, null);

    // The advance is in the audit trail (visible, not silent).
    const auditRows = db
      .select()
      .from(auditEntries)
      .orderBy(asc(auditEntries.id))
      .all()
      .filter((entry) => entry.action === 'renewal.advance');
    // One step for the insurance + three catch-up steps for the leap renewal.
    assert.equal(auditRows.length, 4);
    const insuranceEntry = auditRows.find((entry) => entry.entityId === String(renewal.id));
    assert.ok(insuranceEntry);
    assert.match(insuranceEntry.summary, /advanced from 2026-10-12 to 2027-10-12/);
    assert.equal(insuranceEntry.actor, 'system');
    // Each catch-up year is its own audited step; the final one wins the day.
    const leapEntries = auditRows
      .filter((entry) => entry.entityId === String(leap.id))
      .map((entry) => entry.summary);
    assert.deepEqual(leapEntries, [
      'Renewal “Leap certificate” advanced from 2024-02-29 to 2025-02-28',
      'Renewal “Leap certificate” advanced from 2025-02-28 to 2026-02-28',
      'Renewal “Leap certificate” advanced from 2026-02-28 to 2027-02-28',
    ]);

    // Idempotent: a second pass the same day advances nothing more.
    assert.equal(advanceDueRenewals(db, new Date('2026-10-12T18:00:00Z')), 0);
  });

  it('contract ends: window alerts, past shows rolled / awaiting review, never auto-stops', async () => {
    fixture = await createHouseholdFixture();
    const { db } = fixture;

    const broadband = createSchedule(db, {
      name: 'Broadband',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 3,
      amountPence: Math.round(42 * 100),
      potId: fixture.pots.main.id,
      categoryId: fixture.categoryId('Housing', 'Council Tax'),
      supplierName: 'Northern Power Co',
      targetKind: 'household',
      contractEndsOn: '2026-11-03',
      activeFrom: '2026-09-01',
      actor: 'alex@example.com',
      now: new Date('2026-09-01T09:00:00Z'),
    });

    // 12 October: 22 days before 3 November → outside the 21-day window.
    const beforeWindow = getKeyDateAlerts(db, new Date('2026-10-12T09:00:00Z'));
    assert.equal(
      beforeWindow.filter((alert) => alert.scheduleId === broadband.schedule.id).length,
      0,
    );

    // 13 October: exactly 21 days → "time to shop around" (E9).
    const inWindow = getKeyDateAlerts(db, new Date('2026-10-13T09:00:00Z'));
    const contractAlert = inWindow.find((alert) => alert.scheduleId === broadband.schedule.id);
    assert.ok(contractAlert, 'contract end alert expected from 13 October');
    assert.equal(contractAlert.kind, 'contract-end');
    assert.equal(contractAlert.daysUntil, 21);
    assert.match(keyDateMessage(contractAlert), /time to shop around/);

    // Instances keep being materialised and converting — never auto-stopped.
    materializeAndConvert(db, new Date('2026-11-03T12:00:00Z'));
    const dates = db
      .select()
      .from(scheduleInstances)
      .where(eq(scheduleInstances.scheduleId, broadband.schedule.id))
      .all()
      .map((row) => row.dueDate);
    assert.ok(dates.includes('2026-11-03'));
    assert.ok(dates.includes('2026-12-03'), 'instances continue after the end date');

    // Past end date → quiet, honest "rolled / awaiting review".
    const past = getKeyDateAlerts(db, new Date('2026-11-04T09:00:00Z'));
    const pastAlert = past.find((alert) => alert.scheduleId === broadband.schedule.id);
    assert.ok(pastAlert);
    assert.equal(pastAlert.state, 'rolled-awaiting-review');
    assert.match(keyDateMessage(pastAlert), /rolled \/ awaiting review/);
  });

  it('edits keep the version guard and audit the change', async () => {
    fixture = await createHouseholdFixture();
    const { db } = fixture;
    const renewal = createRenewal(db, {
      label: 'Gym membership',
      nextRenewalDate: '2026-12-01',
      warnDaysBefore: 14,
      actor: 'alex@example.com',
      now: new Date('2026-09-01T09:00:00Z'),
    });
    const edited = editRenewal(db, {
      id: renewal.id,
      expectedVersion: renewal.version,
      actor: 'sam@example.com',
      now: new Date('2026-09-05T09:00:00Z'),
      patch: { warnDaysBefore: 30 },
    });
    assert.equal(edited.warnDaysBefore, 30);
    assert.equal(edited.version, 2);
    assert.throws(
      () =>
        editRenewal(db, {
          id: renewal.id,
          expectedVersion: 1, // stale
          actor: 'alex@example.com',
          now: new Date('2026-09-05T09:30:00Z'),
          patch: { label: 'Nope' },
        }),
      /version/i,
    );
  });
});
