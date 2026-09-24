import { and, eq, isNull } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import { pots, settings } from '../db/schema';
import { isValidPenceAmount, MAX_ABS_PENCE } from '../money';

/**
 * Private runtime settings (plan data-model sketch, docs/SPEC.md §15.2
 * Settings page lands in Phase 4 — this module fixes the storage shape and
 * the typed accessors now, so the projection engine has something to read
 * and the Settings page later only adds UI).
 *
 * Keys are a closed set with a string value; accessors parse/validate.
 * Real figures live only in the private installation (SPEC §19).
 */

export class InvalidSettingValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSettingValueError';
  }
}

const KEY_WEEKLY_GROCERIES = 'weekly_groceries_pence';
const KEY_FUEL_PREFIX = 'monthly_fuel_pence:';
const KEY_RENEWAL_LEAD = 'renewal_warning_lead_days';
const KEY_CONTRACT_END_LEAD = 'contract_end_warning_lead_days';
const KEY_DEFAULT_PURCHASE_POT = 'default_purchase_pot_id';

export const DEFAULT_RENEWAL_WARNING_LEAD_DAYS = 21;
export const DEFAULT_CONTRACT_END_WARNING_LEAD_DAYS = 21;

/** Projected weekly groceries (SPEC §7.3). null = not configured yet. */
export function getWeeklyGroceriesPence(db: Db): number | null {
  const row = settingRow(db, KEY_WEEKLY_GROCERIES);
  if (row === null) return null;
  return parsePenceSetting(row.value, 'weekly groceries');
}

export function setWeeklyGroceriesPence(
  db: Db,
  pence: number | null,
  actor: string,
  now?: Date,
): void {
  if (pence !== null) {
    if (!isValidPenceAmount(pence) || pence < 0) {
      throw new InvalidSettingValueError(
        'The weekly groceries figure must be a non-negative whole-pence amount.',
      );
    }
  }
  upsertSetting(
    db,
    KEY_WEEKLY_GROCERIES,
    pence === null ? '' : String(pence),
    actor,
    'projection',
    now,
  );
}

/** Projected monthly fuel for one vehicle (SPEC §7.3). null = not configured. */
export function getMonthlyFuelPence(db: Db, vehicleId: number): number | null {
  const row = settingRow(db, fuelKey(vehicleId));
  if (row === null) return null;
  return parsePenceSetting(row.value, `monthly fuel for vehicle ${vehicleId}`);
}

export function setMonthlyFuelPence(
  db: Db,
  vehicleId: number,
  pence: number | null,
  actor: string,
  now?: Date,
): void {
  if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
    throw new InvalidSettingValueError('Monthly fuel needs a vehicle id.');
  }
  if (pence !== null && (!isValidPenceAmount(pence) || pence < 0)) {
    throw new InvalidSettingValueError(
      'The monthly fuel figure must be a non-negative whole-pence amount.',
    );
  }
  upsertSetting(
    db,
    fuelKey(vehicleId),
    pence === null ? '' : String(pence),
    actor,
    'projection',
    now,
  );
}

/** All configured monthly fuel figures, keyed by vehicle id. */
export function getMonthlyFuelByVehicle(db: Db): Map<number, number> {
  const rows = db
    .select()
    .from(settings)
    .all()
    .filter((row) => row.key.startsWith(KEY_FUEL_PREFIX) && row.value !== '');
  const result = new Map<number, number>();
  for (const row of rows) {
    const vehicleId = Number(row.key.slice(KEY_FUEL_PREFIX.length));
    result.set(vehicleId, parsePenceSetting(row.value, `monthly fuel for vehicle ${vehicleId}`));
  }
  return result;
}

/** Default warning lead for renewals (SPEC §22.2: default 21, configurable). */
export function getRenewalWarningLeadDays(db: Db): number {
  const row = settingRow(db, KEY_RENEWAL_LEAD);
  if (row === null) return DEFAULT_RENEWAL_WARNING_LEAD_DAYS;
  return parseLeadSetting(row.value, 'renewal warning lead', DEFAULT_RENEWAL_WARNING_LEAD_DAYS);
}

export function setRenewalWarningLeadDays(db: Db, days: number, actor: string, now?: Date): void {
  upsertSetting(db, KEY_RENEWAL_LEAD, String(checkedLeadDays(days)), actor, 'key dates', now);
}

/** Default warning lead for contract-end alerts (plan decision 23: default 21). */
export function getContractEndWarningLeadDays(db: Db): number {
  const row = settingRow(db, KEY_CONTRACT_END_LEAD);
  if (row === null) return DEFAULT_CONTRACT_END_WARNING_LEAD_DAYS;
  return parseLeadSetting(
    row.value,
    'contract-end warning lead',
    DEFAULT_CONTRACT_END_WARNING_LEAD_DAYS,
  );
}

export function setContractEndWarningLeadDays(
  db: Db,
  days: number,
  actor: string,
  now?: Date,
): void {
  upsertSetting(db, KEY_CONTRACT_END_LEAD, String(checkedLeadDays(days)), actor, 'key dates', now);
}

/**
 * The pot the Quick Entry purchase form starts on (SPEC §15.1, v0.9.0).
 * Fixed by the household in Settings rather than guessed from a pot label:
 * the real installation's daily-spend pot is not called "Main account", and
 * a string match silently pointed the till flow at the wrong pot. null =
 * nothing chosen yet, and the form starts with no pot selected.
 */
export function getDefaultPurchasePotId(db: Db): number | null {
  const row = settingRow(db, KEY_DEFAULT_PURCHASE_POT);
  if (row === null || row.value === '') return null;
  const potId = Number(row.value);
  if (!Number.isInteger(potId) || potId <= 0) return null;
  return isLivePot(db, potId) ? potId : null;
}

export function setDefaultPurchasePotId(
  db: Db,
  potId: number | null,
  actor: string,
  now?: Date,
): void {
  if (potId !== null && (!Number.isInteger(potId) || potId <= 0 || !isLivePot(db, potId))) {
    throw new InvalidSettingValueError(
      'That pot does not exist (or is archived), so it cannot be the default for purchases.',
    );
  }
  upsertSetting(
    db,
    KEY_DEFAULT_PURCHASE_POT,
    potId === null ? '' : String(potId),
    actor,
    'quick entry',
    now,
  );
}

/** A pot that still exists and has not been archived. */
function isLivePot(db: Db | DbTx, potId: number): boolean {
  const row = db
    .select({ id: pots.id })
    .from(pots)
    .where(and(eq(pots.id, potId), isNull(pots.archivedAt)))
    .get();
  return row !== undefined;
}

function fuelKey(vehicleId: number): string {
  return `${KEY_FUEL_PREFIX}${vehicleId}`;
}
function settingRow(db: Db | DbTx, key: string): { value: string } | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row ?? null;
}

function upsertSetting(
  db: Db,
  key: string,
  value: string,
  actor: string,
  area: string,
  nowArg?: Date,
): void {
  const now = nowArg ?? new Date();
  db.transaction((tx) => {
    const existing = tx.select().from(settings).where(eq(settings.key, key)).get();
    if (existing === undefined) {
      tx.insert(settings).values({ key, value, updatedAt: now, updatedBy: actor }).run();
    } else {
      tx.update(settings)
        .set({ value, updatedAt: now, updatedBy: actor, version: existing.version + 1 })
        .where(eq(settings.key, key))
        .run();
    }
    recordAudit(tx, {
      actor,
      action: 'setting.update',
      entity: 'setting',
      entityId: key,
      summary: `Updated ${area} setting ${key} to ${value === '' ? '(cleared)' : value}`,
      before: existing === undefined ? null : { value: existing.value },
      after: { value },
      now,
    });
  });
}

function parsePenceSetting(value: string, label: string): number {
  if (value === '') return 0;
  const number = Number(value);
  if (!isValidPenceAmount(number) || number < 0 || Math.abs(number) > MAX_ABS_PENCE) {
    throw new InvalidSettingValueError(
      `The stored ${label} setting is not a valid whole-pence figure.`,
    );
  }
  return number;
}

function parseLeadSetting(value: string, label: string, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 365) return fallback;
  return number;
}

function checkedLeadDays(days: number): number {
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    throw new InvalidSettingValueError(
      'The warning lead must be a whole number of days between 0 and 365.',
    );
  }
  return days;
}
