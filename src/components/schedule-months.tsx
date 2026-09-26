'use client';

import { useState } from 'react';
import { PAYMENT_MONTH_NAMES } from '@/lib/schedule-months';

/** Secondary exception control: native disclosure, deliberately closed initially. */
export function ScheduleMonths({ initialMonths = [] }: { initialMonths?: number[] }) {
  const [months, setMonths] = useState(initialMonths);
  const summary = PAYMENT_MONTH_NAMES.filter((_, index) => months.includes(index + 1)).join(', ');
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-ink-body">
        Select any months with no payment: {summary || 'none'}
      </summary>
      <fieldset className="mt-2">
        <legend className="sr-only">Months with no payment each year</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          {PAYMENT_MONTH_NAMES.map((name, index) => (
            <label key={name} className="flex items-center gap-2 text-sm text-ink-body">
              <input
                type="checkbox"
                name="excludedMonths"
                value={index + 1}
                checked={months.includes(index + 1)}
                onChange={(event) =>
                  setMonths(
                    event.target.checked
                      ? [...months, index + 1]
                      : months.filter((month) => month !== index + 1),
                  )
                }
                className="h-4 w-4 rounded border-border-strong"
              />
              {name}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Repeats every year. Leave at least one month with a payment. Changes apply from the next
          instance; recorded payments stay unchanged.
        </p>
      </fieldset>
    </details>
  );
}
