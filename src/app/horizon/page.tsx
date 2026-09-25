import { redirect } from 'next/navigation';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { addDaysLocal } from '@/lib/records/dates';
import { HorizonLookAheadForm } from '@/components/horizon-look-ahead-form';
import { resolveHorizonThrough } from '@/lib/records/horizon-default';
import {
  ensureScheduleState,
  getHorizonProjectionView,
  landPenceOf,
  nextScheduledIncomeDate,
} from '@/lib/records/money-view';
import { listPots } from '@/lib/records/pots';
import { toLocalDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** The furthest the household can look ahead (a planning figure, not a promise). */
const HORIZON_MAX_DAYS = 400;
/** The default window when no scheduled income is ahead (five weeks). */
const HORIZON_FALLBACK_DAYS = 35;

interface SearchParams {
  through?: string;
  pots?: string | string[];
  daytoday?: string;
}

/**
 * Horizon (SPEC §7.6, v0.5.0): how far the money would go if it only paid
 * what is already expected. The same pure projection engine as the payday
 * panel, given the chosen date as its window's end — so "where we'd land"
 * is `available now + expected money in − commitments − day-to-day`, not a
 * second engine with its own arithmetic. Debt expected inflows join the
 * window flagged `expected`: borrowed money is expected here, never
 * received, and never income. Day-to-day spending joins as dated events
 * (v0.6.0 anchor-reset, SPEC §7.3): weekly shops and per-vehicle fills
 * projected from when the household last recorded them, so the lowest
 * point's date stays meaningful with day-to-day included.
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

  // The chosen date (decision 150): a valid `?through=` inside the window is
  // used as given; otherwise the day before the next scheduled income (the
  // salary — a debt's expected support never counts), clamped into the
  // window; with no scheduled income at all, five weeks ahead. Never trusted
  // from the client.
  const { date: throughDate } = resolveHorizonThrough({
    today,
    requested: typeof params.through === 'string' ? params.through : null,
    nextIncomeDate: nextScheduledIncomeDate(db, today),
    minDate: minSelectable,
    maxDate: maxSelectable,
    fallbackDays: HORIZON_FALLBACK_DAYS,
  });

  // Selected pots: empty or "all" opts into every pot; otherwise ids.
  // HTML checkboxes submit repeated `pots=…` params, which Next.js surfaces
  // as a string array (a single value arrives as a bare string), so both
  // shapes are normalised to one comma list before parsing. Unknown ids are
  // dropped by the read model (it maps to live pots only).
  const potSelectionRaw = Array.isArray(params.pots) ? params.pots.join(',') : (params.pots ?? '');
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
      ? 'border-danger-200 bg-danger-50 text-danger-800'
      : tier === 'heads-up'
        ? 'border-warning-200 bg-warning-50 text-warning'
        : 'border-positive-200 bg-positive-50 text-positive-800';

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
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Horizon</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">How far the money would go</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          A projection of what would be left if the household only paid what is already expected —
          commitments, expected money in, and day-to-day spending — up to a date you choose.
        </p>
      </header>

      <section
        aria-label="Choose the horizon"
        className="mb-6 rounded-xl border border-border bg-surface p-4 shadow-sm"
      >
        <HorizonLookAheadForm
          minDate={minSelectable}
          maxDate={maxSelectable}
          throughDate={throughDate}
        >
          <fieldset>
            <legend className="text-xs font-medium text-ink-soft">
              Which pots count?{' '}
              <span className="text-xs font-normal text-ink-faint">— untick to exclude</span>
            </legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
              {pots.map((pot) => {
                const selected =
                  view.selection.find((entry) => entry.pot.id === pot.id)?.selected ?? true;
                return (
                  <label key={pot.id} className="flex items-center gap-1.5 text-sm text-ink-body">
                    <input
                      type="checkbox"
                      name="pots"
                      value={pot.id}
                      defaultChecked={selected}
                      className="h-4 w-4 rounded border-border-strong"
                    />
                    {pot.label}
                  </label>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {allSelected
                ? 'Every pot is counted. A debt’s expected support counts only when the pot it lands in is ticked.'
                : 'Only ticked pots are counted. A debt’s expected support counts only when the pot it lands in is ticked.'}{' '}
              Unticking every pot counts every pot.
            </p>
          </fieldset>
          <div className="flex flex-col gap-1 self-start">
            <label htmlFor="horizon-daytoday" className="text-xs font-medium text-ink-soft">
              Day-to-day
            </label>
            <select
              id="horizon-daytoday"
              name="daytoday"
              defaultValue={includeDayToDay ? '1' : '0'}
              className="rounded border border-border-strong bg-surface px-2.5 py-1.5 text-sm focus:border-border-emphasis focus:outline-none"
            >
              <option value="1">Include groceries &amp; fuel</option>
              <option value="0">Bills only (leave out day-to-day)</option>
            </select>
          </div>
        </HorizonLookAheadForm>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
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
          <p className="mt-1 text-sm text-ink-soft">
            Where we&rsquo;d land on {view.throughDate} — after commitments and expected money in,
            {view.dayToDayIncluded ? ' and day-to-day spending.' : ' without day-to-day spending.'}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Lowest point</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {result.projectedLowPence === null ? '—' : formatPence(result.projectedLowPence)}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {result.lowDate === null ? 'No window to project.' : `on ${result.lowDate}`}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Scope</p>
          <p className="mt-1 text-sm text-ink-body">
            {result.days} day{result.days === 1 ? '' : 's'} ahead · {selectionText}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            Available now {formatPence(view.availableNowPence)} · commitments −
            {formatPence(view.totalCommitmentsPence)} · expected money in +
            {formatPence(view.totalReceiptsPence)}
            {view.dayToDayIncluded && result.dayToDayPence > 0
              ? ` · day-to-day −${formatPence(result.dayToDayPence)}`
              : ''}
          </p>
        </div>
      </section>

      <p className={`mb-4 rounded-lg border px-3 py-2 text-sm font-medium ${tierStyles}`}>
        {lowLine} {tierLine}
      </p>

      {result.days <= 0 ? (
        <section className="mb-4 rounded-xl border border-dashed border-border-strong bg-surface p-6 text-sm text-ink-soft">
          Pick a date at least one day ahead to project the household&rsquo;s money to it.
        </section>
      ) : null}

      <div className="space-y-4">
        <details
          open={detailsOpen}
          className="rounded-xl border border-border bg-surface p-4 shadow-sm"
        >
          <summary className="cursor-pointer text-sm font-medium text-ink-body">
            Commitments in the window ({view.commitmentLines.length})
          </summary>
          {view.commitmentLines.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No commitments due in this window.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border-hairline">
              {commitmentGroups.map((group) =>
                group.lines.map((line) => (
                  <li
                    key={`${line.dueDate}-commitment-${line.name}`}
                    className="flex items-baseline justify-between gap-2 py-1.5 text-sm"
                  >
                    <span>
                      <span className="font-medium">{line.name}</span>{' '}
                      <span className="text-xs text-ink-muted">
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
          className="rounded-xl border border-border bg-surface p-4 shadow-sm"
        >
          <summary className="cursor-pointer text-sm font-medium text-ink-body">
            Expected money in ({incomeLineCount}
            {expectedLineCount > 0 ? ` income + ${expectedLineCount} expected support` : ''})
          </summary>
          {view.receiptLines.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No expected money in this window.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border-hairline">
              {receiptGroups.map((group) =>
                group.lines.map((line) => (
                  <li
                    key={`${line.dueDate}-receipt-${line.name}-${line.expected ? 'expected' : 'income'}`}
                    className="flex items-baseline justify-between gap-2 py-1.5 text-sm"
                  >
                    <span>
                      <span className="font-medium">{line.name}</span>{' '}
                      <span
                        className={`text-xs ${line.expected ? 'text-ink-faint' : 'text-ink-muted'}`}
                      >
                        {line.dueDate} · {line.subtitle}
                      </span>
                    </span>
                    <span
                      className={`tabular-nums ${line.expected ? 'text-ink-muted' : 'text-positive'}`}
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

        {view.dayToDayIncluded ? (
          <details
            open={detailsOpen && view.dayToDayEvents.length > 0}
            className="rounded-xl border border-border bg-surface p-4 shadow-sm"
          >
            <summary className="cursor-pointer text-sm font-medium text-ink-body">
              Projected day-to-day spending ({view.dayToDayEvents.length})
            </summary>
            {view.dayToDayEvents.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">
                No projection figures are configured — set weekly groceries and per-vehicle fuel in
                Settings to include them here.
              </p>
            ) : (
              <>
                <ul className="mt-2 divide-y divide-border-hairline">
                  {view.dayToDayEvents.map((event) => (
                    <li
                      key={`${event.dueDate}-daytoday-${event.name}`}
                      className="flex items-baseline justify-between gap-2 py-1.5 text-sm"
                    >
                      <span>
                        <span className="font-medium">{event.name}</span>{' '}
                        <span className="text-xs text-ink-muted">{event.dueDate}</span>
                      </span>
                      <span className="tabular-nums">−{formatPence(event.amountPence)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-muted">
                  Dates follow when the household last recorded a weekly shop or a fill — a fresh
                  shop resets the week, a fresh fill resets that vehicle’s month. Amounts are the
                  figures set in Settings; fuels are counted per vehicle.
                </p>
              </>
            )}
          </details>
        ) : null}

        {result.perDay.length > 0 ? (
          <details
            open={detailsOpen}
            className="rounded-xl border border-border bg-surface p-4 shadow-sm"
          >
            <summary className="cursor-pointer text-sm font-medium text-ink-body">
              Day by day ({result.perDay.length} days)
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-3 py-1.5">Date</th>
                    <th className="px-3 py-1.5 text-right">Commitments</th>
                    {view.dayToDayIncluded ? (
                      <th className="px-3 py-1.5 text-right">Day-to-day</th>
                    ) : null}
                    <th className="px-3 py-1.5 text-right">Expected money in</th>
                    <th className="px-3 py-1.5 text-right">End of day</th>
                  </tr>
                </thead>
                <tbody>
                  {result.perDay.map((day) => (
                    <tr key={day.date} className="border-t border-border-hairline">
                      <td className="px-3 py-1.5">{day.date}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {day.commitmentsPence > 0 ? `−${formatPence(day.commitmentsPence)}` : '—'}
                      </td>
                      {view.dayToDayIncluded ? (
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {day.dayToDayPence > 0 ? `−${formatPence(day.dayToDayPence)}` : '—'}
                        </td>
                      ) : null}
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {day.receiptsPence > 0 ? `+${formatPence(day.receiptsPence)}` : '—'}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right font-medium tabular-nums ${day.runningPence < 0 ? 'text-danger' : ''}`}
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

      <p className="mt-6 text-xs text-ink-muted">
        A projection of the records already in the app, not a bank forecast. Expected support is an
        expectation of borrowed money — it is owed, never income, and it lands only if it is
        actually borrowed and recorded. Day-to-day projects the next shops and fills from when the
        household last recorded them, at the figures configured in Settings.
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
