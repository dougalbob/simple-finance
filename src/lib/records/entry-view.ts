import type { Db } from '../db/client';
import {
  formatInstantLocal,
  formatRelativeAge,
  formatShortLocalDate,
  toLocalDateString,
} from '../time';
import { categoryTree, findChildCategory } from './categories';
import { listDebts } from './debts';
import { getCycleOutlook, getMoneySnapshot } from './money-view';
import { listFuelSupplierIds } from './fuel';
import { listPeople } from './people';
import { listPots } from './pots';
import { getDefaultPurchasePotId } from './settings';
import { getSupplier, listSuppliersForEntry, mostUsedCategoryForSupplier } from './suppliers';
import { listVehicles } from './vehicles';
import type { QuickEntryData } from '../../components/quick-entry';

/**
 * The quick-entry form data (mobile home AND the Overview and Purchases
 * pages, SPEC §15.2 "quick-add always visible"): pots with their reported
 * and projected balances, people, vehicles, live leaf categories, supplier
 * memory with derived most-used categories, and the visible defaults (the
 * pot chosen in Settings, the signed-in person — decision 146 — else the
 * first, Groceries/Weekly Shop, the payer's own vehicle). One builder — every page that shows Quick Entry cannot
 * drift.
 *
 * Defaults are the same conventions as Phase 2b (plan decision 50): the
 * paid-by chip the server preselects from the signed-in identity is a
 * separate concern resolved at save time; these are the form's starting
 * values. Debts ride along for the Move tab (borrow/repay links to a
 * tracked debt, SPEC §10.2).
 *
 * The pot default (v0.9.0) is a setting, never a guess from a pot label —
 * the real installation's daily-spend pot is not called "Main account", and
 * the old string match silently pointed the till flow at the wrong pot. With
 * nothing configured the form starts with no pot selected.
 *
 * Each pot carries the two figures SPEC §7.7 puts at the till: its **last
 * checkpoint** (what the bank showed when the household last checked, with
 * its age) and what is **left once the bills due from that pot have left,
 * before the next income lands** — plus the household-wide outlook the form
 * shows as its headline. Both are read-only context here; the checkpoint is
 * never editable in the till form.
 */
export interface EntryDefaultsInput {
  people: ReadonlyArray<{ id: number; email: string | null }>;
  vehicles: ReadonlyArray<{ id: number; ownerPersonId: number | null }>;
  viewerEmail: string | null | undefined;
}

/**
 * Who is holding the phone (decision 146, SPEC §15.1 "prefills payer
 * (signed-in user)"): the person linked to the viewer's sign-in in Settings,
 * else the first person; and that person's own vehicle (its Owner), else the
 * first vehicle. Pure, so the fallbacks are unit-tested.
 */
export function entryDefaults({ people, vehicles, viewerEmail }: EntryDefaultsInput): {
  personId: number | null;
  vehicleId: number | null;
} {
  const wanted = viewerEmail?.trim().toLowerCase() ?? '';
  const viewer =
    wanted === '' ? undefined : people.find((person) => person.email?.toLowerCase() === wanted);
  const person = viewer ?? people[0] ?? null;
  const vehicle =
    (person === null ? undefined : vehicles.find((entry) => entry.ownerPersonId === person.id)) ??
    vehicles[0] ??
    null;
  return { personId: person?.id ?? null, vehicleId: vehicle?.id ?? null };
}

export function buildEntryData(db: Db, nowArg?: Date, viewerEmail?: string | null): QuickEntryData {
  const now = nowArg ?? new Date();
  // The due pass runs inside the money snapshot (SPEC §11.2): converted
  // schedule records must be in the estimate before anything reads it.
  const snapshot = getMoneySnapshot(db, now);
  const outlook = getCycleOutlook(db, now, snapshot);
  const pots = listPots(db);
  const people = listPeople(db);
  const vehicles = listVehicles(db);
  const debts = listDebts(db);
  const supplierRows = listSuppliersForEntry(db);
  const categoryOptions = categoryTree(db).flatMap((parent) =>
    parent.children
      .filter((child) => child.retiredAt === null)
      .map((child) => ({ id: child.id, parentName: parent.name, childName: child.name })),
  );
  const supplierOptions = supplierRows.map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    defaultCategoryId: mostUsedCategoryForSupplier(db, supplier.id)?.categoryId ?? null,
  }));
  const defaultPotId = getDefaultPurchasePotId(db);
  const defaults = entryDefaults({ people, vehicles, viewerEmail });
  const defaultCategory =
    findChildCategory(db, 'Groceries', 'Weekly Shop') ?? categoryOptions[0] ?? null;
  // Only suppliers with a previous fuel purchase (decision 145), most recent
  // fuel purchase first. Reuses the memory already built where it can.
  const byId = new Map(supplierOptions.map((option) => [option.id, option]));
  const fuelSuppliers = listFuelSupplierIds(db).map((id) => {
    const known = byId.get(id);
    if (known !== undefined) return known;
    return {
      id,
      name: getSupplier(db, id).name,
      defaultCategoryId: mostUsedCategoryForSupplier(db, id)?.categoryId ?? null,
    };
  });
  return {
    pots: pots.map(({ id, label, kind }) => {
      const potView = snapshot.pots.find((entry) => entry.pot.id === id);
      const checkpoint = potView?.latestCheckpoint ?? null;
      const potOutlook = outlook.pots.find((entry) => entry.potId === id);
      return {
        id,
        label,
        kind,
        // Cash pots show no balance at all (SPEC §15.1): the household counts
        // the notes, and a stale number would be worse than none.
        checkpoint:
          kind === 'cash' || checkpoint === null
            ? null
            : {
                amountPence: checkpoint.amountPence,
                effectiveAtIso: checkpoint.effectiveAt.toISOString(),
                ageLabel: formatRelativeAge(checkpoint.effectiveAt, now),
                reportedAtLabel: formatInstantLocal(checkpoint.effectiveAt),
              },
        estimatePence: potView?.estimatePence ?? null,
        spendablePence: potOutlook?.spendablePence ?? null,
        shortfallPence: potOutlook?.shortfallPence ?? null,
        dueBeforeIncome: (potOutlook?.outgoing ?? []).map((line) => ({
          ...line,
          dueLabel: formatShortLocalDate(line.dueDate),
        })),
      };
    }),
    people: people.map(({ id, label }) => ({ id, label })),
    vehicles: vehicles.map(({ id, label, ownerPersonId }) => ({ id, label, ownerPersonId })),
    categories: categoryOptions,
    suppliers: supplierOptions,
    fuelSuppliers,
    debts: debts.map(({ id, counterparty, direction }) => ({ id, counterparty, direction })),
    defaultPotId,
    defaultPersonId: defaults.personId,
    defaultCategoryId: typeof defaultCategory?.id === 'number' ? defaultCategory.id : null,
    defaultVehicleId: defaults.vehicleId,
    today: toLocalDateString(now),
    cycle: {
      incomeDate: outlook.incomeDate,
      incomeSource: outlook.incomeSource,
      days: outlook.days,
      householdAvailablePence: outlook.householdAvailablePence,
      incomeDateLabel:
        outlook.incomeDate === null ? null : formatShortLocalDate(outlook.incomeDate),
      commitmentsPence: outlook.commitmentsPence,
      dayToDayPence: outlook.dayToDayPence,
      freeToSpendPence: outlook.freeToSpendPence,
      lowDate: outlook.lowDate,
      lowDateLabel: outlook.lowDate === null ? null : formatShortLocalDate(outlook.lowDate),
    },
  };
}
