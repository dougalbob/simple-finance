'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import {
  addReceiptAction,
  addScheduleAction,
  editReceiptAction,
  editScheduleAction,
} from '@/app/actions';
import { initialActionState } from '@/lib/action-state';
import type { IncomeRecordView, IncomeScheduleView } from '@/lib/records/income-view';

/**
 * Income forms (SPEC §6, §11.3, plan decisions 109–113).
 *
 * Two ways money arrives, two forms: a **scheduled** salary that converts
 * itself every month (edited here on a laptop, which is where the household
 * said they would correct it), and **one-off income** — the bicycle sold for
 * cash, the bank transfer from a buyer, a third-party refund — recorded by
 * hand with an optional source saying what or who it came from.
 *
 * Deliberately desktop-shaped: real labels, wide controls, everything on one
 * screen. Income is not a till-side task for this household, so nothing here
 * is squeezed into the mobile quick-entry panel (plan decision 111).
 */

interface PotOption {
  id: number;
  label: string;
}

function FormMessage({ status, message }: { status: string; message: string | null }) {
  if (message === null) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={status === 'error' ? 'text-sm text-danger' : 'text-sm text-positive'}
    >
      {message}
    </p>
  );
}

const inputClass =
  'rounded border border-border-strong bg-surface px-2.5 py-1.5 text-sm focus:border-border-emphasis focus:outline-none';
const labelClass = 'text-xs font-medium text-ink-soft';
const submitClass =
  'rounded bg-till px-3 py-1.5 text-sm font-medium text-till-ink disabled:opacity-60';

/** Integer pence → the text an amount field expects ("120.00"). */
const penceToAmountText = (pence: number): string => {
  const abs = Math.abs(pence);
  return `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

/**
 * Record one-off income: money that arrived into one pot on one day. Cash or
 * bank transfer is simply which pot it landed in — a sold bicycle paid in
 * cash goes into the cash pot, paid by transfer goes into the bank pot.
 */
export function IncomeEntryForm({
  idPrefix,
  pots,
  today,
}: {
  idPrefix: string;
  pots: PotOption[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(addReceiptAction, initialActionState);
  if (pots.length === 0) {
    return <p className="text-sm text-ink-soft">Create a pot first, then record income.</p>;
  }
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-amount`} className={labelClass}>
            Amount received
          </label>
          <input
            id={`${idPrefix}-amount`}
            name="amount"
            type="text"
            inputMode="decimal"
            required
            placeholder="e.g. 120.00"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-pot`} className={labelClass}>
            Into which pot?
          </label>
          <select id={`${idPrefix}-pot`} name="potId" required className={inputClass}>
            {pots.map((pot) => (
              <option key={pot.id} value={pot.id}>
                {pot.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-date`} className={labelClass}>
            When did it arrive?
          </label>
          <input
            id={`${idPrefix}-date`}
            name="occurredDate"
            type="date"
            required
            defaultValue={today}
            max={today}
            className={inputClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-source`} className={labelClass}>
            What was it / who from? (optional)
          </label>
          <input
            id={`${idPrefix}-source`}
            name="source"
            type="text"
            maxLength={120}
            placeholder="e.g. sale of bicycle"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-note`} className={labelClass}>
            Note (optional)
          </label>
          <input
            id={`${idPrefix}-note`}
            name="note"
            type="text"
            maxLength={280}
            placeholder="e.g. collected in cash, buyer transferred the rest"
            className={inputClass}
          />
        </div>
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Record income'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

/**
 * Correct an income record: pot, amount, date, source, note. The schedule
 * link is immutable in the domain — a converted salary keeps pointing at the
 * instance that produced it, so this form never offers to change it.
 */
export function IncomeEditForm({
  record,
  pots,
  today,
}: {
  record: IncomeRecordView;
  pots: PotOption[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(editReceiptAction, initialActionState);
  const idPrefix = `income-edit-${record.id}`;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="receiptId" value={record.id} />
      <input type="hidden" name="expectedVersion" value={record.version} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-amount`} className={labelClass}>
            Amount
          </label>
          <input
            id={`${idPrefix}-amount`}
            name="amount"
            type="text"
            inputMode="decimal"
            required
            defaultValue={penceToAmountText(record.amountPence)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-pot`} className={labelClass}>
            Pot
          </label>
          <select
            id={`${idPrefix}-pot`}
            name="potId"
            required
            defaultValue={String(record.potId)}
            className={inputClass}
          >
            {pots.map((pot) => (
              <option key={pot.id} value={pot.id}>
                {pot.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-date`} className={labelClass}>
            Date
          </label>
          <input
            id={`${idPrefix}-date`}
            name="occurredDate"
            type="date"
            required
            max={today}
            defaultValue={record.occurredDate}
            className={inputClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-source`} className={labelClass}>
            What it was / who from (blank clears)
          </label>
          <input
            id={`${idPrefix}-source`}
            name="source"
            type="text"
            maxLength={120}
            defaultValue={record.typedSource ?? ''}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-note`} className={labelClass}>
            Note (blank keeps the current note)
          </label>
          <input
            id={`${idPrefix}-note`}
            name="note"
            type="text"
            maxLength={280}
            defaultValue={record.note ?? ''}
            className={inputClass}
          />
        </div>
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

/**
 * Add scheduled income (SPEC §11.3): the expected receipt that defines the
 * payday-to-payday planning cycle and converts itself on its due date. A
 * due day that lands on a weekend is expected on the previous Friday — the
 * household's rule, stated on the form rather than silently applied.
 */
export function IncomeScheduleForm({
  idPrefix,
  pots,
  today,
}: {
  idPrefix: string;
  pots: PotOption[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(addScheduleAction, initialActionState);
  const [frequency, setFrequency] = useState<'monthly' | 'annual'>('monthly');
  if (pots.length === 0) {
    return <p className="text-sm text-ink-soft">Create a pot first, then schedule income.</p>;
  }
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value="receipt" />
      <input type="hidden" name="target" value="" />
      <input type="hidden" name="activeFrom" value={today} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-name`} className={labelClass}>
            What is it?
          </label>
          <input
            id={`${idPrefix}-name`}
            name="name"
            type="text"
            required
            minLength={3}
            maxLength={60}
            defaultValue="Salary"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-amount`} className={labelClass}>
            Amount expected
          </label>
          <input
            id={`${idPrefix}-amount`}
            name="amount"
            type="text"
            inputMode="decimal"
            required
            placeholder="e.g. 2450.00"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-pot`} className={labelClass}>
            Paid into
          </label>
          <select id={`${idPrefix}-pot`} name="potId" required className={inputClass}>
            {pots.map((pot) => (
              <option key={pot.id} value={pot.id}>
                {pot.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-frequency`} className={labelClass}>
            How often?
          </label>
          <select
            id={`${idPrefix}-frequency`}
            name="frequency"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as 'monthly' | 'annual')}
            className={inputClass}
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-day`} className={labelClass}>
            Day of the month
          </label>
          <input
            id={`${idPrefix}-day`}
            name="dueDayOfMonth"
            type="number"
            required
            min={1}
            max={31}
            defaultValue={28}
            className={inputClass}
          />
        </div>
        {frequency === 'annual' ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-month`} className={labelClass}>
              Month
            </label>
            <select
              id={`${idPrefix}-month`}
              name="dueMonth"
              required
              defaultValue={String(new Date().getMonth() + 1)}
              className={inputClass}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-ink-muted">
        A day that lands on a Saturday or Sunday is expected on the Friday before — the app never
        waits for Monday. Short months clamp to their last day (31st → 30th, 28th in February).
      </p>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Add scheduled income'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

/**
 * Edit a scheduled income's name, amount, cadence, day or pot (SPEC §11.1):
 * the change applies **from the next instance onward** — a salary that has
 * already converted for this month is never rewritten.
 */
export function IncomeScheduleEditForm({
  schedule,
  pots,
}: {
  schedule: IncomeScheduleView;
  pots: PotOption[];
}) {
  const [state, formAction, pending] = useActionState(editScheduleAction, initialActionState);
  const [frequency, setFrequency] = useState<'monthly' | 'annual'>(schedule.frequency);
  const idPrefix = `income-schedule-edit-${schedule.scheduleId}`;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="scheduleId" value={schedule.scheduleId} />
      <input type="hidden" name="version" value={schedule.version} />
      <input type="hidden" name="target" value="" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-name`} className={labelClass}>
            What is it?
          </label>
          <input
            id={`${idPrefix}-name`}
            name="name"
            type="text"
            required
            minLength={3}
            maxLength={60}
            defaultValue={schedule.name}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-amount`} className={labelClass}>
            Amount expected
          </label>
          <input
            id={`${idPrefix}-amount`}
            name="amount"
            type="text"
            inputMode="decimal"
            required
            defaultValue={penceToAmountText(schedule.amountPence)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-pot`} className={labelClass}>
            Paid into
          </label>
          <select
            id={`${idPrefix}-pot`}
            name="potId"
            required
            defaultValue={String(schedule.potId)}
            className={inputClass}
          >
            {pots.map((pot) => (
              <option key={pot.id} value={pot.id}>
                {pot.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-frequency`} className={labelClass}>
            How often?
          </label>
          <select
            id={`${idPrefix}-frequency`}
            name="frequency"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as 'monthly' | 'annual')}
            className={inputClass}
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-day`} className={labelClass}>
            Day of the month
          </label>
          <input
            id={`${idPrefix}-day`}
            name="dueDayOfMonth"
            type="number"
            required
            min={1}
            max={31}
            defaultValue={schedule.dueDayOfMonth}
            className={inputClass}
          />
        </div>
        {frequency === 'annual' ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-month`} className={labelClass}>
              Month
            </label>
            <select
              id={`${idPrefix}-month`}
              name="dueMonth"
              required
              defaultValue={String(schedule.dueMonth ?? new Date().getMonth() + 1)}
              className={inputClass}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-until`} className={labelClass}>
              Active until (blank = indefinitely)
            </label>
            <input
              id={`${idPrefix}-until`}
              name="activeUntil"
              type="date"
              defaultValue={schedule.activeUntil ?? ''}
              className={inputClass}
            />
          </div>
        )}
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Save from next instance'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}
