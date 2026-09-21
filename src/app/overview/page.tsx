import Link from 'next/link';
import { redirect } from 'next/navigation';
import { QuickEntry } from '@/components/quick-entry';
import { AddCheckpointForm, CreatePotForm } from '@/components/pot-forms';
import { RecentEntryActions, VoidForm, TransferForm } from '@/components/record-forms';
import { formatPence } from '@/lib/money';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { getMonthComparisonView, getVehicleCostsView } from '@/lib/records/insights-view';
import { categoryTree } from '@/lib/records/categories';
import { addDaysLocal } from '@/lib/records/dates';
import { buildEntryData } from '@/lib/records/entry-view';
import {
  getMoneySnapshot,
  getProjectionView,
  getUpcomingCommitments,
  getKeyDateAlerts,
} from '@/lib/records/money-view';
import { keyDateMessage } from '@/lib/records/keydates';
import { listPeople } from '@/lib/records/people';
import { listPots, recentCheckpoints } from '@/lib/records/pots';
import { listPurchases } from '@/lib/records/purchases';
import { listSuppliersForEntry } from '@/lib/records/suppliers';
import { listTransfers } from '@/lib/records/transfers';
import { listVehicles } from '@/lib/records/vehicles';
import { formatInstantLocal, formatRelativeAge, toLocalDateString } from '@/lib/time';
import { ProjectionSection } from './projection-panel';

export const dynamic = 'force-dynamic';

/**
 * Dense overview (SPEC §15.2, decision 74): money + tier banner, projection
 * with the “what's in this forecast” breakdown, due this week, key dates,
 * this month's spending by parent, vehicles rolling 12, and the review list
 * with inline edit/void/refund actions. Quick entry is embedded here so the
 * mobile home and this page share the same entry code path.
 */
export default async function OverviewPage() {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const now = new Date();
  const today = toLocalDateString(now);

  const money = getMoneySnapshot(db, now);
  const projection = getProjectionView(db, now);
  const dueThisWeek = getUpcomingCommitments(db, addDaysLocal(today, 7), now);
  const keyDates = getKeyDateAlerts(db, now).map((alert) => ({
    ...alert,
    message: keyDateMessage(alert),
  }));
  const monthView = getMonthComparisonView(db, now);
  const vehicleView = getVehicleCostsView(db, now);

  const pots = listPots(db);
  const people = listPeople(db);
  const vehicles = listVehicles(db);
  const entryData = buildEntryData(db, now);
  const categoryNames = new Map(
    categoryTree(db).flatMap((parent) =>
      parent.children.map((child) => [child.id, `${parent.name} / ${child.name}`] as const),
    ),
  );

  const recentPurchases = listPurchases(db, { limit: 12, includeVoided: true });
  const recentTransfers = listTransfers(db, { limit: 5 });
  const potNames = new Map(pots.map((pot) => [pot.id, pot.label]));
  const supplierNames = new Map(
    listSuppliersForEntry(db).map((supplier) => [supplier.id, supplier.name]),
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Overview</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Everything in one place</h1>
        <p className="mt-1 text-sm text-slate-600">
          Estimates are your reported figures plus recorded activity — never a bank balance.
        </p>
      </header>

      <div className="space-y-6">
        <MoneyRow money={money} />
        <div className="grid gap-6 lg:grid-cols-2">
          {projection !== null ? (
            <ProjectionSection projection={projection} />
          ) : (
            <section
              aria-labelledby="projection-locked-heading"
              className="rounded-xl border border-dashed border-slate-300 bg-white p-4"
            >
              <h2 id="projection-locked-heading" className="text-lg font-semibold">
                Payday projection
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                The projection appears once the household has a balance checkpoint and an expected
                income schedule (for example a monthly salary). Record a checkpoint in Accounts
                &amp; Pots, then add the income schedule in Recurring.
              </p>
            </section>
          )}
          <QuickEntry data={entryData} />
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <DueThisWeekSection items={dueThisWeek} />
          <KeyDatesSection items={keyDates} />
          <SectionShell
            title="This month so far"
            kicker="Spending, by parent"
            caption={`vs ${formatMonthLabel(monthView.previous.month)}`}
          >
            <MonthBars current={monthView.monthToDate} previous={monthView.previous.summary} />
          </SectionShell>
          <SectionShell title="Vehicles" kicker="Running costs" caption="rolling 12 months">
            <ul className="space-y-2">
              {vehicleView.map((vehicle) => (
                <li key={vehicle.vehicleId} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{vehicle.label}</span>
                    <span className="tabular-nums">{formatPence(vehicle.rolling12Pence)}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    this month {formatPence(vehicle.monthPence)} · previous{' '}
                    {formatPence(vehicle.previousMonthPence)} · since {vehicle.rolling12From}
                  </p>
                </li>
              ))}
            </ul>
          </SectionShell>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            aria-labelledby="recent-purchases-heading"
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 id="recent-purchases-heading" className="text-lg font-semibold">
                Recent entries
              </h2>
              <Link href="/purchases" className="text-sm font-medium text-sky-700 hover:underline">
                All purchases →
              </Link>
            </div>
            {recentPurchases.length === 0 ? (
              <p className="text-sm text-slate-500">
                Saved purchases will appear here with inline edit, void and refund actions.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentPurchases.map(({ purchase, allocations }) => (
                  <li key={purchase.id} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm">
                        <span
                          className={
                            purchase.voidedAt !== null
                              ? 'text-slate-400 line-through'
                              : 'font-medium text-slate-800'
                          }
                        >
                          {purchase.supplierId !== null
                            ? (supplierNames.get(purchase.supplierId) ?? 'Unknown supplier')
                            : 'Unknown supplier'}
                        </span>{' '}
                        <span className="text-xs text-slate-500">
                          {formatInstantLocal(purchase.occurredAt)} ·{' '}
                          {purchase.scheduleInstanceId !== null
                            ? 'from schedule'
                            : purchase.voidedAt !== null
                              ? `voided (${purchase.voidReason ?? 'no reason'})`
                              : purchase.refundOfPurchaseId !== null
                                ? 'refund'
                                : allocations
                                    .map((line) => categoryNames.get(line.categoryId) ?? 'Category')
                                    .join(' · ')}
                        </span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatPence(purchase.totalPence)}
                      </span>
                    </div>
                    {purchase.voidedAt === null ? (
                      <p className="mt-1.5">
                        <details className="inline-block">
                          <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900">
                            Edit / void / refund
                          </summary>
                          <div className="mt-2 max-w-md">
                            <RecentEntryActions
                              purchaseId={purchase.id}
                              expectedVersion={purchase.version}
                              occurredDate={toLocalDateString(new Date(purchase.occurredAt))}
                              note={purchase.note ?? ''}
                              lines={allocations.map((line) => ({
                                amountPence: line.amountPence,
                                categoryId: line.categoryId,
                                targetKind: line.targetKind,
                                targetId: line.targetId,
                              }))}
                              people={people.map(({ id, label }) => ({ id, label }))}
                              vehicles={vehicles.map(({ id, label }) => ({ id, label }))}
                              categories={entryData.categories}
                              today={today}
                              summary={`${
                                purchase.supplierId !== null
                                  ? (supplierNames.get(purchase.supplierId) ?? 'entry')
                                  : 'entry'
                              }, ${formatPence(purchase.totalPence)}`}
                            />
                          </div>
                        </details>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="space-y-6">
            <section
              aria-labelledby="transfers-heading"
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h2 id="transfers-heading" className="mb-2 text-lg font-semibold">
                Transfers between pots
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                Money moving between your own pots — transfers never enter Insights (SPEC §10).
              </p>
              {recentTransfers.length === 0 ? (
                <p className="mb-3 text-sm text-slate-500">No transfers recorded yet.</p>
              ) : (
                <ul className="mb-3 divide-y divide-slate-100">
                  {recentTransfers.map((transfer) => (
                    <li key={transfer.id} className="py-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span
                          className={
                            transfer.voidedAt !== null
                              ? 'text-slate-400 line-through'
                              : 'text-slate-700'
                          }
                        >
                          {potNames.get(transfer.fromPotId) ?? 'Pot'} →{' '}
                          {potNames.get(transfer.toPotId) ?? 'Pot'}
                          {transfer.voidedAt !== null
                            ? ` (voided: ${transfer.voidReason ?? '—'})`
                            : ''}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {formatPence(transfer.amountPence)}
                        </span>
                      </div>
                      {transfer.voidedAt === null ? (
                        <p className="mt-1">
                          <details className="inline-block">
                            <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900">
                              Void
                            </summary>
                            <div className="mt-2 max-w-md">
                              <VoidForm
                                kind="transfer"
                                recordId={transfer.id}
                                expectedVersion={transfer.version}
                                summary={`${potNames.get(transfer.fromPotId) ?? 'a pot'} → ${
                                  potNames.get(transfer.toPotId) ?? 'a pot'
                                }, ${formatPence(transfer.amountPence)}`}
                              />
                            </div>
                          </details>
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <details>
                <summary className="cursor-pointer text-sm font-medium text-slate-700">
                  Record a transfer
                </summary>
                <div className="mt-3">
                  <TransferForm pots={pots.map(({ id, label }) => ({ id, label }))} today={today} />
                </div>
              </details>
            </section>

            <div className="grid gap-6 sm:grid-cols-2">
              <section
                aria-labelledby="add-pot-heading"
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <h2 id="add-pot-heading" className="mb-3 text-base font-semibold">
                  Add a pot
                </h2>
                <CreatePotForm />
              </section>
              <section
                aria-labelledby="add-checkpoint-heading"
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <h2 id="add-checkpoint-heading" className="mb-3 text-base font-semibold">
                  Balance checkpoint
                </h2>
                <AddCheckpointForm pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))} />
              </section>
            </div>

            <section
              aria-labelledby="recent-checkpoints-heading"
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h2 id="recent-checkpoints-heading" className="mb-2 text-base font-semibold">
                Recent checkpoints
              </h2>
              <p className="mb-2 text-xs text-slate-500">
                Immutable corrections — they never delete what happened.
              </p>
              {recentCheckpoints(db).length === 0 ? (
                <p className="text-sm text-slate-500">Nothing recorded yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recentCheckpoints(db)
                    .slice(0, 6)
                    .map((checkpoint) => (
                      <li
                        key={checkpoint.id}
                        className="flex items-baseline justify-between gap-2 py-1.5 text-sm"
                      >
                        <span>
                          {checkpoint.potLabel}
                          <span className="ml-2 text-xs text-slate-500">
                            {formatRelativeAge(checkpoint.effectiveAt)}
                          </span>
                        </span>
                        <span className="tabular-nums">{formatPence(checkpoint.amountPence)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function MoneyRow({ money }: { money: ReturnType<typeof getMoneySnapshot> }) {
  return (
    <section
      aria-labelledby="money-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="money-heading" className="text-xl font-semibold">
          {money.householdAvailablePence === null
            ? 'Waiting for your first checkpoint'
            : `Household available now: ${formatPence(money.householdAvailablePence)}`}
        </h2>
        <Link href="/pots" className="text-sm font-medium text-sky-700 hover:underline">
          Accounts &amp; Pots →
        </Link>
      </div>
      {money.householdAvailablePence === null ? (
        <p className="text-sm text-slate-600">
          Record a balance checkpoint for at least one pot and the household estimate appears here.
          Unreported pots never get an estimate — the app does not guess balances.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {money.pots.map((view) => (
            <li key={view.pot.id} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">{view.pot.label}</p>
              {view.estimatePence === null ? (
                <p className="text-sm text-slate-400">no checkpoint</p>
              ) : (
                <p className="text-sm font-semibold tabular-nums">
                  {formatPence(view.estimatePence)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SectionShell({
  title,
  kicker,
  caption,
  children,
}: {
  title: string;
  kicker: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {kicker}
          </p>
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <span className="text-xs text-slate-500">{caption}</span>
      </div>
      {children}
    </section>
  );
}

function formatMonthLabel(month: { year: number; month: number }): string {
  const names = [
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
  return `${names[month.month - 1]} ${month.year}`;
}

function MonthBars({
  current,
  previous,
}: {
  current: import('@/lib/records/insights').SpendingSummary;
  previous: import('@/lib/records/insights').SpendingSummary;
}) {
  const parentNames = new Set<string>([
    ...current.byParent.map((entry) => entry.parent),
    ...previous.byParent.map((entry) => entry.parent),
  ]);
  const max = Math.max(
    1,
    ...[...current.byParent, ...previous.byParent].map((entry) => entry.amountPence),
  );
  return (
    <div>
      <p className="mb-2 text-sm">
        <span className="font-semibold tabular-nums">{formatPence(current.totalPence)}</span>{' '}
        <span className="text-xs text-slate-500">so far this month</span>
      </p>
      {current.byParent.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing recorded this month yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {current.byParent.map((entry) => {
            const prevAmount =
              previous.byParent.find((p) => p.parent === entry.parent)?.amountPence ?? 0;
            return (
              <li key={entry.parent}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-slate-600">{entry.parent}</span>
                  <span className="tabular-nums text-slate-700">
                    {formatPence(entry.amountPence)}
                    <span className="ml-1 text-slate-400">
                      ({formatPence(prevAmount)} last month)
                    </span>
                  </span>
                </div>
                <div className="mt-0.5 h-2 rounded bg-slate-100">
                  <div
                    className="h-2 rounded bg-sky-600"
                    style={{
                      width: `${Math.max(2, Math.round((entry.amountPence / max) * 100))}%`,
                    }}
                  />
                </div>
              </li>
            );
          })}
          {parentNames.size === 0 ? null : null}
        </ul>
      )}
    </div>
  );
}

function DueThisWeekSection({
  items,
}: {
  items: Array<{
    name: string;
    amountPence: number;
    dueDate: string;
    scheduleKind: string;
    potLabel: string;
  }>;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Due this week</h2>
        <Link href="/recurring" className="text-xs font-medium text-sky-700 hover:underline">
          Recurring →
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing scheduled in the next seven days.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item, index) => (
            <li
              key={`${item.scheduleKind}-${item.name}-${item.dueDate}-${index}`}
              className="flex items-baseline justify-between gap-2 py-1.5 text-sm"
            >
              <span>
                <span className="font-medium">{item.name}</span>{' '}
                <span className="text-xs text-slate-500">
                  {item.dueDate} · {item.potLabel}
                </span>
              </span>
              <span
                className={`tabular-nums ${item.scheduleKind === 'receipt' ? 'text-emerald-700' : ''}`}
              >
                {item.scheduleKind === 'receipt' ? '+' : '−'}
                {formatPence(item.amountPence)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function KeyDatesSection({ items }: { items: Array<{ message: string; date: string }> }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold">Key dates</h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">
          No renewals or contract ends inside their warning windows right now.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item, index) => (
            <li key={`${item.date}-${index}`} className="py-1.5 text-sm">
              {item.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
