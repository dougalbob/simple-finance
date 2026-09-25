import { formatAxisPence, yFor, type ChartDomain, type Plot } from './scale';

/**
 * Shared SVG furniture for the hand-rolled chart kit (SPEC §16.7).
 * Server-rendered, no client JavaScript, responsive through `viewBox` plus
 * `width: 100%` — so there is nothing to hydrate and nothing to break on a
 * phone, and Playwright can assert the markup directly.
 */

/**
 * The series palette. Every colour is also named in a legend or a table.
 *
 * These are references to the colour tokens in `src/app/globals.css`
 * (decision 159), not colour literals: the chart kit never decides a colour,
 * so a theme that redefines the tokens re-tints every drawing without this
 * file changing. They reach the SVG through an inline `style` rather than a
 * `fill`/`stroke` attribute — a custom property resolves in a declaration,
 * which an inline style is, in every browser; presentation-attribute support
 * is not universal. The same strings are used for the HTML legend swatches.
 */
export const CHART_COLOURS = {
  line: 'var(--color-chart-1)',
  lineFill: 'var(--color-chart-line-fill)',
  bar: 'var(--color-chart-bar)',
  barMuted: 'var(--color-chart-bar-muted)',
  reference: 'var(--color-chart-2)',
  average: 'var(--color-chart-5)',
  danger: 'var(--color-chart-danger)',
  dangerTint: 'var(--color-chart-danger-tint)',
  grid: 'var(--color-chart-grid)',
  axis: 'var(--color-chart-axis)',
  text: 'var(--color-chart-text)',
  halo: 'var(--color-chart-halo)',
  series: [
    'var(--color-chart-1)',
    'var(--color-chart-2)',
    'var(--color-chart-3)',
    'var(--color-chart-4)',
    'var(--color-chart-5)',
  ],
} as const;

export const AXIS_FONT = 10;

/** Gridlines with their money labels, and a firmer rule on zero. */
export function Gridlines({ domain, plot }: { domain: ChartDomain; plot: Plot }) {
  return (
    <g aria-hidden="true">
      {domain.ticks.map((tick) => {
        const y = yFor(tick, domain, plot);
        const isZero = tick === 0;
        return (
          <g key={tick}>
            <line
              x1={plot.left}
              x2={plot.left + plot.width}
              y1={y}
              y2={y}
              style={{ stroke: isZero ? CHART_COLOURS.axis : CHART_COLOURS.grid }}
              strokeWidth={isZero ? 1 : 1}
            />
            <text
              x={plot.left - 4}
              y={y + 3}
              textAnchor="end"
              fontSize={AXIS_FONT}
              style={{ fill: CHART_COLOURS.text }}
            >
              {formatAxisPence(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** The tinted below-zero region — "overdrawn" is a place on the chart. */
export function SubZeroBand({ domain, plot }: { domain: ChartDomain; plot: Plot }) {
  if (domain.min >= 0) return null;
  const zeroY = yFor(0, domain, plot);
  const bottom = plot.top + plot.height;
  return (
    <rect
      aria-hidden="true"
      x={plot.left}
      y={zeroY}
      width={plot.width}
      height={Math.max(0, bottom - zeroY)}
      style={{ fill: CHART_COLOURS.dangerTint }}
    />
  );
}

/**
 * A dashed horizontal reference line with a small label.
 *
 * `side` puts the label at the start or the end of the line: two references
 * whose values are close (the configured weekly figure and the 8-week
 * average, say) would otherwise print on top of each other. The label is
 * drawn with a halo in the surface colour (`paintOrder="stroke"`) so it stays
 * readable where it crosses a bar.
 */
export function ReferenceLine({
  valuePence,
  label,
  colour,
  domain,
  plot,
  side = 'end',
}: {
  valuePence: number;
  label: string;
  colour: string;
  domain: ChartDomain;
  plot: Plot;
  side?: 'start' | 'end';
}) {
  if (valuePence < domain.min || valuePence > domain.max) return null;
  const y = yFor(valuePence, domain, plot);
  const atStart = side === 'start';
  return (
    <g aria-hidden="true">
      <line
        x1={plot.left}
        x2={plot.left + plot.width}
        y1={y}
        y2={y}
        style={{ stroke: colour }}
        strokeWidth={1.25}
        strokeDasharray="4 3"
      />
      <text
        x={atStart ? plot.left + 2 : plot.left + plot.width - 2}
        y={y - 3}
        textAnchor={atStart ? 'start' : 'end'}
        fontSize={AXIS_FONT}
        style={{ fill: colour, stroke: CHART_COLOURS.halo }}
        strokeWidth={2.5}
        paintOrder="stroke"
      >
        {label}
      </text>
    </g>
  );
}

/** X-axis labels under the plot, at chosen band positions. */
export function BandLabels({
  labels,
  plot,
  count,
}: {
  labels: ReadonlyArray<{ index: number; label: string }>;
  plot: Plot;
  count: number;
}) {
  const width = count <= 0 ? plot.width : plot.width / count;
  return (
    <g aria-hidden="true">
      {labels.map(({ index, label }) => (
        <text
          key={`${index}-${label}`}
          x={plot.left + index * width + width / 2}
          y={plot.top + plot.height + 13}
          textAnchor="middle"
          fontSize={AXIS_FONT}
          style={{ fill: CHART_COLOURS.text }}
        >
          {label}
        </text>
      ))}
    </g>
  );
}
