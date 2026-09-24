import { formatPence } from '@/lib/money';
import type { ProjectionView } from '@/lib/records/money-view';

/**
 * Shared projection panel (home + overview, decision 74): the tier banner,
 * the “what's in this forecast” breakdown, the day-by-day table, and the
 * “plan a transfer?” pot watch lines. All figures come from the pure
 * projection engine — nothing here recomputes anything.
 */
export function ProjectionSection({ projection }: { projection: ProjectionView }) {
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

      {projection.dayToDayEvents.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Projected shops and fills ({projection.dayToDayEvents.length})
          </summary>
          <ul className="mt-2 divide-y divide-slate-100">
            {projection.dayToDayEvents.map((event) => (
              <li
                key={`${event.dueDate}-${event.name}`}
                className="flex items-baseline justify-between gap-2 py-1.5 text-sm"
              >
                <span>
                  <span className="font-medium">{event.name}</span>{' '}
                  <span className="text-xs text-slate-500">{event.dueDate}</span>
                </span>
                <span className="tabular-nums">−{formatPence(event.amountPence)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Dates follow when the household last recorded a weekly shop or a fill — a fresh shop
            resets the week, a fresh fill resets the vehicle’s month. Amounts are the figures set in
            Settings.
          </p>
        </details>
      ) : null}

      {result.perDay.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            What’s in this forecast — day-by-day ({result.perDay.length} days)
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-1.5">Date</th>
                  <th className="px-3 py-1.5 text-right">Commitments</th>
                  {result.dayToDayPence > 0 ? (
                    <th className="px-3 py-1.5 text-right">Day-to-day</th>
                  ) : null}
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
                    {result.dayToDayPence > 0 ? (
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {day.dayToDayPence > 0 ? `−${formatPence(day.dayToDayPence)}` : '—'}
                      </td>
                    ) : null}
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
