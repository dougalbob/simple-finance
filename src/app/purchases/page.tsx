import { redirect } from 'next/navigation';
import { RecentEntryActions } from '@/components/record-forms';
import { AttachmentForm } from '@/components/attachment-form';
import { PurchaseFilterForm } from '@/components/purchase-filter-form';
import { listAuditForEntity, type AuditEntry } from '@/lib/audit';
import { formatPence } from '@/lib/money';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { categoryTree } from '@/lib/records/categories';
import { buildEntryData } from '@/lib/records/entry-view';
import { listPeople } from '@/lib/records/people';
import { listPots } from '@/lib/records/pots';
import { listPurchases, type PurchaseFilters } from '@/lib/records/purchases';
import { listSuppliersForEntry } from '@/lib/records/suppliers';
import { listStoredAttachments, type StoredAttachment } from '@/lib/records/attachments';
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
          Filter, review and correct entries. Voids and refunds are kept in the history — a purchase
          record is never deleted. A receipt can be removed; that removal is in the history, and an
          older backup is the only way to get the file back.
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
                    attachments={listStoredAttachments(db, purchase.id)}
                    history={listAuditForEntity(db, 'purchase', purchase.id)}
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
  attachments: StoredAttachment[];
  history: AuditEntry[];
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
        <AttachmentForm purchaseId={props.purchaseId} attachments={props.attachments} />
        <details className="mt-1">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800">
            History
          </summary>
          {props.history.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">No history recorded.</p>
          ) : (
            <ul className="mt-1 space-y-1" aria-label={`History for purchase ${props.purchaseId}`}>
              {props.history.map((entry) => (
                <li key={entry.id} className="text-xs text-slate-600">
                  <span className="font-medium text-slate-700">{entry.summary}</span>
                  <span className="block text-slate-500">
                    {entry.actor} · {formatInstantLocal(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
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
