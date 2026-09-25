import type { ReactNode } from 'react';

/**
 * The frame every chart ships in (docs/SPEC.md §16.7, decision 153).
 *
 * Standing rules, enforced here so no chart can quietly skip one:
 * - a **verdict sentence** above the drawing — the chart's point in words;
 * - an **honesty line** saying whether the figures are reported or projected;
 * - a **table twin** under `<details>`: the same numbers, exact, readable by
 *   a screen reader, working without JavaScript and copyable into a message.
 *
 * Nothing here is a client component. There is no hydration step, so the
 * charts are on the screen in the first paint on a phone — which is the
 * device this feature exists for.
 */

export type ChartBasis = 'Reported' | 'Projected' | 'Reported + projected';

export interface ChartTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

export interface ChartTableRow {
  key: string;
  cells: ReactNode[];
  /** Rendered dimmed, for an in-progress week or month. */
  muted?: boolean;
}

export interface ChartFigureProps {
  /** Stable id for the specs: `data-chart="forecast"` and friends. */
  chart: string;
  /** 'phone' or 'laptop' — both are rendered; CSS chooses. */
  variant: 'phone' | 'laptop';
  headline: string;
  basis: ChartBasis;
  caption: string;
  children: ReactNode;
  columns: ChartTableColumn[];
  rows: ChartTableRow[];
  /** Total row, drawn in the table twin's foot. */
  totals?: ReactNode[];
  /** Anything extra under the chart — a legend, a link, a toggle. */
  footer?: ReactNode;
}

export function ChartFigure({
  chart,
  variant,
  headline,
  basis,
  caption,
  children,
  columns,
  rows,
  totals,
  footer,
}: ChartFigureProps) {
  return (
    <figure data-chart={chart} data-variant={variant} className="m-0">
      <p data-chart-headline className="text-sm font-semibold text-ink sm:text-base">
        {headline}
      </p>
      <div className="mt-2">{children}</div>
      {footer !== undefined ? <div className="mt-2">{footer}</div> : null}
      <figcaption className="mt-2 text-xs leading-5 text-ink-muted">
        <span
          className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            basis === 'Reported'
              ? 'bg-positive-50 text-positive-800'
              : basis === 'Projected'
                ? 'bg-warning-50 text-warning-900'
                : 'bg-accent-50 text-accent-900'
          }`}
        >
          {basis}
        </span>
        {caption}
      </figcaption>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-ink-soft">
          Show the numbers ({rows.length} {rows.length === 1 ? 'row' : 'rows'})
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table data-chart-table={chart} className="w-full text-xs">
            <caption className="sr-only">{headline}</caption>
            <thead className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`py-1 pr-3 font-medium ${
                      column.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-t border-border-hairline ${row.muted ? 'text-ink-faint' : ''}`}
                >
                  {row.cells.map((cell, index) => (
                    <td
                      key={columns[index]?.key ?? index}
                      className={`py-1 pr-3 ${
                        columns[index]?.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {totals !== undefined ? (
              <tfoot>
                <tr className="border-t border-border-strong font-semibold">
                  {totals.map((cell, index) => (
                    <td
                      key={columns[index]?.key ?? index}
                      className={`py-1 pr-3 ${
                        columns[index]?.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </details>
    </figure>
  );
}

/** A legend: the series names in words, because colour is never the only signal. */
export function ChartLegend({
  items,
}: {
  items: Array<{ key: string; label: string; fill: string; note?: string }>;
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: item.fill }}
          />
          <span>
            {item.label}
            {item.note !== undefined ? <span className="text-ink-faint"> {item.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
