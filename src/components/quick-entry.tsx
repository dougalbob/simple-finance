'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useActionState } from 'react';
import {
  addFuelAction,
  addPurchaseAction,
  addCheckpointAction,
  voidDuplicatePurchaseAction,
} from '@/app/actions';
import {
  initialActionState,
  initialPurchaseActionState,
  type ActionState,
  type DuplicateNoticeState,
  type PurchaseActionState,
} from '@/lib/action-state';
import { formatPence, parsePence } from '@/lib/money';

export interface EntryCategoryOption {
  id: number;
  parentName: string;
  childName: string;
}

export interface EntrySupplierOption {
  id: number;
  name: string;
  defaultCategoryId: number | null;
}

export interface EntryPersonOption {
  id: number;
  label: string;
}

export interface EntryVehicleOption {
  id: number;
  label: string;
  ownerPersonId: number | null;
}

export interface EntryPotOption {
  id: number;
  label: string;
}

export interface QuickEntryData {
  pots: EntryPotOption[];
  people: EntryPersonOption[];
  vehicles: EntryVehicleOption[];
  categories: EntryCategoryOption[];
  suppliers: EntrySupplierOption[];
  defaultPotId: number | null;
  defaultPersonId: number | null;
  defaultCategoryId: number | null;
  defaultVehicleId: number | null;
  today: string;
}

type TargetKind = 'household' | 'person' | 'vehicle';
type LineDraft = {
  amount: string;
  categoryId: number | null;
  targetKind: TargetKind;
  targetId: number | null;
};

export function QuickEntry({ data }: { data: QuickEntryData }) {
  const [mode, setMode] = useState<'purchase' | 'fuel' | 'balance'>('purchase');
  return (
    <section
      aria-labelledby="quick-entry-heading"
      className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">
            Quick entry
          </p>
          <h2 id="quick-entry-heading" className="mt-1 text-xl font-semibold">
            Record it while it is fresh
          </h2>
          <p className="mt-1 max-w-xl text-sm text-slate-300">
            Mobile-first entry. Reported balances stay labelled as checkpoints; nothing here is a
            bank connection.
          </p>
        </div>
        <div
          className="flex rounded-lg bg-slate-800 p-1 text-sm"
          role="tablist"
          aria-label="Quick entry type"
        >
          <TabButton active={mode === 'purchase'} onClick={() => setMode('purchase')}>
            Purchase
          </TabButton>
          <TabButton active={mode === 'fuel'} onClick={() => setMode('fuel')}>
            Fuel
          </TabButton>
          <TabButton active={mode === 'balance'} onClick={() => setMode('balance')}>
            Balance
          </TabButton>
        </div>
      </div>

      <div className="mt-5">
        {mode === 'purchase' ? <PurchaseForm data={data} /> : null}
        {mode === 'fuel' ? <FuelForm data={data} /> : null}
        {mode === 'balance' ? <BalanceForm data={data} /> : null}
      </div>
    </section>
  );
}

function PurchaseForm({ data }: { data: QuickEntryData }) {
  const [state, formAction, pending] = useActionState<PurchaseActionState, FormData>(
    addPurchaseAction,
    initialPurchaseActionState,
  );
  const [supplierName, setSupplierName] = useState('');
  const [total, setTotal] = useState('');
  const [potId, setPotId] = useState(data.defaultPotId?.toString() ?? '');
  const [paidByPersonId, setPaidByPersonId] = useState(data.defaultPersonId?.toString() ?? '');
  const [occurredDate, setOccurredDate] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine(data.defaultCategoryId, data)]);
  const submitGuard = useRef(false);

  useEffect(() => {
    if (!pending) submitGuard.current = false;
  }, [pending]);

  const totalPence = parsePence(total);
  const linePence = lines.map((line) => parsePence(line.amount));
  const allocated = linePence.reduce<number | null>(
    (sum, value) => (sum === null || value === null ? null : sum + value),
    0,
  );
  const remaining = totalPence === null || allocated === null ? null : totalPence - allocated;
  const balanced =
    totalPence !== null &&
    totalPence > 0 &&
    remaining === 0 &&
    lines.length > 0 &&
    lines.every((line) => {
      const amount = parsePence(line.amount);
      return (
        amount !== null &&
        amount > 0 &&
        line.categoryId !== null &&
        (line.targetKind === 'household' || line.targetId !== null)
      );
    });
  const exactSupplier = data.suppliers.find(
    (supplier) => normalize(supplier.name) === normalize(supplierName),
  );
  const nearSupplier =
    supplierName.trim() === '' || exactSupplier
      ? null
      : (data.suppliers.find(
          (supplier) => editDistance(normalize(supplier.name), normalize(supplierName)) <= 2,
        ) ?? null);
  const linesJson = JSON.stringify(
    lines.map((line, index) => ({
      amountPence: linePence[index] ?? 0,
      categoryId: line.categoryId ?? 0,
      targetKind: line.targetKind,
      targetId: line.targetKind === 'household' ? null : line.targetId,
    })),
  );

  function selectSupplier(name: string) {
    setSupplierName(name);
    const supplier = data.suppliers.find((item) => normalize(item.name) === normalize(name));
    if (supplier?.defaultCategoryId !== null && supplier?.defaultCategoryId !== undefined) {
      updateLine(0, { categoryId: supplier.defaultCategoryId }, true);
    }
  }

  function updateLine(index: number, patch: Partial<LineDraft>, resetTarget = false) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const next = { ...line, ...patch };
        if (resetTarget && next.categoryId !== line.categoryId) {
          const target = defaultTarget(next.categoryId, data, paidByPersonId);
          next.targetKind = target.kind;
          next.targetId = target.id;
        }
        if (next.targetKind === 'household') next.targetId = null;
        return next;
      }),
    );
  }

  function addSplit() {
    setLines((current) => [...current, newLine(data.defaultCategoryId, data)]);
  }

  function assignRemainder(index: number) {
    if (remaining === null || remaining <= 0) return;
    updateLine(index, { amount: penceInput(remaining) });
  }

  function guardSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitGuard.current) {
      event.preventDefault();
      return;
    }
    submitGuard.current = true;
  }

  function resetForAnother() {
    setTotal('');
    setSupplierName('');
    setOccurredDate('');
    setNote('');
    setLines([newLine(data.defaultCategoryId, data)]);
  }

  return (
    <form
      action={formAction}
      onSubmit={guardSubmit}
      className="grid gap-4 text-slate-900 lg:grid-cols-[1.1fr_1fr]"
    >
      <div className="space-y-3">
        <Field label="Supplier" hint="Recents appear first. Type a new name to add it inline.">
          <input
            name="supplierName"
            value={supplierName}
            onChange={(event) => selectSupplier(event.target.value)}
            list="supplier-options"
            autoComplete="off"
            placeholder="e.g. Tesco (optional)"
            className={inputClass}
          />
          <datalist id="supplier-options">
            {data.suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.name} />
            ))}
          </datalist>
          {nearSupplier ? (
            <p className="mt-1 text-xs text-amber-700">
              Did you mean{' '}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => selectSupplier(nearSupplier.name)}
              >
                {nearSupplier.name}
              </button>
              ?
            </p>
          ) : null}
          {exactSupplier?.defaultCategoryId ? (
            <p className="mt-1 inline-flex rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">
              Most-used category:{' '}
              {data.categories.find((category) => category.id === exactSupplier.defaultCategoryId)
                ?.childName ?? 'remembered'}{' '}
              · changeable below
            </p>
          ) : null}
        </Field>
        <Field label="Amount">
          <input
            name="amount"
            value={total}
            onChange={(event) => setTotal(event.target.value)}
            inputMode="decimal"
            autoFocus
            required
            placeholder="0.00"
            className={`${inputClass} text-2xl font-semibold tabular-nums`}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <ChipSelect
            label="Pot"
            name="potId"
            value={potId}
            onChange={setPotId}
            options={data.pots.map((pot) => ({ value: pot.id, label: pot.label }))}
          />
          <ChipSelect
            label="Paid by"
            name="paidByPersonId"
            value={paidByPersonId}
            onChange={setPaidByPersonId}
            options={data.people.map((person) => ({ value: person.id, label: person.label }))}
          />
          <Field label="Date" hint="Today if left blank.">
            <input
              name="occurredDate"
              type="date"
              value={occurredDate}
              max={data.today}
              onChange={(event) => setOccurredDate(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Note (optional)">
          <input
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={280}
            placeholder="What should future-us know?"
            className={inputClass}
          />
        </Field>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Split the payment</h3>
            <p className="text-xs text-slate-500">
              Each line must have a leaf category and one target.
            </p>
          </div>
          <span
            className={`rounded-full px-2 py-1 text-xs font-semibold ${balanced ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}
          >
            {balanced
              ? 'Matches exactly'
              : remaining === null
                ? 'Enter amount'
                : remaining > 0
                  ? `Remaining ${formatPence(remaining)}`
                  : `Over by ${formatPence(Math.abs(remaining))}`}
          </span>
        </div>
        <div className="mt-3 space-y-3">
          {lines.map((line, index) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="grid gap-2 sm:grid-cols-[0.8fr_1.2fr]">
                <label className="text-xs font-semibold text-slate-600">
                  Line {index + 1} amount
                  <input
                    value={line.amount}
                    onChange={(event) => updateLine(index, { amount: event.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Category
                  <select
                    value={line.categoryId ?? ''}
                    onChange={(event) =>
                      updateLine(index, { categoryId: Number(event.target.value) || null }, true)
                    }
                    className={`${inputClass} mt-1`}
                  >
                    <option value="">Choose category</option>
                    {data.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.parentName} / {category.childName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="text-xs font-semibold text-slate-600">
                  For
                  <select
                    value={line.targetKind}
                    onChange={(event) =>
                      updateLine(index, {
                        targetKind: event.target.value as TargetKind,
                        targetId:
                          event.target.value === 'household'
                            ? null
                            : (data.people[0]?.id ?? data.vehicles[0]?.id ?? null),
                      })
                    }
                    className={`${inputClass} mt-1`}
                  >
                    <option value="household">Household</option>
                    <option value="person">Person</option>
                    <option value="vehicle">Vehicle</option>
                  </select>
                </label>
                {line.targetKind === 'person' ? (
                  <label className="text-xs font-semibold text-slate-600">
                    Person
                    <select
                      value={line.targetId ?? ''}
                      onChange={(event) =>
                        updateLine(index, { targetId: Number(event.target.value) || null })
                      }
                      className={`${inputClass} mt-1`}
                    >
                      <option value="">Choose person</option>
                      {data.people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {line.targetKind === 'vehicle' ? (
                  <label className="text-xs font-semibold text-slate-600">
                    Vehicle
                    <select
                      value={line.targetId ?? ''}
                      onChange={(event) =>
                        updateLine(index, { targetId: Number(event.target.value) || null })
                      }
                      className={`${inputClass} mt-1`}
                    >
                      <option value="">Choose vehicle</option>
                      {data.vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {remaining !== null && remaining > 0 ? (
                  <button
                    type="button"
                    onClick={() => assignRemainder(index)}
                    className="rounded-lg border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Assign remaining
                  </button>
                ) : null}
              </div>
              {lines.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))
                  }
                  className="mt-2 text-xs font-semibold text-red-700 underline"
                >
                  Remove line
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addSplit}
          className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          + Add split
        </button>
        <input type="hidden" name="linesJson" value={linesJson} readOnly />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={pending || !balanced || data.people.length === 0 || data.pots.length === 0}
            className="rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save purchase'}
          </button>
          {state.status === 'ok' ? (
            <button
              type="button"
              onClick={resetForAnother}
              className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700"
            >
              Add another
            </button>
          ) : null}
        </div>
        <EntryMessage state={state} />
      </div>
    </form>
  );
}

function FuelForm({ data }: { data: QuickEntryData }) {
  const [state, formAction, pending] = useActionState<PurchaseActionState, FormData>(
    addFuelAction,
    initialPurchaseActionState,
  );
  const [amount, setAmount] = useState('');
  const [potId, setPotId] = useState(data.defaultPotId?.toString() ?? '');
  const [vehicleId, setVehicleId] = useState(data.defaultVehicleId?.toString() ?? '');
  const [paidByPersonId, setPaidByPersonId] = useState(data.defaultPersonId?.toString() ?? '');
  const [supplierName, setSupplierName] = useState('');
  const [occurredDate, setOccurredDate] = useState('');
  const [note, setNote] = useState('');
  const submitGuard = useRef(false);
  useEffect(() => {
    if (!pending) submitGuard.current = false;
  }, [pending]);
  const canSave =
    parsePence(amount) !== null &&
    parsePence(amount)! > 0 &&
    potId !== '' &&
    vehicleId !== '' &&
    paidByPersonId !== '';
  function guardSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitGuard.current) event.preventDefault();
    submitGuard.current = true;
  }
  return (
    <form
      action={formAction}
      onSubmit={guardSubmit}
      className="grid gap-4 text-slate-900 lg:grid-cols-[0.9fr_1.1fr]"
    >
      <div className="space-y-3">
        <Field label="Fuel amount">
          <input
            name="amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            autoFocus
            required
            placeholder="0.00"
            className={`${inputClass} text-2xl font-semibold tabular-nums`}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChipSelect
            label="Vehicle"
            name="vehicleId"
            value={vehicleId}
            onChange={setVehicleId}
            options={data.vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.label }))}
          />
          <ChipSelect
            label="Paid by"
            name="paidByPersonId"
            value={paidByPersonId}
            onChange={setPaidByPersonId}
            options={data.people.map((person) => ({ value: person.id, label: person.label }))}
          />
        </div>
        <ChipSelect
          label="Pot"
          name="potId"
          value={potId}
          onChange={setPotId}
          options={data.pots.map((pot) => ({ value: pot.id, label: pot.label }))}
        />
        <p className="text-xs text-slate-300">
          Category is fixed to Vehicle Running / Fuel. Flip the vehicle chip when the other car is
          filled.
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-900">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier (optional)">
            <input
              name="supplierName"
              value={supplierName}
              onChange={(event) => setSupplierName(event.target.value)}
              list="fuel-suppliers"
              placeholder="e.g. Petrol Station"
              className={inputClass}
            />
            <datalist id="fuel-suppliers">
              {data.suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Date" hint="Today if blank.">
            <input
              name="occurredDate"
              type="date"
              value={occurredDate}
              max={data.today}
              onChange={(event) => setOccurredDate(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Note (optional)">
          <input
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={280}
            className={inputClass}
          />
        </Field>
        <button
          type="submit"
          disabled={pending || !canSave}
          className="mt-4 rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save fuel'}
        </button>
        <EntryMessage state={state} />
      </div>
    </form>
  );
}

function BalanceForm({ data }: { data: QuickEntryData }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    addCheckpointAction,
    initialActionState,
  );
  const [potId, setPotId] = useState(data.defaultPotId?.toString() ?? '');
  const [amount, setAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [note, setNote] = useState('');
  const submitGuard = useRef(false);
  useEffect(() => {
    if (!pending) submitGuard.current = false;
  }, [pending]);
  function guardSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitGuard.current) event.preventDefault();
    submitGuard.current = true;
  }
  return (
    <form action={formAction} onSubmit={guardSubmit} className="max-w-2xl space-y-3 text-slate-900">
      <div className="grid gap-3 sm:grid-cols-2">
        <ChipSelect
          label="Pot"
          name="potId"
          value={potId}
          onChange={setPotId}
          options={data.pots.map((pot) => ({ value: pot.id, label: pot.label }))}
        />
        <Field label="Balance now" hint="Ledger balance for a bank; counted amount for cash.">
          <input
            name="amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            autoFocus
            required
            placeholder="0.00"
            className={`${inputClass} text-2xl font-semibold tabular-nums`}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Effective date (optional)"
          hint="A date-only checkpoint takes effect at the end of that local day."
        >
          <input
            name="effectiveDate"
            type="date"
            value={effectiveDate}
            max={data.today}
            onChange={(event) => setEffectiveDate(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Note (optional)">
          <input
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={280}
            className={inputClass}
          />
        </Field>
      </div>
      <button
        type="submit"
        disabled={pending || potId === '' || parsePence(amount) === null}
        className="rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save checkpoint'}
      </button>
      <EntryMessage state={state} />
    </form>
  );
}

function DuplicateNotice({ notice }: { notice: DuplicateNoticeState }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    voidDuplicatePurchaseAction,
    initialActionState,
  );
  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">Possible duplicate — the purchase was saved, not blocked.</p>
      <p className="mt-1">
        {notice.enteredBy} recorded a matching {formatPence(notice.totalPence)} entry{' '}
        {notice.minutesAgo === 0 ? 'just now' : `${notice.minutesAgo} minutes ago`}.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <a href={`#purchase-${notice.purchaseId}`} className="font-semibold underline">
          Review entry #{notice.purchaseId}
        </a>
        <input type="hidden" name="version" value={notice.version} />
        <button
          type="submit"
          formAction={formAction}
          name="purchaseId"
          value={notice.purchaseId}
          disabled={pending}
          className="font-semibold underline disabled:opacity-50"
        >
          {pending ? 'Voiding…' : 'Void this copy'}
        </button>
      </div>
      {state.message ? (
        <p
          role="status"
          className={`mt-2 ${state.status === 'error' ? 'text-red-800' : 'text-emerald-800'}`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function EntryMessage({ state }: { state: ActionState | PurchaseActionState }) {
  return (
    <>
      {state.message ? (
        <p
          role="status"
          aria-live="polite"
          className={`mt-3 text-sm ${state.status === 'error' ? 'text-red-700' : 'text-emerald-700'}`}
        >
          {state.message}
        </p>
      ) : null}
      {'duplicateNotice' in state && state.duplicateNotice ? (
        <DuplicateNotice notice={state.duplicateNotice} />
      ) : null}
    </>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md px-3 py-2 font-medium ${active ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'}`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-semibold text-slate-800">
      {label}
      {children}
      <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span>
    </label>
  );
}

function ChipSelect({
  label,
  name,
  value,
  onChange,
  options,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: number; label: string }>;
}) {
  return (
    <label className="block text-sm font-semibold text-slate-800">
      {label}
      <select
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass} mt-1`}
      >
        <option value="">Choose…</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function newLine(defaultCategoryId: number | null, data: QuickEntryData): LineDraft {
  const target = defaultTarget(defaultCategoryId, data, data.defaultPersonId?.toString() ?? '');
  return {
    amount: '',
    categoryId: defaultCategoryId,
    targetKind: target.kind,
    targetId: target.id,
  };
}

function defaultTarget(
  categoryId: number | null,
  data: QuickEntryData,
  paidByPersonId: string,
): { kind: TargetKind; id: number | null } {
  const category = data.categories.find((item) => item.id === categoryId);
  if (category?.parentName === 'Vehicle Running') {
    const own = data.vehicles.find((vehicle) => vehicle.ownerPersonId === Number(paidByPersonId));
    return { kind: 'vehicle', id: own?.id ?? data.defaultVehicleId };
  }
  if (category?.parentName === 'Personal') {
    return { kind: 'person', id: Number(paidByPersonId) || data.defaultPersonId };
  }
  return { kind: 'household', id: null };
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = row[j] ?? 0;
      row[j] =
        left[i - 1] === right[j - 1]
          ? diagonal
          : Math.min(above + 1, (row[j - 1] ?? 0) + 1, diagonal + 1);
      diagonal = above;
    }
  }
  return row[right.length] ?? 99;
}
function penceInput(pence: number): string {
  return (pence / 100).toFixed(2);
}

const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-normal text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200';
