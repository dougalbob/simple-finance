'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import {
  addRenewalAction,
  addScheduleAction,
  cancelScheduleAction,
  saveProjectionSettingsAction,
} from '@/app/actions';
import { initialActionState, type ActionState } from '@/lib/action-state';

/**
 * Phase 3 entry surfaces (SPEC §11, §22, §7.3): add/cancel schedules, add
 * renewals, and the configured projection figures. Mobile-first, visible
 * defaults, honest messages. The dense Recurring Payments page with the
 * month calendar lands in Phase 4 — this is the working mobile surface.
 */

export interface RecurringPotOption {
  id: number;
  label: string;
}

export interface RecurringCategoryOption {
  id: number;
  parentName: string;
  childName: string;
}

export interface RecurringScheduleOption {
  id: number;
  name: string;
  kind: string;
  frequency: string;
  amountPence: number;
  dueDayOfMonth: number;
  dueMonth: number | null;
  potLabel: string;
  nextDueDate: string | null;
  version: number;
  cancelledEffectiveOn: string | null;
  contractEndsOn: string | null;
  supplierId: number | null;
  supplierName: string | null;
}

export interface RecurringData {
  pots: RecurringPotOption[];
  categories: RecurringCategoryOption[];
  people: Array<{ id: number; label: string }>;
  vehicles: Array<{ id: number; label: string }>;
  suppliers: Array<{ id: number; name: string }>;
  today: string;
  schedules: RecurringScheduleOption[];
  renewals: Array<{
    id: number;
    label: string;
    nextRenewalDate: string;
    warnDaysBefore: number;
    repeatsAnnually: boolean;
    targetLabel: string | null;
    supplierName: string | null;
    advancedFrom: string | null;
  }>;
  projectionSettings: {
    weeklyGroceriesPence: number | null;
    monthlyFuelPence: Array<{ vehicleId: number; label: string; pence: number | null }>;
  };
}

function FormMessage({ status, message }: { status: string; message: string | null }) {
  if (message === null) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={
        status === 'error'
          ? 'text-sm text-red-700'
          : status === 'ok'
            ? 'text-sm text-emerald-700'
            : 'text-sm text-slate-600'
      }
    >
      {message}
    </p>
  );
}

const inputClass = 'rounded border border-slate-300 bg-white px-3 py-2 text-base';
const labelClass = 'block text-sm font-medium text-slate-700';
const buttonClass =
  'rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60';

export function AddScheduleForm({ data }: { data: RecurringData }) {
  const [state, formAction, pending] = useActionState(addScheduleAction, initialActionState);
  const [kind, setKind] = useState<'dd' | 'so' | 'receipt'>('dd');
  const [frequency, setFrequency] = useState<'monthly' | 'annual'>('monthly');
  /** '' = pick existing; '__new__' = type a new name; for SO also allow no supplier. */
  const [supplierMode, setSupplierMode] = useState<string>('');
  const isReceipt = kind === 'receipt';
  const needsSupplier = kind === 'dd' || kind === 'so';

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Schedule name
          <input
            name="name"
            required
            maxLength={60}
            placeholder="e.g. Electricity bill"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Amount
          <input
            name="amount"
            required
            inputMode="decimal"
            placeholder="e.g. 84.55"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Type
          <select
            name="kind"
            className={inputClass}
            value={kind}
            onChange={(event) => {
              const next = event.target.value as 'dd' | 'so' | 'receipt';
              setKind(next);
              if (next === 'receipt') setSupplierMode('');
            }}
          >
            <option value="dd">Direct debit</option>
            <option value="so">Standing order</option>
            <option value="receipt">Expected receipt (income)</option>
          </select>
        </label>
        <label className={labelClass}>
          Frequency
          <select
            name="frequency"
            className={inputClass}
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as 'monthly' | 'annual')}
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </label>
        <label className={labelClass}>
          Due day of month
          <input
            name="dueDayOfMonth"
            type="number"
            min={1}
            max={31}
            defaultValue={1}
            required
            className={inputClass}
          />
        </label>
        {frequency === 'annual' ? (
          <label className={labelClass}>
            Due month
            <select name="dueMonth" required className={inputClass}>
              <option value="" disabled>
                Choose the month
              </option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={labelClass}>
          Pot
          <select name="potId" required className={inputClass}>
            {data.pots.map((pot) => (
              <option key={pot.id} value={pot.id}>
                {pot.label}
              </option>
            ))}
          </select>
        </label>
        {!isReceipt ? (
          <label className={labelClass}>
            Category (child)
            <select name="categoryId" required className={inputClass}>
              <option value="" disabled>
                Choose a category
              </option>
              {data.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.parentName} / {category.childName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {needsSupplier ? (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="schedule-supplier" className={labelClass}>
                Supplier
              </label>
              <select
                id="schedule-supplier"
                // Always post supplierId; "__new__" is stripped by the action when
                // supplierName is present. An empty value is the standing-order
                // household-transfer option.
                name="supplierId"
                required={kind === 'dd'}
                className={inputClass}
                value={supplierMode}
                onChange={(event) => setSupplierMode(event.target.value)}
              >
                <option value="" disabled={kind === 'dd'}>
                  {kind === 'dd' ? 'Choose a supplier…' : 'No supplier / household transfer'}
                </option>
                {data.suppliers.map((supplier) => (
                  <option key={supplier.id} value={String(supplier.id)}>
                    {supplier.name}
                  </option>
                ))}
                <option value="__new__">Add a new supplier…</option>
              </select>
            </div>
            {supplierMode === '__new__' ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="schedule-supplier-name" className={labelClass}>
                  New supplier name
                </label>
                <input
                  id="schedule-supplier-name"
                  name="supplierName"
                  required
                  maxLength={120}
                  placeholder="e.g. Northern Power Co"
                  className={inputClass}
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Creates the same supplier record used on Purchases, Renewals and Suppliers. Add
                  contact details there afterwards.
                </span>
              </div>
            ) : null}
            {kind === 'so' && supplierMode === '' ? (
              <p className="text-xs text-slate-500">
                Standing orders that are household transfers need no supplier. Supplier payments
                should pick one so converted purchases land on the right card.
              </p>
            ) : null}
          </div>
        ) : null}
        <label className={labelClass}>
          For
          <select name="target" className={inputClass} defaultValue="household">
            <option value="household">Household</option>
            {data.people.map((person) => (
              <option key={person.id} value={`person-${person.id}`}>
                Person — {person.label}
              </option>
            ))}
            {data.vehicles.map((vehicle) => (
              <option key={vehicle.id} value={`vehicle-${vehicle.id}`}>
                Vehicle — {vehicle.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Contract end date (optional)
          <input name="contractEndsOn" type="date" className={inputClass} />
          <span className="mt-1 block text-xs text-slate-500">
            Informational — a reminder to shop around. Instances never stop automatically.
          </span>
        </label>
        <label className={labelClass}>
          Active from
          <input
            name="activeFrom"
            type="date"
            defaultValue={data.today}
            required
            className={inputClass}
          />
        </label>
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : 'Add schedule'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export function CancelScheduleForm({
  schedule,
  today,
}: {
  schedule: RecurringScheduleOption;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(cancelScheduleAction, initialActionState);
  return (
    <form
      action={formAction}
      className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2"
    >
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Cancel from (local date)
          <input
            name="effectiveOn"
            type="date"
            defaultValue={today}
            required
            className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Instances from that date stop; converted history is kept.
        </p>
      </div>
      <input type="hidden" name="scheduleId" value={schedule.id} />
      <input type="hidden" name="version" value={schedule.version} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Cancelling…' : 'Cancel schedule'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export function AddRenewalForm({ data }: { data: RecurringData }) {
  const [state, formAction, pending] = useActionState(addRenewalAction, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Label
          <input
            name="label"
            required
            maxLength={60}
            placeholder="e.g. Vehicle A insurance — InsurerCo"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Next renewal date
          <input name="nextRenewalDate" type="date" required className={inputClass} />
        </label>
        <label className={labelClass}>
          Warn days before
          <input
            name="warnDaysBefore"
            type="number"
            min={0}
            max={365}
            defaultValue={21}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Supplier (optional)
          <select name="supplierId" className={inputClass}>
            <option value="">None</option>
            {data.suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          For
          <select name="target" className={inputClass} defaultValue="household">
            <option value="household">Household</option>
            {data.vehicles.map((vehicle) => (
              <option key={vehicle.id} value={`vehicle-${vehicle.id}`}>
                Vehicle — {vehicle.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input name="repeatsAnnually" type="checkbox" defaultChecked />
          Repeats annually (auto-advances, 29 Feb → 28 Feb)
        </label>
        <label className={labelClass}>
          Notes (optional)
          <input name="notes" maxLength={280} className={inputClass} />
        </label>
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : 'Add renewal'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

/** Slim props (decision 73): the settings page reuses this form without
 *  assembling the full recurring dataset. */
export interface ProjectionSettingsData {
  weeklyGroceriesPence: number | null;
  monthlyFuelPence: Array<{ vehicleId: number; label: string; pence: number | null }>;
}

export function ProjectionSettingsForm({ data }: { data: ProjectionSettingsData }) {
  const [state, formAction, pending] = useActionState(
    saveProjectionSettingsAction,
    initialActionState,
  );
  const toPounds = (pence: number | null) => (pence === null ? '' : (pence / 100).toFixed(2));
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Weekly shop (projected)
          <input
            name="weeklyGroceries"
            inputMode="decimal"
            defaultValue={toPounds(data.weeklyGroceriesPence)}
            placeholder="e.g. 90.00"
            className={inputClass}
          />
        </label>
        {data.monthlyFuelPence.map((vehicle) => (
          <label key={vehicle.vehicleId} className={labelClass}>
            Monthly fuel — {vehicle.label}
            <input
              name={`fuel_${vehicle.vehicleId}`}
              inputMode="decimal"
              defaultValue={toPounds(vehicle.pence)}
              placeholder="e.g. 75.00"
              className={inputClass}
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Blank clears a figure. Each number is one projected event — a weekly shop every 7 days, a
        fill every 30 days per vehicle — counted from when you last recorded one (the Insights
        honesty loop compares them with recent actuals).
      </p>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : 'Save figures'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

/** Convenience: parse a "kind-id" composite from the For select (parent form submits it). */
export function splitCompositeTarget(value: string): { kind: string; id: number | null } {
  const dash = value.indexOf('-');
  if (dash === -1) return { kind: 'household', id: null };
  return { kind: value.slice(0, dash), id: Number(value.slice(dash + 1)) };
}
