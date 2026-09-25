import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { auditEntries, purchases } from '../src/lib/db/schema';
import {
  checkFuelDetails,
  computeFuelEconomy,
  formatLitres,
  formatPencePerLitre,
  fuelFeedback,
  InvalidFuelDetailsError,
  LITRES_PER_UK_GALLON,
  parseLitres,
  parseOdometer,
  totalStretches,
  type FuelFill,
  type FuelStretch,
} from '../src/lib/records/fuel-economy';
import {
  editFuelDetails,
  fuelFeedbackForPurchase,
  getFuelEconomyView,
  listFuelFills,
  NotAFuelPurchaseError,
} from '../src/lib/records/fuel';
import { createPurchase, voidPurchase } from '../src/lib/records/purchases';
import { VersionConflictError } from '../src/lib/records/errors';
import { createHouseholdFixture, type HouseholdFixture } from './household';

/**
 * Fuel economy (SPEC §16.4, v0.10.0 — decisions 139–141): full tank to full
 * tank, UK gallons, nothing guessed. The pure calculation first, then the
 * database layer: the optional details on the fuel entry, the later edit and
 * the Insights view.
 */

let nextId = 1;
function fill(partial: Partial<FuelFill> & { day: number }): FuelFill {
  const id = partial.purchaseId ?? nextId++;
  const date = `2026-08-${String(partial.day).padStart(2, '0')}`;
  return {
    purchaseId: id,
    occurredDate: date,
    occurredAt: new Date(`${date}T12:00:00Z`),
    fuelPence: partial.fuelPence ?? 6000,
    odometerMiles: partial.odometerMiles ?? null,
    fuelMillilitres: partial.fuelMillilitres ?? null,
    fullTank: partial.fullTank ?? true,
  };
}

describe('parsing what the household types', () => {
  it('reads litres to the millilitre and odometers to the mile', () => {
    assert.deepEqual(parseLitres('45.23'), { ok: true, value: 45230 });
    assert.deepEqual(parseLitres(' 45.2 L '), { ok: true, value: 45200 });
    assert.deepEqual(parseLitres('40'), { ok: true, value: 40000 });
    assert.deepEqual(parseLitres('40.125'), { ok: true, value: 40125 });
    assert.deepEqual(parseLitres(''), { ok: true, value: null });
    assert.equal(parseLitres('4O.1').ok, false);
    assert.equal(parseLitres('0').ok, false);
    assert.equal(parseLitres('501').ok, false);
    assert.equal(parseLitres('40.1234').ok, false);

    assert.deepEqual(parseOdometer('52,310'), { ok: true, value: 52310 });
    assert.deepEqual(parseOdometer('52 310 miles'), { ok: true, value: 52310 });
    assert.deepEqual(parseOdometer(''), { ok: true, value: null });
    assert.equal(parseOdometer('52310.5').ok, false);
    assert.equal(parseOdometer('0').ok, false);
  });

  it('formats litres and the forecourt price the way the pump shows them', () => {
    assert.equal(formatLitres(45230), '45.23');
    assert.equal(formatLitres(40000), '40.00');
    assert.equal(formatLitres(40125), '40.125');
    // £58.20 for 40.73 L → 142.89… → 142.9p/L
    assert.equal(formatPencePerLitre(5820, 40730), '142.9p/L');
  });

  it('refuses nonsense in the domain, whatever the form sent', () => {
    assert.throws(
      () => checkFuelDetails({ odometerMiles: -1, fuelMillilitres: null, fullTank: true }),
      InvalidFuelDetailsError,
    );
    assert.throws(
      () => checkFuelDetails({ odometerMiles: null, fuelMillilitres: 1.5, fullTank: true }),
      InvalidFuelDetailsError,
    );
  });
});

describe('full tank to full tank', () => {
  it('measures the miles over every litre put in after the first full tank', () => {
    const fills = [
      fill({ day: 1, odometerMiles: 50000, fuelMillilitres: 45000 }),
      fill({ day: 8, odometerMiles: 50200, fuelMillilitres: 20000, fullTank: false }),
      fill({ day: 15, odometerMiles: 50400, fuelMillilitres: 25000, fuelPence: 3600 }),
    ];
    const economy = computeFuelEconomy(fills);
    assert.equal(economy.stretches.length, 1);
    const stretch = economy.stretches[0] as FuelStretch;
    assert.equal(stretch.kind, 'measured');
    assert.equal(stretch.miles, 400);
    // The first tank's own 45 L are not counted — it was the starting line.
    assert.equal(stretch.millilitres, 45000);
    assert.equal(stretch.fuelPence, 9600);
    assert.ok(Math.abs(stretch.mpg - 400 / (45 / LITRES_PER_UK_GALLON)) < 1e-9);
    assert.equal(stretch.mpg.toFixed(1), '40.4');
    assert.equal(stretch.pencePerMile, 24);
    assert.equal(stretch.suspect, false);
    assert.equal(economy.anchor?.purchaseId, fills[2]!.purchaseId);
  });

  it('a part fill needs no odometer, but it does need its litres', () => {
    const start = fill({ day: 1, odometerMiles: 1000, fuelMillilitres: 40000 });
    const part = fill({ day: 5, fuelMillilitres: null, fullTank: false });
    const end = fill({ day: 9, odometerMiles: 1400, fuelMillilitres: 30000 });
    const economy = computeFuelEconomy([start, part, end]);
    assert.deepEqual(economy.stretches[0], {
      kind: 'gap',
      toPurchaseId: end.purchaseId,
      toDate: end.occurredDate,
      reason: 'missing_litres',
      purchaseIds: [part.purchaseId],
    });

    // Adding the litres later makes the stretch appear — nothing else changes.
    const fixed = computeFuelEconomy([start, { ...part, fuelMillilitres: 15000 }, end]);
    assert.equal(fixed.stretches[0]!.kind, 'measured');
    assert.equal((fixed.stretches[0] as FuelStretch).millilitres, 45000);
  });

  it('a full tank without a reading ends one stretch and cannot start the next', () => {
    const fills = [
      fill({ day: 1, odometerMiles: 1000, fuelMillilitres: 40000 }),
      fill({ day: 5, fuelMillilitres: 40000 }),
      fill({ day: 9, odometerMiles: 1800, fuelMillilitres: 40000 }),
      fill({ day: 14, odometerMiles: 2200, fuelMillilitres: 40000 }),
    ];
    const economy = computeFuelEconomy(fills);
    assert.deepEqual(
      economy.stretches.map((entry) => (entry.kind === 'gap' ? entry.reason : 'measured')),
      ['missing_odometer', 'measured'],
    );
    // Day 9 re-anchors (it has a reading); only day 9 → day 14 is measured.
    assert.equal((economy.stretches[1] as FuelStretch).miles, 400);
  });

  it('an odometer that goes backwards is flagged, not turned into a negative mpg', () => {
    const economy = computeFuelEconomy([
      fill({ day: 1, odometerMiles: 5000, fuelMillilitres: 40000 }),
      fill({ day: 9, odometerMiles: 4900, fuelMillilitres: 40000 }),
    ]);
    assert.equal(economy.stretches[0]!.kind, 'gap');
    assert.equal((economy.stretches[0] as { reason: string }).reason, 'odometer_not_increasing');
  });

  it('fills before the first usable full tank are simply waited out', () => {
    const economy = computeFuelEconomy([
      fill({ day: 1, fuelMillilitres: 40000 }),
      fill({ day: 3, odometerMiles: 900, fuelMillilitres: 10000, fullTank: false }),
    ]);
    assert.equal(economy.stretches.length, 0);
    assert.equal(economy.anchor, null);
  });

  it('flags a figure no car does as worth checking', () => {
    const economy = computeFuelEconomy([
      fill({ day: 1, odometerMiles: 1000, fuelMillilitres: 40000 }),
      fill({ day: 2, odometerMiles: 5000, fuelMillilitres: 10000 }),
    ]);
    assert.equal((economy.stretches[0] as FuelStretch).suspect, true);
  });

  it('totals are one ratio of sums, never an average of ratios', () => {
    const totals = totalStretches([
      { miles: 100, millilitres: 10000, fuelPence: 1500 } as FuelStretch,
      { miles: 300, millilitres: 40000, fuelPence: 6000 } as FuelStretch,
    ]);
    assert.ok(totals !== null);
    assert.equal(totals.miles, 400);
    assert.ok(Math.abs(totals.mpg - 400 / (50 / LITRES_PER_UK_GALLON)) < 1e-9);
    assert.equal(totals.pencePerMile, 18.75);
    assert.equal(totalStretches([]), null);
  });

  it('says what happened after a save, in plain words', () => {
    const a = fill({ day: 1, odometerMiles: 1000, fuelMillilitres: 40000 });
    const b = fill({ day: 9, odometerMiles: 1400, fuelMillilitres: 40730, fuelPence: 5820 });
    const economy = computeFuelEconomy([a, b]);
    assert.equal(
      fuelFeedback('Vehicle A', b, economy),
      'Vehicle A: 44.6 mpg over 400 miles since the last full tank. 40.73 L at 142.9p/L.',
    );
    assert.match(
      fuelFeedback('Vehicle A', a, computeFuelEconomy([a])) ?? '',
      /full tank at 1,000 miles noted — mpg appears after the next full tank/,
    );
    const bare = fill({ day: 3 });
    assert.match(
      fuelFeedback('Vehicle A', bare, computeFuelEconomy([bare])) ?? '',
      /Add the odometer reading and litres later/,
    );
    const part = fill({ day: 4, fuelMillilitres: 10000, fullTank: false });
    assert.match(
      fuelFeedback('Vehicle A', part, computeFuelEconomy([a, part])) ?? '',
      /Part fill for Vehicle A — mpg is worked out at the next full tank/,
    );
  });
});

describe('fuel details in the database', () => {
  function fuelPurchase(
    fx: HouseholdFixture,
    options: {
      day: string;
      pence: number;
      odometerMiles?: number | null;
      fuelMillilitres?: number | null;
      fullTank?: boolean;
      vehicleId?: number;
    },
  ) {
    return createPurchase(fx.db, {
      potId: fx.pots.main.id,
      totalPence: options.pence,
      paidByPersonId: fx.people.alex.id,
      occurredDate: options.day,
      lines: [
        {
          amountPence: options.pence,
          categoryId: fx.categoryId('Vehicle Running', 'Fuel'),
          targetKind: 'vehicle',
          targetId: options.vehicleId ?? fx.vehicles.vehicleA.id,
        },
      ],
      fuelDetails:
        options.odometerMiles === undefined &&
        options.fuelMillilitres === undefined &&
        options.fullTank === undefined
          ? undefined
          : {
              odometerMiles: options.odometerMiles ?? null,
              fuelMillilitres: options.fuelMillilitres ?? null,
              fullTank: options.fullTank ?? true,
            },
      actor: 'alex@example.com',
      now: new Date('2026-09-20T17:00:00Z'),
    }).purchase;
  }

  it('stores the optional details with the fuel entry, and nothing when omitted', async () => {
    const fx = await createHouseholdFixture();
    try {
      const bare = fuelPurchase(fx, { day: '2026-09-01', pence: 5000 });
      assert.equal(bare.odometerMiles, null);
      assert.equal(bare.fuelMillilitres, null);
      assert.equal(bare.fuelFullTank, true);

      const full = fuelPurchase(fx, {
        day: '2026-09-02',
        pence: 5820,
        odometerMiles: 52310,
        fuelMillilitres: 40730,
        fullTank: false,
      });
      assert.equal(full.odometerMiles, 52310);
      assert.equal(full.fuelMillilitres, 40730);
      assert.equal(full.fuelFullTank, false);
    } finally {
      fx.close();
    }
  });

  it('adds the details later as a versioned, audited edit, then answers with the mpg', async () => {
    const fx = await createHouseholdFixture();
    try {
      fuelPurchase(fx, {
        day: '2026-09-01',
        pence: 6000,
        odometerMiles: 50000,
        fuelMillilitres: 45000,
      });
      const later = fuelPurchase(fx, { day: '2026-09-10', pence: 5820 });
      assert.match(fuelFeedbackForPurchase(fx.db, later.id) ?? '', /no odometer reading yet/);

      const edited = editFuelDetails(fx.db, {
        id: later.id,
        expectedVersion: later.version,
        actor: 'sam@example.com',
        details: { odometerMiles: 50400, fuelMillilitres: 40730, fullTank: true },
      });
      assert.equal(edited.version, later.version + 1);
      assert.equal(edited.odometerMiles, 50400);
      assert.equal(
        fuelFeedbackForPurchase(fx.db, later.id),
        'Vehicle A: 44.6 mpg over 400 miles since the last full tank. 40.73 L at 142.9p/L.',
      );

      const audit = fx.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.action, 'purchase.fuel_details'))
        .all();
      assert.equal(audit.length, 1);
      assert.equal(audit[0]!.actor, 'sam@example.com');
      assert.match(audit[0]!.summary, /50,400 miles · 40\.73 L · full tank/);

      // A stale form fails visibly.
      assert.throws(
        () =>
          editFuelDetails(fx.db, {
            id: later.id,
            expectedVersion: later.version,
            actor: 'alex@example.com',
            details: { odometerMiles: null, fuelMillilitres: null, fullTank: true },
          }),
        VersionConflictError,
      );
    } finally {
      fx.close();
    }
  });

  it('refuses fuel details on something that is not a fuel purchase', async () => {
    const fx = await createHouseholdFixture();
    try {
      const shop = createPurchase(fx.db, {
        potId: fx.pots.main.id,
        totalPence: 1200,
        paidByPersonId: fx.people.alex.id,
        lines: [
          {
            amountPence: 1200,
            categoryId: fx.categoryId('Groceries', 'Weekly Shop'),
            targetKind: 'household',
          },
        ],
        actor: 'alex@example.com',
      }).purchase;
      assert.throws(
        () =>
          editFuelDetails(fx.db, {
            id: shop.id,
            expectedVersion: shop.version,
            actor: 'alex@example.com',
            details: { odometerMiles: 1000, fuelMillilitres: null, fullTank: true },
          }),
        NotAFuelPurchaseError,
      );
      assert.equal(fuelFeedbackForPurchase(fx.db, shop.id), null);
    } finally {
      fx.close();
    }
  });

  it('keeps each vehicle to its own fills and leaves voided ones out', async () => {
    const fx = await createHouseholdFixture();
    try {
      fuelPurchase(fx, {
        day: '2026-09-01',
        pence: 6000,
        odometerMiles: 1000,
        fuelMillilitres: 40000,
      });
      fuelPurchase(fx, {
        day: '2026-09-02',
        pence: 5000,
        odometerMiles: 9000,
        fuelMillilitres: 35000,
        vehicleId: fx.vehicles.vehicleB.id,
      });
      const mistake = fuelPurchase(fx, {
        day: '2026-09-03',
        pence: 100,
        odometerMiles: 1001,
        fuelMillilitres: 1000,
      });
      voidPurchase(fx.db, {
        id: mistake.id,
        expectedVersion: mistake.version,
        actor: 'alex@example.com',
        reason: 'typo',
      });
      fuelPurchase(fx, {
        day: '2026-09-09',
        pence: 5500,
        odometerMiles: 1400,
        fuelMillilitres: 40000,
      });

      const fills = listFuelFills(fx.db);
      assert.equal(fills.get(fx.vehicles.vehicleA.id)?.length, 2);
      assert.equal(fills.get(fx.vehicles.vehicleB.id)?.length, 1);

      const view = getFuelEconomyView(fx.db, new Date('2026-09-20T17:00:00Z'));
      const a = view.find((vehicle) => vehicle.vehicleId === fx.vehicles.vehicleA.id);
      const b = view.find((vehicle) => vehicle.vehicleId === fx.vehicles.vehicleB.id);
      assert.ok(a !== undefined && b !== undefined);
      assert.equal(a.latest?.miles, 400);
      assert.equal(a.latest?.mpg.toFixed(1), '45.5');
      assert.equal(a.lastYear?.stretches, 1);
      assert.equal(a.latestPrice?.pencePerLitre, 137.5);
      assert.equal(a.missing.length, 0);
      assert.equal(b.latest, null);
      assert.equal(b.fillCount, 1);
    } finally {
      fx.close();
    }
  });

  it('lists recent fills that are missing a detail that matters', async () => {
    const fx = await createHouseholdFixture();
    try {
      const full = fuelPurchase(fx, { day: '2026-09-10', pence: 5000 });
      const part = fuelPurchase(fx, {
        day: '2026-09-12',
        pence: 2000,
        fullTank: false,
      });
      const view = getFuelEconomyView(fx.db, new Date('2026-09-20T17:00:00Z'));
      const a = view.find((vehicle) => vehicle.vehicleId === fx.vehicles.vehicleA.id);
      assert.deepEqual(
        a?.missing.map((entry) => [entry.purchaseId, entry.missing]),
        [
          // A part fill needs only its litres.
          [part.id, ['litres']],
          [full.id, ['odometer', 'litres']],
        ],
      );
      // The columns really are nullable in the database, not just in the type.
      const row = fx.db.select().from(purchases).where(eq(purchases.id, full.id)).get();
      assert.equal(row?.odometerMiles, null);
    } finally {
      fx.close();
    }
  });
});
