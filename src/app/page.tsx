import { redirect } from 'next/navigation';
import { HouseholdSetup } from '@/components/household-setup';
import { AddCheckpointForm, CreatePotForm } from '@/components/pot-forms';
import {
  AddRenewalForm,
  AddScheduleForm,
  CancelScheduleForm,
  ProjectionSettingsForm,
  type RecurringData,
} from '@/components/recurring';
import { QuickEntry, type QuickEntryData } from '@/components/quick-entry';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { addDaysLocal } from '@/lib/records/dates';
import { categoryTree, findChildCategory } from '@/lib/records/categories';
import {
  getMoneySnapshot,
  getProjectionView,
  getUpcomingCommitments,
  getKeyDateAlerts,
  type MoneySnapshot,
  type ProjectionView,
} from '@/lib/records/money-view';
import { keyDateMessage } from '@/lib/records/keydates';
import { getMonthlyFuelByVehicle, getWeeklyGroceriesPence } from '@/lib/records/settings';
import { listSchedules } from '@/lib/records/schedules';
import { listRenewals } from '@/lib/records/renewals';
import { listPeople } from '@/lib/records/people';
import { listPots, recentCheckpoints } from '@/lib/records/pots';
import { listPurchases } from '@/lib/records/purchases';
import { listSuppliersForEntry, mostUsedCategoryForSupplier } from '@/lib/records/suppliers';
import { listVehicles } from '@/lib/records/vehicles';
import { formatInstantLocal, formatRelativeAge, toLocalDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const now = new Date();
  const today = toLocalDateString(now);

  // Phase 3 money view — runs the lazy due pass (conversions + renewal
  // advances) first, so every figure below reflects the converted state.
  const money = getMoneySnapshot(db, now);
  const projection = getProjectionView(db, now);
  const dueThisWeek = getUpcomingCommitments(db, addDaysLocal(today, 7), now);
  const keyDates = getKeyDateAlerts(db, now);

  const pots = listPots(db);
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
    today,
  };
  const recentPurchases = listPurchases(db, { limit: 12, includeVoided: true });
  const supplierNames = new Map(supplierRows.map((supplier) => [supplier.id, supplier.name]));
  const categoryNames = new Map(
    categoryOptions.map((category) => [
      category.id,
      `${category.parentName} / ${category.childName}`,
    ]),
  );

  const recurringData = buildRecurringData(
    db,
    pots,
    people,
    vehicles,
    supplierRows,
    categoryOptions,
    today,
  );
  const potNames = new Map(pots.map((pot) => [pot.id, pot.label]));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
            Shared household ledger
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Simple Finance</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as {user.email}. Estimates are your reported figures plus recorded activity —
            never a bank balance.
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

        <MoneySection money={money} />
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
              income schedule (for example a monthly salary). Record a checkpoint above, then add
              the income schedule in Recurring payments below.
            </p>
          </section>
        )}
        <QuickEntry data={entryData} />

        <div className="grid gap-6 lg:grid-cols-2">
          <DueThisWeekSection items={dueThisWeek} potNames={potNames} />
          <KeyDatesSection
            items={keyDates.map((alert) => ({ ...alert, message: keyDateMessage(alert) }))}
          />
        </div>

        <RecurringSection data={recurringData} potNames={potNames} />

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
                const view = money.pots.find((entry) => entry.pot.id === pot.id);
                const checkpoint = view?.latestCheckpoint ?? null;
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
                        {view !== undefined && view.estimatePence !== null ? (
                          <p className="mt-2 text-xs text-slate-600">
                            Available now (estimate):{' '}
                            <span className="font-semibold tabular-nums">
                              {formatPence(view.estimatePence)}
                            </span>
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">
                        No checkpoint yet — this pot has no estimate, by design.
                      </p>
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
              duplicate. Schedule conversions appear here too, tagged “From schedule …”.
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
                        {purchase.scheduleInstanceId !== null
                          ? (purchase.note ?? 'From schedule')
                          : allocations
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
          <p className="mb-2 max-w-prose text-xs text-slate-500">
            Checkpoints are immutable corrections — they never delete what happened.
          </p>
          {money.pots.length === 0 ? (
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
                  {recentCheckpoints(db).map((checkpoint) => (
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

/* ------------------------------------------------------------------ */
/* Phase 3 panels                                                      */
/* ------------------------------------------------------------------ */

function MoneySection({ money }: { money: MoneySnapshot }) {
  if (money.pots.length === 0) return null;
  return (
    <section
      aria-labelledby="money-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
            Available now (estimate)
          </p>
          <h2 id="money-heading" className="text-xl font-semibold">
            {money.householdAvailablePence === null
              ? 'Waiting for your first checkpoint'
              : `Household: ${formatPence(money.householdAvailablePence)}`}
          </h2>
        </div>
        <span className="text-xs text-slate-500">
          Your reported figures plus recorded activity — not a bank balance
        </span>
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

function ProjectionSection({ projection }: { projection: ProjectionView }) {
  const { result } = projection;
  const tier = result.tier;
  const tierStyles =
    tier === 'warning'
      ? 'border-red-200 bg-red-50 text-red-800'
      : tier === 'heads-up'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  const tierText =
    tier === 'warning'
      ? `This week’s low would reach ${formatPence(result.projectedLowPence ?? 0)} — beyond the overdrawn limit of ${formatPence(result.warningThresholdPence ?? 0)}. Plan something before pay day.`
      : tier === 'heads-up'
        ? `This week’s low would reach ${formatPence(result.projectedLowPence ?? 0)} before pay lands — you would be below £0. No overdraft expected if nothing else changes.`
        : `Projected to stay above zero until pay day (lowest ${result.projectedLowPence !== null ? formatPence(result.projectedLowPence) : '—'}).`;
  return (
    <section
      aria-labelledby="projection-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
            Payday projection
          </p>
          <h2 id="projection-heading" className="text-xl font-semibold">
            To {projection.paydayScheduleName ?? 'pay day'} · {result.paydayDate} ({result.days}{' '}
            days)
          </h2>
        </div>
        <span className="text-xs text-slate-500">A projection, not a bank forecast</span>
      </div>

      <p className={`rounded-lg border px-3 py-2 text-sm font-medium ${tierStyles}`}>{tierText}</p>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-600">Available now</dt>
          <dd className="font-semibold tabular-nums">{formatPence(result.availableNowPence)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-600">Projected day-to-day ({result.days}d)</dt>
          <dd className="tabular-nums">
            −{formatPence(result.dayToDayPence)}
            <span className="text-xs text-slate-500">
              {' '}
              (groceries {formatPence(result.groceriesPence)} + fuel {formatPence(result.fuelPence)}
              )
            </span>
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-600">Upcoming commitments</dt>
          <dd className="tabular-nums">−{formatPence(result.totalCommitmentsPence)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-600">Expected receipts</dt>
          <dd className="tabular-nums">+{formatPence(result.totalReceiptsPence)}</dd>
        </div>
      </dl>

      {result.perDay.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Day-by-day ({result.perDay.length} days)
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-1.5">Date</th>
                  <th className="px-3 py-1.5 text-right">Commitments</th>
                  <th className="px-3 py-1.5 text-right">Receipts</th>
                  <th className="px-3 py-1.5 text-right">End of day</th>
                </tr>
              </thead>
              <tbody>
                {result.perDay.map((day) => (
                  <tr key={day.date} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">{day.date}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {day.commitmentsPence > 0 ? `−${formatPence(day.commitmentsPence)}` : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {day.receiptsPence > 0 ? `+${formatPence(day.receiptsPence)}` : '—'}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-medium tabular-nums ${day.runningPence < 0 ? 'text-red-700' : ''}`}
                    >
                      {formatPence(day.runningPence)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {result.potWatches.length > 0 ? (
        <div className="mt-4 space-y-2">
          {result.potWatches.map((watch) => {
            const label = projection.potLabels.get(watch.potId) ?? `Pot ${watch.potId}`;
            const others = [...projection.otherPotEstimates.entries()]
              .filter(([potId, pence]) => potId !== watch.potId && pence > 0)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2)
              .map(
                ([potId, pence]) =>
                  `${projection.potLabels.get(potId) ?? 'Another pot'} holds ${formatPence(pence)}`,
              )
              .join(', ');
            const items = watch.earliestCommitments.map((item) => item.name).join(' and ');
            return (
              <p
                key={watch.potId}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                <span className="font-semibold">Plan a transfer?</span> {label} is projected to run
                about{' '}
                <span className="font-semibold tabular-nums">
                  {formatPence(watch.shortfallPence)}
                </span>{' '}
                short of its{' '}
                {watch.commitmentsPence > 0
                  ? `upcoming commitments (${formatPence(watch.commitmentsPence)})`
                  : 'due outgoings'}
                {watch.earliestDueDate !== null
                  ? ` (first due ${watch.earliestDueDate}${items !== '' ? ` — ${items}` : ''})`
                  : ''}
                .{others !== '' ? ` Meanwhile, ${others}.` : ''} Transfers stay explicit — record
                one when you decide.
              </p>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function DueThisWeekSection({
  items,
  potNames,
}: {
  items: Array<{
    name: string;
    amountPence: number;
    dueDate: string;
    potId: number;
    potLabel: string;
    scheduleKind: string;
  }>;
  potNames: Map<number, string>;
}) {
  void potNames;
  return (
    <section
      aria-labelledby="due-week-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 id="due-week-heading" className="mb-2 text-lg font-semibold">
        Due this week
      </h2>
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
                  {item.dueDate} · {item.scheduleKind === 'receipt' ? 'in' : 'out'} ·{' '}
                  {item.potLabel}
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
    <section
      aria-labelledby="keydates-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 id="keydates-heading" className="mb-2 text-lg font-semibold">
        Key dates
      </h2>
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

function RecurringSection({
  data,
  potNames,
}: {
  data: RecurringData;
  potNames: Map<number, string>;
}) {
  void potNames;
  return (
    <section
      aria-labelledby="recurring-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Recurring
          </p>
          <h2 id="recurring-heading" className="text-xl font-semibold">
            Schedules, renewals &amp; projection figures
          </h2>
        </div>
        <span className="text-xs text-slate-500">
          Schedules convert automatically on their due date
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              Direct debits, standing orders, expected income
            </h3>
            {data.schedules.length === 0 ? (
              <p className="text-sm text-slate-500">
                No schedules yet. Add one below — each converts into a normal record at local
                midnight on its due date.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {data.schedules.map((schedule) => (
                  <li key={schedule.id} className="py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span>
                        <span className="font-medium">{schedule.name}</span>{' '}
                        <span className="text-xs text-slate-500">
                          {schedule.kind === 'receipt' ? 'income' : schedule.kind} ·{' '}
                          {schedule.frequency === 'annual'
                            ? `every year, month ${schedule.dueMonth ?? '?'} day ${schedule.dueDayOfMonth}`
                            : `day ${schedule.dueDayOfMonth} each month`}{' '}
                          · {schedule.potLabel}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums">
                        {formatPence(schedule.amountPence)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {schedule.cancelledEffectiveOn !== null
                        ? `Cancelled from ${schedule.cancelledEffectiveOn} — history kept`
                        : `Next: ${schedule.nextDueDate ?? '—'}`}
                      {schedule.contractEndsOn !== null
                        ? ` · Contract ends ${schedule.contractEndsOn} (informational)`
                        : ''}
                    </p>
                    {schedule.cancelledEffectiveOn === null ? (
                      <CancelScheduleForm schedule={schedule} today={data.today} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">
                Add a schedule
              </summary>
              <div className="mt-3">
                <AddScheduleForm data={data} />
              </div>
            </details>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Renewals</h3>
            {data.renewals.length === 0 ? (
              <p className="text-sm text-slate-500">No renewals tracked yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {data.renewals.map((renewal) => (
                  <li key={renewal.id} className="py-1.5">
                    <span className="font-medium">{renewal.label}</span>{' '}
                    <span className="text-xs text-slate-500">
                      · due {renewal.nextRenewalDate}
                      {renewal.advancedFrom !== null
                        ? ` (advanced from ${renewal.advancedFrom})`
                        : ''}
                      {renewal.targetLabel !== null ? ` · ${renewal.targetLabel}` : ''}
                      {renewal.supplierName !== null ? ` · ${renewal.supplierName}` : ''}
                      {renewal.warnDaysBefore > 0
                        ? ` · warns ${renewal.warnDaysBefore} days before`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">
                Add a renewal
              </summary>
              <div className="mt-3">
                <AddRenewalForm data={data} />
              </div>
            </details>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Projection figures</h3>
            <ProjectionSettingsForm data={data} />
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">How it works</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>
              <strong>Schedules</strong> are templates. Each due date gets one instance; when the
              local midnight of the due date arrives, the instance converts into a normal record (a
              purchase for a direct debit, a receipt for income) tagged “From schedule …”.
            </li>
            <li>
              Nothing is ever double-counted: the instance and the converted record are one fact,
              and the money view always runs the conversion pass before reading.
            </li>
            <li>
              <strong>Edits apply from the next instance</strong>; converted history is never
              rewritten. Cancelling stops future instances from their effective date — history
              stays.
            </li>
            <li>
              <strong>Renewals</strong> are alerts with context. If the money also moves (an annual
              premium), that is a separate annual schedule — the two never double-count.
            </li>
            <li>
              <strong>Contract end dates</strong> are informational: a reminder to shop around. They
              never stop instances automatically.
            </li>
            <li>
              The <strong>projection</strong> starts from your available-now estimate, applies
              configured day-to-day figures pessimistically, then receipts and commitments on their
              due days (outgoings before receipts on the same day).
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function buildRecurringData(
  db: ReturnType<typeof getDbHandle>['db'],
  pots: ReturnType<typeof listPots>,
  people: ReturnType<typeof listPeople>,
  vehicles: ReturnType<typeof listVehicles>,
  supplierRows: ReturnType<typeof listSuppliersForEntry>,
  categoryOptions: Array<{ id: number; parentName: string; childName: string }>,
  today: string,
): RecurringData {
  const potLabel = new Map(pots.map((pot) => [pot.id, pot.label]));
  const schedules = listSchedules(db).map(({ schedule, nextDueDate }) => ({
    id: schedule.id,
    name: schedule.name,
    kind: schedule.kind,
    frequency: schedule.frequency,
    amountPence: schedule.amountPence,
    dueDayOfMonth: schedule.dueDayOfMonth,
    dueMonth: schedule.dueMonth,
    potLabel: potLabel.get(schedule.potId) ?? `Pot ${schedule.potId}`,
    nextDueDate,
    version: schedule.version,
    cancelledEffectiveOn: schedule.cancelledEffectiveOn,
    contractEndsOn: schedule.contractEndsOn,
  }));
  const supplierNames = new Map(supplierRows.map((supplier) => [supplier.id, supplier.name]));
  const vehicleLabels = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.label]));
  const renewals = listRenewals(db).map((renewal) => ({
    id: renewal.id,
    label: renewal.label,
    nextRenewalDate: renewal.nextRenewalDate,
    warnDaysBefore: renewal.warnDaysBefore,
    repeatsAnnually: renewal.repeatsAnnually,
    targetLabel: renewal.targetId === null ? null : (vehicleLabels.get(renewal.targetId) ?? null),
    supplierName:
      renewal.supplierId === null ? null : (supplierNames.get(renewal.supplierId) ?? null),
    advancedFrom: renewal.advancedFrom,
  }));
  const fuelByVehicle = getMonthlyFuelByVehicle(db);
  return {
    pots: pots.map(({ id, label }) => ({ id, label })),
    categories: categoryOptions,
    people: people.map(({ id, label }) => ({ id, label })),
    vehicles: vehicles.map(({ id, label }) => ({ id, label })),
    suppliers: supplierRows.map(({ id, name }) => ({ id, name })),
    today,
    schedules,
    renewals,
    projectionSettings: {
      weeklyGroceriesPence: getWeeklyGroceriesPence(db),
      monthlyFuelPence: vehicles.map((vehicle) => ({
        vehicleId: vehicle.id,
        label: vehicle.label,
        pence: fuelByVehicle.get(vehicle.id) ?? null,
      })),
    },
  };
}
