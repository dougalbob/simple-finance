import { formatPence } from '@/lib/money';
import type { CycleOutlook, CycleOutlookPot } from '@/lib/records/money-view';
import { formatShortLocalDate } from '@/lib/time';

/**
 * The "before income lands" figures (SPEC §7.7, v0.9.0), shared by every
 * review surface — the home page's pot cards, the Overview's mini-balances —
 * so the same arithmetic is never rendered two different ways. The number is
 * the dip: everything already expected to leave before the next income has
 * left, with nothing coming in counted.
 */

/** The household-wide headline, with the two figures that make it up. */
export function CycleOutlookLine({
  outlook,
  className,
}: {
  outlook: CycleOutlook;
  className?: string;
}) {
  if (outlook.incomeDate === null) {
    return (
      <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-ink-soft">
        No expected income is scheduled yet, so there is no “before income lands” figure. Add the
        income schedule in Recurring payments and it appears here.
      </p>
    );
  }
  if (outlook.freeToSpendPence === null) {
    return (
      <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-ink-soft">
        Record a balance checkpoint and the “before income lands” figure appears here.
      </p>
    );
  }
  const negative = outlook.freeToSpendPence < 0;
  return (
    <p
      className={`rounded-lg px-3 py-2 text-sm ${
        negative
          ? 'bg-negative-50 font-medium text-negative-900 ring-1 ring-negative-200'
          : 'bg-canvas text-ink-body'
      } ${className ?? ''}`}
    >
      Free to spend before income lands ({formatShortLocalDate(outlook.incomeDate)}):{' '}
      <span className="font-semibold tabular-nums">{formatPence(outlook.freeToSpendPence)}</span> —
      after {formatPence(outlook.commitmentsPence)} of bills
      {outlook.dayToDayPence > 0
        ? ` and ${formatPence(outlook.dayToDayPence)} of projected shopping & fuel`
        : ''}
      , counting nothing coming in.
    </p>
  );
}

/**
 * The per-pot version for the pot cards: the pot's estimate minus the bills
 * due from that pot before income lands (§7.5's watch, in the same window).
 * A shortfall is loud; a healthy figure is quiet context.
 */
export function PotOutlookLine({
  pot,
  incomeDate,
}: {
  pot: CycleOutlookPot | undefined;
  incomeDate: string | null;
}) {
  // No expected income, no window — nothing honest to say here.
  if (incomeDate === null || pot === undefined || pot.spendablePence === null) return null;
  const window = formatShortLocalDate(incomeDate);
  if (pot.shortfallPence !== null) {
    const first = pot.outgoing[0];
    return (
      <p className="mt-2 rounded-md bg-warning-100 px-2 py-1 text-xs font-semibold text-warning-900">
        {formatPence(pot.shortfallPence)} short of its own bills
        {window === null ? '' : ` before ${window}`}
        {first === undefined
          ? ''
          : ` — ${first.name} ${formatPence(first.amountPence)} on ${formatShortLocalDate(first.dueDate)}`}
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs text-ink-soft">
      Before income lands{window === null ? '' : ` (${window})`}:{' '}
      <span className="font-semibold tabular-nums">{formatPence(pot.spendablePence)}</span>
    </p>
  );
}
