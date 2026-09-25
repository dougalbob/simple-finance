import { bandWidth, bandX, yFor, type ChartDomain, type Plot } from './scale';
import {
  AXIS_FONT,
  BandLabels,
  CHART_COLOURS,
  Gridlines,
  ReferenceLine,
  SubZeroBand,
} from './chart-primitives';
import { formatPence } from '@/lib/money';

/**
 * The forecast chart (SPEC §16.7 A): a **step** area, because the balance
 * changes at day boundaries — a smooth line would invent values between
 * days that the app does not have.
 *
 * Negatives are drawn properly rather than clipped: the domain always holds
 * zero, the sub-zero region is tinted, the overdraft limit is a dashed line
 * when one applies, and the lowest point is labelled with its date.
 */

export interface StepAreaPoint {
  date: string;
  valuePence: number;
  /** The first point only: today's reported balance. */
  reported: boolean;
  /** Money expected in on that day — drawn as a tick on the baseline. */
  income: boolean;
}

export interface StepAreaChartProps {
  points: readonly StepAreaPoint[];
  domain: ChartDomain;
  ariaLabel: string;
  width?: number;
  height?: number;
  xTicks?: ReadonlyArray<{ index: number; label: string }>;
  lowIndex?: number | null;
  lowLabel?: string;
  referenceLines?: ReadonlyArray<{ valuePence: number; label: string; colour?: string }>;
}

export function StepAreaChart({
  points,
  domain,
  ariaLabel,
  width = 720,
  height = 300,
  xTicks = [],
  lowIndex = null,
  lowLabel,
  referenceLines = [],
}: StepAreaChartProps) {
  const plot: Plot = {
    left: 46,
    top: 14,
    width: Math.max(10, width - 56),
    height: Math.max(10, height - 42),
  };
  const count = points.length;
  const step = bandWidth(count, plot);
  const zeroY = yFor(0, domain, plot);

  const line: string[] = [];
  points.forEach((point, index) => {
    const x0 = bandX(index, count, plot);
    const x1 = x0 + step;
    const y = yFor(point.valuePence, domain, plot);
    line.push(index === 0 ? `M ${round(x0)} ${round(y)}` : `L ${round(x0)} ${round(y)}`);
    line.push(`L ${round(x1)} ${round(y)}`);
  });
  const linePath = line.join(' ');
  const areaPath =
    count === 0
      ? ''
      : `${linePath} L ${round(plot.left + plot.width)} ${round(zeroY)} L ${round(plot.left)} ${round(zeroY)} Z`;

  const low = lowIndex === null ? null : points[lowIndex];
  const lowX = lowIndex === null ? 0 : bandX(lowIndex, count, plot) + step / 2;
  const lowY = low === undefined || low === null ? 0 : yFor(low.valuePence, domain, plot);
  const lowAnchor =
    lowX < plot.left + 60 ? 'start' : lowX > plot.left + plot.width - 60 ? 'end' : 'middle';
  const lowTextY = lowY < plot.top + 24 ? lowY + 16 : lowY - 8;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-auto w-full"
      style={{ maxWidth: '100%' }}
    >
      <SubZeroBand domain={domain} plot={plot} />
      <Gridlines domain={domain} plot={plot} />
      {areaPath === '' ? null : <path d={areaPath} fill={CHART_COLOURS.lineFill} stroke="none" />}
      {linePath === '' ? null : (
        <path
          d={linePath}
          fill="none"
          stroke={CHART_COLOURS.line}
          strokeWidth={1.75}
          strokeLinejoin="round"
        />
      )}
      {referenceLines.map((reference, index) => (
        <ReferenceLine
          key={`${reference.label}-${reference.valuePence}`}
          valuePence={reference.valuePence}
          label={reference.label}
          colour={reference.colour ?? CHART_COLOURS.reference}
          domain={domain}
          plot={plot}
          side={index % 2 === 0 ? 'start' : 'end'}
        />
      ))}
      <g aria-hidden="true">
        {points.map((point, index) =>
          point.income ? (
            <line
              key={`income-${point.date}`}
              x1={bandX(index, count, plot) + step / 2}
              x2={bandX(index, count, plot) + step / 2}
              y1={plot.top + plot.height}
              y2={plot.top + plot.height - 7}
              stroke={CHART_COLOURS.average}
              strokeWidth={1.5}
            />
          ) : null,
        )}
      </g>
      {low !== null && low !== undefined ? (
        <g aria-hidden="true">
          <circle cx={lowX} cy={lowY} r={3} fill={CHART_COLOURS.danger} />
          <text
            x={lowX}
            y={lowTextY}
            textAnchor={lowAnchor}
            fontSize={AXIS_FONT + 1}
            fontWeight={600}
            fill={CHART_COLOURS.danger}
            // A white halo: the label sits over the balance line and its
            // tint, and the lowest point is the one number on this chart
            // that must never be hard to read.
            stroke="#ffffff"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {lowLabel ?? formatPence(low.valuePence)}
          </text>
        </g>
      ) : null}
      <BandLabels labels={xTicks} plot={plot} count={count} />
    </svg>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
