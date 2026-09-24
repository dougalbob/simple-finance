import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { allocations, purchases } from '../db/schema';
import { addDaysLocal } from './dates';
import { findChildCategory } from './categories';
import { listVehicles } from './vehicles';
import { getMonthlyFuelByVehicle, getWeeklyGroceriesPence } from './settings';

/**
 * Projected day-to-day spending as **episodic events** (SPEC §7.3, v0.6.0,
 * decisions 118–119) — the anchor-reset model.
 *
 * The household's predictable spending is not a smooth rate: the weekly shop
 * happens on one day and not again until the next, and a £55 fill resets the
 * fuel clock for the month. So each configured figure (Settings → Projection
 * figures) drives a repeating **projected event** instead of a pro-rata
 * allowance:
 *
 * - **Cadence** comes from the configuration's shape: weekly groceries every
 *   7 days; monthly fuel every 30 days, per vehicle.
 * - **Anchor** comes from the ledger: the most recent actual event of that
 *   kind — a purchase line in `Groceries > Weekly Shop` for groceries (top-up
 *   shops deliberately do not reset the week), or a `Vehicle Running > Fuel`
 *   line targeted at that vehicle for each vehicle's fuel. The next
 *   occurrence is anchor + cadence, and an actual event therefore suppresses
 *   projected spending for its cooldown window — no double-counting.
 * - **Amount** is the configured figure: the budget per event, stable and
 *   reviewable in Settings.
 * - **No history, or overdue** (anchor + cadence already in the past): the
 *   next event is projected **tomorrow**, then the cadence continues. The
 *   projection may understate, never overstate — an unknown shop is closer
 *   than a known one.
 * - **No weekend shift**: shops and fills happen on any day of the week.
 *
 * The events join the projection engine as ordinary expected outgoings with
 * due dates, so the lowest point lands on shop/fill days again and the
 * horizon's lowest-point date is meaningful with day-to-day included.
 *
 * Pure queries + date arithmetic: reads only, never writes.
 */

/** Groceries: one projected shop per 7 days. */
export const GROCERIES_CADENCE_DAYS = 7;
/** Fuel: one projected fill per 30 days, per vehicle. */
export const FUEL_CADENCE_DAYS = 30;

export interface ProjectedDayToDayEvent {
  kind: 'groceries' | 'fuel';
  /** Display name, e.g. "Weekly shop (projected)" or "Fuel — Audi (projected)". */
  name: string;
  amountPence: number;
  dueDate: string;
  /** The vehicle a fuel event belongs to; null for groceries. */
  vehicleId: number | null;
}

/**
 * The most recent date a non-voided purchase carried a positive allocation
 * to `Groceries > Weekly Shop`. Any amount counts — the shop happened; the
 * projected amount comes from the configured figure, not the receipt. Top-up
 * shops are deliberately a different category so they never reset the week.
 * null when the household has never recorded one (or the category tree has
 * been renamed away): the caller then projects from tomorrow.
 */
export function lastWeeklyShopDate(db: Db): string | null {
  const category = findChildCategory(db, 'Groceries', 'Weekly Shop');
  if (category === null) return null;
  const row = db
    .select({ occurredDate: purchases.occurredDate })
    .from(purchases)
    .innerJoin(allocations, eq(allocations.purchaseId, purchases.id))
    .where(
      and(
        isNull(purchases.voidedAt),
        eq(allocations.categoryId, category.id),
        gt(allocations.amountPence, 0),
      ),
    )
    .orderBy(desc(purchases.occurredDate), desc(purchases.id))
    .limit(1)
    .all();
  return row[0]?.occurredDate ?? null;
}

/**
 * Per live vehicle, the most recent date a non-voided purchase carried a
 * positive `Vehicle Running > Fuel` allocation **targeted at that vehicle**.
 * A fill belongs to the car it went into: Alex's fill of the Audi never
 * resets the Mercedes' clock. Vehicles with no recorded fill map to null.
 */
export function lastFuelDatesByVehicle(db: Db): Map<number, string | null> {
  const result = new Map<number, string | null>();
  const vehicles = listVehicles(db);
  for (const vehicle of vehicles) result.set(vehicle.id, null);

  const category = findChildCategory(db, 'Vehicle Running', 'Fuel');
  if (category === null) return result;
  const rows = db
    .select({
      targetId: allocations.targetId,
      occurredDate: purchases.occurredDate,
    })
    .from(purchases)
    .innerJoin(allocations, eq(allocations.purchaseId, purchases.id))
    .where(
      and(
        isNull(purchases.voidedAt),
        eq(allocations.categoryId, category.id),
        eq(allocations.targetKind, 'vehicle'),
        gt(allocations.amountPence, 0),
      ),
    )
    .orderBy(desc(purchases.occurredDate), desc(purchases.id))
    .all();
  for (const row of rows) {
    if (row.targetId === null || !result.has(row.targetId)) continue;
    if (result.get(row.targetId) === null) {
      result.set(row.targetId, row.occurredDate); // rows arrive newest-first
    }
  }
  return result;
}

/**
 * The next event date after an anchor: `anchor + cadenceDays` when that lies
 * strictly after today; otherwise tomorrow (never today — the projection
 * covers future days strictly after today only). A null anchor (never
 * recorded) is tomorrow too: pessimism by default.
 */
function nextEventDate(anchor: string | null, cadenceDays: number, today: string): string {
  const tomorrow = addDaysLocal(today, 1);
  if (anchor === null) return tomorrow;
  const next = addDaysLocal(anchor, cadenceDays);
  return next > today ? next : tomorrow;
}

/**
 * Every projected day-to-day event due in the window (today, throughDate]:
 * groceries from the configured weekly figure, fuel from each live vehicle's
 * configured monthly figure. Configured figures of zero (or unset) project
 * nothing — the household said there is no such spending. Sorted by date.
 */
export function projectDayToDayEvents(
  db: Db,
  today: string,
  throughDate: string,
): ProjectedDayToDayEvent[] {
  const events: ProjectedDayToDayEvent[] = [];
  if (throughDate <= today) return events;

  const groceriesPence = getWeeklyGroceriesPence(db);
  if (groceriesPence !== null && groceriesPence > 0) {
    const anchor = lastWeeklyShopDate(db);
    for (
      let due = nextEventDate(anchor, GROCERIES_CADENCE_DAYS, today);
      due <= throughDate;
      due = addDaysLocal(due, GROCERIES_CADENCE_DAYS)
    ) {
      events.push({
        kind: 'groceries',
        name: 'Weekly shop (projected)',
        amountPence: groceriesPence,
        dueDate: due,
        vehicleId: null,
      });
    }
  }

  const fuelByVehicle = getMonthlyFuelByVehicle(db);
  const lastFillByVehicle = lastFuelDatesByVehicle(db);
  for (const vehicle of listVehicles(db)) {
    const monthlyPence = fuelByVehicle.get(vehicle.id) ?? 0;
    if (monthlyPence <= 0) continue;
    const anchor = lastFillByVehicle.get(vehicle.id) ?? null;
    for (
      let due = nextEventDate(anchor, FUEL_CADENCE_DAYS, today);
      due <= throughDate;
      due = addDaysLocal(due, FUEL_CADENCE_DAYS)
    ) {
      events.push({
        kind: 'fuel',
        name: `Fuel — ${vehicle.label} (projected)`,
        amountPence: monthlyPence,
        dueDate: due,
        vehicleId: vehicle.id,
      });
    }
  }

  events.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
  return events;
}

/** Split helper for the read models: groceries events and fuel events apart. */
export function splitDayToDayEvents(events: readonly ProjectedDayToDayEvent[]): {
  groceries: ProjectedDayToDayEvent[];
  fuel: ProjectedDayToDayEvent[];
} {
  return {
    groceries: events.filter((event) => event.kind === 'groceries'),
    fuel: events.filter((event) => event.kind === 'fuel'),
  };
}
