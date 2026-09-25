'use client';

import { useActionState } from 'react';
import { addPersonAction, addVehicleAction } from '@/app/actions';
import { initialActionState } from '@/lib/action-state';

export function HouseholdSetup({ people }: { people: Array<{ id: number; label: string }> }) {
  const [personState, personAction, personPending] = useActionState(
    addPersonAction,
    initialActionState,
  );
  const [vehicleState, vehicleAction, vehiclePending] = useActionState(
    addVehicleAction,
    initialActionState,
  );
  return (
    <section
      aria-labelledby="targets-heading"
      className="rounded-2xl border border-accent-200 bg-accent-50 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="targets-heading" className="text-lg font-semibold text-ink">
            Household targets
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Add the two people and any vehicles once. These labels power the visible paid-by and
            for-whom chips; they are never seeded with real household data.
          </p>
        </div>
        <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-soft">
          {people.length}/2 people
        </span>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <form action={personAction} className="rounded-xl border border-accent-100 bg-surface p-3">
          <label className="block text-sm font-semibold text-ink-emphasis">
            Add person
            <input
              name="label"
              required
              maxLength={60}
              placeholder="e.g. Alex"
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={personPending} className={buttonClass}>
            {personPending ? 'Saving…' : 'Add person'}
          </button>
          <Message status={personState.status} message={personState.message} />
        </form>
        <form action={vehicleAction} className="rounded-xl border border-accent-100 bg-surface p-3">
          <label className="block text-sm font-semibold text-ink-emphasis">
            Add vehicle
            <input
              name="label"
              required
              maxLength={60}
              placeholder="e.g. Vehicle A"
              className={inputClass}
            />
          </label>
          <label className="mt-3 block text-sm font-semibold text-ink-emphasis">
            Owner (optional)
            <select name="ownerPersonId" className={inputClass}>
              <option value="">Shared / not assigned</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={vehiclePending} className={buttonClass}>
            {vehiclePending ? 'Saving…' : 'Add vehicle'}
          </button>
          <Message status={vehicleState.status} message={vehicleState.message} />
        </form>
      </div>
    </section>
  );
}

function Message({ status, message }: { status: string; message: string | null }) {
  return message ? (
    <p
      role="status"
      className={`mt-2 text-sm ${status === 'error' ? 'text-danger' : 'text-positive'}`}
    >
      {message}
    </p>
  ) : null;
}

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-200';
const buttonClass =
  'mt-3 rounded-lg bg-till px-4 py-2 font-semibold text-till-ink disabled:opacity-50';
