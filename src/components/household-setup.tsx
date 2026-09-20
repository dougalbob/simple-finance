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
      className="rounded-2xl border border-sky-200 bg-sky-50 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="targets-heading" className="text-lg font-semibold text-slate-900">
            Household targets
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Add the two people and any vehicles once. These labels power the visible paid-by and
            for-whom chips; they are never seeded with real household data.
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
          {people.length}/2 people
        </span>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <form action={personAction} className="rounded-xl border border-sky-100 bg-white p-3">
          <label className="block text-sm font-semibold text-slate-800">
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
        <form action={vehicleAction} className="rounded-xl border border-sky-100 bg-white p-3">
          <label className="block text-sm font-semibold text-slate-800">
            Add vehicle
            <input
              name="label"
              required
              maxLength={60}
              placeholder="e.g. Vehicle A"
              className={inputClass}
            />
          </label>
          <label className="mt-3 block text-sm font-semibold text-slate-800">
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
      className={`mt-2 text-sm ${status === 'error' ? 'text-red-700' : 'text-emerald-700'}`}
    >
      {message}
    </p>
  ) : null;
}

const inputClass =
  'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-normal text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200';
const buttonClass =
  'mt-3 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50';
