import { redirect } from 'next/navigation';
import { HouseholdSetup } from '@/components/household-setup';
import { AddCheckpointForm, CreatePotForm } from '@/components/pot-forms';
import { QuickEntry, type QuickEntryData } from '@/components/quick-entry';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { categoryTree, findChildCategory } from '@/lib/records/categories';
import { listPeople } from '@/lib/records/people';
import { listPots, latestCheckpointPerPot, recentCheckpoints } from '@/lib/records/pots';
import { listPurchases } from '@/lib/records/purchases';
import { listSuppliersForEntry, mostUsedCategoryForSupplier } from '@/lib/records/suppliers';
import { listVehicles } from '@/lib/records/vehicles';
import { formatInstantLocal, formatRelativeAge, toLocalDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const pots = listPots(db);
  const latest = latestCheckpointPerPot(db);
  const recent = recentCheckpoints(db, 10);
  const people = listPeople(db);
  const vehicles = listVehicles(db);
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
  const entryData: QuickEntryData = {
    pots: pots.map(({ id, label }) => ({ id, label })),
    people: people.map(({ id, label }) => ({ id, label })),
    vehicles: vehicles.map(({ id, label, ownerPersonId }) => ({ id, label, ownerPersonId })),
    categories: categoryOptions,
    suppliers: supplierOptions,
    defaultPotId: defaultPot?.id ?? null,
    defaultPersonId: defaultPerson?.id ?? null,
    defaultCategoryId: typeof defaultCategory?.id === 'number' ? defaultCategory.id : null,
    defaultVehicleId: defaultVehicle?.id ?? null,
    today: toLocalDateString(new Date()),
  };
  const recentPurchases = listPurchases(db, { limit: 12, includeVoided: true });
  const supplierNames = new Map(supplierRows.map((supplier) => [supplier.id, supplier.name]));
  const categoryNames = new Map(
    categoryOptions.map((category) => [
      category.id,
      `${category.parentName} / ${category.childName}`,
    ]),
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
            Shared household ledger
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Simple Finance</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as {user.email}. Record first, review later — available-now estimates arrive
            in Phase 3.
          </p>
        </div>
        <p className="rounded-full bg-white px-3 py-1 text-xs text-slate-500 shadow-sm ring-1 ring-slate-200">
          v0.1.0 · pre-release
        </p>
      </header>

      <div className="space-y-6">
        {people.length < 2 || vehicles.length === 0 ? (
          <HouseholdSetup people={people.map(({ id, label }) => ({ id, label }))} />
        ) : null}
        <QuickEntry data={entryData} />

        <section aria-labelledby="pots-heading">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Reported figures
              </p>
              <h2 id="pots-heading" className="text-xl font-semibold">
                Pots &amp; checkpoints
              </h2>
            </div>
            <span className="text-xs text-slate-500">
              Not a bank balance · last reported amount
            </span>
          </div>
          {pots.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
              Add the household&apos;s pots below. A typical setup has two bank accounts and three
              cash pots.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {pots.map((pot) => {
                const checkpoint = latest.get(pot.id);
                return (
                  <li
                    key={pot.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{pot.label}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {pot.kind === 'bank' ? 'Bank' : 'Cash'}
                      </span>
                    </div>
                    {checkpoint ? (
                      <>
                        <p className="mt-3 text-xl font-semibold tabular-nums">
                          {formatPence(checkpoint.amountPence)}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          Last reported {formatRelativeAge(checkpoint.effectiveAt)} (
                          {formatInstantLocal(checkpoint.effectiveAt)})
                        </p>
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">No checkpoint yet.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            aria-labelledby="add-pot-heading"
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <h2 id="add-pot-heading" className="mb-3 text-lg font-semibold">
              Add a pot
            </h2>
            <CreatePotForm />
          </section>
          <section
            aria-labelledby="add-checkpoint-heading"
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <h2 id="add-checkpoint-heading" className="mb-3 text-lg font-semibold">
              Record a balance checkpoint
            </h2>
            <AddCheckpointForm pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))} />
          </section>
        </div>

        <section aria-labelledby="recent-purchases-heading">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Review
              </p>
              <h2 id="recent-purchases-heading" className="text-xl font-semibold">
                Recent entries
              </h2>
            </div>
            <span className="text-xs text-slate-500">
              Transfers and projections are separate records
            </span>
          </div>
          {recentPurchases.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
              Saved purchases will appear here, including a retained void marker when you resolve a
              duplicate.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Supplier</th>
                    <th className="px-3 py-2">Category / target</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Entered by</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPurchases.map(({ purchase, allocations }) => (
                    <tr
                      id={`purchase-${purchase.id}`}
                      key={purchase.id}
                      className={`border-t border-slate-100 ${purchase.voidedAt ? 'text-slate-400 line-through' : ''}`}
                    >
                      <td className="whitespace-nowrap px-3 py-2">
                        {formatInstantLocal(purchase.occurredAt)}
                      </td>
                      <td className="px-3 py-2">
                        {purchase.supplierId
                          ? (supplierNames.get(purchase.supplierId) ?? 'Unknown supplier')
                          : 'Unknown supplier'}
                      </td>
                      <td className="px-3 py-2">
                        {allocations
                          .map((line) => categoryNames.get(line.categoryId) ?? 'Category')
                          .join(' · ')}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatPence(purchase.totalPence)}
                      </td>
                      <td className="px-3 py-2">{purchase.enteredBy}</td>
                      <td className="px-3 py-2">
                        {purchase.voidedAt
                          ? 'Voided · history kept'
                          : purchase.refundOfPurchaseId
                            ? 'Refund'
                            : 'Active'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="recent-checkpoints-heading">
          <h2 id="recent-checkpoints-heading" className="mb-3 text-xl font-semibold">
            Recent checkpoints
          </h2>
          {recent.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
              Nothing recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Pot</th>
                    <th className="px-3 py-2 text-right">Reported</th>
                    <th className="px-3 py-2">By</th>
                    <th className="px-3 py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((checkpoint) => (
                    <tr key={checkpoint.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-3 py-2">
                        {formatInstantLocal(checkpoint.effectiveAt)}
                      </td>
                      <td className="px-3 py-2">{checkpoint.potLabel}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPence(checkpoint.amountPence)}
                      </td>
                      <td className="px-3 py-2">{checkpoint.enteredBy}</td>
                      <td className="px-3 py-2 text-slate-500">{checkpoint.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
