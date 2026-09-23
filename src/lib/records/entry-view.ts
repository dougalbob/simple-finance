import type { Db } from '../db/client';
import { toLocalDateString } from '../time';
import { categoryTree, findChildCategory } from './categories';
import { listDebts } from './debts';
import { listPeople } from './people';
import { listPots } from './pots';
import { listSuppliersForEntry, mostUsedCategoryForSupplier } from './suppliers';
import { listVehicles } from './vehicles';
import type { QuickEntryData } from '../../components/quick-entry';

/**
 * The quick-entry form data (mobile home AND the Overview page, SPEC
 * §15.2 "quick-add always visible"): pots, people, vehicles, live leaf
 * categories, supplier memory with derived most-used categories, and the
 * visible defaults (Main account pot, first person, Groceries/Weekly Shop,
 * the payer's own vehicle). One builder — both pages cannot drift.
 *
 * Defaults are the same conventions as Phase 2b (plan decision 50): the
 * paid-by chip the server preselects from the signed-in identity is a
 * separate concern resolved at save time; these are the form's starting
 * values. Debts ride along for the Move tab (borrow/repay links to a
 * tracked debt, SPEC §10.2).
 */
export function buildEntryData(db: Db, nowArg?: Date): QuickEntryData {
  const now = nowArg ?? new Date();
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
  const defaultPot =
    pots.find((pot) => pot.label.toLowerCase() === 'main account') ?? pots[0] ?? null;
  const defaultPerson = people[0] ?? null;
  const defaultCategory =
    findChildCategory(db, 'Groceries', 'Weekly Shop') ?? categoryOptions[0] ?? null;
  const defaultVehicle =
    vehicles.find((vehicle) => vehicle.ownerPersonId === defaultPerson?.id) ?? vehicles[0] ?? null;
  return {
    pots: pots.map(({ id, label }) => ({ id, label })),
    people: people.map(({ id, label }) => ({ id, label })),
    vehicles: vehicles.map(({ id, label, ownerPersonId }) => ({ id, label, ownerPersonId })),
    categories: categoryOptions,
    suppliers: supplierOptions,
    debts: debts.map(({ id, counterparty, direction }) => ({ id, counterparty, direction })),
    defaultPotId: defaultPot?.id ?? null,
    defaultPersonId: defaultPerson?.id ?? null,
    defaultCategoryId: typeof defaultCategory?.id === 'number' ? defaultCategory.id : null,
    defaultVehicleId: defaultVehicle?.id ?? null,
    today: toLocalDateString(now),
  };
}
