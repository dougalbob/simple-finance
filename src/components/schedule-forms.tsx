'use client';

import { useActionState, useState } from 'react';
import { editRenewalAction, editScheduleAction } from '@/app/actions';
import { initialActionState } from '@/lib/action-state';

const inputClass =
  'rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none';
const labelClass = 'text-xs font-medium text-slate-600';
const submitClass =
  'rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60';

function FormMessage({ status, message }: { status: string; message: string | null }) {
  if (message === null) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={status === 'error' ? 'text-sm text-red-700' : 'text-sm text-emerald-700'}
    >
      {message}
    </p>
  );
}

interface TargetOption {
  id: number;
  label: string;
}

interface CategoryOption {
  id: number;
  parentName: string;
  childName: string;
}

interface TargetPickerProps {
  idPrefix: string;
  targetKind: 'household' | 'person' | 'vehicle';
  targetId: number | null;
  setTarget: (targetKind: 'household' | 'person' | 'vehicle', targetId: number | null) => void;
  people: TargetOption[];
  vehicles: TargetOption[];
}

/** Household / person / vehicle picker (same composite target as entries). */
function TargetPicker({
  idPrefix,
  targetKind,
  targetId,
  setTarget,
  people,
  vehicles,
}: TargetPickerProps) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-targetkind`} className={labelClass}>
          Spent for
        </label>
        <select
          id={`${idPrefix}-targetkind`}
          value={targetKind}
          onChange={(event) => {
            const kind = event.target.value as 'household' | 'person' | 'vehicle';
            setTarget(kind, null);
          }}
          className={inputClass}
        >
          <option value="household">Household (shared)</option>
          <option value="person">Person</option>
          <option value="vehicle">Vehicle</option>
        </select>
      </div>
      {targetKind === 'household' ? null : (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-targetid`} className={labelClass}>
            Which
          </label>
          <select
            id={`${idPrefix}-targetid`}
            required
            value={targetId === null ? '' : String(targetId)}
            onChange={(event) =>
              setTarget(targetKind, event.target.value === '' ? null : Number(event.target.value))
            }
            className={inputClass}
          >
            <option value="" disabled>
              Choose…
            </option>
            {(targetKind === 'person' ? people : vehicles).map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export interface ScheduleEditFormProps {
  scheduleId: number;
  version: number;
  name: string;
  /** Kind is fixed at creation — used only to show/hide the supplier field. */
  kind: 'dd' | 'so' | 'receipt';
  frequency: 'monthly' | 'annual';
  dueDayOfMonth: number;
  dueMonth: number | null;
  amountPence: number;
  contractEndsOn: string | null;
  activeUntil: string | null;
  potId: number;
  potOptions: TargetOption[];
  categoryId: number | null;
  categoryOptions: CategoryOption[];
  supplierId: number | null;
  supplierOptions: TargetOption[];
  targetKind: 'household' | 'person' | 'vehicle';
  targetId: number | null;
  people: TargetOption[];
  vehicles: TargetOption[];
}

/**
 * Edit an active schedule (blueprint: edits apply from the next instance;
 * converted history is never rewritten). The kind is fixed at creation —
 * the domain layer has no kind change on purpose.
 */
export function ScheduleEditForm(props: ScheduleEditFormProps) {
  const [targetKind, setTargetKind] = useState(props.targetKind);
  const [targetId, setTargetId] = useState<number | null>(props.targetId);
  const [supplierMode, setSupplierMode] = useState<string>(
    props.supplierId === null ? '' : String(props.supplierId),
  );
  const [state, formAction, pending] = useActionState(editScheduleAction, initialActionState);
  const amountText = `${Math.trunc(props.amountPence / 100)}.${String(
    Math.abs(props.amountPence % 100),
  ).padStart(2, '0')}`;
  const needsSupplier = props.kind === 'dd' || props.kind === 'so';
  return (
    <form
      action={(formData: FormData) => {
        formData.set(
          'target',
          targetKind === 'household' || targetId === null ? '' : `${targetKind}-${targetId}`,
        );
        formAction(formData);
      }}
      className="flex flex-col gap-2"
      id={`schedule-edit-${props.scheduleId}`}
    >
      <input type="hidden" name="scheduleId" value={props.scheduleId} />
      <input type="hidden" name="version" value={props.version} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor={`schedule-${props.scheduleId}-name`} className={labelClass}>
            Schedule name
          </label>
          <input
            id={`schedule-${props.scheduleId}-name`}
            name="name"
            type="text"
            required
            minLength={3}
            maxLength={60}
            defaultValue={props.name}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`schedule-${props.scheduleId}-freq`} className={labelClass}>
            Frequency
          </label>
          <select
            id={`schedule-${props.scheduleId}-freq`}
            name="frequency"
            defaultValue={props.frequency}
            className={inputClass}
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`schedule-${props.scheduleId}-month`} className={labelClass}>
            Month (annual)
          </label>
          <select
            id={`schedule-${props.scheduleId}-month`}
            name="dueMonth"
            defaultValue={props.dueMonth === null ? '' : String(props.dueMonth)}
            className={inputClass}
          >
            <option value="">Monthly (n/a)</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <div className="flex flex-col gap-1">
          <label htmlFor={`schedule-${props.scheduleId}-day`} className={labelClass}>
            Day of month
          </label>
          <input
            id={`schedule-${props.scheduleId}-day`}
            name="dueDayOfMonth"
            type="number"
            required
            min={1}
            max={31}
            defaultValue={props.dueDayOfMonth}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`schedule-${props.scheduleId}-amount`} className={labelClass}>
            Amount (£)
          </label>
          <input
            id={`schedule-${props.scheduleId}-amount`}
            name="amount"
            type="text"
            inputMode="decimal"
            required
            defaultValue={amountText}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`schedule-${props.scheduleId}-pot`} className={labelClass}>
            Pot
          </label>
          <select
            id={`schedule-${props.scheduleId}-pot`}
            name="potId"
            defaultValue={String(props.potId)}
            className={inputClass}
          >
            {props.potOptions.map((pot) => (
              <option key={pot.id} value={pot.id}>
                {pot.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-3">
          <label htmlFor={`schedule-${props.scheduleId}-category`} className={labelClass}>
            Category (optional)
          </label>
          <select
            id={`schedule-${props.scheduleId}-category`}
            name="categoryId"
            defaultValue={props.categoryId === null ? '' : String(props.categoryId)}
            className={inputClass}
          >
            <option value="">None</option>
            {props.categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.parentName} / {category.childName}
              </option>
            ))}
          </select>
        </div>
      </div>
      {needsSupplier ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`schedule-${props.scheduleId}-supplier`} className={labelClass}>
              Supplier
            </label>
            <select
              id={`schedule-${props.scheduleId}-supplier`}
              name="supplierId"
              required={props.kind === 'dd'}
              value={supplierMode}
              onChange={(event) => setSupplierMode(event.target.value)}
              className={inputClass}
            >
              <option value="" disabled={props.kind === 'dd'}>
                {props.kind === 'dd' ? 'Choose a supplier…' : 'No supplier / household transfer'}
              </option>
              {props.supplierOptions.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.label}
                </option>
              ))}
              <option value="__new__">Add a new supplier…</option>
            </select>
          </div>
          {supplierMode === '__new__' ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={`schedule-${props.scheduleId}-supplier-name`} className={labelClass}>
                New supplier name
              </label>
              <input
                id={`schedule-${props.scheduleId}-supplier-name`}
                name="supplierName"
                type="text"
                required
                maxLength={120}
                placeholder="e.g. Northern Power Co"
                className={inputClass}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <TargetPicker
        idPrefix={`schedule-${props.scheduleId}`}
        targetKind={targetKind}
        targetId={targetId}
        setTarget={(kind, id) => {
          setTargetKind(kind);
          setTargetId(id);
        }}
        people={props.people}
        vehicles={props.vehicles}
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`schedule-${props.scheduleId}-contract`} className={labelClass}>
            Contract ends on (informational, blank clears)
          </label>
          <input
            id={`schedule-${props.scheduleId}-contract`}
            name="contractEndsOn"
            type="date"
            defaultValue={props.contractEndsOn ?? ''}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`schedule-${props.scheduleId}-active`} className={labelClass}>
            Active until (blank = indefinitely)
          </label>
          <input
            id={`schedule-${props.scheduleId}-active`}
            name="activeUntil"
            type="date"
            defaultValue={props.activeUntil ?? ''}
            className={inputClass}
          />
        </div>
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Save from next instance'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export interface RenewalEditFormProps {
  renewalId: number;
  version: number;
  label: string;
  nextRenewalDate: string;
  warnDaysBefore: number;
  repeatsAnnually: boolean;
  supplierId: number | null;
  supplierOptions: TargetOption[];
  targetKind: 'household' | 'person' | 'vehicle';
  targetId: number | null;
  people: TargetOption[];
  vehicles: TargetOption[];
  notes: string;
}

/**
 * Renewal correction (SPEC §22.2 — visible, editable, audited). Renewals are
 * alerts with context: changing the date re-runs the annual advance lazily
 * in the domain layer.
 */
export function RenewalEditForm(props: RenewalEditFormProps) {
  const [targetKind, setTargetKind] = useState(props.targetKind);
  const [targetId, setTargetId] = useState<number | null>(props.targetId);
  const [state, formAction, pending] = useActionState(editRenewalAction, initialActionState);
  return (
    <form
      action={(formData: FormData) => {
        formData.set(
          'target',
          targetKind === 'household' || targetId === null ? '' : `${targetKind}-${targetId}`,
        );
        formAction(formData);
      }}
      className="flex flex-col gap-2"
      id={`renewal-edit-${props.renewalId}`}
    >
      <input type="hidden" name="renewalId" value={props.renewalId} />
      <input type="hidden" name="version" value={props.version} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor={`renewal-${props.renewalId}-label`} className={labelClass}>
            Label
          </label>
          <input
            id={`renewal-${props.renewalId}-label`}
            name="label"
            type="text"
            required
            minLength={3}
            maxLength={60}
            defaultValue={props.label}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`renewal-${props.renewalId}-date`} className={labelClass}>
            Next renewal
          </label>
          <input
            id={`renewal-${props.renewalId}-date`}
            name="nextRenewalDate"
            type="date"
            required
            defaultValue={props.nextRenewalDate}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`renewal-${props.renewalId}-warn`} className={labelClass}>
            Warn days before
          </label>
          <input
            id={`renewal-${props.renewalId}-warn`}
            name="warnDaysBefore"
            type="number"
            required
            min={0}
            max={365}
            defaultValue={props.warnDaysBefore}
            className={inputClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`renewal-${props.renewalId}-supplier`} className={labelClass}>
            Supplier (optional)
          </label>
          <select
            id={`renewal-${props.renewalId}-supplier`}
            name="supplierId"
            defaultValue={props.supplierId === null ? '' : String(props.supplierId)}
            className={inputClass}
          >
            <option value="">None</option>
            {props.supplierOptions.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="repeatsAnnually"
              value="true"
              defaultChecked={props.repeatsAnnually}
              className="h-4 w-4 rounded border-slate-300"
            />
            Repeats annually (renews one year forward automatically)
          </label>
        </div>
      </div>
      <TargetPicker
        idPrefix={`renewal-${props.renewalId}`}
        targetKind={targetKind}
        targetId={targetId}
        setTarget={(kind, id) => {
          setTargetKind(kind);
          setTargetId(id);
        }}
        people={props.people}
        vehicles={props.vehicles}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={`renewal-${props.renewalId}-notes`} className={labelClass}>
          Notes (optional)
        </label>
        <input
          id={`renewal-${props.renewalId}-notes`}
          name="notes"
          type="text"
          maxLength={280}
          defaultValue={props.notes}
          className={inputClass}
        />
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Save renewal'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}
