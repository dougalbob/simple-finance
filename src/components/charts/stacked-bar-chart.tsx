import { bandWidth, bandX, yFor, type ChartDomain, type Plot } from './scale';
import { BandLabels, CHART_COLOURS, Gridlines, SubZeroBand } from './chart-primitives';

/**
 * Stacked bars for the personal-spending chart (SPEC §16.7 C): one segment
 * per series (each person, then Household) per month.
 *
 * Positive segments stack upward from zero and negative ones (a month whose
 * refunds outweigh its spending) stack downward, so a net-negative month is
 * visible instead of silently disappearing. Every segment can be a link to
 * the purchases behind it, on the same terms as `BarChart`.
 */

export interface StackedSeries {
  key: string;
  label: string;
  fill: string;
}

export interface StackedSegment {
  key: string;
  valuePence: number;
  href?: string;
  hint?: string;
}

export interface StackedGroup {
  key: string;
  label: string;
  segments: readonly StackedSegment[];
  muted?: boolean;
}

export interface StackedBarChartProps {
  groups: readonly StackedGroup[];
  series: readonly StackedSeries[];
  domain: ChartDomain;
  ariaLabel: string;
  width?: number;
  height?: number;
  xTicks?: ReadonlyArray<{ index: number; label: string }>;
}

export function StackedBarChart({
  groups,
  series,
  domain,
  ariaLabel,
  width = 720,
  height = 280,
  xTicks = [],
}: StackedBarChartProps) {
  const plot: Plot = {
    left: 46,
    top: 14,
    width: Math.max(10, width - 56),
    height: Math.max(10, height - 42),
  };
  const count = groups.length;
  const band = bandWidth(count, plot);
  const gap = Math.min(6, band * 0.25);
  const barWidth = Math.max(1.5, band - gap);
  const fillOf = new Map(series.map((entry) => [entry.key, entry.fill]));

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
      {groups.map((group, index) => {
        const x = bandX(index, count, plot) + gap / 2;
        let positiveBase = 0;
        let negativeBase = 0;
        return (
          <g key={group.key} opacity={group.muted ? 0.65 : 1}>
            {group.segments.map((segment) => {
              if (segment.valuePence === 0) return null;
              const positive = segment.valuePence > 0;
              const from = positive ? positiveBase : negativeBase;
              const to = from + segment.valuePence;
              if (positive) positiveBase = to;
              else negativeBase = to;
              const yFrom = yFor(from, domain, plot);
              const yTo = yFor(to, domain, plot);
              const y = Math.min(yFrom, yTo);
              const segmentHeight = Math.max(1, Math.abs(yTo - yFrom));
              const rect = (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={segmentHeight}
                  fill={fillOf.get(segment.key) ?? CHART_COLOURS.bar}
                />
              );
              const title = segment.hint === undefined ? null : <title>{segment.hint}</title>;
              return segment.href === undefined ? (
                <g key={segment.key}>
                  {title}
                  {rect}
                </g>
              ) : (
                <a key={segment.key} href={segment.href} tabIndex={-1} aria-hidden="true">
                  {title}
                  {rect}
                </a>
              );
            })}
          </g>
        );
      })}
      <BandLabels labels={xTicks} plot={plot} count={count} />
    </svg>
  );
}
