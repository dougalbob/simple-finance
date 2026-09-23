'use client';

import { useActionState, useState } from 'react';
import {
  addDebtAction,
  addExternalMovementAction,
  addSwapAction,
  archivePotAction,
  editDebtAction,
  editExternalMovementAction,
  voidSwapAction,
} from '@/app/actions';
import { initialActionState } from '@/lib/action-state';

interface PotOption {
  id: number;
  label: string;
}

export interface DebtOption {
  id: number;
  counterparty: string;
  direction: 'we_owe' | 'they_owe';
}

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

const inputClass =
  'rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none';
const labelClass = 'text-xs font-medium text-slate-600';
const submitClass =
  'rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60';
const dangerSubmitClass =
  'rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:border-red-700 hover:bg-red-700 hover:text-white disabled:opacity-60';

/**
 * Start tracking an informal debt (SPEC §10.2): who the money is owed to or
 * by, and which way round. The balance itself always derives from the
 * borrowing and repayment movements recorded against it.
 */
export function DebtForm({ idPrefix }: { idPrefix: string }) {
  const [state, formAction, pending] = useActionState(addDebtAction, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-counterparty`} className={labelClass}>
          Who is it owed to or by?
        </label>
        <input
          id={`${idPrefix}-counterparty`}
          name="counterparty"
          type="text"
          required
          maxLength={120}
          placeholder="e.g. Mum"
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-direction`} className={labelClass}>
          Which way round?
        </label>
        <select id={`${idPrefix}-direction`} name="direction" className={inputClass}>
          <option value="we_owe">We owe them (a loan to pay back)</option>
          <option value="they_owe">They owe us (money lent out)</option>
        </select>
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
          placeholder="e.g. helping with the bills until spring"
          className={inputClass}
        />
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Track this debt'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

/** Correct a debt's name or note. The direction never changes (domain rule). */
export function DebtEditForm({
  idPrefix,
  debtId,
  version,
  counterparty,
  note,
}: {
  idPrefix: string;
  debtId: number;
  version: number;
  counterparty: string;
  note: string | null;
}) {
  const [state, formAction, pending] = useActionState(editDebtAction, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="debtId" value={debtId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-counterparty`} className={labelClass}>
          Who is it owed to or by?
        </label>
        <input
          id={`${idPrefix}-counterparty`}
          name="counterparty"
          type="text"
          required
          maxLength={120}
          defaultValue={counterparty}
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
          defaultValue={note ?? ''}
          className={inputClass}
        />
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Save debt'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

/**
 * Borrow or repay against a tracked debt (SPEC §10.2). Borrowing raises the
 * pot estimate and the owed balance together — it is never income, and
 * repaying is never spending.
 */
export function LoanMovementForm({
  idPrefix,
  pots,
  debts,
  today,
}: {
  idPrefix: string;
  pots: PotOption[];
  debts: DebtOption[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    addExternalMovementAction,
    initialActionState,
  );
  const [debtId, setDebtId] = useState(debts[0] !== undefined ? String(debts[0].id) : '');
  if (pots.length === 0) {
    return <p className="text-sm text-slate-600">Create a pot first, then record borrowing.</p>;
  }
  if (debts.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        Add who it is owed to or by first — borrowing and repayments always link to a tracked debt.
      </p>
    );
  }
  const selected = debts.find((debt) => String(debt.id) === debtId) ?? debts[0];
  const weOwe = (selected?.direction ?? 'we_owe') === 'we_owe';
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value="loan" />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-debt`} className={labelClass}>
            Debt
          </label>
          <select
            id={`${idPrefix}-debt`}
            name="debtId"
            required
            value={debtId}
            onChange={(event) => setDebtId(event.target.value)}
            className={inputClass}
          >
            {debts.map((debt) => (
              <option key={debt.id} value={debt.id}>
                {debt.counterparty} ({debt.direction === 'we_owe' ? 'we owe' : 'owed to us'})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-direction`} className={labelClass}>
            What happened?
          </label>
          <select id={`${idPrefix}-direction`} name="direction" className={inputClass}>
            {weOwe ? (
              <>
                <option value="in">Borrowed — money in</option>
                <option value="out">Repaid — money out</option>
              </>
            ) : (
              <>
                <option value="out">Lent — money out</option>
                <option value="in">Repayment received — money in</option>
              </>
            )}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-pot`} className={labelClass}>
            Pot
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
          <label htmlFor={`${idPrefix}-amount`} className={labelClass}>
            Amount
          </label>
          <input
            id={`${idPrefix}-amount`}
            name="amount"
            type="text"
            inputMode="decimal"
            required
            placeholder="e.g. 200.00"
            className={inputClass}
          />
        </div>
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
            max={today}
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
        {pending ? 'Saving…' : 'Record it'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

/**
 * Other money across the household boundary (SPEC §10.2): not borrowing, not
 * a swap, not salary, not spending — with a note saying what it was, always.
 */
export function OtherMovementForm({
  idPrefix,
  pots,
  today,
}: {
  idPrefix: string;
  pots: PotOption[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    addExternalMovementAction,
    initialActionState,
  );
  if (pots.length === 0) {
    return <p className="text-sm text-slate-600">Create a pot first.</p>;
  }
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value="other" />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-direction`} className={labelClass}>
            Direction
          </label>
          <select id={`${idPrefix}-direction`} name="direction" className={inputClass}>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-pot`} className={labelClass}>
            Pot
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
      <div className="grid grid-cols-2 gap-2">
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
            placeholder="e.g. 25.00"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-counterparty`} className={labelClass}>
            Who from / to?
          </label>
          <input
            id={`${idPrefix}-counterparty`}
            name="counterparty"
            type="text"
            required
            maxLength={120}
            placeholder="e.g. neighbour"
            className={inputClass}
          />
        </div>
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
            max={today}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-note`} className={labelClass}>
            What was it? (required)
          </label>
          <input
            id={`${idPrefix}-note`}
            name="note"
            type="text"
            required
            maxLength={280}
            placeholder="e.g. sold the old bike"
            className={inputClass}
          />
        </div>
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Record it'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

/**
 * A swap with someone outside the household (SPEC §10.2): cash in one hand,
 * a bank transfer in the other. One amount, two pots, recorded as an atomic
 * pair — the household total provably does not move.
 */
export function SwapForm({
  idPrefix,
  pots,
  today,
}: {
  idPrefix: string;
  pots: PotOption[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(addSwapAction, initialActionState);
  if (pots.length < 2) {
    return (
      <p className="text-sm text-slate-600">Create at least two pots before recording a swap.</p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-counterparty`} className={labelClass}>
          Who did you swap with?
        </label>
        <input
          id={`${idPrefix}-counterparty`}
          name="counterparty"
          type="text"
          required
          maxLength={120}
          placeholder="e.g. our son"
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-in`} className={labelClass}>
            Money arrived in
          </label>
          <select
            id={`${idPrefix}-in`}
            name="inPotId"
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
          <label htmlFor={`${idPrefix}-out`} className={labelClass}>
            Money left from
          </label>
          <select
            id={`${idPrefix}-out`}
            name="outPotId"
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
      <div className="grid grid-cols-2 gap-2">
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
            placeholder="e.g. 120.00"
            className={inputClass}
          />
        </div>
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
            max={today}
            className={inputClass}
          />
        </div>
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
          placeholder="e.g. his wages in cash, our bank transfer back"
          className={inputClass}
        />
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Record swap'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

/** Integer pence → the text form's amount field expects ("80.00"). */
const penceToAmountText = (pence: number): string => {
  const abs = Math.abs(pence);
  return `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

export interface EditableMovement {
  id: number;
  version: number;
  kind: 'loan' | 'swap' | 'other';
  potId: number;
  amountPence: number;
  occurredDate: string;
  counterparty: string;
  note: string | null;
}

/**
 * Correct one boundary movement's pot, amount, date, counterparty or note
 * (SPEC §10.2). Kind/direction/debt/exchange are immutable in the domain —
 * for a swap leg that means the pair's net-zero can change (an honest
 * correction), which the Pots page then shows. A blank note keeps the
 * current note, matching the purchase-edit convention.
 */
export function ExternalMovementEditForm({
  idPrefix,
  movement,
  pots,
  today,
}: {
  idPrefix: string;
  movement: EditableMovement;
  pots: PotOption[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    editExternalMovementAction,
    initialActionState,
  );
  const counterpartyLocked = movement.kind === 'loan';
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="movementId" value={movement.id} />
      <input type="hidden" name="expectedVersion" value={movement.version} />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-pot`} className={labelClass}>
            Pot
          </label>
          <select
            id={`${idPrefix}-pot`}
            name="potId"
            className={inputClass}
            defaultValue={String(movement.potId)}
          >
            {pots.map((pot) => (
              <option key={pot.id} value={pot.id}>
                {pot.label}
              </option>
            ))}
          </select>
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
            defaultValue={penceToAmountText(movement.amountPence)}
            className={inputClass}
          />
        </div>
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
            max={today}
            defaultValue={movement.occurredDate}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-counterparty`} className={labelClass}>
            Who
          </label>
          <input
            id={`${idPrefix}-counterparty`}
            name="counterparty"
            type="text"
            required
            maxLength={120}
            defaultValue={movement.counterparty}
            disabled={counterpartyLocked}
            className={inputClass}
          />
          {counterpartyLocked ? (
            <p className="text-xs text-slate-500">
              Borrowing carries the debt&rsquo;s name — rename the debt instead.
            </p>
          ) : null}
        </div>
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
          defaultValue={movement.note ?? ''}
          className={inputClass}
        />
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

/**
 * Void a swap as a pair — both legs in one server action, one shared reason
 * (SPEC §10.2). Two-click confirm, like archive. The single-leg VoidForm
 * stays available for the honest half-correction (one leg genuinely did not
 * happen).
 */
export function VoidSwapPairForm({
  idPrefix,
  exchangeKey,
  inLeg,
  outLeg,
  summary,
}: {
  idPrefix: string;
  exchangeKey: string;
  inLeg: { id: number; version: number };
  outLeg: { id: number; version: number };
  summary: string;
}) {
  const [state, formAction, pending] = useActionState(voidSwapAction, initialActionState);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={dangerSubmitClass}>
        Void both legs
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="exchangeKey" value={exchangeKey} />
      <input type="hidden" name="inLegId" value={inLeg.id} />
      <input type="hidden" name="outLegId" value={outLeg.id} />
      <input type="hidden" name="inLegVersion" value={inLeg.version} />
      <input type="hidden" name="outLegVersion" value={outLeg.version} />
      <p className="text-sm text-slate-600">
        Void &ldquo;{summary}&rdquo;? Both legs are voided together in one step — the history stays.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-reason`} className={labelClass}>
          Why are you voiding both legs?
        </label>
        <input
          id={`${idPrefix}-reason`}
          name="reason"
          type="text"
          required
          minLength={4}
          maxLength={280}
          placeholder="e.g. the swap never happened"
          className={inputClass}
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={dangerSubmitClass}>
          {pending ? 'Voiding…' : 'Yes, void both legs'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
        >
          Keep the swap
        </button>
      </div>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

/** Archive an empty pot, with a quiet two-click confirm. Pots with records refuse (domain rule). */
export function ArchivePotForm({
  potId,
  version,
  label,
}: {
  potId: number;
  version: number;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(archivePotAction, initialActionState);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={dangerSubmitClass}>
        Archive “{label}”
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="potId" value={potId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <p className="text-sm text-slate-600">
        Archive “{label}”? Only a pot with no records can be archived — its history, if any, stays
        visible instead.
      </p>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={dangerSubmitClass}>
          {pending ? 'Archiving…' : 'Yes, archive it'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
        >
          Keep it
        </button>
      </div>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}
