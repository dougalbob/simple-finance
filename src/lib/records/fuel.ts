import { and, asc, eq, isNull } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import { allocations, categories, purchases, vehicles } from '../db/schema';
import { formatPence } from '../money';
import { toLocalDateString } from '../time';
import { addDaysLocal } from './dates';
import { RecordVoidedError, VersionConflictError } from './errors';
import {
  checkFuelDetails,
  describeClosure,
  computeFuelEconomy,
  formatLitres,
  formatMiles,
  fuelFeedback,
  pencePerLitre,
  sortFills,
  totalStretches,
  type FuelDetails,
  type FuelFill,
  type FuelGap,
  type FuelStretch,
  type FuelTotals,
} from './fuel-economy';
import { PurchaseNotFoundError, type Purchase } from './purchases';
import { listVehicles } from './vehicles';

/**
 * Fuel details and fuel economy against the database (SPEC §15.1, §16.4 —
 * v0.10.0, decisions 139–141). The arithmetic is `fuel-economy.ts`'s; this
 * module only finds the fills and writes the details.
 *
 * A **fuel purchase** is a non-void, non-refund purchase whose Vehicle
 * Running / Fuel lines all target one and the same vehicle — which is what the
 * till's Fuel form always writes. A purchase whose fuel lines name two
 * vehicles is ambiguous (whose tank got the litres?) and is left out of the
 * mpg calculation rather than guessed at.
 */

export class NotAFuelPurchaseError extends Error {
  constructor(
    message = 'Fuel details belong on a fuel purchase for one vehicle (Vehicle Running / Fuel).',
  ) {
    super(message);
    this.name = 'NotAFuelPurchaseError';
  }
}

/** The Vehicle Running / Fuel leaf — the category the Fuel form writes. */
export function getFuelCategoryId(db: Db | DbTx): number | null {
  const parent = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, 'Vehicle Running'), isNull(categories.parentId)))
    .get();
  if (parent === undefined) return null;
  const child = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, parent.id), eq(categories.name, 'Fuel')))
    .get();
  return child?.id ?? null;
}

/**
 * The one vehicle a purchase's fuel lines target, or null when it has no
 * fuel line, or fuel lines for more than one vehicle.
 */
export function fuelVehicleOfLines(
  lines: ReadonlyArray<{ categoryId: number; targetKind: string; targetId: number | null }>,
  fuelCategoryId: number | null,
): number | null {
  if (fuelCategoryId === null) return null;
  const fuelLines = lines.filter((line) => line.categoryId === fuelCategoryId);
  if (fuelLines.length === 0) return null;
  const targets = new Set(
    fuelLines.map((line) => (line.targetKind === 'vehicle' ? line.targetId : null)),
  );
  if (targets.size !== 1) return null;
  const [only] = [...targets];
  return only ?? null;
}

/** Every vehicle's fuel fills, oldest first. */
export function listFuelFills(db: Db | DbTx): Map<number, FuelFill[]> {
  const byVehicle = new Map<number, FuelFill[]>();
  const fuelCategoryId = getFuelCategoryId(db);
  if (fuelCategoryId === null) return byVehicle;
  const rows = db
    .select({
      purchaseId: purchases.id,
      occurredDate: purchases.occurredDate,
      occurredAt: purchases.occurredAt,
      odometerMiles: purchases.odometerMiles,
      fuelMillilitres: purchases.fuelMillilitres,
      fullTank: purchases.fuelFullTank,
      amountPence: allocations.amountPence,
      targetKind: allocations.targetKind,
      targetId: allocations.targetId,
    })
    .from(purchases)
    .innerJoin(allocations, eq(allocations.purchaseId, purchases.id))
    .where(
      and(
        eq(allocations.categoryId, fuelCategoryId),
        isNull(purchases.voidedAt),
        isNull(purchases.refundOfPurchaseId),
      ),
    )
    .orderBy(asc(purchases.id))
    .all();

  const grouped = new Map<number, { fill: FuelFill; targets: Set<number | null> }>();
  for (const row of rows) {
    const target = row.targetKind === 'vehicle' ? row.targetId : null;
    const existing = grouped.get(row.purchaseId);
    if (existing !== undefined) {
      existing.fill.fuelPence += row.amountPence;
      existing.targets.add(target);
      continue;
    }
    grouped.set(row.purchaseId, {
      fill: {
        purchaseId: row.purchaseId,
        occurredDate: row.occurredDate,
        occurredAt: row.occurredAt,
        fuelPence: row.amountPence,
        odometerMiles: row.odometerMiles,
        fuelMillilitres: row.fuelMillilitres,
        fullTank: row.fullTank,
      },
      targets: new Set([target]),
    });
  }
  for (const { fill, targets } of grouped.values()) {
    if (targets.size !== 1) continue;
    const [vehicleId] = [...targets];
    if (vehicleId === null || vehicleId === undefined) continue;
    const list = byVehicle.get(vehicleId) ?? [];
    list.push(fill);
    byVehicle.set(vehicleId, list);
  }
  for (const [vehicleId, list] of byVehicle) byVehicle.set(vehicleId, sortFills(list));
  return byVehicle;
}

/** Per fuel purchase, the stretch it closed (for the Purchases rows). */
export function getFuelClosures(db: Db): Map<number, FuelStretch | FuelGap> {
  const closures = new Map<number, FuelStretch | FuelGap>();
  for (const fills of listFuelFills(db).values()) {
    for (const [purchaseId, entry] of computeFuelEconomy(fills).closedBy) {
      closures.set(purchaseId, entry);
    }
  }
  return closures;
}

export interface EditFuelDetailsInput {
  id: number;
  expectedVersion: number;
  actor: string;
  details: FuelDetails;
  now?: Date;
}

/**
 * Add or correct the odometer, litres and full-tank flag of a fuel purchase
 * after the fact (decision 139: neither figure is required at the pump). A
 * versioned, audited edit like every other correction; blank clears a figure.
 */
export function editFuelDetails(db: Db, input: EditFuelDetailsInput): Purchase {
  const now = input.now ?? new Date();
  const actor = input.actor.trim();
  if (actor === '') throw new NotAFuelPurchaseError('Every change records who made it.');
  const details = checkFuelDetails(input.details);

  return db.transaction((tx) => {
    const current = tx.select().from(purchases).where(eq(purchases.id, input.id)).get();
    if (current === undefined) throw new PurchaseNotFoundError(input.id);
    if (current.voidedAt !== null) throw new RecordVoidedError('purchase', input.id);
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('purchase', input.id, input.expectedVersion, current.version);
    }
    if (current.refundOfPurchaseId !== null) {
      throw new NotAFuelPurchaseError('A refund has no fuel details of its own.');
    }
    const lines = tx
      .select({
        categoryId: allocations.categoryId,
        targetKind: allocations.targetKind,
        targetId: allocations.targetId,
      })
      .from(allocations)
      .where(eq(allocations.purchaseId, current.id))
      .all();
    if (fuelVehicleOfLines(lines, getFuelCategoryId(tx)) === null) {
      throw new NotAFuelPurchaseError();
    }

    const updated = tx
      .update(purchases)
      .set({
        odometerMiles: details.odometerMiles,
        fuelMillilitres: details.fuelMillilitres,
        fuelFullTank: details.fullTank,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(purchases.id, current.id))
      .returning()
      .get();
    if (updated === undefined) throw new Error('update purchase returned no row');

    recordAudit(tx, {
      actor,
      action: 'purchase.fuel_details',
      entity: 'purchase',
      entityId: current.id,
      summary: `Fuel details for purchase #${current.id} (${formatPence(current.totalPence)}): ${describeFuelDetails(details)}`,
      before: {
        odometerMiles: current.odometerMiles,
        fuelMillilitres: current.fuelMillilitres,
        fullTank: current.fuelFullTank,
      },
      after: details,
      now,
    });
    return updated;
  });
}

/** "52,310 miles · 45.23 L · full tank" — for history lines and rows. */
export function describeFuelDetails(details: FuelDetails): string {
  return [
    details.odometerMiles === null ? 'no odometer' : `${formatMiles(details.odometerMiles)} miles`,
    details.fuelMillilitres === null ? 'no litres' : `${formatLitres(details.fuelMillilitres)} L`,
    details.fullTank ? 'full tank' : 'part fill',
  ].join(' · ');
}

/**
 * The sentence shown after a fuel purchase is saved, or its details edited
 * (decision 141). Null when the purchase is not a fuel purchase.
 */
export function fuelFeedbackForPurchase(db: Db, purchaseId: number): string | null {
  const lines = db
    .select({
      categoryId: allocations.categoryId,
      targetKind: allocations.targetKind,
      targetId: allocations.targetId,
    })
    .from(allocations)
    .where(eq(allocations.purchaseId, purchaseId))
    .all();
  const vehicleId = fuelVehicleOfLines(lines, getFuelCategoryId(db));
  if (vehicleId === null) return null;
  const fills = listFuelFills(db).get(vehicleId) ?? [];
  const fill = fills.find((item) => item.purchaseId === purchaseId);
  if (fill === undefined) return null;
  const vehicle = db
    .select({ label: vehicles.label })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .get();
  return fuelFeedback(vehicle?.label ?? 'This vehicle', fill, computeFuelEconomy(fills));
}

export interface FuelFillView {
  fill: FuelFill;
  /** The stretch this fill closed, when it was a full tank after another. */
  closed: FuelStretch | FuelGap | null;
  pencePerLitre: number | null;
}

export interface MissingFuelDetail {
  purchaseId: number;
  occurredDate: string;
  fuelPence: number;
  missing: Array<'odometer' | 'litres'>;
}

export interface VehicleFuelEconomyView {
  vehicleId: number;
  label: string;
  fillCount: number;
  /** The most recent measured stretch. */
  latest: FuelStretch | null;
  /** Every measured stretch that ended in the last 12 months, as one ratio of sums. */
  lastYear: FuelTotals | null;
  /** The most recent fill with litres recorded. */
  latestPrice: { pencePerLitre: number; occurredDate: string } | null;
  /** Newest first, the last six fills. */
  recent: FuelFillView[];
  /**
   * Fills from the last 120 days still missing a detail that matters: litres
   * on any fill, the odometer on a full tank (a part fill needs none).
   */
  missing: MissingFuelDetail[];
}

export const FUEL_RECENT_FILLS = 6;
export const FUEL_MISSING_WINDOW_DAYS = 120;

/** The Insights panel (SPEC §16.4): one card per vehicle, every vehicle listed. */
export function getFuelEconomyView(db: Db, nowArg?: Date): VehicleFuelEconomyView[] {
  const now = nowArg ?? new Date();
  const today = toLocalDateString(now);
  const yearAgo = addDaysLocal(today, -365);
  const missingFrom = addDaysLocal(today, -FUEL_MISSING_WINDOW_DAYS);
  const fillsByVehicle = listFuelFills(db);

  return listVehicles(db).map((vehicle) => {
    const fills = fillsByVehicle.get(vehicle.id) ?? [];
    const economy = computeFuelEconomy(fills);
    const measured = economy.stretches.filter(
      (entry): entry is FuelStretch => entry.kind === 'measured',
    );
    const newestFirst = [...fills].reverse();
    const priced = newestFirst.find((fill) => fill.fuelMillilitres !== null);
    return {
      vehicleId: vehicle.id,
      label: vehicle.label,
      fillCount: fills.length,
      latest: measured.at(-1) ?? null,
      lastYear: totalStretches(measured.filter((entry) => entry.toDate >= yearAgo)),
      latestPrice:
        priced === undefined
          ? null
          : {
              pencePerLitre: pencePerLitre(priced.fuelPence, priced.fuelMillilitres as number),
              occurredDate: priced.occurredDate,
            },
      recent: newestFirst.slice(0, FUEL_RECENT_FILLS).map((fill) => ({
        fill,
        closed: economy.closedBy.get(fill.purchaseId) ?? null,
        pencePerLitre:
          fill.fuelMillilitres === null
            ? null
            : pencePerLitre(fill.fuelPence, fill.fuelMillilitres),
      })),
      missing: newestFirst
        .filter((fill) => fill.occurredDate >= missingFrom)
        .map((fill) => ({
          purchaseId: fill.purchaseId,
          occurredDate: fill.occurredDate,
          fuelPence: fill.fuelPence,
          missing: [
            ...(fill.fullTank && fill.odometerMiles === null ? (['odometer'] as const) : []),
            ...(fill.fuelMillilitres === null ? (['litres'] as const) : []),
          ],
        }))
        .filter((entry) => entry.missing.length > 0),
    };
  });
}

/** What the purchase lists need to draw fuel details, gathered once per page. */
export interface FuelRowContext {
  fuelCategoryId: number | null;
  vehicleLabels: Map<number, string>;
  closures: Map<number, FuelStretch | FuelGap>;
}

export function getFuelRowContext(db: Db): FuelRowContext {
  return {
    fuelCategoryId: getFuelCategoryId(db),
    vehicleLabels: new Map(listVehicles(db).map((vehicle) => [vehicle.id, vehicle.label])),
    closures: getFuelClosures(db),
  };
}

/** Props for `FuelDetailsForm`, or null when the purchase is not a fuel purchase. */
export function fuelRowDetails(
  context: FuelRowContext,
  purchase: Purchase,
  lines: ReadonlyArray<{
    categoryId: number;
    targetKind: string;
    targetId: number | null;
    amountPence: number;
  }>,
) {
  if (purchase.refundOfPurchaseId !== null) return null;
  const vehicleId = fuelVehicleOfLines(lines, context.fuelCategoryId);
  if (vehicleId === null) return null;
  const closure = context.closures.get(purchase.id);
  return {
    purchaseId: purchase.id,
    expectedVersion: purchase.version,
    vehicleLabel: context.vehicleLabels.get(vehicleId) ?? 'Vehicle',
    fuelPence: lines
      .filter((line) => line.categoryId === context.fuelCategoryId)
      .reduce((sum, line) => sum + line.amountPence, 0),
    odometerMiles: purchase.odometerMiles,
    fuelMillilitres: purchase.fuelMillilitres,
    fullTank: purchase.fuelFullTank,
    economyNote: closure === undefined ? null : describeClosure(closure),
    editable: purchase.voidedAt === null,
  };
}
