import { bandWidth, bandX, yFor, type ChartDomain, type Plot } from './scale';
import {
  BandLabels,
  CHART_COLOURS,
  Gridlines,
  ReferenceLine,
  SubZeroBand,
} from './chart-primitives';

/**
 * Bars for a period series (SPEC §16.7 B and D).
 *
 * **Links are the drill-down** (decision 155): a bar with an `href` is a
 * real server-rendered `<a>` around its `<rect>`, pointing at `/purchases`
 * with the period's filters. It works without JavaScript, opens in a new
 * tab, and can be sent to the other person — which a click handler and a
 * router push cannot do.
 *
 * The SVG carries `role="img"`, so its subtree is one image to a screen
 * reader; the same links are repeated as ordinary links in the table twin,
 * which is the accessible (and keyboard) path. The bar anchors are therefore
 * `tabIndex={-1}` and `aria-hidden` — pointer affordances, never a trap.
 */

export interface BarDatum {
  key: string;
  label: string;
  valuePence: number;
  /** `/purchases?...` — the purchases behind this bar. */
  href?: string;
  /** Native tooltip text. */
  hint?: string;
  /** An in-progress period: drawn hatched, never counted in an average. */
  muted?: boolean;
}

export interface BarChartProps {
  bars: readonly BarDatum[];
  domain: ChartDomain;
  ariaLabel: string;
  width?: number;
  height?: number;
  xTicks?: ReadonlyArray<{ index: number; label: string }>;
  referenceLines?: ReadonlyArray<{ valuePence: number; label: string; colour?: string }>;
  colour?: string;
}

export function BarChart({
  bars,
  domain,
  ariaLabel,
  width = 720,
  height = 260,
  xTicks = [],
  referenceLines = [],
  colour = CHART_COLOURS.bar,
}: BarChartProps) {
  const plot: Plot = {
    left: 46,
    top: 14,
    width: Math.max(10, width - 56),
    height: Math.max(10, height - 42),
  };
  const count = bars.length;
  const band = bandWidth(count, plot);
  const gap = Math.min(4, band * 0.22);
  const barWidth = Math.max(1.5, band - gap);
  const zeroY = yFor(0, domain, plot);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-auto w-full"
      style={{ maxWidth: '100%' }}
    >
      <defs>
        <pattern
          id="chart-hatch"
          width="5"
          height="5"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <rect width="5" height="5" style={{ fill: CHART_COLOURS.barMuted }} />
          <line x1="0" y1="0" x2="0" y2="5" style={{ stroke: colour }} strokeWidth="1.6" />
        </pattern>
      </defs>
      <SubZeroBand domain={domain} plot={plot} />
      <Gridlines domain={domain} plot={plot} />
      {bars.map((bar, index) => {
        const valueY = yFor(bar.valuePence, domain, plot);
        const y = Math.min(valueY, zeroY);
        const barHeight = Math.max(bar.valuePence === 0 ? 0 : 1, Math.abs(valueY - zeroY));
        const x = bandX(index, count, plot) + gap / 2;
        const rect = (
          <rect
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            style={{ fill: bar.muted ? 'url(#chart-hatch)' : colour }}
            rx={1}
          />
        );
        const title = bar.hint === undefined ? null : <title>{bar.hint}</title>;
        return bar.href === undefined ? (
          <g key={bar.key}>
            {title}
            {rect}
          </g>
        ) : (
          <a key={bar.key} href={bar.href} tabIndex={-1} aria-hidden="true">
            {title}
            {rect}
          </a>
        );
      })}
      {referenceLines.map((reference, index) => (
        <ReferenceLine
          key={`${reference.label}-${reference.valuePence}`}
          valuePence={reference.valuePence}
          label={reference.label}
          colour={reference.colour ?? CHART_COLOURS.reference}
          domain={domain}
          plot={plot}
          // Alternate ends: two references at similar values (the configured
          // figure and the average it is being judged against) must not print
          // on top of each other.
          side={index % 2 === 0 ? 'start' : 'end'}
        />
      ))}
      <BandLabels labels={xTicks} plot={plot} count={count} />
    </svg>
  );
}
