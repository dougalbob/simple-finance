import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { listPotActivity, type ActivityRow } from '@/lib/records/activity';
import { ensureScheduleState } from '@/lib/records/money-view';
import { latestCheckpointPerPot, listPots } from '@/lib/records/pots';
import { addDaysLocal } from '@/lib/records/dates';
import { isValidLocalDate, toLocalDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

interface SearchParams {
  potId?: string;
  from?: string;
  to?: string;
}

/**
 * All Transactions (SPEC §15.3, plan decisions 101–108): a read-only, one-pot
 * activity view. A pure projection of existing records — this page renders no
 * form and cannot create, edit or void anything. Every row links to the
 * canonical page that owns that behaviour.
 */
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const now = new Date();
  // The lazy due pass runs as on every read page (SPEC §11.2), so a direct
  // debit that came due today is in the list. It writes conversions, never
  // user records — "read-only" here means no user-facing writes.
  ensureScheduleState(db, now);

  const params = await searchParams;
  const today = toLocalDateString(now);
  // Live pots only. Archiving a pot requires it to have no records at all
  // (SPEC §4), so an archived pot has no history to reach and offering one
  // here would only suggest there was something to see.
  const pots = listPots(db);
  const pot =
    pots.find((candidate) => candidate.id === Number(params.potId)) ??
    pots.find((candidate) => candidate.label.toLowerCase() === 'main account') ??
    pots[0] ??
    null;

  if (pot === null) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        <h1 className="text-3xl font-semibold tracking-tight">All Transactions</h1>
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No pots yet. Add an account or cash pot in{' '}
          <Link href="/settings" className="text-sky-700 underline">
            Settings
          </Link>{' '}
          first.
        </p>
      </main>
    );
  }

  // The window: a manual range, clamped so the end date is never in the
  // future (no record can be — SPEC §9.1), falling back to the last 30 days.
  const defaultFrom = addDaysLocal(today, -29);
  const latest = latestCheckpointPerPot(db).get(pot.id) ?? null;
  const checkpointDate = latest === null ? null : toLocalDateString(latest.effectiveAt);
  const requestedFrom = params.from ?? '';
  const requestedTo = params.to ?? '';
  const rawTo = isValidLocalDate(requestedTo) && requestedTo <= today ? requestedTo : today;
  const rawFrom = isValidLocalDate(requestedFrom) ? requestedFrom : defaultFrom;
  const rangeIsBroken = rawFrom > rawTo;
  const dateFrom = rangeIsBroken ? defaultFrom : rawFrom;
  const dateTo = rangeIsBroken ? today : rawTo;

  const activity = listPotActivity(db, { potId: pot.id, dateFrom, dateTo });
  const net = activity.totals.inPence - activity.totals.outPence;

  const monthStart = `${today.slice(0, 7)}-01`;
  const quickPicks = [
    { label: 'Last 30 days', from: defaultFrom, to: today },
    {
      label: 'Since last checkpoint',
      from: checkpointDate ?? defaultFrom,
      to: today,
    },
    { label: 'This month', from: monthStart > today ? today : monthStart, to: today },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
          All Transactions
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Activity in one pot</h1>
        <p className="mt-1 text-sm text-slate-600">
          Everything that touched <span className="font-medium">{pot.label}</span> between two
          dates, newest first. This page is read-only: each row opens the record in the page that
          can edit or void it. Green is money into this pot, red is money out.
        </p>
      </header>

      <form
        method="GET"
        aria-label="Activity filters"
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-end">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="activity-pot" className="text-xs font-medium text-slate-600">
              Target
            </label>
            <select
              id="activity-pot"
              name="potId"
              defaultValue={String(pot.id)}
              className="w-full min-w-0 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            >
              {pots.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="activity-from" className="text-xs font-medium text-slate-600">
              Start date
            </label>
            <input
              id="activity-from"
              name="from"
              type="date"
              defaultValue={dateFrom}
              max={today}
              className="w-full min-w-0 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="activity-to" className="text-xs font-medium text-slate-600">
              End date
            </label>
            <input
              id="activity-to"
              name="to"
              type="date"
              defaultValue={dateTo}
              max={today}
              className="w-full min-w-0 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Show activity
          </button>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-medium">Quick picks:</span>
          {quickPicks.map((pick) => (
            <Link
              key={pick.label}
              href={`/transactions?potId=${pot.id}&from=${pick.from}&to=${pick.to}`}
              className={`rounded-full border px-2.5 py-1 ${
                pick.from === dateFrom && pick.to === dateTo
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'
              }`}
            >
              {pick.label}
            </Link>
          ))}
          {checkpointDate === null ? (
            <span className="text-slate-500">
              (this pot has never been reported, so &ldquo;since last checkpoint&rdquo; falls back
              to 30 days)
            </span>
          ) : null}
        </p>
      </form>

      {rangeIsBroken ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          That start date was after the end date, so the last 30 days are shown instead.
        </p>
      ) : null}

      <section aria-labelledby="activity-heading" className="mt-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="activity-heading" className="text-xl font-semibold">
            {dateFrom} to {dateTo}
          </h2>
          <span className="text-xs text-slate-500">
            {activity.totals.rowCount} {activity.totals.rowCount === 1 ? 'movement' : 'movements'}
            {activity.totals.hiddenRowCount > 0
              ? ` · showing the newest ${activity.totals.rowCount}, ${activity.totals.hiddenRowCount} older ones hidden — narrow the range`
              : ''}
          </span>
        </div>

        {activity.totals.rowCount === 0 &&
        activity.entries.every((entry) => entry.kind !== 'checkpoint') ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
            Nothing touched {pot.label} in this window.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Supplier / transfer / loan
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Category
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Amount
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {activity.entries.map((entry) =>
                  entry.kind === 'checkpoint' ? (
                    <tr
                      key={entry.checkpoint.key}
                      className="border-y-2 border-slate-300 bg-slate-50 text-slate-600"
                    >
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                        {entry.checkpoint.date}
                      </td>
                      <td className="px-3 py-2" colSpan={3}>
                        <span className="font-medium text-slate-700">
                          Checkpoint · reported {formatPence(entry.checkpoint.amountPence)}
                        </span>
                        {entry.checkpoint.note !== '' ? (
                          <span className="ml-2 text-xs text-slate-500">
                            {entry.checkpoint.note}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-slate-500">reported</td>
                      <td className="px-3 py-2 text-xs text-slate-500">not a movement</td>
                    </tr>
                  ) : (
                    <ActivityTableRow key={entry.row.key} row={entry.row} />
                  ),
                )}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 text-sm">
                <tr>
                  <td className="px-3 py-2 font-medium text-slate-700" colSpan={4}>
                    Movements shown
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className="text-emerald-700">
                      +{formatPence(activity.totals.inPence)}
                    </span>
                    <span className="mx-1 text-slate-400">/</span>
                    <span className="text-red-700">−{formatPence(activity.totals.outPence)}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    net {net < 0 ? '−' : '+'}
                    {formatPence(Math.abs(net))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-slate-500">
          &ldquo;Movements shown&rdquo; is the sum of the rows above. It is not the change in this
          pot&rsquo;s estimate: voided records are not listed here, and a date-only credit recorded
          on a checkpoint&rsquo;s own day is treated as already counted by the estimate (SPEC §7.1).
        </p>
      </section>
    </main>
  );
}

function ActivityTableRow({ row }: { row: ActivityRow }) {
  const incoming = row.direction === 'in';
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700">{row.date}</td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tracking-wide text-slate-700">
          {row.code}
        </span>
        {row.secondaryLink !== null ? (
          <Link href={row.secondaryLink.href} className="ml-2 text-xs text-sky-700 hover:underline">
            {row.secondaryLink.label}
          </Link>
        ) : null}
        {row.badge !== null ? (
          <span className="mt-1 block text-xs text-slate-500">{row.badge}</span>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        <Link href={row.link.href} className="font-medium text-slate-800 hover:text-sky-700">
          {row.source}
          <span className="sr-only"> — {row.link.label}</span>
        </Link>
      </td>
      <td className="px-3 py-2.5 text-slate-600">
        {row.category === '' ? <span className="text-slate-400">—</span> : row.category}
        {row.extraLines > 0 ? (
          <span className="ml-1 text-xs text-slate-500">+{row.extraLines} more</span>
        ) : null}
      </td>
      <td
        className={`whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums ${
          incoming ? 'text-emerald-700' : 'text-red-700'
        }`}
      >
        {incoming ? '+' : '−'}
        {formatPence(row.amountPence)}
      </td>
      <td className="px-3 py-2.5 text-slate-600">
        {row.note === '' ? <span className="text-slate-400">—</span> : row.note}
      </td>
    </tr>
  );
}
