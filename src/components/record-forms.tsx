'use client';

import { useActionState, useState } from 'react';
import {
  addRefundAction,
  addTransferAction,
  editPurchaseAction,
  voidExternalMovementAction,
  voidPurchaseAction,
  voidReceiptAction,
  voidTransferAction,
} from '@/app/actions';
import { initialActionState } from '@/lib/action-state';

export interface EntryLineState {
  amount: string;
  categoryId: number;
  targetKind: 'household' | 'person' | 'vehicle';
  targetId: number | null;
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

export function poundsToPence(value: string): { pence: number | null; error: string | null } {
  const trimmed = value.trim();
  if (trimmed === '') return { pence: null, error: 'An amount is required.' };
  const match = /^£?\s*(-)?(\d{1,9})([.,](\d{1,2}))?$/.exec(trimmed);
  if (match === null) {
    return { pence: null, error: `“${trimmed}” is not a valid amount (use e.g. 12.50).` };
  }
  const sign = match[1] === '-' ? -1 : 1;
  const pounds = Number(match[2]);
  const decimals = match[4] === undefined ? 0 : Number(match[4].padEnd(2, '0'));
  const pence = sign * (pounds * 100 + decimals);
  if (pence === 0) return { pence: null, error: 'Amount must be more than zero.' };
  return { pence, error: null };
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
/**
 * Destructive submit. Deliberately self-contained rather than
 * `${submitClass} … text-danger`: Tailwind resolves competing utilities by
 * their order in the *generated stylesheet*, not by the order in the class
 * attribute, and `.text-till-ink` is emitted after `.text-danger` (verified
 * again in the token build, decision 159) — so layering a colour override on
 * top of `submitClass` produced ink-on-ink (and a 1.09:1 label on hover).
 * Danger label on a surface at rest, inverting to a saturated danger
 * background with a till-ink label on hover (6.42:1 — WCAG AA), which also
 * keeps it legible on a touch screen where `:hover` never applies.
 */
const dangerSubmitClass =
  'rounded border border-danger-300 bg-surface px-3 py-1.5 text-sm font-medium text-danger hover:border-danger hover:bg-danger hover:text-till-ink disabled:opacity-60';

interface LineEditorProps {
  idPrefix: string;
  lines: EntryLineState[];
  setLines: (lines: EntryLineState[]) => void;
  categories: CategoryOption[];
  people: TargetOption[];
  vehicles: TargetOption[];
  allowEmptyCategory?: boolean;
}

/**
 * Shared line editor for purchase edits/refunds (blueprint: same line rules
 * everywhere — total must equal the sum of the lines, enforced server-side;
 * this UI only keeps the input tidy).
 */
function LineEditor({ idPrefix, lines, setLines, categories, people, vehicles }: LineEditorProps) {
  const updateLine = (index: number, patch: Partial<EntryLineState>) => {
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, index) => {
        const personMatches = line.targetKind === 'person';
        const vehicleMatches = line.targetKind === 'vehicle';
        return (
          <div
            key={index}
            className="grid grid-cols-2 items-end gap-2 rounded-lg bg-canvas p-2 sm:grid-cols-12"
          >
            <div className="flex flex-col gap-1 sm:col-span-3">
              <label htmlFor={`${idPrefix}-amount-${index}`} className={labelClass}>
                Amount
              </label>
              <input
                id={`${idPrefix}-amount-${index}`}
                type="text"
                inputMode="decimal"
                required
                value={line.amount}
                onChange={(event) => updateLine(index, { amount: event.target.value })}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-4">
              <label htmlFor={`${idPrefix}-category-${index}`} className={labelClass}>
                Category
              </label>
              <select
                id={`${idPrefix}-category-${index}`}
                required
                value={String(line.categoryId)}
                onChange={(event) => updateLine(index, { categoryId: Number(event.target.value) })}
                className={inputClass}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.parentName} / {category.childName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-3">
              <label htmlFor={`${idPrefix}-target-${index}`} className={labelClass}>
                Spent for
              </label>
              <select
                id={`${idPrefix}-target-${index}`}
                value={line.targetKind}
                onChange={(event) => {
                  const targetKind = event.target.value as EntryLineState['targetKind'];
                  updateLine(index, { targetKind, targetId: null });
                }}
                className={inputClass}
              >
                <option value="household">Household (shared)</option>
                <option value="person">Person</option>
                <option value="vehicle">Vehicle</option>
              </select>
            </div>
            {personMatches || vehicleMatches ? (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label htmlFor={`${idPrefix}-targetid-${index}`} className={labelClass}>
                  Which
                </label>
                <select
                  id={`${idPrefix}-targetid-${index}`}
                  required={personMatches || vehicleMatches}
                  value={line.targetId === null ? '' : String(line.targetId)}
                  onChange={(event) =>
                    updateLine(index, {
                      targetId: event.target.value === '' ? null : Number(event.target.value),
                    })
                  }
                  className={inputClass}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {(personMatches ? people : vehicles).map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() =>
            setLines([
              ...lines,
              {
                amount: '',
                categoryId: categories[0]?.id ?? 0,
                targetKind: 'household',
                targetId: null,
              },
            ])
          }
          className="text-xs font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
        >
          Add a line
        </button>
      </div>
    </div>
  );
}

export interface PurchaseEditFormProps {
  purchaseId: number;
  expectedVersion: number;
  occurredDate: string;
  note: string;
  lines: EntryLineState[];
  categories: CategoryOption[];
  people: TargetOption[];
  vehicles: TargetOption[];
}

/** Full-replacement edit of an ACTIVE purchase (blueprint: void + re-add is
 *  the other path; editing a converted instance is never offered). */
export function PurchaseEditForm(props: PurchaseEditFormProps) {
  const [lines, setLines] = useState<EntryLineState[]>(props.lines);
  const [state, formAction, pending] = useActionState(editPurchaseAction, initialActionState);
  return (
    <form
      action={(formData: FormData) => {
        for (const [index, line] of lines.entries()) {
          const { pence, error } = poundsToPence(line.amount);
          if (pence === null || error !== null) {
            formData.set('clientError', `Line ${index + 1}: ${error}`);
            break;
          }
        }
        formData.set('linesJson', JSON.stringify(lines));
        formAction(formData);
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`edit-purchase-${props.purchaseId}-date`} className={labelClass}>
          When it happened (blank keeps the current date)
        </label>
        <input
          id={`edit-purchase-${props.purchaseId}-date`}
          name="occurredDate"
          type="date"
          defaultValue={props.occurredDate}
          className={inputClass}
        />
      </div>
      <LineEditor
        idPrefix={`edit-purchase-${props.purchaseId}`}
        lines={lines}
        setLines={setLines}
        categories={props.categories}
        people={props.people}
        vehicles={props.vehicles}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={`edit-purchase-${props.purchaseId}-note`} className={labelClass}>
          Note (blank keeps the current note)
        </label>
        <input
          id={`edit-purchase-${props.purchaseId}-note`}
          name="note"
          type="text"
          maxLength={280}
          defaultValue={props.note}
          className={inputClass}
        />
      </div>
      <input type="hidden" name="purchaseId" value={props.purchaseId} />
      <input type="hidden" name="expectedVersion" value={props.expectedVersion} />
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Save purchase'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export interface RefundFormProps {
  purchaseId: number;
  expectedVersion: number;
  occurredDate: string;
  note: string;
  lines: EntryLineState[];
  categories: CategoryOption[];
  people: TargetOption[];
  vehicles: TargetOption[];
  today: string;
}

/**
 * Refund form (negative purchase that links to its original, decision 37).
 * The lines are prefilled from the original purchase as POSITIVE magnitudes;
 * the action flips the signs before calling createRefund.
 */
export function RefundForm(props: RefundFormProps) {
  const [lines, setLines] = useState<EntryLineState[]>(props.lines);
  const [state, formAction, pending] = useActionState(addRefundAction, initialActionState);
  return (
    <form
      action={(formData: FormData) => {
        for (const [index, line] of lines.entries()) {
          const { pence, error } = poundsToPence(line.amount);
          if (pence === null || error !== null) {
            formData.set('clientError', `Line ${index + 1}: ${error}`);
            break;
          }
        }
        formData.set('linesJson', JSON.stringify(lines));
        formAction(formData);
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`refund-${props.purchaseId}-date`} className={labelClass}>
          When the refund landed
        </label>
        <input
          id={`refund-${props.purchaseId}-date`}
          name="occurredDate"
          type="date"
          required
          defaultValue={props.today}
          className={inputClass}
        />
      </div>
      <LineEditor
        idPrefix={`refund-${props.purchaseId}`}
        lines={lines}
        setLines={setLines}
        categories={props.categories}
        people={props.people}
        vehicles={props.vehicles}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={`refund-${props.purchaseId}-note`} className={labelClass}>
          Note (optional)
        </label>
        <input
          id={`refund-${props.purchaseId}-note`}
          name="note"
          type="text"
          maxLength={280}
          defaultValue={props.note}
          className={inputClass}
        />
      </div>
      <input type="hidden" name="purchaseId" value={props.purchaseId} />
      <input type="hidden" name="expectedVersion" value={props.expectedVersion} />
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Record refund'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

interface VoidFormProps {
  kind: 'purchase' | 'transfer' | 'external' | 'receipt';
  recordId: number;
  expectedVersion: number;
  summary: string;
}

/**
 * Generic void form (blueprint: every voidable record shows its void reason
 * field with the same rules). Voids never delete — the record stays in the
 * history with its reason and the actor (decision 6).
 */
export function VoidForm({ kind, recordId, expectedVersion, summary }: VoidFormProps) {
  const [state, formAction, pending] = useActionState(
    kind === 'purchase'
      ? voidPurchaseAction
      : kind === 'transfer'
        ? voidTransferAction
        : kind === 'receipt'
          ? voidReceiptAction
          : voidExternalMovementAction,
    initialActionState,
  );
  return (
    <form action={(formData: FormData) => formAction(formData)} className="flex flex-col gap-2">
      {/* Field names are the contract with the void actions:
          they read `recordId`, `expectedVersion` and `reason`. */}
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <div className="flex flex-col gap-1">
        <label htmlFor={`void-${kind}-${recordId}`} className={labelClass}>
          Why are you voiding this? ({summary})
        </label>
        <input
          id={`void-${kind}-${recordId}`}
          name="reason"
          type="text"
          required
          minLength={4}
          maxLength={280}
          placeholder="e.g. duplicate of the entry above"
          className={inputClass}
        />
      </div>
      <button type="submit" disabled={pending} className={`${dangerSubmitClass} self-start`}>
        {pending ? 'Voiding…' : `Void ${kind === 'receipt' ? 'income' : kind}`}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export interface EntryLineAmounts {
  amountPence: number;
  categoryId: number;
  targetKind: 'household' | 'person' | 'vehicle';
  targetId: number | null;
}

export interface RecentEntryActionsProps {
  purchaseId: number;
  expectedVersion: number;
  occurredDate: string;
  note: string;
  lines: EntryLineAmounts[];
  categories: CategoryOption[];
  people: TargetOption[];
  vehicles: TargetOption[];
  today: string;
  summary: string;
}

const penceToAmountText = (pence: number): string => {
  const abs = Math.abs(pence);
  return `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

/**
 * Inline actions for a recent purchase row (overview + purchases pages):
 * full edit (line replacement), refund (prefilled lines, positive
 * magnitudes — the action flips the signs), or void (reason required).
 */
export function RecentEntryActions(props: RecentEntryActionsProps) {
  const [mode, setMode] = useState<'none' | 'edit' | 'refund' | 'void'>('none');
  const editLines: EntryLineState[] = props.lines.map((line) => ({
    amount: penceToAmountText(line.amountPence),
    categoryId: line.categoryId,
    targetKind: line.targetKind,
    targetId: line.targetId,
  }));
  const refundLines: EntryLineState[] = props.lines.map((line) => ({
    amount: penceToAmountText(line.amountPence),
    categoryId: line.categoryId,
    targetKind: line.targetKind,
    targetId: line.targetId,
  }));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode(mode === 'edit' ? 'none' : 'edit')}
          className="rounded border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink-body hover:bg-canvas"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === 'refund' ? 'none' : 'refund')}
          className="rounded border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink-body hover:bg-canvas"
        >
          Refund
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === 'void' ? 'none' : 'void')}
          className="rounded border border-danger-200 bg-surface px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger-50"
        >
          Void
        </button>
      </div>
      {mode === 'edit' ? (
        <PurchaseEditForm
          purchaseId={props.purchaseId}
          expectedVersion={props.expectedVersion}
          occurredDate={props.occurredDate}
          note={props.note}
          lines={editLines}
          categories={props.categories}
          people={props.people}
          vehicles={props.vehicles}
        />
      ) : null}
      {mode === 'refund' ? (
        <RefundForm
          purchaseId={props.purchaseId}
          expectedVersion={props.expectedVersion}
          occurredDate={props.occurredDate}
          note={props.note}
          lines={refundLines}
          categories={props.categories}
          people={props.people}
          vehicles={props.vehicles}
          today={props.today}
        />
      ) : null}
      {mode === 'void' ? (
        <VoidForm
          kind="purchase"
          recordId={props.purchaseId}
          expectedVersion={props.expectedVersion}
          summary={props.summary}
        />
      ) : null}
    </div>
  );
}

export interface TransferFormProps {
  pots: TargetOption[];
  today: string;
  /** Prefix for control ids — the form renders twice on pages that embed quick entry. */
  idPrefix?: string;
}

/**
 * Transfer form (money moving between the household's own pots — never a
 * bank sync; transfers never enter Insights, SPEC §10/§15.4).
 */
export function TransferForm({ pots, today, idPrefix = 'transfer' }: TransferFormProps) {
  const [state, formAction, pending] = useActionState(addTransferAction, initialActionState);
  if (pots.length < 2) {
    return (
      <p className="text-sm text-ink-soft">
        Create at least two pots before moving money between them.
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-from`} className={labelClass}>
            From pot
          </label>
          <select
            id={`${idPrefix}-from`}
            name="fromPotId"
            required
            defaultValue={String(pots[0]?.id ?? '')}
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
          <label htmlFor={`${idPrefix}-to`} className={labelClass}>
            To pot
          </label>
          <select
            id={`${idPrefix}-to`}
            name="toPotId"
            required
            defaultValue={String(pots[1]?.id ?? '')}
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
          placeholder="e.g. 50.00"
          className={inputClass}
        />
        <p className="text-xs text-ink-muted">
          Recorded as you see it; the ledger books it out of one pot and into the other.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-date`} className={labelClass}>
            When
          </label>
          <input
            id={`${idPrefix}-date`}
            name="occurredDate"
            type="date"
            required
            defaultValue={today}
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
            className={inputClass}
          />
        </div>
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Record transfer'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}
