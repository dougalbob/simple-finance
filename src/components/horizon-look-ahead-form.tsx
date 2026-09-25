'use client';

import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';

/**
 * Horizon's look-ahead form (SPEC §7.6, decision 150). Still the plain
 * `GET /horizon` form — the URL carries the look-ahead and it works without
 * JavaScript — with one enhancement: changing the **"Look ahead to"** date
 * submits the form, so the date change applies the pots and the Day-to-day
 * choice set above it in one go. The pots and Day-to-day controls do not
 * auto-apply (one navigation per tick would make the field order pointless);
 * the "Look ahead" button stays as their explicit control and the no-JS path.
 *
 * Guards: an empty field (mid-edit clear) and an invalid/out-of-range date
 * never submit, and `requestSubmit()` keeps HTML validation in play.
 */
export function HorizonLookAheadForm({
  children,
  minDate,
  maxDate,
  throughDate,
}: {
  /** The pot fieldset and the Day-to-day select — rendered above the date. */
  children: ReactNode;
  minDate: string;
  maxDate: string;
  throughDate: string;
}) {
  const [pending, setPending] = useState(false);
  // Hydration signal: before React attaches `onChange`, a date change cannot
  // auto-apply (the button still works). Specs wait for this, as they wait
  // for the till's `data-till-ready`.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  // A plain GET form is a full navigation, so the dim state ends with the
  // page — except when the browser restores this page from its back/forward
  // cache, which would keep it dimmed.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  const onDateChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    if (input.value === '' || !input.validity.valid) return;
    const form = input.form;
    if (form === null) return;
    setPending(true);
    form.requestSubmit();
  };

  return (
    <form
      method="GET"
      action="/horizon"
      className={`flex flex-col gap-4 transition-opacity ${pending ? 'opacity-60' : ''}`}
      aria-busy={pending}
      data-horizon-ready={ready ? 'true' : 'false'}
      onSubmit={() => setPending(true)}
    >
      {children}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="horizon-through" className="text-xs font-medium text-ink-soft">
            Look ahead to
          </label>
          <input
            id="horizon-through"
            name="through"
            type="date"
            min={minDate}
            max={maxDate}
            defaultValue={throughDate}
            onChange={onDateChange}
            className="rounded border border-border-strong bg-surface px-2.5 py-1.5 text-sm focus:border-border-emphasis focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded bg-till px-3 py-1.5 text-sm font-medium text-till-ink disabled:opacity-60"
        >
          Look ahead
        </button>
        <p className="pb-1.5 text-xs text-ink-muted">
          Changing the date applies the pots and day-to-day above; use “Look ahead” after changing
          only those.
        </p>
      </div>
    </form>
  );
}
