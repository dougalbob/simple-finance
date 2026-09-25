'use client';

import { useActionState } from 'react';
import {
  addSupplierInteractionAction,
  addSupplierReferenceAction,
  saveSupplierContactAction,
} from '@/app/actions';
import { initialActionState } from '@/lib/action-state';

const FIELD_CLASS =
  'w-full rounded border border-border-strong px-2 py-1 text-sm focus:border-border-emphasis focus:outline-none';

function Status({ state }: { state: { status: string; message: string | null } }) {
  if (state.message === null) return null;
  return (
    <span
      role="status"
      className={`text-xs ${state.status === 'error' ? 'text-danger' : 'text-positive'}`}
    >
      {state.message}
    </span>
  );
}

export interface SupplierContactValues {
  id: number;
  name: string;
  version: number;
  contactPhone: string | null;
  contactEmail: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
}

/**
 * The contact card editor (SPEC §21.1). Phone, email, website, address and
 * notes — the details you need when something has gone wrong and the paperwork
 * is in a drawer. Empty fields clear a value; the audit trail keeps the
 * before/after.
 */
export function SupplierContactForm({ supplier }: { supplier: SupplierContactValues }) {
  const [state, formAction, pending] = useActionState(
    saveSupplierContactAction,
    initialActionState,
  );
  return (
    <details className="mt-3 rounded-lg border border-border bg-canvas p-3">
      <summary className="cursor-pointer text-sm font-medium text-ink-body">
        Edit contact card
      </summary>
      <form action={formAction} className="mt-3 grid gap-2 sm:grid-cols-2">
        <input type="hidden" name="id" value={supplier.id} />
        <input type="hidden" name="expectedVersion" value={supplier.version} />
        <label className="text-xs font-medium text-ink-soft">
          Phone
          <input
            name="contactPhone"
            type="tel"
            defaultValue={supplier.contactPhone ?? ''}
            className={FIELD_CLASS}
          />
        </label>
        <label className="text-xs font-medium text-ink-soft">
          Email
          <input
            name="contactEmail"
            type="email"
            defaultValue={supplier.contactEmail ?? ''}
            className={FIELD_CLASS}
          />
        </label>
        <label className="text-xs font-medium text-ink-soft">
          Website
          <input name="website" defaultValue={supplier.website ?? ''} className={FIELD_CLASS} />
        </label>
        <label className="text-xs font-medium text-ink-soft">
          Postal address
          <input name="address" defaultValue={supplier.address ?? ''} className={FIELD_CLASS} />
        </label>
        <label className="text-xs font-medium text-ink-soft sm:col-span-2">
          Notes
          <textarea
            name="notes"
            rows={2}
            defaultValue={supplier.notes ?? ''}
            className={FIELD_CLASS}
          />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-till px-3 py-1.5 text-sm font-medium text-till-ink disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save contact card'}
          </button>
          <Status state={state} />
        </div>
      </form>
    </details>
  );
}

/** Label→value reference pair, e.g. "Policy number" → "ABC123" (SPEC §21.1). */
export function SupplierReferenceForm({ supplierId }: { supplierId: number }) {
  const [state, formAction, pending] = useActionState(
    addSupplierReferenceAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="my-2 space-y-1">
      <input type="hidden" name="supplierId" value={supplierId} />
      <div className="flex flex-wrap gap-1">
        <label className="sr-only" htmlFor={`reference-label-${supplierId}`}>
          Reference label
        </label>
        <input
          id={`reference-label-${supplierId}`}
          name="label"
          placeholder="Label (e.g. Policy number)"
          required
          className="w-40 rounded border border-border-strong px-2 py-1 text-xs"
        />
        <label className="sr-only" htmlFor={`reference-value-${supplierId}`}>
          Reference value
        </label>
        <input
          id={`reference-value-${supplierId}`}
          name="value"
          placeholder="Value"
          required
          className="w-36 rounded border border-border-strong px-2 py-1 text-xs"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-till-inset px-2 py-1 text-xs text-till-ink disabled:opacity-60"
        >
          Add reference
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

const CHANNELS: Array<{ value: string; label: string }> = [
  { value: 'call', label: 'Phone call' },
  { value: 'email', label: 'Email' },
  { value: 'letter', label: 'Letter' },
  { value: 'in_person', label: 'In person' },
  { value: 'other', label: 'Other' },
];

/**
 * "+ Create interaction" (SPEC §21.2): what was said, the optional outcome and
 * an optional follow-up date that surfaces on the Contracts & renewals page so
 * a promise does not quietly evaporate.
 */
export function SupplierInteractionForm({ supplierId }: { supplierId: number }) {
  const [state, formAction, pending] = useActionState(
    addSupplierInteractionAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="my-2 space-y-1">
      <input type="hidden" name="supplierId" value={supplierId} />
      <div className="flex flex-wrap gap-1">
        <label className="sr-only" htmlFor={`interaction-channel-${supplierId}`}>
          Channel
        </label>
        <select
          id={`interaction-channel-${supplierId}`}
          name="channel"
          className="rounded border border-border-strong px-2 py-1 text-xs"
        >
          {CHANNELS.map((channel) => (
            <option key={channel.value} value={channel.value}>
              {channel.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`interaction-follow-up-${supplierId}`}>
          Follow-up date
        </label>
        <input
          id={`interaction-follow-up-${supplierId}`}
          name="followUpDate"
          type="date"
          className="rounded border border-border-strong px-2 py-1 text-xs"
        />
      </div>
      <label className="sr-only" htmlFor={`interaction-summary-${supplierId}`}>
        Summary
      </label>
      <input
        id={`interaction-summary-${supplierId}`}
        name="summary"
        placeholder="What happened?"
        required
        className="w-full rounded border border-border-strong px-2 py-1 text-xs"
      />
      <label className="sr-only" htmlFor={`interaction-outcome-${supplierId}`}>
        Outcome
      </label>
      <input
        id={`interaction-outcome-${supplierId}`}
        name="outcome"
        placeholder="Outcome (optional)"
        className="w-full rounded border border-border-strong px-2 py-1 text-xs"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-note px-2 py-1 text-xs text-till-ink disabled:opacity-60"
        >
          {pending ? 'Logging…' : 'Log interaction'}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}
