/**
 * Fuel economy (SPEC §16.6, v0.10.0 — decisions 139–141). Pure: no database,
 * no clock. The DB assembly lives in `fuel.ts`, so the Insights panel, the
 * after-save sentence and the tests all share this one code path.
 *
 * The method is the one a careful driver uses with a notebook — **full tank
 * to full tank**:
 *
 * 1. Fill to the brim and note the odometer. That fill is the *anchor*.
 * 2. Drive. Any part fills along the way only add their litres.
 * 3. Next time you fill to the brim, note the odometer again. The miles
 *    between the two readings, divided by every litre put in *after* the
 *    anchor (the part fills and this one), is the economy for that stretch.
 *
 * A stretch is only measured when every fill in it has its litres, and both
 * full-tank ends have an odometer reading. Anything missing makes that one
 * stretch unmeasurable — it never guesses, and it never borrows a figure from
 * a neighbouring stretch. The household adds the missing detail later and the
 * stretch appears.
 *
 * Units are the UK's: odometer in **miles**, fuel bought in **litres**,
 * economy in **miles per imperial gallon** (4.54609 litres). Litres are held
 * as whole millilitres and money as whole pence, so there is no floating
 * point anywhere except the final ratio.
 */

export const LITRES_PER_UK_GALLON = 4.54609;
/** The largest odometer reading accepted: a 7-digit dial. */
export const MAX_ODOMETER_MILES = 9_999_999;
/** The most fuel one purchase may carry: 500 litres (a jerry-can run plus a van tank, generously). */
export const MAX_FUEL_MILLILITRES = 500_000;
/** Readings outside this band are shown, but flagged "check the readings". */
export const PLAUSIBLE_MPG = { low: 8, high: 150 } as const;

export class InvalidFuelDetailsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFuelDetailsError';
  }
}

/** The optional details a fuel purchase can carry (both may be added later). */
export interface FuelDetails {
  odometerMiles: number | null;
  fuelMillilitres: number | null;
  /** Filled to the brim. Defaults to true: most fills are. */
  fullTank: boolean;
}

/** Range checks shared by the till, the edit form and the domain write. */
export function checkFuelDetails(details: FuelDetails): FuelDetails {
  const { odometerMiles, fuelMillilitres } = details;
  if (odometerMiles !== null) {
    if (!Number.isInteger(odometerMiles) || odometerMiles <= 0) {
      throw new InvalidFuelDetailsError('The odometer reading must be a whole number of miles.');
    }
    if (odometerMiles > MAX_ODOMETER_MILES) {
      throw new InvalidFuelDetailsError('That odometer reading is longer than any dial.');
    }
  }
  if (fuelMillilitres !== null) {
    if (!Number.isInteger(fuelMillilitres) || fuelMillilitres <= 0) {
      throw new InvalidFuelDetailsError('Litres must be more than zero.');
    }
    if (fuelMillilitres > MAX_FUEL_MILLILITRES) {
      throw new InvalidFuelDetailsError('Litres must be 500 or fewer for one purchase.');
    }
  }
  return { odometerMiles, fuelMillilitres, fullTank: details.fullTank };
}

export type ParseResult = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * "45.23", "45.23 L", " 45 " → millilitres. Blank → null (not recorded yet).
 * Up to three decimal places — pumps show two, some receipts three.
 */
export function parseLitres(raw: string | null | undefined): ParseResult {
  const text = (raw ?? '').trim().replace(/\s*(l|litres?|liters?)$/i, '');
  if (text === '') return { ok: true, value: null };
  const match = /^(\d{1,4})(?:\.(\d{1,3}))?$/.exec(text);
  if (match === null) {
    return { ok: false, error: 'Litres should look like 45.23 — digits and a decimal point.' };
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(3, '0'));
  const millilitres = whole * 1000 + fraction;
  if (millilitres <= 0) return { ok: false, error: 'Litres must be more than zero.' };
  if (millilitres > MAX_FUEL_MILLILITRES) {
    return { ok: false, error: 'Litres must be 500 or fewer for one purchase.' };
  }
  return { ok: true, value: millilitres };
}

/** "52,310", "52 310 mi", "52310" → 52310. Blank → null. Whole miles only. */
export function parseOdometer(raw: string | null | undefined): ParseResult {
  const text = (raw ?? '')
    .trim()
    .replace(/\s*(mi|miles?)$/i, '')
    .replace(/[,\s]/g, '');
  if (text === '') return { ok: true, value: null };
  if (!/^\d{1,7}$/.test(text)) {
    return { ok: false, error: 'The odometer reading should be whole miles, like 52,310.' };
  }
  const miles = Number(text);
  if (miles <= 0) return { ok: false, error: 'The odometer reading must be more than zero.' };
  return { ok: true, value: miles };
}

/** Millilitres → "45.23" (at least two decimals, a third only when present). */
export function formatLitres(millilitres: number): string {
  const text = (millilitres / 1000).toFixed(3);
  return text.endsWith('0') ? text.slice(0, -1) : text;
}

/** "52,310" — the odometer as it reads on a UK dashboard. */
export function formatMiles(miles: number): string {
  return miles.toLocaleString('en-GB');
}

/** Pence per litre, one decimal place, as a forecourt sign shows it: 142.9. */
export function pencePerLitre(fuelPence: number, millilitres: number): number {
  return Math.round((fuelPence * 10000) / millilitres) / 10;
}

export function formatPencePerLitre(fuelPence: number, millilitres: number): string {
  return `${pencePerLitre(fuelPence, millilitres).toFixed(1)}p/L`;
}

export function milesPerGallon(miles: number, millilitres: number): number {
  return miles / (millilitres / 1000 / LITRES_PER_UK_GALLON);
}

export function formatMpg(mpg: number): string {
  return `${mpg.toFixed(1)} mpg`;
}

/** One fuel purchase for one vehicle, as the calculation needs it. */
export interface FuelFill {
  purchaseId: number;
  occurredDate: string;
  occurredAt: Date;
  /** The fuel part of the purchase (its Fuel lines), not any split-off extras. */
  fuelPence: number;
  odometerMiles: number | null;
  fuelMillilitres: number | null;
  fullTank: boolean;
}

/** A measured stretch between two full tanks. */
export interface FuelStretch {
  kind: 'measured';
  fromPurchaseId: number;
  toPurchaseId: number;
  fromDate: string;
  toDate: string;
  miles: number;
  millilitres: number;
  fuelPence: number;
  mpg: number;
  pencePerMile: number;
  /** Outside the plausible band: shown, with a nudge to check the readings. */
  suspect: boolean;
}

export type GapReason =
  /** A fill in the stretch has no litres. */
  | 'missing_litres'
  /** The full tank that ends (or would start) the stretch has no odometer. */
  | 'missing_odometer'
  /** The reading went down or stayed put — a typo, most likely. */
  | 'odometer_not_increasing';

/** A stretch between two full tanks that cannot be measured, and why. */
export interface FuelGap {
  kind: 'gap';
  toPurchaseId: number;
  toDate: string;
  reason: GapReason;
  /** The fills in the stretch that are missing the detail named by `reason`. */
  purchaseIds: number[];
}

export interface FuelEconomy {
  /** Oldest first. */
  stretches: Array<FuelStretch | FuelGap>;
  /** Per fill: the stretch it closed, if it closed one. */
  closedBy: Map<number, FuelStretch | FuelGap>;
  /** The full tank the next stretch will be measured from, if any. */
  anchor: FuelFill | null;
}

/** Oldest first, ties by purchase id — the order the fills went in. */
export function sortFills(fills: readonly FuelFill[]): FuelFill[] {
  return [...fills].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.purchaseId - b.purchaseId,
  );
}

/**
 * Walk one vehicle's fills oldest first and measure every full-to-full
 * stretch that can be measured. See the module comment for the method.
 */
export function computeFuelEconomy(fills: readonly FuelFill[]): FuelEconomy {
  const stretches: Array<FuelStretch | FuelGap> = [];
  const closedBy = new Map<number, FuelStretch | FuelGap>();
  let anchor: FuelFill | null = null;
  let since: FuelFill[] = [];

  for (const fill of sortFills(fills)) {
    if (anchor === null) {
      // Nothing to measure from yet: wait for a full tank with a reading.
      if (fill.fullTank && fill.odometerMiles !== null) {
        anchor = fill;
        since = [];
      }
      continue;
    }
    since.push(fill);
    if (!fill.fullTank) continue; // a part fill only adds its litres

    const record = (entry: FuelStretch | FuelGap) => {
      stretches.push(entry);
      closedBy.set(fill.purchaseId, entry);
    };
    const missingLitres = since.filter((item) => item.fuelMillilitres === null);
    if (fill.odometerMiles === null) {
      record({
        kind: 'gap',
        toPurchaseId: fill.purchaseId,
        toDate: fill.occurredDate,
        reason: 'missing_odometer',
        purchaseIds: [fill.purchaseId],
      });
      // A full tank at an unknown mileage cannot start the next stretch either.
      anchor = null;
      since = [];
      continue;
    }
    if (missingLitres.length > 0) {
      record({
        kind: 'gap',
        toPurchaseId: fill.purchaseId,
        toDate: fill.occurredDate,
        reason: 'missing_litres',
        purchaseIds: missingLitres.map((item) => item.purchaseId),
      });
    } else if (fill.odometerMiles <= (anchor.odometerMiles as number)) {
      record({
        kind: 'gap',
        toPurchaseId: fill.purchaseId,
        toDate: fill.occurredDate,
        reason: 'odometer_not_increasing',
        purchaseIds: [anchor.purchaseId, fill.purchaseId],
      });
    } else {
      const miles = fill.odometerMiles - (anchor.odometerMiles as number);
      const millilitres = since.reduce((sum, item) => sum + (item.fuelMillilitres as number), 0);
      const fuelPence = since.reduce((sum, item) => sum + item.fuelPence, 0);
      const mpg = milesPerGallon(miles, millilitres);
      record({
        kind: 'measured',
        fromPurchaseId: anchor.purchaseId,
        toPurchaseId: fill.purchaseId,
        fromDate: anchor.occurredDate,
        toDate: fill.occurredDate,
        miles,
        millilitres,
        fuelPence,
        mpg,
        pencePerMile: fuelPence / miles,
        suspect: mpg < PLAUSIBLE_MPG.low || mpg > PLAUSIBLE_MPG.high,
      });
    }
    // Every full tank with a reading starts the next stretch, measured or not.
    anchor = fill;
    since = [];
  }
  return { stretches, closedBy, anchor };
}

/** Totals over a set of measured stretches: one ratio of sums, never an average of ratios. */
export interface FuelTotals {
  stretches: number;
  miles: number;
  millilitres: number;
  fuelPence: number;
  mpg: number;
  pencePerMile: number;
}

export function totalStretches(stretches: readonly FuelStretch[]): FuelTotals | null {
  if (stretches.length === 0) return null;
  const miles = stretches.reduce((sum, item) => sum + item.miles, 0);
  const millilitres = stretches.reduce((sum, item) => sum + item.millilitres, 0);
  const fuelPence = stretches.reduce((sum, item) => sum + item.fuelPence, 0);
  return {
    stretches: stretches.length,
    miles,
    millilitres,
    fuelPence,
    mpg: milesPerGallon(miles, millilitres),
    pencePerMile: fuelPence / miles,
  };
}

/**
 * The one-line answer after a fuel purchase is saved or its details edited
 * ("Vehicle A: 41.2 mpg since the last full tank …"). Plain words, no
 * jargon, and always says what would make the figure appear when it cannot.
 */
export function fuelFeedback(
  vehicleLabel: string,
  fill: FuelFill,
  economy: FuelEconomy,
): string | null {
  const price =
    fill.fuelMillilitres !== null
      ? ` ${formatLitres(fill.fuelMillilitres)} L at ${formatPencePerLitre(fill.fuelPence, fill.fuelMillilitres)}.`
      : '';
  const closed = economy.closedBy.get(fill.purchaseId);
  if (closed?.kind === 'measured') {
    const check = closed.suspect ? ' That looks unusual — worth checking the readings.' : '';
    return `${vehicleLabel}: ${formatMpg(closed.mpg)} over ${formatMiles(closed.miles)} miles since the last full tank.${price}${check}`;
  }
  if (closed?.kind === 'gap') {
    const why =
      closed.reason === 'missing_litres'
        ? 'an earlier fill since the last full tank has no litres yet — add them on Purchases'
        : closed.reason === 'missing_odometer'
          ? 'this fill has no odometer reading yet'
          : 'the odometer reading is not higher than the last full tank — check it';
    return `${vehicleLabel}: no mpg for this stretch — ${why}.${price}`;
  }
  if (fill.odometerMiles === null && fill.fuelMillilitres === null) {
    return `Add the odometer reading and litres later (Purchases → Fuel details) to track ${vehicleLabel}'s mpg.`;
  }
  if (!fill.fullTank) {
    return `Part fill for ${vehicleLabel} — mpg is worked out at the next full tank.${price}`;
  }
  if (fill.odometerMiles === null) {
    return `Add the odometer reading to measure ${vehicleLabel}'s mpg from this full tank.${price}`;
  }
  if (economy.anchor?.purchaseId === fill.purchaseId) {
    return `${vehicleLabel}: full tank at ${formatMiles(fill.odometerMiles)} miles noted — mpg appears after the next full tank.${price}`;
  }
  return price === '' ? null : price.trim();
}

/** The short line under a fuel purchase that closed a stretch. */
export function describeClosure(entry: FuelStretch | FuelGap): string {
  if (entry.kind === 'measured') {
    const check = entry.suspect ? ' — unusual, check the readings' : '';
    return `${formatMpg(entry.mpg)} over ${formatMiles(entry.miles)} miles since the last full tank (${entry.pencePerMile.toFixed(1)}p a mile)${check}`;
  }
  if (entry.reason === 'missing_litres') {
    return 'No mpg for this stretch yet: a fill since the last full tank has no litres.';
  }
  if (entry.reason === 'missing_odometer') {
    return 'No mpg for this stretch yet: add the odometer reading.';
  }
  return 'No mpg: the odometer reading is not higher than the last full tank — check it.';
}
