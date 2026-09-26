import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PotOutlookLine } from '@/components/pot-outlook';
import { QuickEntry } from '@/components/quick-entry';
import { formatPence } from '@/lib/money';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { getMonthComparisonView, getVehicleCostsView } from '@/lib/records/insights-view';
import { addDaysLocal } from '@/lib/records/dates';
import { buildEntryData } from '@/lib/records/entry-view';
import {
  getCycleOutlook,
  getMoneySnapshot,
  getProjectionView,
  getUpcomingCommitments,
  getKeyDateAlerts,
} from '@/lib/records/money-view';
import { keyDateMessage } from '@/lib/records/keydates';
import { toLocalDateString } from '@/lib/time';
import { ProjectionSection } from './projection-panel';

export const dynamic = 'force-dynamic';

/**
 * Dense overview (SPEC §15.2, decisions 74 and 164): money + tier banner,
 * projection with the “what's in this forecast” breakdown, due this week,
 * key dates, this month's spending by parent, and vehicles rolling 12.
 * Purchase review, transfer void, adding a pot and checkpoint history live
 * on their own pages. Quick entry is embedded here so the mobile home and
 * this page share the same entry code path.
 */
export default async function OverviewPage() {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const now = new Date();
  const today = toLocalDateString(now);

  const money = getMoneySnapshot(db, now);
  const projection = getProjectionView(db, now);
  // "Before income lands" per pot (SPEC §7.7, v0.9.0): the same figure the
  // quick-entry balance shows at the till, so review and entry agree.
  const outlook = getCycleOutlook(db, now, money);
  const dueThisWeek = getUpcomingCommitments(db, addDaysLocal(today, 7), now);
  const keyDates = getKeyDateAlerts(db, now).map((alert) => ({
    ...alert,
    message: keyDateMessage(alert),
  }));
  const monthView = getMonthComparisonView(db, now);
  const vehicleView = getVehicleCostsView(db, now);
  const entryData = buildEntryData(db, now, user.email);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Overview</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Everything in one place</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Estimates are your reported figures plus recorded activity — never a bank balance.{' '}
          <Link href="/purchases" className="font-medium text-accent hover:underline">
            All purchases →
          </Link>
        </p>
      </header>

      <div className="space-y-6">
        <MoneyRow money={money} outlook={outlook} />
        <div className="grid gap-6 lg:grid-cols-2">
          {projection !== null ? (
            <ProjectionSection projection={projection} />
          ) : (
            <section
              aria-labelledby="projection-locked-heading"
              className="rounded-xl border border-dashed border-border-strong bg-surface p-4"
            >
              <h2 id="projection-locked-heading" className="text-lg font-semibold">
                Payday projection
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                The projection appears once the household has a balance checkpoint and an expected
                income schedule (for example a monthly salary). Record a checkpoint in Quick Entry →
                Balance or on Accounts &amp; Pots, then add the income schedule in Recurring.
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
                  <p className="text-xs text-ink-muted">
                    this month {formatPence(vehicle.monthPence)} · previous{' '}
                    {formatPence(vehicle.previousMonthPence)} · since {vehicle.rolling12From}
                  </p>
                </li>
              ))}
            </ul>
          </SectionShell>
        </div>
      </div>
    </main>
  );
}

function MoneyRow({
  money,
  outlook,
}: {
  money: ReturnType<typeof getMoneySnapshot>;
  outlook: ReturnType<typeof getCycleOutlook>;
}) {
  return (
    <section
      aria-labelledby="money-heading"
      className="rounded-xl border border-border bg-surface p-4 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="money-heading" className="text-xl font-semibold">
          {money.householdAvailablePence === null
            ? 'Waiting for your first checkpoint'
            : `Household available now: ${formatPence(money.householdAvailablePence)}`}
        </h2>
        <Link href="/pots" className="text-sm font-medium text-accent hover:underline">
          Accounts &amp; Pots →
        </Link>
      </div>
      {money.householdAvailablePence === null ? (
        <p className="text-sm text-ink-soft">
          Record a balance checkpoint in Quick Entry → Balance or on Accounts &amp; Pots and the
          household estimate appears here. Unreported pots never get an estimate — the app does not
          guess balances.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {money.pots.map((view) => (
            <li key={view.pot.id} className="rounded-lg bg-canvas px-3 py-2">
              <p className="text-xs text-ink-muted">{view.pot.label}</p>
              {view.estimatePence === null ? (
                <p className="text-sm text-ink-faint">no checkpoint</p>
              ) : (
                <p className="text-sm font-semibold tabular-nums">
                  {formatPence(view.estimatePence)}
                </p>
              )}
              <PotOutlookLine
                pot={outlook.pots.find((entry) => entry.potId === view.pot.id)}
                incomeDate={outlook.incomeDate}
              />
            </li>
          ))}
        </ul>
      )}
      {money.debts.owedByHouseholdPence > 0 || money.debts.owedToHouseholdPence > 0 ? (
        <p className="mt-3 text-sm text-ink-soft">
          {money.debts.owedByHouseholdPence > 0 ? (
            <>
              Owe others{' '}
              <span className="font-semibold tabular-nums text-ink">
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
              <span className="font-semibold tabular-nums text-ink">
                {formatPence(money.debts.owedToHouseholdPence)}
              </span>
            </>
          ) : null}
        </p>
      ) : null}
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
    <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
            {kicker}
          </p>
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <span className="text-xs text-ink-muted">{caption}</span>
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
        <span className="text-xs text-ink-muted">so far this month</span>
      </p>
      {current.byParent.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing recorded this month yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {current.byParent.map((entry) => {
            const prevAmount =
              previous.byParent.find((p) => p.parent === entry.parent)?.amountPence ?? 0;
            return (
              <li key={entry.parent}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-ink-soft">{entry.parent}</span>
                  <span className="tabular-nums text-ink-body">
                    {formatPence(entry.amountPence)}
                    <span className="ml-1 text-ink-faint">
                      ({formatPence(prevAmount)} last month)
                    </span>
                  </span>
                </div>
                <div className="mt-0.5 h-2 rounded bg-surface-muted">
                  <div
                    className="h-2 rounded bg-accent-600"
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
    scheduleKind: string | null;
    potLabel: string;
  }>;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Due this week</h2>
        <Link href="/recurring" className="text-xs font-medium text-accent hover:underline">
          Recurring →
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing scheduled in the next seven days.</p>
      ) : (
        <ul className="divide-y divide-border-hairline">
          {items.map((item, index) => (
            <li
              key={`${item.scheduleKind}-${item.name}-${item.dueDate}-${index}`}
              className="flex items-baseline justify-between gap-2 py-1.5 text-sm"
            >
              <span>
                <span className="font-medium">{item.name}</span>{' '}
                <span className="text-xs text-ink-muted">
                  {item.dueDate} · {item.potLabel}
                </span>
              </span>
              <span
                className={`tabular-nums ${item.scheduleKind === 'receipt' ? 'text-positive' : ''}`}
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
    <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold">Key dates</h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No renewals or contract ends inside their warning windows right now.
        </p>
      ) : (
        <ul className="divide-y divide-border-hairline">
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
