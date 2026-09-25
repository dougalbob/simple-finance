/**
 * Chart geometry (v0.14.0, docs/SPEC.md §16.7) — pure, framework-free,
 * integer-pence in and SVG user units out. No React, no DOM: the drawing
 * components below only place what these functions work out, and
 * `tests/chart-series.test.ts` can pin the awkward cases (an empty series,
 * one point, an all-negative series) without a browser.
 */

export interface ChartDomain {
  min: number;
  max: number;
  /** Gridline values, ascending, always including zero. */
  ticks: number[];
}

export interface ChartDomainOptions {
  /** Roughly how many gridlines to aim for (default 4). */
  targetTicks?: number;
  /** Headroom as a share of the span (default 8%). */
  padRatio?: number;
  /**
   * When the series goes below zero, the share of the plot the sub-zero
   * half is guaranteed (default 18%) — a negative balance must have real
   * room to be drawn in, not a sliver against the baseline.
   */
  minNegativeShare?: number;
}

/** A "nice" round step (1, 2, 2.5, 5 × 10ⁿ) at least as big as `rough`. */
export function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const scaled = rough / magnitude;
  const stepped = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return Math.max(1, Math.round(stepped * magnitude));
}

/**
 * The y-domain for a series of pence values.
 *
 * Rules, in the order they matter:
 * 1. **Zero is always in the domain** — a chart of money whose axis starts
 *    at £200 exaggerates every wobble, and one that clips at zero hides an
 *    overdraft.
 * 2. When anything is negative the padding is **symmetric** and the sub-zero
 *    band gets at least `minNegativeShare` of the height, so "below zero" is
 *    somewhere you can see a line, not a line on the floor.
 * 3. The bounds round outward to a nice step, so the gridlines are readable
 *    figures rather than £83.47.
 */
export function chartDomain(
  values: readonly number[],
  options: ChartDomainOptions = {},
): ChartDomain {
  const targetTicks = Math.max(2, Math.trunc(options.targetTicks ?? 4));
  const padRatio = options.padRatio ?? 0.08;
  const minNegativeShare = options.minNegativeShare ?? 0.18;

  const finite = values.filter((value) => Number.isFinite(value));
  const rawMin = Math.min(0, ...finite);
  const rawMax = Math.max(0, ...finite);
  const span = Math.max(rawMax - rawMin, 1);
  const pad = Math.max(Math.round(span * padRatio), 100);

  const hasNegative = rawMin < 0;
  let min = hasNegative ? rawMin - pad : 0;
  let max = rawMax + pad;

  if (hasNegative) {
    // Guarantee the sub-zero band is worth drawing in.
    const needed = (minNegativeShare * max) / (1 - minNegativeShare);
    if (-min < needed) min = -needed;
  }

  const step = niceStep((max - min) / targetTicks);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  if (min === max) max = min + step;

  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2; value += step) {
    ticks.push(Math.round(value));
  }
  return { min, max, ticks };
}

export interface Plot {
  /** Left edge of the plotting area (the axis gutter sits to its left). */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The y pixel for a pence value inside a plot box. */
export function yFor(value: number, domain: ChartDomain, plot: Plot): number {
  const span = domain.max - domain.min || 1;
  const clamped = Math.min(Math.max(value, domain.min), domain.max);
  return plot.top + plot.height - ((clamped - domain.min) / span) * plot.height;
}

/** The x pixel of band `index` of `count` equal bands (bar/step charts). */
export function bandX(index: number, count: number, plot: Plot): number {
  if (count <= 0) return plot.left;
  return plot.left + (index / count) * plot.width;
}

/** The width of one band. */
export function bandWidth(count: number, plot: Plot): number {
  if (count <= 0) return plot.width;
  return plot.width / count;
}

/**
 * Short axis money: "£1.2k" above a thousand pounds, "-£85" below. Axis
 * labels have ~40px; the exact figures live in the table twin, which is the
 * copy of the chart that never rounds.
 */
export function formatAxisPence(pence: number): string {
  const negative = pence < 0;
  const pounds = Math.abs(pence) / 100;
  const text =
    pounds >= 1000
      ? `£${trimZero((pounds / 1000).toFixed(1))}k`
      : pounds >= 100 || Number.isInteger(pounds)
        ? `£${Math.round(pounds)}`
        : `£${trimZero(pounds.toFixed(2))}`;
  return negative ? `-${text}` : text;
}

function trimZero(text: string): string {
  return text.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}
