import { daysBetween } from './dates';

/**
 * The key-date alert engine (docs/SPEC.md §22): renewals and fixed-term
 * contract end dates, united in one Overview panel and one page (§15.2),
 * but modelled separately because they behave differently (§22.1–§22.2).
 *
 * Pure date arithmetic: warning windows (days-until vs per-item lead),
 * "rolled / awaiting review" for past contract ends (instances never
 * auto-stop — SPEC §22.1), and "past" for overdue non-repeating renewals.
 * The advance itself (renewals moving a year forward) is done by the
 * renewals module before this engine runs.
 */

export type KeyDateKind = 'renewal' | 'contract-end';

export interface KeyDateItem {
  id: number;
  kind: KeyDateKind;
  label: string;
  /** Local date ('YYYY-MM-DD') of the renewal or contract end. */
  date: string;
  /** Per-item warning lead in days (default 21, SPEC §22.2 / decision 23). */
  leadDays: number;
  supplierId?: number | null;
  targetLabel?: string | null;
  scheduleId?: number | null;
}

export type KeyDateState = 'today' | 'in-window' | 'rolled-awaiting-review' | 'past';

export interface KeyDateAlert extends KeyDateItem {
  daysUntil: number;
  state: KeyDateState;
}

const STATE_RANK: Record<KeyDateState, number> = {
  today: 0,
  'in-window': 1,
  'rolled-awaiting-review': 2,
  past: 3,
};

/**
 * The alert list: everything inside its warning window (soonest first),
 * today's items first, then the honest past states. Items outside their
 * window are omitted — the panel is quiet until a date matters.
 */
export function computeKeyDateAlerts(items: readonly KeyDateItem[], today: string): KeyDateAlert[] {
  const alerts: KeyDateAlert[] = [];
  for (const item of items) {
    const daysUntil = daysBetween(today, item.date);
    let state: KeyDateState | null = null;
    if (daysUntil === 0) {
      state = 'today';
    } else if (daysUntil > 0 && daysUntil <= item.leadDays) {
      state = 'in-window';
    } else if (daysUntil < 0) {
      // Contract ends never stop the money — a past end date is a quiet,
      // honest "rolled / awaiting review" (SPEC §22.1, E9). A past
      // non-repeating renewal is simply overdue.
      state = item.kind === 'contract-end' ? 'rolled-awaiting-review' : 'past';
    }
    if (state !== null) {
      alerts.push({ ...item, daysUntil, state });
    }
  }
  alerts.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.date.localeCompare(b.date));
  return alerts;
}

/**
 * The one-line message for a key-date alert (SPEC §22.3 / E9). Colour is
 * never the only signal — the text carries the state.
 */
export function keyDateMessage(alert: KeyDateAlert): string {
  switch (alert.state) {
    case 'today':
      return alert.kind === 'renewal' ? `${alert.label} renews today` : `${alert.label} ends today`;
    case 'in-window':
      return alert.kind === 'renewal'
        ? `${alert.label} renews in ${alert.daysUntil} ${alert.daysUntil === 1 ? 'day' : 'days'}`
        : `${alert.label} ends in ${alert.daysUntil} ${alert.daysUntil === 1 ? 'day' : 'days'} — time to shop around`;
    case 'rolled-awaiting-review':
      return `${alert.label} ended on ${alert.date} — rolled / awaiting review`;
    case 'past':
      return `${alert.label} was due on ${alert.date} — review it`;
  }
}
