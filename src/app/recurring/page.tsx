import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AddRenewalForm,
  AddScheduleForm,
  CancelScheduleForm,
  ProjectionSettingsForm,
  type RecurringData,
} from '@/components/recurring';
import { ScrollHashIntoView } from '@/components/scroll-hash';
import { RenewalEditForm, ScheduleEditForm } from '@/components/schedule-forms';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { categoryTree } from '@/lib/records/categories';
import { addDaysLocal, daysInMonth } from '@/lib/records/dates';
import { startOfWeekLocal } from '@/lib/records/insights';
import { listPeople } from '@/lib/records/people';
import { listPots } from '@/lib/records/pots';
import { listRenewals } from '@/lib/records/renewals';
import { listInstances, listSchedules } from '@/lib/records/schedules';
import { getMonthlyFuelByVehicle, getWeeklyGroceriesPence } from '@/lib/records/settings';
import { supplierCardHref } from '@/lib/records/supplier-focus';
import { listSuppliersForEntry } from '@/lib/records/suppliers';
import { toLocalDateString } from '@/lib/time';
import { listVehicles } from '@/lib/records/vehicles';

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
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface MonthRef {
  year: number;
  month: number; // 1–12
}

const monthParam = (ref: MonthRef) => `${ref.year}-${String(ref.month).padStart(2, '0')}`;
const monthTitle = (ref: MonthRef) => `${MONTH_NAMES[ref.month - 1]} ${ref.year}`;

function parseMonthParam(raw: string | undefined, fallback: MonthRef): MonthRef {
  if (raw === undefined) return fallback;
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (match === null) return fallback;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return fallback;
  return { year, month };
}

function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const index = ref.year * 12 + (ref.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

interface CalendarInstance {
  instanceId: number;
  scheduleId: number;
  scheduleName: string;
  kind: string;
  amountPence: number;
  state: 'upcoming' | 'converted';
  dueDate: string;
}

interface CalendarDay {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  instances: CalendarInstance[];
}

function buildCalendar(
  ref: MonthRef,
  today: string,
  instances: Array<{
    instance: { id: number; scheduleId: number; dueDate: string; state: 'upcoming' | 'converted' };
    scheduleName: string;
    scheduleKind: string;
    amountPence: number;
  }>,
): CalendarDay[] {
  const first = `${ref.year}-${String(ref.month).padStart(2, '0')}-01`;
  const last = addDaysLocal(first, daysInMonth(ref.year, ref.month) - 1);
  const gridStart = startOfWeekLocal(first);
  const byDate = new Map<string, CalendarInstance[]>();
  for (const row of instances) {
    const list = byDate.get(row.instance.dueDate) ?? [];
    list.push({
      instanceId: row.instance.id,
      scheduleId: row.instance.scheduleId,
      scheduleName: row.scheduleName,
      kind: row.scheduleKind,
      amountPence: row.amountPence,
      state: row.instance.state,
      dueDate: row.instance.dueDate,
    });
    byDate.set(row.instance.dueDate, list);
  }
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDaysLocal(gridStart, i);
    days.push({
      date,
      inMonth: date >= first && date <= last,
      isToday: date === today,
      instances: (byDate.get(date) ?? []).sort((a, b) =>
        a.scheduleName.localeCompare(b.scheduleName),
      ),
    });
  }
  return days;
}

export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const now = new Date();
  const today = toLocalDateString(now);
  const params = await searchParams;

  const thisMonth = {
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  };
  const ref = parseMonthParam(params.month, thisMonth);

  const first = `${ref.year}-${String(ref.month).padStart(2, '0')}-01`;
  const last = addDaysLocal(first, daysInMonth(ref.year, ref.month) - 1);
  // The calendar renders exactly the instances listInstances returns for the
  // month window — same rows as the lists below (decision 70), so the two can
  // never disagree.
  const monthInstances = listInstances(db, { from: first, through: last });
  const days = buildCalendar(ref, today, monthInstances);

  const schedules = listSchedules(db, now);
  const renewals = listRenewals(db);
  const pots = listPots(db);
  const people = listPeople(db);
  const vehicles = listVehicles(db);
  const suppliers = listSuppliersForEntry(db);
  const categoryOptions = categoryTree(db).flatMap((parent) =>
    parent.children
      .filter((child) => child.retiredAt === null)
      .map((child) => ({ id: child.id, parentName: parent.name, childName: child.name })),
  );
  const fuelByVehicle = getMonthlyFuelByVehicle(db);

  const recurringData: RecurringData = {
    pots: pots.map(({ id, label }) => ({ id, label })),
    categories: categoryOptions,
    people: people.map(({ id, label }) => ({ id, label })),
    vehicles: vehicles.map(({ id, label }) => ({ id, label })),
    suppliers: suppliers.map(({ id, name }) => ({ id, name })),
    today,
    schedules: schedules.map(({ schedule, nextDueDate }) => ({
      id: schedule.id,
      name: schedule.name,
      kind: schedule.kind,
      frequency: schedule.frequency,
      amountPence: schedule.amountPence,
      dueDayOfMonth: schedule.dueDayOfMonth,
      dueMonth: schedule.dueMonth,
      potLabel: pots.find((pot) => pot.id === schedule.potId)?.label ?? 'Pot',
      nextDueDate,
      version: schedule.version,
      cancelledEffectiveOn: schedule.cancelledEffectiveOn,
      contractEndsOn: schedule.contractEndsOn,
      supplierId: schedule.supplierId,
      supplierName:
        schedule.supplierId === null
          ? null
          : (suppliers.find((s) => s.id === schedule.supplierId)?.name ?? null),
    })),
    renewals: renewals.map((renewal) => ({
      id: renewal.id,
      label: renewal.label,
      nextRenewalDate: renewal.nextRenewalDate,
      warnDaysBefore: renewal.warnDaysBefore,
      repeatsAnnually: renewal.repeatsAnnually,
      targetLabel:
        renewal.targetKind === 'vehicle' && renewal.targetId !== null
          ? (vehicles.find((vehicle) => vehicle.id === renewal.targetId)?.label ?? null)
          : null,
      supplierName:
        renewal.supplierId === null
          ? null
          : (suppliers.find((s) => s.id === renewal.supplierId)?.name ?? null),
      advancedFrom: renewal.advancedFrom,
    })),
    projectionSettings: {
      weeklyGroceriesPence: getWeeklyGroceriesPence(db),
      monthlyFuelPence: vehicles.map((vehicle) => ({
        vehicleId: vehicle.id,
        label: vehicle.label,
        pence: fuelByVehicle.get(vehicle.id) ?? null,
      })),
    },
  };

  const potNames = new Map(pots.map((pot) => [pot.id, pot.label]));

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          Recurring payments
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Schedules, renewals &amp; the month at a glance
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Schedules convert automatically at local midnight on their due date. This calendar is
          <span className="font-semibold"> read-only planning aid</span>: moving a date here (or
          editing a schedule) changes the <em>records</em> the app makes — it never moves your bank
          instructions. Direct debits and standing orders are agreed with your bank, and the app
          does not touch them.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="calendar-heading"
          className="order-1 rounded-xl border border-border bg-surface p-4 shadow-sm lg:col-start-1 lg:row-start-1"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="calendar-heading" className="text-xl font-semibold">
              {monthTitle(ref)}
            </h2>
            <div className="flex items-center gap-1">
              <Link
                href={`/recurring?month=${monthParam(shiftMonth(ref, -1))}`}
                className="rounded border border-border-strong px-2.5 py-1 text-sm font-medium text-ink-body hover:bg-canvas"
              >
                ← Prev
              </Link>
              <Link
                href="/recurring"
                className="rounded border border-border-strong px-2.5 py-1 text-sm font-medium text-ink-body hover:bg-canvas"
              >
                Today
              </Link>
              <Link
                href={`/recurring?month=${monthParam(shiftMonth(ref, 1))}`}
                className="rounded border border-border-strong px-2.5 py-1 text-sm font-medium text-ink-body hover:bg-canvas"
              >
                Next →
              </Link>
            </div>
          </div>
          <CalendarGrid days={days} />
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-marker-muted" />
              outgo (direct debit / standing order)
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-positive-500" />
              receipt (income)
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full border border-marker-muted bg-surface" />
              not converted yet
            </span>
          </div>
        </section>

        <section
          aria-labelledby="schedules-heading"
          className="order-2 flex flex-col rounded-xl border border-border bg-surface p-4 shadow-sm lg:col-start-2 lg:row-start-1 lg:h-0 lg:min-h-full lg:overflow-hidden"
        >
          <ScrollHashIntoView />
          <div className="mb-3 flex shrink-0 items-baseline justify-between gap-2">
            <h2 id="schedules-heading" className="text-lg font-semibold">
              Schedules
            </h2>
            <span className="text-xs text-ink-muted">
              edits apply from the next instance — history is never rewritten; a start date moved
              earlier backfills the dates the app was never told about
            </span>
          </div>
          {schedules.length === 0 ? (
            <p className="mb-3 text-sm text-ink-muted">
              No schedules yet. Add one below — each converts into a normal record at local midnight
              on its due date.
            </p>
          ) : (
            <ul
              data-schedule-scroller
              className="mb-3 divide-y divide-border-hairline lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-y-contain"
            >
              {schedules.map(({ schedule, nextDueDate }) => (
                <li key={schedule.id} id={`schedule-${schedule.id}`} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm">
                      <span
                        className={
                          schedule.cancelledAt !== null
                            ? 'font-medium text-ink-faint line-through'
                            : 'font-medium text-ink-emphasis'
                        }
                      >
                        {schedule.name}
                      </span>{' '}
                      <span className="text-xs text-ink-muted">
                        {schedule.kind === 'receipt'
                          ? 'income'
                          : schedule.kind === 'dd'
                            ? 'direct debit'
                            : 'standing order'}
                        {schedule.frequency === 'annual'
                          ? ` · every year, ${MONTH_NAMES[(schedule.dueMonth ?? 1) - 1]}`
                          : ` · monthly`}{' '}
                        · {potNames.get(schedule.potId) ?? 'Pot'}
                        {schedule.supplierId !== null
                          ? ` · ${suppliers.find((s) => s.id === schedule.supplierId)?.name ?? 'supplier'}`
                          : ''}
                      </span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {schedule.kind === 'receipt' ? '+' : '−'}
                      {formatPence(schedule.amountPence)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {schedule.cancelledAt !== null ? (
                      <>Cancelled from {schedule.cancelledEffectiveOn} — history kept</>
                    ) : (
                      <>Next due: {nextDueDate ?? '—'}</>
                    )}
                    {` · active from ${schedule.activeFrom}`}
                    {schedule.contractEndsOn !== null
                      ? ` · contract ends ${schedule.contractEndsOn} (informational)`
                      : ''}
                    {schedule.supplierId !== null ? (
                      <>
                        {' · '}
                        <Link
                          href={supplierCardHref(schedule.supplierId)}
                          className="text-accent hover:underline"
                        >
                          Supplier card
                        </Link>
                      </>
                    ) : null}
                  </p>
                  {schedule.cancelledAt === null ? (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">
                        Edit schedule
                      </summary>
                      <div className="mt-2 max-w-2xl">
                        <ScheduleEditForm
                          scheduleId={schedule.id}
                          version={schedule.version}
                          name={schedule.name}
                          kind={schedule.kind}
                          frequency={schedule.frequency}
                          dueDayOfMonth={schedule.dueDayOfMonth}
                          dueMonth={schedule.dueMonth}
                          excludedMonths={schedule.excludedMonths}
                          amountPence={schedule.amountPence}
                          contractEndsOn={schedule.contractEndsOn}
                          activeFrom={schedule.activeFrom}
                          activeUntil={schedule.activeUntil}
                          potId={schedule.potId}
                          potOptions={pots.map((pot) => ({ id: pot.id, label: pot.label }))}
                          categoryId={schedule.categoryId}
                          categoryOptions={categoryOptions}
                          supplierId={schedule.supplierId}
                          supplierOptions={suppliers.map((s) => ({ id: s.id, label: s.name }))}
                          targetKind={schedule.targetKind}
                          targetId={schedule.targetId}
                          people={recurringData.people}
                          vehicles={recurringData.vehicles}
                        />
                      </div>
                    </details>
                  ) : null}
                  {schedule.cancelledAt === null ? (
                    <CancelScheduleForm
                      schedule={
                        recurringData.schedules.find((entry) => entry.id === schedule.id) ??
                        ({
                          id: schedule.id,
                          name: schedule.name,
                          kind: schedule.kind,
                          frequency: schedule.frequency,
                          amountPence: schedule.amountPence,
                          dueDayOfMonth: schedule.dueDayOfMonth,
                          dueMonth: schedule.dueMonth,
                          potLabel: potNames.get(schedule.potId) ?? 'Pot',
                          nextDueDate,
                          version: schedule.version,
                          cancelledEffectiveOn: schedule.cancelledEffectiveOn,
                          contractEndsOn: schedule.contractEndsOn,
                          supplierId: schedule.supplierId,
                          supplierName:
                            schedule.supplierId === null
                              ? null
                              : (suppliers.find((s) => s.id === schedule.supplierId)?.name ?? null),
                        } as RecurringData['schedules'][number])
                      }
                      today={today}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <details className="shrink-0 lg:max-h-[45%] lg:overflow-y-auto lg:border-t lg:border-border-hairline lg:pt-3">
            <summary className="cursor-pointer text-sm font-medium text-ink-body">
              Add a schedule
            </summary>
            <div className="mt-3">
              <AddScheduleForm data={recurringData} />
            </div>
          </details>
        </section>

        <section
          aria-labelledby="renewals-heading"
          className="order-3 rounded-xl border border-border bg-surface p-4 shadow-sm lg:order-4 lg:col-start-2 lg:row-start-2"
        >
          <h2 id="renewals-heading" className="mb-2 text-lg font-semibold">
            Renewals
          </h2>
          <p className="mb-3 text-xs text-ink-muted">
            Alerts with context — if the money also moves (an annual premium), that is a separate
            annual schedule; the two never double-count.
          </p>
          {renewals.length === 0 ? (
            <p className="mb-3 text-sm text-ink-muted">No renewals tracked yet.</p>
          ) : (
            <ul className="mb-3 divide-y divide-border-hairline">
              {renewals.map((renewal) => (
                <li key={renewal.id} id={`renewal-${renewal.id}`} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span>
                      <span className="font-medium text-ink-emphasis">{renewal.label}</span>{' '}
                      <span className="text-xs text-ink-muted">
                        due {renewal.nextRenewalDate}
                        {renewal.advancedFrom !== null
                          ? ` (advanced from ${renewal.advancedFrom})`
                          : ''}
                        {renewal.supplierId !== null
                          ? ` · ${suppliers.find((s) => s.id === renewal.supplierId)?.name ?? 'supplier'}`
                          : ''}
                        {renewal.targetKind === 'vehicle' && renewal.targetId !== null
                          ? ` · ${vehicles.find((v) => v.id === renewal.targetId)?.label ?? 'vehicle'}`
                          : ''}
                        {renewal.warnDaysBefore > 0
                          ? ` · warns ${renewal.warnDaysBefore} days before`
                          : ''}
                      </span>
                    </span>
                    <span className="text-xs text-ink-muted">
                      {renewal.repeatsAnnually ? 'annual' : 'one-off'}
                    </span>
                  </div>
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">
                      Edit renewal
                    </summary>
                    <div className="mt-2 max-w-2xl">
                      <RenewalEditForm
                        renewalId={renewal.id}
                        version={renewal.version}
                        label={renewal.label}
                        nextRenewalDate={renewal.nextRenewalDate}
                        warnDaysBefore={renewal.warnDaysBefore}
                        repeatsAnnually={renewal.repeatsAnnually}
                        supplierId={renewal.supplierId}
                        supplierOptions={suppliers.map((s) => ({ id: s.id, label: s.name }))}
                        targetKind={renewal.targetKind}
                        targetId={renewal.targetId}
                        people={recurringData.people}
                        vehicles={recurringData.vehicles}
                        notes={renewal.notes ?? ''}
                      />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-ink-body">
              Add a renewal
            </summary>
            <div className="mt-3">
              <AddRenewalForm data={recurringData} />
            </div>
          </details>
        </section>

        <section
          aria-labelledby="projection-figures-heading"
          className="order-4 rounded-xl border border-border bg-surface p-4 shadow-sm lg:order-3 lg:col-start-1 lg:row-start-2"
        >
          <h2 id="projection-figures-heading" className="text-base font-semibold">
            Projection figures
          </h2>
          <p className="mb-3 mt-1 text-xs text-ink-muted">
            Weekly shop and per-vehicle fuel the payday projection uses. Insights compares them with
            recent actuals.
          </p>
          <ProjectionSettingsForm data={recurringData.projectionSettings} />
        </section>
      </div>
    </main>
  );
}

function CalendarGrid({ days }: { days: CalendarDay[] }) {
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-1">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <div
            key={day.date}
            // Exposed for the browser acceptance run: one cell per date, and the
            // cell is rendered from the same instance list as the lists below.
            data-date={day.date}
            className={`min-h-20 rounded-lg border p-1.5 ${
              day.isToday
                ? 'border-accent-400 bg-accent-50'
                : day.inMonth
                  ? 'border-border bg-surface'
                  : 'border-border-hairline bg-canvas'
            }`}
          >
            <p
              className={`text-xs font-medium ${
                day.inMonth ? 'text-ink-body' : 'text-ink-faint'
              } ${day.isToday ? 'text-accent' : ''}`}
            >
              {Number(day.date.slice(8))}
              {day.isToday ? ' · today' : ''}
            </p>
            {day.instances.length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer list-none text-xs font-medium text-ink-soft hover:text-ink">
                  {day.instances.length} {day.instances.length === 1 ? 'item' : 'items'}
                </summary>
                <ul className="mt-1 space-y-1">
                  {day.instances.map((instance) => (
                    <li key={instance.instanceId}>
                      <a
                        href={`#schedule-${instance.scheduleId}`}
                        className={`flex items-start gap-1 rounded px-1 py-0.5 text-xs hover:bg-surface-muted ${
                          instance.kind === 'receipt' ? 'text-positive-800' : 'text-ink-body'
                        }`}
                      >
                        <span
                          className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                            instance.kind === 'receipt' ? 'bg-positive-500' : 'bg-marker-muted'
                          }`}
                        />
                        <span>
                          <span
                            className={
                              instance.state === 'converted'
                                ? 'line-through decoration-ink-ghost'
                                : ''
                            }
                          >
                            {instance.scheduleName}
                          </span>{' '}
                          <span className="tabular-nums">
                            {instance.kind === 'receipt' ? '+' : '−'}
                            {formatPence(instance.amountPence)}
                          </span>
                          {instance.state === 'upcoming' ? (
                            <span className="ml-1 text-ink-faint">pending</span>
                          ) : null}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
