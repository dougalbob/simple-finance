import { redirect } from 'next/navigation';
import { RecentEntryActions } from '@/components/record-forms';
import { formatPence } from '@/lib/money';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { categoryTree } from '@/lib/records/categories';
import { buildEntryData } from '@/lib/records/entry-view';
import { listPeople } from '@/lib/records/people';
import { listPots } from '@/lib/records/pots';
import { listPurchases, type PurchaseFilters } from '@/lib/records/purchases';
import { listSuppliersForEntry } from '@/lib/records/suppliers';
import { listVehicles } from '@/lib/records/vehicles';
import { formatInstantLocal, toLocalDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

interface SearchParams {
  from?: string;
  to?: string;
  potId?: string;
  supplierId?: string;
  categoryId?: string;
  targetKind?: string;
  targetId?: string;
  paidByPersonId?: string;
  scheduleOnly?: string;
  refundsOnly?: string;
  voidedOnly?: string;
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const now = new Date();
  const today = toLocalDateString(now);
  const params = await searchParams;

  const filters: PurchaseFilters = {
    potId: toNumber(params.potId),
    supplierId: toNumber(params.supplierId),
    categoryId: toNumber(params.categoryId),
    targetKind:
      params.targetKind === 'person' || params.targetKind === 'vehicle'
        ? params.targetKind
        : undefined,
    targetId: toNumber(params.targetId),
    paidByPersonId: toNumber(params.paidByPersonId),
    dateFrom: params.from || undefined,
    dateTo: params.to || undefined,
    scheduleOnly: params.scheduleOnly === '1',
    refundsOnly: params.refundsOnly === '1',
    voidedOnly: params.voidedOnly === '1',
    limit: 500,
  };

  const purchases = listPurchases(db, filters);

  const pots = listPots(db);
  const people = listPeople(db);
  const vehicles = listVehicles(db);
  const suppliers = listSuppliersForEntry(db);
  const entryData = buildEntryData(db, now);
  const categoryNames = new Map(
    categoryTree(db).flatMap((parent) =>
      parent.children.map((child) => [child.id, `${parent.name} / ${child.name}`] as const),
    ),
  );
  const potNames = new Map(pots.map((pot) => [pot.id, pot.label]));
  const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  const personNames = new Map(people.map((person) => [person.id, person.label]));

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Purchases</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Every recorded purchase</h1>
        <p className="mt-1 text-sm text-slate-600">
          Filter, review and correct entries. Voids and refunds are kept in the history — nothing is
          ever deleted.
        </p>
      </header>

      <PurchaseFilterForm
        pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))}
        suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        people={people.map((person) => ({ id: person.id, label: person.label }))}
        categories={entryData.categories}
        active={params}
      />

      <section aria-labelledby="results-heading" className="mt-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="results-heading" className="text-xl font-semibold">
            {purchases.length} {purchases.length === 1 ? 'entry' : 'entries'}
          </h2>
          <span className="text-xs text-slate-500">
            Newest first · line items shown receipt-style
          </span>
        </div>
        {purchases.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
            Nothing matches these filters. Clear the filters to see the full history.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">Lines</th>
                  <th className="px-3 py-2">Pot</th>
                  <th className="px-3 py-2">Paid by</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map(({ purchase, allocations }) => (
                  <PurchaseRow
                    key={purchase.id}
                    purchaseId={purchase.id}
                    totalPence={purchase.totalPence}
                    occurredAt={purchase.occurredAt}
                    occurredDate={toLocalDateString(new Date(purchase.occurredAt))}
                    supplierLabel={
                      purchase.supplierId !== null
                        ? (supplierNames.get(purchase.supplierId) ?? 'Unknown supplier')
                        : 'Unknown supplier'
                    }
                    potLabel={potNames.get(purchase.potId) ?? 'Pot'}
                    paidByLabel={
                      purchase.paidByPersonId !== null
                        ? (personNames.get(purchase.paidByPersonId) ?? 'Someone')
                        : '—'
                    }
                    lines={allocations.map((line) => ({
                      label: categoryNames.get(line.categoryId) ?? 'Category',
                      targetLabel: lineTargetLabel(line, people, vehicles),
                      amountPence: line.amountPence,
                      categoryId: line.categoryId,
                      targetKind: line.targetKind,
                      targetId: line.targetId,
                    }))}
                    fromSchedule={purchase.scheduleInstanceId !== null}
                    isRefund={purchase.refundOfPurchaseId !== null}
                    voidedAt={purchase.voidedAt}
                    voidReason={purchase.voidReason}
                    note={purchase.note ?? ''}
                    version={purchase.version}
                    people={people.map(({ id, label }) => ({ id, label }))}
                    vehicles={vehicles.map(({ id, label }) => ({ id, label }))}
                    categories={entryData.categories}
                    today={today}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function lineTargetLabel(
  line: { targetKind: string; targetId: number | null },
  people: Array<{ id: number; label: string }>,
  vehicles: Array<{ id: number; label: string }>,
): string {
  if (line.targetKind === 'person' && line.targetId !== null) {
    return people.find((person) => person.id === line.targetId)?.label ?? 'person';
  }
  if (line.targetKind === 'vehicle' && line.targetId !== null) {
    return vehicles.find((vehicle) => vehicle.id === line.targetId)?.label ?? 'vehicle';
  }
  return 'household';
}

interface PurchaseRowProps {
  purchaseId: number;
  totalPence: number;
  occurredAt: Date;
  occurredDate: string;
  supplierLabel: string;
  potLabel: string;
  paidByLabel: string;
  lines: Array<{
    label: string;
    targetLabel: string;
    amountPence: number;
    categoryId: number;
    targetKind: 'household' | 'person' | 'vehicle';
    targetId: number | null;
  }>;
  fromSchedule: boolean;
  isRefund: boolean;
  voidedAt: Date | null;
  voidReason: string | null;
  note: string;
  version: number;
  people: Array<{ id: number; label: string }>;
  vehicles: Array<{ id: number; label: string }>;
  categories: Array<{ id: number; parentName: string; childName: string }>;
  today: string;
}

function PurchaseRow(props: PurchaseRowProps) {
  const status =
    props.voidedAt !== null
      ? `Voided · ${props.voidReason ?? 'no reason'}`
      : props.fromSchedule
        ? 'From schedule'
        : props.isRefund
          ? 'Refund'
          : 'Active';
  const statusClass =
    props.voidedAt !== null
      ? 'bg-slate-100 text-slate-500'
      : props.isRefund
        ? 'bg-red-50 text-red-700'
        : props.fromSchedule
          ? 'bg-sky-50 text-sky-700'
          : 'bg-emerald-50 text-emerald-700';
  return (
    <tr
      className={`border-t border-slate-100 align-top ${props.voidedAt !== null ? 'text-slate-400' : ''}`}
    >
      <td className="whitespace-nowrap px-3 py-2.5">{formatInstantLocal(props.occurredAt)}</td>
      <td className="px-3 py-2.5">
        <span className={props.voidedAt !== null ? 'line-through' : 'font-medium text-slate-800'}>
          {props.supplierLabel}
        </span>
        {props.note !== '' ? <p className="mt-0.5 text-xs text-slate-500">{props.note}</p> : null}
      </td>
      <td className="px-3 py-2.5">
        <ul className="space-y-0.5">
          {props.lines.map((line, index) => (
            <li key={index} className="text-xs">
              <span className={props.voidedAt !== null ? 'line-through' : ''}>{line.label}</span>
              <span className="ml-1 text-slate-400">({line.targetLabel})</span>
              <span className="ml-2 tabular-nums">{formatPence(line.amountPence)}</span>
            </li>
          ))}
        </ul>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{props.potLabel}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{props.paidByLabel}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">
        {formatPence(props.totalPence)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>
          {status}
        </span>
      </td>
      <td className="px-3 py-2.5">
        {props.voidedAt === null ? (
          <details className="inline-block">
            <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900">
              Edit
            </summary>
            <div className="mt-2 max-w-md">
              <RecentEntryActions
                purchaseId={props.purchaseId}
                expectedVersion={props.version}
                occurredDate={props.occurredDate}
                note={props.note}
                lines={props.lines.map((line) => ({
                  amountPence: line.amountPence,
                  categoryId: line.categoryId,
                  targetKind: line.targetKind,
                  targetId: line.targetId,
                }))}
                people={props.people}
                vehicles={props.vehicles}
                categories={props.categories}
                today={props.today}
                summary={`${props.supplierLabel}, ${formatPence(props.totalPence)}`}
              />
            </div>
          </details>
        ) : (
          <span className="text-xs text-slate-400">history kept</span>
        )}
      </td>
    </tr>
  );
}

interface FilterOption {
  id: number;
  label: string;
  name?: string;
}

function PurchaseFilterForm({
  pots,
  suppliers,
  people,
  categories,
  active,
}: {
  pots: Array<{ id: number; label: string }>;
  suppliers: Array<{ id: number; name: string }>;
  people: Array<{ id: number; label: string }>;
  categories: Array<{ id: number; parentName: string; childName: string }>;
  active: SearchParams;
}) {
  const inputClass =
    'rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none';
  const labelClass = 'text-xs font-medium text-slate-600';
  return (
    <form method="GET" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-from" className={labelClass}>
            From date
          </label>
          <input
            id="f-from"
            name="from"
            type="date"
            defaultValue={active.from ?? ''}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-to" className={labelClass}>
            To date
          </label>
          <input
            id="f-to"
            name="to"
            type="date"
            defaultValue={active.to ?? ''}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-pot" className={labelClass}>
            Pot
          </label>
          <select id="f-pot" name="potId" defaultValue={active.potId ?? ''} className={inputClass}>
            <option value="">Any</option>
            {pots.map((pot) => (
              <option key={pot.id} value={pot.id}>
                {pot.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-supplier" className={labelClass}>
            Supplier
          </label>
          <select
            id="f-supplier"
            name="supplierId"
            defaultValue={active.supplierId ?? ''}
            className={inputClass}
          >
            <option value="">Any</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-category" className={labelClass}>
            Category
          </label>
          <select
            id="f-category"
            name="categoryId"
            defaultValue={active.categoryId ?? ''}
            className={inputClass}
          >
            <option value="">Any</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.parentName} / {category.childName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-paidby" className={labelClass}>
            Paid by
          </label>
          <select
            id="f-paidby"
            name="paidByPersonId"
            defaultValue={active.paidByPersonId ?? ''}
            className={inputClass}
          >
            <option value="">Anyone</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            name="scheduleOnly"
            value="1"
            defaultChecked={active.scheduleOnly === '1'}
            className="h-4 w-4 rounded border-slate-300"
          />
          From schedule
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            name="refundsOnly"
            value="1"
            defaultChecked={active.refundsOnly === '1'}
            className="h-4 w-4 rounded border-slate-300"
          />
          Refunds
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            name="voidedOnly"
            value="1"
            defaultChecked={active.voidedOnly === '1'}
            className="h-4 w-4 rounded border-slate-300"
          />
          Voided
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="submit"
            className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white"
          >
            Apply filters
          </button>
          <a href="/purchases" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Clear
          </a>
        </div>
      </div>
    </form>
  );
}
