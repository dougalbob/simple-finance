/**
 * The hand-rolled chart kit (SPEC §16.7, decision 155): server-rendered SVG
 * behind one component boundary, with no new dependency. The boundary is
 * what keeps the library question reversible — if the interaction ever
 * outgrows this, a library can be dropped in behind the same components.
 */
export { ChartFigure, ChartLegend } from './chart-figure';
export type { ChartBasis, ChartFigureProps, ChartTableColumn, ChartTableRow } from './chart-figure';
export { CHART_COLOURS } from './chart-primitives';
export { StepAreaChart } from './step-area-chart';
export type { StepAreaChartProps, StepAreaPoint } from './step-area-chart';
export { BarChart } from './bar-chart';
export type { BarChartProps, BarDatum } from './bar-chart';
export { StackedBarChart } from './stacked-bar-chart';
export type {
  StackedBarChartProps,
  StackedGroup,
  StackedSegment,
  StackedSeries,
} from './stacked-bar-chart';
export { bandWidth, bandX, chartDomain, formatAxisPence, niceStep, yFor } from './scale';
export type { ChartDomain, ChartDomainOptions, Plot } from './scale';
