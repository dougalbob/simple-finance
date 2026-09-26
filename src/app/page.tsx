import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HouseholdSetup } from '@/components/household-setup';
import { QuickEntry } from '@/components/quick-entry';
import { currentUserFromRequest } from '@/lib/auth/next';
import { APP_RELEASE_STAGE, APP_VERSION } from '@/lib/version';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { addDaysLocal } from '@/lib/records/dates';
import { buildEntryData } from '@/lib/records/entry-view';
import {
  getMoneySnapshot,
  getProjectionView,
  getUpcomingCommitments,
  type MoneySnapshot,
} from '@/lib/records/money-view';
import { listPeople } from '@/lib/records/people';
import { listVehicles } from '@/lib/records/vehicles';
import { toLocalDateString } from '@/lib/time';
import { ProjectionSection } from '@/app/overview/projection-panel';

export const dynamic = 'force-dynamic';

/**
 * Phone till home (SPEC §15.1, decision 164): available now, Quick Entry
 * (opens at the till), payday projection, due this week, and links to the
 * full pages. Recurring, pots, checkpoints, recent purchases and key dates
 * live on their own pages — not here.
 */
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

  const people = listPeople(db);
  const vehicles = listVehicles(db);
  // Shared builder (mobile home + Overview, decision: one code path).
  const entryData = buildEntryData(db, now, user.email);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Shared household ledger
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Simple Finance</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Signed in as {user.email}. Estimates are your reported figures plus recorded activity —
            never a bank balance.
          </p>
        </div>
        <p className="rounded-full bg-surface px-3 py-1 text-xs text-ink-muted shadow-sm ring-1 ring-border">
          v{APP_VERSION} · {APP_RELEASE_STAGE}
        </p>
      </header>

      <div className="space-y-6">
        {people.length < 2 || vehicles.length === 0 ? (
          <HouseholdSetup people={people.map(({ id, label }) => ({ id, label }))} />
        ) : null}

        <MoneySection money={money} />
        {/* On a phone this page opens at the till (decision 158). */}
        <QuickEntry data={entryData} openAtTillOnMobile />
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
              Balance or on{' '}
              <Link href="/pots" className="font-medium text-accent hover:underline">
                Accounts &amp; Pots
              </Link>
              , then add the income schedule in Recurring.
            </p>
          </section>
        )}

        <DueThisWeekSection items={dueThisWeek} />

        <HomePageLinks />
      </div>
    </main>
  );
}

function MoneySection({ money }: { money: MoneySnapshot }) {
  if (money.pots.length === 0) return null;
  return (
    <section
      aria-labelledby="money-heading"
      className="rounded-xl border border-border bg-surface p-4 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-positive">
            Available now (estimate)
          </p>
          <h2 id="money-heading" className="text-xl font-semibold">
            {money.householdAvailablePence === null
              ? 'Waiting for your first checkpoint'
              : `Household: ${formatPence(money.householdAvailablePence)}`}
          </h2>
        </div>
        <span className="text-xs text-ink-muted">
          Your reported figures plus recorded activity — not a bank balance
        </span>
      </div>
      {money.householdAvailablePence === null ? (
        <p className="text-sm text-ink-soft">
          Record a balance checkpoint in Quick Entry → Balance or on{' '}
          <Link href="/pots" className="font-medium text-accent hover:underline">
            Accounts &amp; Pots
          </Link>{' '}
          and the household estimate appears here. Unreported pots never get an estimate — the app
          does not guess balances.
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
          ) : null}{' '}
          <a href="/pots" className="font-medium text-accent hover:underline">
            Details →
          </a>
        </p>
      ) : null}
    </section>
  );
}

function DueThisWeekSection({
  items,
}: {
  items: Array<{
    name: string;
    amountPence: number;
    dueDate: string;
    potId: number;
    potLabel: string;
    scheduleKind: string | null;
  }>;
}) {
  return (
    <section
      aria-labelledby="due-week-heading"
      className="rounded-xl border border-border bg-surface p-4 shadow-sm"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="due-week-heading" className="text-lg font-semibold">
          Due this week
        </h2>
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
                  {item.dueDate} · {item.scheduleKind === 'receipt' ? 'in' : 'out'} ·{' '}
                  {item.potLabel}
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

/**
 * Doors to the full pages — not mini copies of them (decision 164). Charts
 * stays below the till (decision 153); Purchases is where a receipt is
 * attached after the event; Horizon is wanted on both phone and laptop.
 */
function HomePageLinks() {
  const links = [
    {
      href: '/charts',
      kicker: 'Charts',
      title: 'See the money drawn',
      caption:
        "The next month's balance, the weekly shop, personal spending and the fixed bills — each with its numbers underneath.",
    },
    {
      href: '/purchases',
      kicker: 'Purchases',
      title: 'Review what was spent',
      caption: 'Attach a receipt, edit, void or refund — the full purchase history.',
    },
    {
      href: '/horizon',
      kicker: 'Horizon',
      title: 'How far the money would go',
      caption: 'Look ahead up to 400 days from the same engine as the payday projection.',
    },
  ];
  return (
    <nav aria-label="Other pages" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="block rounded-xl border border-border bg-surface p-4 shadow-sm hover:border-accent-300 hover:bg-accent-50/40"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
            {link.kicker}
          </p>
          <p className="text-base font-semibold text-ink">{link.title}</p>
          <p className="mt-0.5 text-sm text-ink-soft">{link.caption}</p>
        </Link>
      ))}
    </nav>
  );
}
