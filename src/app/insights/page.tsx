import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import {
  getHonestyLoopView,
  getMonthComparisonView,
  getPersonalMonthView,
  getVehicleCostsView,
} from '@/lib/records/insights-view';
import { addDaysLocal } from '@/lib/records/dates';
import { getFuelEconomyView, type VehicleFuelEconomyView } from '@/lib/records/fuel';
import { describeClosure, formatLitres, formatMiles, formatMpg } from '@/lib/records/fuel-economy';
import { toLocalDateString } from '@/lib/time';

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

/**
 * Insights v1 (SPEC §16): the four panels. Every figure comes from the pure
 * insights engine via the DB assembly layer — the UI only formats and lays
 * out, so the numbers here reconcile with the tested engines by construction.
 */
export default async function InsightsPage({
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

  const thisMonth = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const comparison = getMonthComparisonView(db, now);
  const personal = getPersonalMonthView(db, parseMonthParam(params.month, thisMonth), now);
  const vehicles = getVehicleCostsView(db, now);
  const loop = getHonestyLoopView(db, now);
  const economy = getFuelEconomyView(db, now);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Insights</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Where the money actually went
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Recorded spending only — transfers never appear here (they move money between your own
          pots), and income is not spending. Figures reconcile with the purchase history exactly.
        </p>
      </header>

      <div className="space-y-6">
        <section
          aria-labelledby="panel-month-heading"
          className="rounded-xl border border-border bg-surface p-4 shadow-sm"
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="panel-month-heading" className="text-xl font-semibold">
              {comparison.current.label}
              {comparison.currentInProgress ? ' (in progress)' : ''} vs {comparison.previous.label}
            </h2>
            <span className="text-xs text-ink-muted">
              {comparison.previous.summary.from} → {comparison.current.summary.to}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-canvas px-4 py-3">
              <p className="text-xs text-ink-muted">{comparison.current.label}</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatPence(comparison.current.summary.totalPence)}
              </p>
            </div>
            <div className="rounded-lg bg-canvas px-4 py-3">
              <p className="text-xs text-ink-muted">{comparison.previous.label} (complete)</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatPence(comparison.previous.summary.totalPence)}
              </p>
            </div>
          </div>
          {comparison.byParent.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="py-1.5 pr-4">Category</th>
                    <th className="py-1.5 pr-4 text-right">{comparison.current.label}</th>
                    <th className="py-1.5 pr-4 text-right">{comparison.previous.label}</th>
                    <th className="py-1.5 text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.byParent.map((row) => (
                    <tr key={row.parent} className="border-t border-border-hairline">
                      <td className="py-1.5 pr-4 font-medium">{row.parent}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {formatPence(row.currentPence)}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {formatPence(row.previousPence)}
                      </td>
                      <td
                        className={`py-1.5 text-right font-medium tabular-nums ${
                          row.deltaPence > 0
                            ? 'text-danger'
                            : row.deltaPence < 0
                              ? 'text-positive'
                              : 'text-ink-muted'
                        }`}
                      >
                        {row.deltaPence === 0
                          ? '±0'
                          : `${row.deltaPence > 0 ? '+' : '−'}${formatPence(Math.abs(row.deltaPence))}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">No spending recorded in either month yet.</p>
          )}
        </section>

        <section
          aria-labelledby="panel-persons-heading"
          className="rounded-xl border border-border bg-surface p-4 shadow-sm"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="panel-persons-heading" className="text-xl font-semibold">
              By person — {personal.label}
            </h2>
            <div className="flex items-center gap-1">
              <Link
                href={`/insights?month=${monthParam(shiftMonth(personal.month, -1))}`}
                className="rounded border border-border-strong px-2.5 py-1 text-sm font-medium text-ink-body hover:bg-canvas"
              >
                ← Prev
              </Link>
              <Link
                href={`/insights?month=${monthParam(shiftMonth(personal.month, 1))}`}
                className="rounded border border-border-strong px-2.5 py-1 text-sm font-medium text-ink-body hover:bg-canvas"
              >
                Next →
              </Link>
            </div>
          </div>
          <p className="mb-3 text-xs text-ink-muted">
            Only lines explicitly marked “for {personal.people.length > 1 ? 'a person' : 'someone'}”
            are attributed. Household spending is never attributed to whoever happened to pay.
          </p>
          {personal.people.length === 0 ? (
            <p className="text-sm text-ink-muted">No people in the household yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {personal.people.map((person) => (
                <div key={person.personId} className="rounded-lg bg-canvas p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold">{person.person}</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatPence(person.totalPence)}
                    </p>
                  </div>
                  {person.byParent.length === 0 ? (
                    <p className="mt-1 text-xs text-ink-muted">
                      Nothing marked for {person.person} this month.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-sm">
                      {person.byParent.map((row) => (
                        <li key={row.parent} className="flex items-baseline justify-between gap-2">
                          <span className="text-ink-soft">
                            {row.parent}
                            {row.children.length > 0
                              ? ` (${row.children.map((child) => child.child).join(', ')})`
                              : ''}
                          </span>
                          <span className="tabular-nums">{formatPence(row.amountPence)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          aria-labelledby="panel-vehicles-heading"
          className="rounded-xl border border-border bg-surface p-4 shadow-sm"
        >
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="panel-vehicles-heading" className="text-xl font-semibold">
              Vehicle running costs
            </h2>
            <span className="text-xs text-ink-muted">
              fuel, insurance, maintenance, road tax, parking
            </span>
          </div>
          {vehicles.length === 0 ? (
            <p className="text-sm text-ink-muted">No vehicles in the household yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {vehicles.map((vehicle) => (
                <div key={vehicle.vehicleId} className="rounded-lg bg-canvas p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold">{vehicle.label}</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatPence(vehicle.rolling12Pence)}
                      <span className="ml-1 text-xs font-normal text-ink-muted">
                        last 12 months
                      </span>
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    this month {formatPence(vehicle.monthPence)} (in progress) · previous month{' '}
                    {formatPence(vehicle.previousMonthPence)} · window since {vehicle.rolling12From}
                  </p>
                  {vehicle.byChild.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm">
                      {vehicle.byChild.map((row) => (
                        <li
                          key={`${row.parent}-${row.child}`}
                          className="flex items-baseline justify-between gap-2"
                        >
                          <span className="text-ink-soft">{row.child}</span>
                          <span className="tabular-nums">{formatPence(row.amountPence)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          aria-labelledby="panel-mpg-heading"
          className="rounded-xl border border-border bg-surface p-4 shadow-sm"
        >
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="panel-mpg-heading" className="text-xl font-semibold">
              Fuel economy
            </h2>
            <span className="text-xs text-ink-muted">
              miles per UK gallon, measured full tank to full tank
            </span>
          </div>
          <p className="mb-3 max-w-3xl text-xs text-ink-muted">
            Record the litres and the odometer reading with a fill — at the pump or later on
            Purchases. A stretch is measured once both of its full tanks have a mileage and every
            fill in between has its litres; part fills just add their litres.
          </p>
          {economy.length === 0 ? (
            <p className="text-sm text-ink-muted">No vehicles in the household yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {economy.map((vehicle) => (
                <FuelEconomyCard key={vehicle.vehicleId} vehicle={vehicle} />
              ))}
            </div>
          )}
        </section>

        <section
          aria-labelledby="panel-honesty-heading"
          className="rounded-xl border border-border bg-surface p-4 shadow-sm"
        >
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="panel-honesty-heading" className="text-xl font-semibold">
              Are your configured figures honest?
            </h2>
            <Link href="/settings" className="text-sm font-medium text-accent hover:underline">
              Adjust in Settings →
            </Link>
          </div>
          <p className="mb-4 text-xs text-ink-muted">
            Complete weeks and months only — the in-progress period never skews the average. If the
            configured figure is far from what actually happens, the projection will be too.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <h3 className="text-sm font-semibold">Groceries — {loop.groceries.parent}</h3>
              <p className="text-xs text-ink-muted">
                last {loop.groceries.weeks.length} complete weeks (Mon–Sun)
              </p>
              <HonestyComparison
                configuredLabel="weekly"
                configuredPence={loop.groceries.configuredPence}
                averagePence={loop.groceries.averageWeeklyPence}
                driftPence={loop.groceries.driftPence}
              />
              <ul className="mt-3 space-y-1">
                {loop.groceries.weeks.map((week) => (
                  <li
                    key={week.weekStart}
                    className="flex items-baseline justify-between gap-2 text-xs"
                  >
                    <span className="text-ink-soft">week of {week.weekStart}</span>
                    <span className="tabular-nums">{formatPence(week.actualPence)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border p-3">
              <h3 className="text-sm font-semibold">Fuel</h3>
              <p className="text-xs text-ink-muted">
                last {loop.fuel[0]?.months.length ?? 3} complete months, per vehicle
              </p>
              <div className="mt-3 space-y-4">
                {loop.fuel.map((vehicle) => (
                  <div key={vehicle.vehicleId}>
                    <p className="text-sm font-medium">{vehicle.label}</p>
                    <HonestyComparison
                      configuredLabel="monthly"
                      configuredPence={vehicle.configuredPence}
                      averagePence={vehicle.averageMonthlyPence}
                      driftPence={vehicle.driftPence}
                    />
                    <ul className="mt-2 space-y-1">
                      {vehicle.months.map((month) => (
                        <li
                          key={month.month}
                          className="flex items-baseline justify-between gap-2 text-xs"
                        >
                          <span className="text-ink-soft">{month.month}</span>
                          <span className="tabular-nums">{formatPence(month.actualPence)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {loop.fuel.length === 0 ? (
                  <p className="text-sm text-ink-muted">No vehicles to compare yet.</p>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function HonestyComparison({
  configuredLabel,
  configuredPence,
  averagePence,
  driftPence,
}: {
  configuredLabel: string;
  configuredPence: number | null;
  averagePence: number;
  driftPence: number | null;
}) {
  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded bg-surface px-3 py-2 ring-1 ring-border">
          <p className="text-xs text-ink-muted">Configured {configuredLabel}</p>
          <p className="font-semibold tabular-nums">
            {configuredPence === null ? 'not set' : formatPence(configuredPence)}
          </p>
        </div>
        <div className="rounded bg-surface px-3 py-2 ring-1 ring-border">
          <p className="text-xs text-ink-muted">Actual average {configuredLabel}</p>
          <p className="font-semibold tabular-nums">{formatPence(averagePence)}</p>
        </div>
      </div>
      {driftPence === null ? (
        <p className="mt-2 text-xs text-ink-muted">
          Set the configured figure in Settings to see the drift.
        </p>
      ) : (
        <p
          className={`mt-2 rounded px-3 py-2 text-sm font-medium ${
            driftPence > 0
              ? 'bg-warning-50 text-warning-900 ring-1 ring-warning-200'
              : 'bg-positive-50 text-positive-900 ring-1 ring-positive-200'
          }`}
        >
          {driftPence === 0
            ? 'Your configured figure matches recent actuals exactly.'
            : driftPence > 0
              ? `You are spending about ${formatPence(driftPence)} more per ${configuredLabel} than the ${formatPence(
                  configuredPence ?? 0,
                )} you configured. Consider raising the figure — or cutting back.`
              : `You are spending about ${formatPence(Math.abs(driftPence))} less per ${configuredLabel} than the ${formatPence(
                  configuredPence ?? 0,
                )} you configured. The projection is being pessimistic.`}
        </p>
      )}
    </div>
  );
}

/** One vehicle's mpg card (SPEC §16.6, v0.10.0 — decision 140). */
function FuelEconomyCard({ vehicle }: { vehicle: VehicleFuelEconomyView }) {
  return (
    <div
      className="rounded-lg bg-canvas p-3"
      role="group"
      aria-label={`Fuel economy for ${vehicle.label}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{vehicle.label}</p>
        {vehicle.latest !== null ? (
          <p className="text-lg font-semibold tabular-nums">
            {formatMpg(vehicle.latest.mpg)}
            <span className="ml-1 text-xs font-normal text-ink-muted">latest</span>
          </p>
        ) : (
          <p className="text-xs text-ink-muted">no measured stretch yet</p>
        )}
      </div>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-ink-soft">
        <dt>Last 12 months</dt>
        <dd className="text-right tabular-nums">
          {vehicle.lastYear === null
            ? '—'
            : `${formatMpg(vehicle.lastYear.mpg)} over ${formatMiles(vehicle.lastYear.miles)} miles`}
        </dd>
        <dt>Fuel cost per mile</dt>
        <dd className="text-right tabular-nums">
          {vehicle.lastYear === null ? '—' : `${vehicle.lastYear.pencePerMile.toFixed(1)}p`}
        </dd>
        <dt>Latest price</dt>
        <dd className="text-right tabular-nums">
          {vehicle.latestPrice === null
            ? '—'
            : `${vehicle.latestPrice.pencePerLitre.toFixed(1)}p/L (${vehicle.latestPrice.occurredDate})`}
        </dd>
      </dl>
      {vehicle.latest?.suspect ? (
        <p className="mt-1 text-xs font-semibold text-warning">
          The latest figure looks unusual — worth checking the readings.
        </p>
      ) : null}
      {vehicle.fillsWithoutFullTank !== null ? (
        <p className="mt-2 rounded-md bg-warning-50 p-2 text-xs font-semibold text-warning-900">
          No full tank marked in the last {vehicle.fillsWithoutFullTank} fills — mpg needs one. Tick
          “Filled to full” next time the pump clicks off (or fix a past fill from Purchases).
        </p>
      ) : null}
      {vehicle.missing.length > 0 ? (
        <div className="mt-2 rounded-md bg-warning-50 p-2 text-xs text-warning-900">
          <p className="font-semibold">
            {vehicle.missing.length === 1
              ? '1 recent fill is missing details'
              : `${vehicle.missing.length} recent fills are missing details`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {vehicle.missing.slice(0, 5).map((entry) => (
              <li key={entry.purchaseId}>
                <Link href={`/purchases#purchase-${entry.purchaseId}`} className="underline">
                  {entry.occurredDate} · {formatPence(entry.fuelPence)}
                </Link>{' '}
                — add {entry.missing.join(' & ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {vehicle.recent.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-ink-soft">
            Recent fills ({vehicle.recent.length} of {vehicle.fillCount})
          </summary>
          <ul className="mt-1 space-y-1 text-xs">
            {vehicle.recent.map(({ fill, closed, pencePerLitre }) => (
              <li key={fill.purchaseId} className="text-ink-soft">
                <span className="tabular-nums">
                  {fill.occurredDate} · {formatPence(fill.fuelPence)}
                  {fill.fuelMillilitres !== null
                    ? ` · ${formatLitres(fill.fuelMillilitres)} L`
                    : ''}
                  {pencePerLitre !== null ? ` · ${pencePerLitre.toFixed(1)}p/L` : ''}
                  {fill.odometerMiles !== null ? ` · ${formatMiles(fill.odometerMiles)} mi` : ''}
                  {fill.fullTank ? '' : ' · part fill'}
                </span>
                {closed !== null ? (
                  <span className="block text-ink-muted">{describeClosure(closed)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="mt-2 text-xs text-ink-muted">No fuel recorded for this vehicle yet.</p>
      )}
    </div>
  );
}
