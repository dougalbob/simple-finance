import Link from 'next/link';
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
import { QuickEntry } from '@/components/quick-entry';
import { currentUserFromRequest } from '@/lib/auth/next';
import { APP_RELEASE_STAGE, APP_VERSION } from '@/lib/version';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { categoryTree } from '@/lib/records/categories';
import { addDaysLocal } from '@/lib/records/dates';
import { buildEntryData } from '@/lib/records/entry-view';
import {
  getCycleOutlook,
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
import { listSuppliersForEntry } from '@/lib/records/suppliers';
import { listVehicles } from '@/lib/records/vehicles';
import { formatInstantLocal, formatRelativeAge, toLocalDateString } from '@/lib/time';
import { ProjectionSection } from '@/app/overview/projection-panel';
import { CycleOutlookLine, PotOutlookLine } from '@/components/pot-outlook';

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
  // The "before income lands" figures (SPEC §7.7, v0.9.0) — one outlook, read
  // by the pot cards and the quick-entry balance.
  const outlook = getCycleOutlook(db, now, money);
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
  // Shared builder (mobile home + Overview, decision: one code path).
  const entryData = buildEntryData(db, now, user.email);
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
          v{APP_VERSION} · {APP_RELEASE_STAGE}
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
        {/* On a phone this page opens at the till (decision 158). */}
        <QuickEntry data={entryData} openAtTillOnMobile />

        <ChartsLinkCard />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
          <CycleOutlookLine outlook={outlook} className="mb-3" />
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
                        <PotOutlookLine
                          pot={outlook.pots.find((entry) => entry.potId === pot.id)}
                          incomeDate={outlook.incomeDate}
                        />
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

        {/* grid-cols-1 (minmax(0,1fr)), not the implicit auto column: an auto
            track grows to its widest input and pushed the page sideways on a
            narrow phone with larger text (decision 143). */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
      {money.debts.owedByHouseholdPence > 0 || money.debts.owedToHouseholdPence > 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          {money.debts.owedByHouseholdPence > 0 ? (
            <>
              Owe others{' '}
              <span className="font-semibold tabular-nums text-slate-900">
                {formatPence(money.debts.owedByHouseholdPence)}
              </span>
              {' (borrowed, not income)'}
            </>
          ) : null}
          {money.debts.owedByHouseholdPence > 0 && money.debts.owedToHouseholdPence > 0
            ? ' · '
            : null}
          {money.debts.owedToHouseholdPence > 0 ? (
            <>
              Owed to us{' '}
              <span className="font-semibold tabular-nums text-slate-900">
                {formatPence(money.debts.owedToHouseholdPence)}
              </span>
            </>
          ) : null}{' '}
          <a href="/pots" className="font-medium text-sky-700 hover:underline">
            Details →
          </a>
        </p>
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
    scheduleKind: string | null;
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

/**
 * One tap from the till to the drawn version of the same money (SPEC §16.7,
 * decision 153). Below the till, never above it: v0.13.1's lesson is that
 * the home page belongs to the till, so the charts get their own page and
 * this card is the door to it.
 */
function ChartsLinkCard() {
  return (
    <Link
      href="/charts"
      className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-300 hover:bg-sky-50/40"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Charts</p>
          <p className="text-base font-semibold text-slate-900">See the money drawn</p>
          <p className="mt-0.5 text-sm text-slate-600">
            The next month&apos;s balance, the weekly shop, personal spending and the fixed bills —
            each with its numbers underneath.
          </p>
        </div>
        <span aria-hidden="true" className="shrink-0 text-2xl text-sky-700">
          →
        </span>
      </div>
    </Link>
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
                          {schedule.supplierName !== null ? ` · ${schedule.supplierName}` : ''}
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
            <ProjectionSettingsForm data={data.projectionSettings} />
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
    supplierId: schedule.supplierId,
    supplierName: null as string | null,
  }));
  const supplierNames = new Map(supplierRows.map((supplier) => [supplier.id, supplier.name]));
  for (const entry of schedules) {
    entry.supplierName =
      entry.supplierId === null ? null : (supplierNames.get(entry.supplierId) ?? null);
  }
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
