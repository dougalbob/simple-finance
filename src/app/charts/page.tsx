import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  BarChart,
  CHART_COLOURS,
  ChartFigure,
  ChartLegend,
  StackedBarChart,
  StepAreaChart,
  chartDomain,
  type BarDatum,
  type ChartTableRow,
  type StackedGroup,
} from '@/components/charts';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import {
  getCommitmentChartView,
  getForecastChartView,
  getGroceriesChartView,
  getPersonalChartView,
  type CommitmentChartView,
  type ForecastChartView,
  type GroceriesChartView,
  type PersonalChartView,
} from '@/lib/records/charts-view';
import {
  purchasesHref,
  type GroceriesSeries,
  type PersonalSeries,
  type WeekBucket,
} from '@/lib/records/chart-series';
import { formatShortLocalDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Charts (SPEC §16.7, v0.14.0) — the visual layer over the same numbers
 * `/insights` prints. Four charts, one under another on a phone, a
 * two-column grid on a laptop with the forecast across the top.
 *
 * Every chart on this page is server-rendered SVG with no client
 * JavaScript, so it is on the screen in the first paint; every chart states
 * whether its figures are reported or projected; and every chart ships with
 * a table twin holding the exact numbers. The filter chips and the
 * schedule-converted toggle are plain links, so they work with JavaScript
 * switched off and can be sent to the other person.
 */

interface SearchParams {
  who?: string;
  scheduleOnly?: string;
}

const PHONE_WIDTH = 320;
const LAPTOP_WIDTH = 720;

export default async function ChartsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const now = new Date();
  const params = await searchParams;
  const scheduleOnly = params.scheduleOnly === '1';

  const forecast = getForecastChartView(db, now);
  const groceries = getGroceriesChartView(db, {}, now);
  const everyone = getPersonalChartView(db, {}, now);
  const include = parseWho(params.who, everyone);
  const personal = include === null ? everyone : getPersonalChartView(db, { include }, now);
  const commitments = getCommitmentChartView(db, { scheduleOnly }, now);

  return (
    <main className="mx-auto max-w-7xl overflow-x-clip px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Charts</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">The money, drawn</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Four questions: where the balance goes next month, whether the shopping is creeping up,
          whose discretionary spending is moving, and whether the fixed bills are coming down. Every
          chart carries its numbers underneath —{' '}
          <Link href="/insights" className="font-medium text-sky-700 hover:underline">
            Insights
          </Link>{' '}
          holds the same figures as tables, and the two always agree.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ForecastSection view={forecast} />
        <GroceriesSection view={groceries} />
        <PersonalSection view={personal} everyone={everyone} selected={include} params={params} />
        <CommitmentsSection view={commitments} params={params} />
      </div>

      <p className="mt-6 text-xs text-slate-500">
        Clicking a bar opens the purchases behind it. Those filters match the <em>purchase</em>, and
        a matched purchase comes back with all of its lines, receipt-style — so a split shop appears
        whole, not as the single line that matched.
      </p>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* A. Forecast                                                         */
/* ------------------------------------------------------------------ */

function ForecastSection({ view }: { view: ForecastChartView }) {
  const { series } = view;
  const points = series.days.map((day) => ({
    date: day.date,
    valuePence: day.runningPence,
    reported: day.reported,
    income: day.receiptsPence > 0,
  }));
  const domain = chartDomain(
    points.map((point) => point.valuePence),
    { targetTicks: 4 },
  );
  const lowIndex = series.days.findIndex((day) => day.date === series.lowDate);
  // The overdraft line is only drawn when the chart reaches that far down.
  // A legend entry for a line nobody can see is the kind of small lie this
  // app does not tell — when it is off the chart, the caption says so
  // instead, which is also the better news.
  const overdraftDrawn =
    series.overdraftLimitPence !== null && domain.min <= -series.overdraftLimitPence;
  const references = [
    ...(overdraftDrawn && series.overdraftLimitPence !== null
      ? [
          {
            valuePence: -series.overdraftLimitPence,
            label: 'overdraft limit',
            colour: CHART_COLOURS.danger,
          },
        ]
      : []),
    ...(series.warningThresholdPence === null
      ? []
      : [{ valuePence: series.warningThresholdPence, label: 'warning level' }]),
  ];

  const rows: ChartTableRow[] = series.days.map((day) => ({
    key: day.date,
    cells: [
      formatShortLocalDate(day.date),
      day.receiptsPence === 0 ? '—' : formatPence(day.receiptsPence),
      day.commitmentsPence + day.dayToDayPence === 0
        ? '—'
        : formatPence(day.commitmentsPence + day.dayToDayPence),
      formatPence(day.runningPence),
    ],
  }));
  const columns = [
    { key: 'date', label: 'Day' },
    { key: 'in', label: 'In', align: 'right' as const },
    { key: 'out', label: 'Out', align: 'right' as const },
    { key: 'balance', label: 'Balance', align: 'right' as const },
  ];
  const caption = `Today's ${formatPence(series.startPence)} is your own reported figure plus recorded activity; every later day is projected from schedules and the day-to-day model. Not a bank feed.${
    series.overdraftLimitPence !== null && !overdraftDrawn
      ? ` The ${formatPence(series.overdraftLimitPence)} of overdraft room is off the bottom of this chart — nothing next month goes near it.`
      : ''
  }`;

  if (view.unavailable && series.days.length <= 1) {
    return (
      <ChartCard
        id="forecast"
        eyebrow="A · Forecast"
        title="Where the balance goes, today to a month ahead"
        className="lg:col-span-2"
      >
        <p className="text-sm text-slate-600">
          The forecast needs at least one balance checkpoint. Record one on the till and it appears
          here.
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      id="forecast"
      eyebrow="A · Forecast"
      title="Where the balance goes, today to a month ahead"
      className="lg:col-span-2"
    >
      <div className="lg:hidden">
        <ChartFigure
          chart="forecast"
          variant="phone"
          headline={series.headline}
          basis="Reported + projected"
          caption={caption}
          columns={columns}
          rows={rows}
          footer={<DipList view={view} />}
        >
          <StepAreaChart
            points={points}
            domain={domain}
            width={PHONE_WIDTH}
            height={220}
            ariaLabel={`Projected household balance to ${formatShortLocalDate(series.throughDate)}. ${series.headline}`}
            xTicks={weeklyTicks(points.map((point) => point.date))}
            lowIndex={lowIndex < 0 ? null : lowIndex}
            lowLabel={`${formatPence(series.lowPence)} · ${shortDayMonth(series.lowDate)}`}
            referenceLines={references}
          />
        </ChartFigure>
      </div>
      <div className="hidden lg:block">
        <ChartFigure
          chart="forecast"
          variant="laptop"
          headline={series.headline}
          basis="Reported + projected"
          caption={caption}
          columns={columns}
          rows={rows}
          footer={
            <>
              <ChartLegend
                items={[
                  { key: 'balance', label: 'Projected balance', fill: CHART_COLOURS.line },
                  { key: 'income', label: 'Money expected in', fill: CHART_COLOURS.average },
                  ...(overdraftDrawn && series.overdraftLimitPence !== null
                    ? [
                        {
                          key: 'overdraft',
                          label: view.overdraftLabel ?? 'Overdraft limit',
                          fill: CHART_COLOURS.danger,
                          note: `(${formatPence(series.overdraftLimitPence)})`,
                        },
                      ]
                    : []),
                ]}
              />
              <DayDetails view={view} />
            </>
          }
        >
          <StepAreaChart
            points={points}
            domain={domain}
            width={LAPTOP_WIDTH}
            height={300}
            ariaLabel={`Projected household balance to ${formatShortLocalDate(series.throughDate)}. ${series.headline}`}
            xTicks={weeklyTicks(points.map((point) => point.date))}
            lowIndex={lowIndex < 0 ? null : lowIndex}
            lowLabel={`${formatPence(series.lowPence)} · ${shortDayMonth(series.lowDate)}`}
            referenceLines={references}
          />
        </ChartFigure>
      </div>
    </ChartCard>
  );
}

function DipList({ view }: { view: ForecastChartView }) {
  if (view.series.dips.length === 0) {
    return <p className="text-xs text-slate-500">Nothing is due in the next month.</p>;
  }
  return (
    <div>
      <p className="text-xs font-semibold text-slate-600">What makes it dip</p>
      <ul className="mt-0.5 space-y-0.5 text-xs text-slate-600">
        {view.series.dips.map((dip) => (
          <li key={dip.date} className="flex justify-between gap-2">
            <span>{formatShortLocalDate(dip.date)}</span>
            <span className="tabular-nums">{formatPence(dip.amountPence)} out</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DayDetails({ view }: { view: ForecastChartView }) {
  if (view.details.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-slate-600">
        What lands on each day ({view.details.length} days)
      </summary>
      <ul className="mt-2 space-y-2 text-xs">
        {view.details.map((detail) => (
          <li key={detail.date}>
            <p className="font-medium text-slate-700">{formatShortLocalDate(detail.date)}</p>
            <ul className="mt-0.5 space-y-0.5 text-slate-600">
              {detail.commitments.map((line) => (
                <li key={`c-${line.name}`} className="flex justify-between gap-3">
                  <span>
                    {line.name} <span className="text-slate-400">· {line.potLabel}</span>
                  </span>
                  <span className="tabular-nums">−{formatPence(line.amountPence)}</span>
                </li>
              ))}
              {detail.dayToDay.map((line) => (
                <li key={`d-${line.name}`} className="flex justify-between gap-3">
                  <span>{line.name}</span>
                  <span className="tabular-nums">−{formatPence(line.amountPence)}</span>
                </li>
              ))}
              {detail.receipts.map((line) => (
                <li key={`r-${line.name}`} className="flex justify-between gap-3 text-emerald-800">
                  <span>
                    {line.name}
                    {line.expected ? ' (expected)' : ''}{' '}
                    <span className="text-slate-400">· {line.potLabel}</span>
                  </span>
                  <span className="tabular-nums">+{formatPence(line.amountPence)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* B. Groceries                                                        */
/* ------------------------------------------------------------------ */

function GroceriesSection({ view }: { view: GroceriesChartView }) {
  const caption =
    'Recorded grocery lines only, bucketed Monday to Sunday. A week with no shop is a zero week, not a missing one — the average would flatter you otherwise. The current week is still being lived and never counts towards the average.';
  return (
    <ChartCard id="groceries" eyebrow="B · Groceries" title="Is the weekly shop creeping up?">
      <div className="lg:hidden">
        {renderGroceries(view, view.phone, 'phone', PHONE_WIDTH, 200, caption, 3)}
      </div>
      <div className="hidden lg:block">
        {renderGroceries(view, view.laptop, 'laptop', LAPTOP_WIDTH, 260, caption, 4)}
      </div>
    </ChartCard>
  );
}

function renderGroceries(
  view: GroceriesChartView,
  series: GroceriesSeries,
  variant: 'phone' | 'laptop',
  width: number,
  height: number,
  caption: string,
  labelEvery: number,
) {
  const href = (week: WeekBucket): string =>
    purchasesHref({
      from: week.weekStart,
      to: week.weekEnd,
      categoryIds: view.parentCategoryId === null ? undefined : [view.parentCategoryId],
    });
  const bars: BarDatum[] = series.weeks.map((week) => ({
    key: week.weekStart,
    label: shortDayMonth(week.weekStart),
    valuePence: week.amountPence,
    href: href(week),
    hint: `Week of ${formatShortLocalDate(week.weekStart)}: ${formatPence(week.amountPence)}${
      week.complete ? '' : ' so far'
    } — open these purchases`,
    muted: !week.complete,
  }));
  const domain = chartDomain(
    [...bars.map((bar) => bar.valuePence), series.configuredWeeklyPence ?? 0, series.averagePence],
    { targetTicks: 4 },
  );
  const references = [
    ...(series.configuredWeeklyPence === null
      ? []
      : [
          {
            valuePence: series.configuredWeeklyPence,
            label: `configured ${formatPence(series.configuredWeeklyPence)}`,
            colour: CHART_COLOURS.reference,
          },
        ]),
    ...(series.averageWeeks === 0
      ? []
      : [
          {
            valuePence: series.averagePence,
            label: `${series.averageWeeks}-week average`,
            colour: CHART_COLOURS.average,
          },
        ]),
  ];
  return (
    <ChartFigure
      chart="groceries"
      variant={variant}
      headline={series.headline}
      basis="Reported"
      caption={caption}
      columns={[
        { key: 'week', label: 'Week (Mon)' },
        { key: 'spent', label: 'Spent', align: 'right' as const },
      ]}
      rows={series.weeks.map((week) => ({
        key: week.weekStart,
        muted: !week.complete,
        cells: [
          <a key="link" href={href(week)} className="text-sky-700 hover:underline">
            {week.weekStart}
            {week.complete ? '' : ' (so far)'}
          </a>,
          formatPence(week.amountPence),
        ],
      }))}
      totals={['Total', formatPence(series.weeks.reduce((sum, week) => sum + week.amountPence, 0))]}
      footer={
        <ChartLegend
          items={[
            { key: 'week', label: 'Weekly spend', fill: CHART_COLOURS.bar },
            ...(series.configuredWeeklyPence === null
              ? []
              : [
                  {
                    key: 'configured',
                    label: 'Configured weekly figure',
                    fill: CHART_COLOURS.reference,
                    note: `(${formatPence(series.configuredWeeklyPence)})`,
                  },
                ]),
            ...(series.averageWeeks === 0
              ? []
              : [
                  {
                    key: 'average',
                    label: `Trailing ${series.averageWeeks}-week average`,
                    fill: CHART_COLOURS.average,
                    note: `(${formatPence(series.averagePence)})`,
                  },
                ]),
          ]}
        />
      }
    >
      <BarChart
        bars={bars}
        domain={domain}
        width={width}
        height={height}
        ariaLabel={`Grocery spending by week. ${series.headline}`}
        xTicks={everyNth(
          bars.map((bar) => bar.label),
          labelEvery,
        )}
        referenceLines={references}
      />
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ */
/* C. Personal spending                                                */
/* ------------------------------------------------------------------ */

function PersonalSection({
  view,
  everyone,
  selected,
  params,
}: {
  view: PersonalChartView;
  everyone: PersonalChartView;
  selected: string[] | null;
  params: SearchParams;
}) {
  const caption = `Attributed by “For: …”, the way Insights already does it — not by whose card was used. Household-marked spending (a joint takeaway, a shared subscription) is its own bar and is never split between people. Scope: ${view.parentNames.join(' and ')}.`;
  const chips = everyone.laptop.series.map((ref) => ({
    key: ref.key,
    label: ref.label,
    on: selected === null || selected.includes(ref.key),
    href: chipHref(params, ref.key, everyone),
  }));
  const fills = new Map(
    everyone.laptop.series.map((ref, index) => [
      ref.key,
      CHART_COLOURS.series[index % CHART_COLOURS.series.length] as string,
    ]),
  );

  return (
    <ChartCard
      id="personal"
      eyebrow="C · Personal spending"
      title="Hers, his, household"
      action={
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Whose spending to show">
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
              aria-current={chip.on ? 'true' : undefined}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                chip.on
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {chip.on ? '✓ ' : ''}
              {chip.label}
            </Link>
          ))}
        </div>
      }
    >
      {view.laptop.series.length === 0 ? (
        <p className="text-sm text-slate-600">
          Nothing selected. Tap a name above to put a series back on the chart.
        </p>
      ) : (
        <>
          <div className="lg:hidden">
            {renderPersonal(view, view.phone, 'phone', PHONE_WIDTH, 210, caption, fills, 1)}
          </div>
          <div className="hidden lg:block">
            {renderPersonal(view, view.laptop, 'laptop', LAPTOP_WIDTH, 280, caption, fills, 1)}
          </div>
        </>
      )}
    </ChartCard>
  );
}

function renderPersonal(
  view: PersonalChartView,
  series: PersonalSeries,
  variant: 'phone' | 'laptop',
  width: number,
  height: number,
  caption: string,
  fills: Map<string, string>,
  labelEvery: number,
) {
  const hrefFor = (from: string, to: string, key: string): string =>
    purchasesHref({
      from,
      to,
      categoryIds: view.parentCategoryIds,
      ...(key === 'household'
        ? { targetKind: 'household' as const }
        : { targetKind: 'person' as const, targetId: Number(key.split(':')[1]) }),
    });

  const groups: StackedGroup[] = series.months.map((month) => ({
    key: month.from,
    label: monthTick(month.label),
    muted: !month.complete,
    segments: month.cells.map((cell) => ({
      key: cell.key,
      valuePence: cell.amountPence,
      href: hrefFor(month.from, month.to, cell.key),
      hint: `${labelOf(series, cell.key)} · ${month.label}: ${formatPence(cell.amountPence)} — open these purchases`,
    })),
  }));
  const domain = chartDomain(
    groups.map((group) =>
      group.segments.reduce((sum, segment) => sum + Math.max(0, segment.valuePence), 0),
    ),
    { targetTicks: 4 },
  );

  return (
    <ChartFigure
      chart="personal"
      variant={variant}
      headline={series.headline}
      basis="Reported"
      caption={caption}
      columns={[
        { key: 'month', label: 'Month' },
        ...series.series.map((ref) => ({
          key: ref.key,
          label: ref.label,
          align: 'right' as const,
        })),
        { key: 'total', label: 'Total', align: 'right' as const },
      ]}
      rows={series.months.map((month) => ({
        key: month.from,
        muted: !month.complete,
        cells: [
          <span key="month">
            {month.label}
            {month.complete ? '' : ' (so far)'}
          </span>,
          ...month.cells.map((cell) => (
            <a
              key={cell.key}
              href={hrefFor(month.from, month.to, cell.key)}
              className="text-sky-700 hover:underline"
            >
              {formatPence(cell.amountPence)}
            </a>
          )),
          formatPence(month.totalPence),
        ],
      }))}
      totals={[
        'Total',
        ...series.totals.map((total) => formatPence(total.amountPence)),
        formatPence(series.totals.reduce((sum, total) => sum + total.amountPence, 0)),
      ]}
      footer={
        <ChartLegend
          items={series.series.map((ref, index) => ({
            key: ref.key,
            label: ref.label,
            fill: fills.get(ref.key) ?? (CHART_COLOURS.series[index] as string),
            note: `(${formatPence((series.totals[index] as { amountPence: number }).amountPence)})`,
          }))}
        />
      }
    >
      <StackedBarChart
        groups={groups}
        series={series.series.map((ref, index) => ({
          key: ref.key,
          label: ref.label,
          fill: fills.get(ref.key) ?? (CHART_COLOURS.series[index] as string),
        }))}
        domain={domain}
        width={width}
        height={height}
        ariaLabel={`Discretionary spending per month, by person. ${series.headline}`}
        xTicks={everyNth(
          groups.map((group) => group.label),
          labelEvery,
        )}
      />
    </ChartFigure>
  );
}

function labelOf(series: PersonalSeries, key: string): string {
  return series.series.find((ref) => ref.key === key)?.label ?? key;
}

/* ------------------------------------------------------------------ */
/* D. Fixed commitments                                                */
/* ------------------------------------------------------------------ */

function CommitmentsSection({ view, params }: { view: CommitmentChartView; params: SearchParams }) {
  const toggleHref = hrefWith(params, {
    scheduleOnly: view.scheduleOnly ? undefined : '1',
  });
  const caption = `Tracked categories are the household's own list, ticked in Settings — “direct debit” is not a field on a purchase. ${
    view.scheduleOnly
      ? 'Narrowed to purchases the app converted from a schedule: true DD/SOs only.'
      : 'Every purchase in a tracked category counts, converted from a schedule or typed by hand.'
  }${view.tracking.source === 'schedules' ? ' Nothing is saved yet, so this is the set your schedules already use.' : ''}`;

  const action = (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={toggleHref}
        aria-current={view.scheduleOnly ? 'true' : undefined}
        className={`rounded-full border px-3 py-1 text-xs font-medium ${
          view.scheduleOnly
            ? 'border-slate-900 bg-slate-900 text-white'
            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
        }`}
      >
        {view.scheduleOnly ? '✓ ' : ''}Schedule-converted only
      </Link>
      <Link
        href="/settings#commitment-categories"
        className="text-xs font-medium text-sky-700 hover:underline"
      >
        Choose categories →
      </Link>
    </div>
  );

  if (view.tracking.categoryIds.length === 0) {
    return (
      <ChartCard
        id="commitments"
        eyebrow="D · Fixed commitments"
        title="Are the direct debits coming down?"
        action={action}
      >
        <p className="text-sm text-slate-600">
          No categories are tracked as fixed commitments yet. Tick the ones that are bills —
          Insurance and Road Tax but not Fuel, for instance — in{' '}
          <Link
            href="/settings#commitment-categories"
            className="font-medium text-sky-700 hover:underline"
          >
            Settings
          </Link>
          , and this chart fills in.
        </p>
      </ChartCard>
    );
  }

  const series = view.series;
  const href = (from: string, to: string): string =>
    purchasesHref({
      from,
      to,
      categoryIds: view.tracking.categoryIds,
      scheduleOnly: view.scheduleOnly,
    });
  const bars: BarDatum[] = series.months.map((month) => ({
    key: month.from,
    label: monthTick(month.label),
    valuePence: month.amountPence,
    href: href(month.from, month.to),
    hint: `${month.label}: ${formatPence(month.amountPence)}${month.complete ? '' : ' so far'} — open these purchases`,
    muted: !month.complete,
  }));
  const domain = chartDomain(
    bars.map((bar) => bar.valuePence),
    { targetTicks: 4 },
  );
  const columns = [
    { key: 'month', label: 'Month' },
    { key: 'total', label: 'Total', align: 'right' as const },
  ];
  const rows: ChartTableRow[] = series.months.map((month) => ({
    key: month.from,
    muted: !month.complete,
    cells: [
      <a key="link" href={href(month.from, month.to)} className="text-sky-700 hover:underline">
        {month.label}
        {month.complete ? '' : ' (so far)'}
      </a>,
      formatPence(month.amountPence),
    ],
  }));
  const totals = [
    `${series.months.length} months`,
    formatPence(series.months.reduce((sum, month) => sum + month.amountPence, 0)),
  ];

  return (
    <ChartCard
      id="commitments"
      eyebrow="D · Fixed commitments"
      title="Are the direct debits coming down?"
      action={action}
    >
      <div className="lg:hidden">
        <ChartFigure
          chart="commitments"
          variant="phone"
          headline={series.headline}
          basis="Reported"
          caption={caption}
          columns={columns}
          rows={rows}
          totals={totals}
        >
          <BarChart
            bars={bars}
            domain={domain}
            width={PHONE_WIDTH}
            height={200}
            ariaLabel={`Tracked fixed commitments by month. ${series.headline}`}
            xTicks={everyNth(
              bars.map((bar) => bar.label),
              2,
            )}
          />
        </ChartFigure>
      </div>
      <div className="hidden lg:block">
        <ChartFigure
          chart="commitments"
          variant="laptop"
          headline={series.headline}
          basis="Reported"
          caption={caption}
          columns={columns}
          rows={rows}
          totals={totals}
          footer={
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-slate-600">
                  Tracked categories ({view.trackedCategories.length})
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {view.trackedCategories.map((category) => (
                    <li key={category.id}>
                      {category.parent} / {category.child}
                      {category.retired ? ' (retired)' : ''}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-600">
                  By category over {series.months.length} months
                </p>
                {series.byCategory.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Nothing recorded in the tracked categories in this window.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                    {series.byCategory.map((entry) => (
                      <li key={entry.categoryId} className="flex justify-between gap-3">
                        <span>
                          {entry.parent} / {entry.child}
                        </span>
                        <span className="tabular-nums">{formatPence(entry.amountPence)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          }
        >
          <BarChart
            bars={bars}
            domain={domain}
            width={LAPTOP_WIDTH}
            height={260}
            ariaLabel={`Tracked fixed commitments by month. ${series.headline}`}
            xTicks={everyNth(
              bars.map((bar) => bar.label),
              1,
            )}
          />
        </ChartFigure>
      </div>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/* Page furniture                                                      */
/* ------------------------------------------------------------------ */

function ChartCard({
  id,
  eyebrow,
  title,
  action,
  className,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={`min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className ?? ''}`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {eyebrow}
          </p>
          <h2 id={`${id}-heading`} className="text-lg font-semibold sm:text-xl">
            {title}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Labels for every nth band — enough to read, few enough not to collide. */
function everyNth(labels: readonly string[], nth: number): Array<{ index: number; label: string }> {
  const step = Math.max(1, nth);
  const out: Array<{ index: number; label: string }> = [];
  for (let index = labels.length - 1; index >= 0; index -= step) {
    out.unshift({ index, label: labels[index] as string });
  }
  return out;
}

/** Weekly x-ticks for a daily series — 30 days is ~9px a day on a phone. */
function weeklyTicks(dates: readonly string[]): Array<{ index: number; label: string }> {
  const out: Array<{ index: number; label: string }> = [];
  for (let index = 0; index < dates.length; index += 7) {
    out.push({ index, label: shortDayMonth(dates[index] as string) });
  }
  return out;
}

/** "3 Oct" — the weekday is noise once the ticks are weekly. */
function shortDayMonth(date: string): string {
  return formatShortLocalDate(date).replace(/^\w{3} /, '');
}

/** "Sep 26" from "September 2026" — a month tick that fits. */
function monthTick(label: string): string {
  const [month, year] = label.split(' ');
  return `${(month ?? '').slice(0, 3)} ${(year ?? '').slice(2)}`;
}

function parseWho(raw: string | undefined, everyone: PersonalChartView): string[] | null {
  if (raw === undefined || raw.trim() === '') return null;
  const known = new Set(everyone.laptop.series.map((ref) => ref.key));
  const wanted = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => known.has(part));
  return wanted.length === everyone.laptop.series.length ? null : wanted;
}

function chipHref(params: SearchParams, key: string, everyone: PersonalChartView): string {
  const all = everyone.laptop.series.map((ref) => ref.key);
  const current = parseWho(params.who, everyone) ?? all;
  const next = current.includes(key)
    ? current.filter((entry) => entry !== key)
    : all.filter((entry) => current.includes(entry) || entry === key);
  const who = next.length === all.length ? undefined : next.join(',');
  return `${hrefWith(params, { who })}#personal`;
}

function hrefWith(params: SearchParams, changes: Partial<SearchParams>): string {
  const merged: SearchParams = { ...params, ...changes };
  const query = new URLSearchParams();
  if (merged.who !== undefined && merged.who !== '') query.set('who', merged.who);
  if (merged.scheduleOnly === '1') query.set('scheduleOnly', '1');
  const text = query.toString();
  return text === '' ? '/charts' : `/charts?${text}`;
}
