import { redirect } from 'next/navigation';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { addDaysLocal } from '@/lib/records/dates';
import {
  ensureScheduleState,
  getHorizonProjectionView,
  landPenceOf,
} from '@/lib/records/money-view';
import { listPots } from '@/lib/records/pots';
import { isValidLocalDate, toLocalDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** The furthest the household can look ahead (a planning figure, not a promise). */
const HORIZON_MAX_DAYS = 400;

interface SearchParams {
  through?: string;
  pots?: string;
  daytoday?: string;
}

/**
 * Horizon (SPEC §7.6, v0.5.0): how far the money would go if it only paid
 * what is already expected. The same pure projection engine as the payday
 * panel, given the chosen date as its window's end — so "where we'd land"
 * is `available now + expected money in − commitments − day-to-day`, not a
 * second engine with its own arithmetic. Debt expected inflows join the
 * window flagged `expected`: borrowed money is expected here, never
 * received, and never income.
 *
 * The page is laptop-shaped by the same household choice that shaped
 * Income: it is a sit-down review surface, not a till-side tool.
 */
export default async function HorizonPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const now = new Date();
  const today = toLocalDateString(now);
  // Lazy due pass as on every read page (SPEC §11.2): a commitment due today
  // is already in the window as a real record, not double-counted tomorrow.
  ensureScheduleState(db, now);

  const params = await searchParams;

  const minSelectable = addDaysLocal(today, 1);
  const maxSelectable = addDaysLocal(today, HORIZON_MAX_DAYS);

  // The chosen date: any valid date up to today + 400, else a sensible
  // default (five weeks ahead). Clamped, never trusted from the client.
  const requestedThrough = typeof params.through === 'string' ? params.through : '';
  const throughDate =
    isValidLocalDate(requestedThrough) &&
    requestedThrough >= minSelectable &&
    requestedThrough <= maxSelectable
      ? requestedThrough
      : addDaysLocal(today, 35);

  // Selected pots: empty or "all" opts into every pot; otherwise ids.
  // Unknown ids are dropped by the read model (it maps to live pots only).
  const potSelectionRaw = typeof params.pots === 'string' ? params.pots : '';
  const potIds =
    potSelectionRaw.trim() === '' || potSelectionRaw.trim() === 'all'
      ? []
      : potSelectionRaw
          .split(',')
          .map((part) => Number(part))
          .filter((id) => Number.isInteger(id) && id > 0);

  // Day-to-day (groceries + fuel) is included unless the user said no.
  const includeDayToDay = params.daytoday !== '0';

  const pots = listPots(db);
  const view = getHorizonProjectionView(db, throughDate, potIds, includeDayToDay, now);
  const { result } = view;

  const tier = result.tier;
  const tierStyles =
    tier === 'warning'
      ? 'border-red-200 bg-red-50 text-red-800'
      : tier === 'heads-up'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  const lowLine =
    result.projectedLowPence === null
      ? 'No window to project — pick a date at least one day ahead.'
      : `The lowest point would be ${formatPence(result.projectedLowPence)} on ${result.lowDate ?? '—'}.`;
  const tierLine =
    tier === 'warning'
      ? ` That crosses the configured threshold of ${formatPence(result.warningThresholdPence ?? 0)} overdrawn.`
      : tier === 'heads-up'
        ? ` That dips below £0, but stays within the configured threshold.`
        : ` The household stays above zero throughout.`;

  const detailsOpen = result.days <= 60;
  const incomeLineCount = view.receiptLines.filter((line) => !line.expected).length;
  const expectedLineCount = view.receiptLines.filter((line) => line.expected).length;

  const selectedCount = view.selection.filter((entry) => entry.selected).length;
  const selectionText =
    selectedCount === pots.length ? 'every pot' : `${selectedCount} of ${pots.length} pots`;
  const allSelected = selectedCount === pots.length;

  // Sorted, day-grouped commitment list for the detail block.
  const commitmentGroups = groupByDate(
    view.commitmentLines.map((line) => ({
      name: line.name,
      dueDate: line.dueDate,
      subtitle: line.potLabel,
      amountPence: line.amountPence,
      negative: true,
    })),
  );
  const receiptGroups = groupByDate(
    view.receiptLines.map((line) => ({
      name: line.name,
      dueDate: line.dueDate,
      subtitle: `${line.potLabel}${line.expected ? ' · expected — never received' : ''}`,
      amountPence: line.amountPence,
      negative: false,
      expected: line.expected,
    })),
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Horizon</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">How far the money would go</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          A projection of what would be left if the household only paid what is already expected —
          commitments, expected money in, and day-to-day spending — up to a date you choose.
        </p>
      </header>

      <section
        aria-label="Choose the horizon"
        className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <form method="GET" action="/horizon" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="horizon-through" className="text-xs font-medium text-slate-600">
                Look ahead to
              </label>
              <input
                id="horizon-through"
                name="through"
                type="date"
                min={minSelectable}
                max={maxSelectable}
                defaultValue={throughDate}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="horizon-daytoday" className="text-xs font-medium text-slate-600">
                Day-to-day
              </label>
              <select
                id="horizon-daytoday"
                name="daytoday"
                defaultValue={includeDayToDay ? '1' : '0'}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
              >
                <option value="1">Include groceries &amp; fuel</option>
                <option value="0">Bills only (leave out day-to-day)</option>
              </select>
            </div>
            <button
              type="submit"
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              Look ahead
            </button>
          </div>
          <fieldset>
            <legend className="text-xs font-medium text-slate-600">
              Which pots count?{' '}
              <span className="text-xs font-normal text-slate-400">— untick to exclude</span>
            </legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
              {pots.map((pot) => {
                const selected =
                  view.selection.find((entry) => entry.pot.id === pot.id)?.selected ?? true;
                return (
                  <label key={pot.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="pots"
                      value={pot.id}
                      defaultChecked={selected}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {pot.label}
                  </label>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {allSelected
                ? 'Every pot is counted. A debt’s expected support counts only when the pot it lands in is ticked.'
                : 'Only ticked pots are counted. A debt’s expected support counts only when the pot it lands in is ticked.'}
            </p>
          </fieldset>
        </form>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {view.dayToDayIncluded ? 'Free to spend up to' : 'Free to spend on bills up to'}
          </p>
          <p
            aria-label={`${
              view.dayToDayIncluded ? 'Free to spend up to' : 'Free to spend on bills up to'
            } ${view.throughDate}: ${formatPence(landPenceOf(result))}`}
            className="mt-1 text-3xl font-semibold tabular-nums"
          >
            {formatPence(landPenceOf(result))}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Where we&rsquo;d land on {view.throughDate} — after commitments and expected money in,
            {view.dayToDayIncluded ? ' and day-to-day spending.' : ' without day-to-day spending.'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Lowest point</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {result.projectedLowPence === null ? '—' : formatPence(result.projectedLowPence)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {result.lowDate === null ? 'No window to project.' : `on ${result.lowDate}`}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Scope</p>
          <p className="mt-1 text-sm text-slate-700">
            {result.days} day{result.days === 1 ? '' : 's'} ahead · {selectionText}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Available now {formatPence(view.availableNowPence)} · commitments −
            {formatPence(view.totalCommitmentsPence)} · expected money in +
            {formatPence(view.totalReceiptsPence)}
          </p>
        </div>
      </section>

      <p className={`mb-4 rounded-lg border px-3 py-2 text-sm font-medium ${tierStyles}`}>
        {lowLine} {tierLine}
      </p>

      {result.days <= 0 ? (
        <section className="mb-4 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          Pick a date at least one day ahead to project the household&rsquo;s money to it.
        </section>
      ) : null}

      <div className="space-y-4">
        <details
          open={detailsOpen}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Commitments in the window ({view.commitmentLines.length})
          </summary>
          {view.commitmentLines.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No commitments due in this window.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {commitmentGroups.map((group) =>
                group.lines.map((line) => (
                  <li
                    key={`${line.dueDate}-commitment-${line.name}`}
                    className="flex items-baseline justify-between gap-2 py-1.5 text-sm"
                  >
                    <span>
                      <span className="font-medium">{line.name}</span>{' '}
                      <span className="text-xs text-slate-500">
                        {line.dueDate} · {line.subtitle}
                      </span>
                    </span>
                    <span className="tabular-nums">−{formatPence(line.amountPence)}</span>
                  </li>
                )),
              )}
            </ul>
          )}
        </details>

        <details
          open={detailsOpen}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Expected money in ({incomeLineCount}
            {expectedLineCount > 0 ? ` income + ${expectedLineCount} expected support` : ''})
          </summary>
          {view.receiptLines.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No expected money in this window.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {receiptGroups.map((group) =>
                group.lines.map((line) => (
                  <li
                    key={`${line.dueDate}-receipt-${line.name}-${line.expected ? 'expected' : 'income'}`}
                    className="flex items-baseline justify-between gap-2 py-1.5 text-sm"
                  >
                    <span>
                      <span className="font-medium">{line.name}</span>{' '}
                      <span
                        className={`text-xs ${line.expected ? 'text-slate-400' : 'text-slate-500'}`}
                      >
                        {line.dueDate} · {line.subtitle}
                      </span>
                    </span>
                    <span
                      className={`tabular-nums ${line.expected ? 'text-slate-500' : 'text-emerald-700'}`}
                    >
                      {line.expected ? '≈' : '+'}
                      {formatPence(line.amountPence)}
                    </span>
                  </li>
                )),
              )}
            </ul>
          )}
        </details>

        {result.perDay.length > 0 ? (
          <details
            open={detailsOpen}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              Day by day ({result.perDay.length} days)
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5">Date</th>
                    <th className="px-3 py-1.5 text-right">Commitments</th>
                    <th className="px-3 py-1.5 text-right">Expected money in</th>
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
      </div>

      <p className="mt-6 text-xs text-slate-500">
        A projection of the records already in the app, not a bank forecast. Expected support is an
        expectation of borrowed money — it is owed, never income, and it lands only if it is
        actually borrowed and recorded. Day-to-day uses the figures configured in Settings.
      </p>
    </main>
  );
}

/** Group dated lines for the detail blocks, sorted by date then name. */
function groupByDate(
  lines: Array<{
    name: string;
    dueDate: string;
    subtitle: string;
    amountPence: number;
    negative: boolean;
    expected?: boolean;
  }>,
): Array<{
  date: string;
  lines: Array<{
    name: string;
    dueDate: string;
    subtitle: string;
    amountPence: number;
    negative: boolean;
    expected?: boolean;
  }>;
}> {
  const sorted = [...lines].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name),
  );
  const groups = new Map<
    string,
    Array<{
      name: string;
      dueDate: string;
      subtitle: string;
      amountPence: number;
      negative: boolean;
      expected?: boolean;
    }>
  >();
  for (const line of sorted) {
    const list = groups.get(line.dueDate) ?? [];
    list.push(line);
    groups.set(line.dueDate, list);
  }
  return [...groups.entries()].map(([date, entryLines]) => ({ date, lines: entryLines }));
}
