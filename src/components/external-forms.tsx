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
import { penceInput } from '@/lib/money';
import { lastOccurrenceDate } from '@/lib/records/dates';

interface PotOption {
  id: number;
  label: string;
}

export interface DebtOption {
  id: number;
  counterparty: string;
  direction: 'we_owe' | 'they_owe';
}

/** 1 → "st", 2 → "nd", 3 → "rd", 11–13 and everything else → "th". */
function suffixOf(count: number): string {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return 'th';
  const last = count % 10;
  if (last === 1) return 'st';
  if (last === 2) return 'nd';
  if (last === 3) return 'rd';
  return 'th';
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
const dangerSubmitClass =
  'rounded border border-danger-300 bg-surface px-3 py-1.5 text-sm font-medium text-danger hover:border-danger hover:bg-danger hover:text-fill-ink disabled:opacity-60';

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

/**
 * Correct a debt's name, note or expected inflow. The direction never
 * changes (domain rule). The expected inflow (v0.5.0) is a read-only
 * expectation: it feeds the payday and horizon projections as flagged
 * "expected" money and never counts as received income — the actual deposit
 * still goes through Borrow &amp; repay. The day it lands follows the same
 * payday rule as income: a weekend day shifts back to the Friday before.
 *
 * v0.7.0: the expectation may carry an inclusive **until** date, so an
 * arrangement with an end ("about five months") stops on its own. Changing
 * the day of month later is a plain edit — the occurrences are derived, so
 * future months follow the new day and nothing already recorded moves.
 */
export function DebtEditForm({
  idPrefix,
  debtId,
  version,
  counterparty,
  note,
  expectedInflowAmountPence,
  expectedInflowDayOfMonth,
  expectedInflowUntilDate,
  today,
}: {
  idPrefix: string;
  debtId: number;
  version: number;
  counterparty: string;
  note: string | null;
  expectedInflowAmountPence: number | null;
  expectedInflowDayOfMonth: number | null;
  expectedInflowUntilDate: string | null;
  /** Today's local date — the "continuing for N payments" helper counts from here. */
  today: string;
}) {
  const [state, formAction, pending] = useActionState(editDebtAction, initialActionState);
  const [dayOfMonth, setDayOfMonth] = useState(
    expectedInflowDayOfMonth === null ? '' : String(expectedInflowDayOfMonth),
  );
  const [untilDate, setUntilDate] = useState(expectedInflowUntilDate ?? '');
  const [paymentCount, setPaymentCount] = useState('5');
  const [helperNote, setHelperNote] = useState<string | null>(null);

  const fillEndDate = () => {
    const count = Number(paymentCount);
    const last = lastOccurrenceDate(Number(dayOfMonth), today, count);
    if (last === null) {
      setHelperNote('Enter a day between 1 and 31 and a whole number of payments.');
      return;
    }
    setUntilDate(last);
    setHelperNote(`Set to ${last} — the ${count}${suffixOf(count)} expected payment, inclusive.`);
  };

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
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-inflow`} className={labelClass}>
          Expected support payment
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-muted">£</span>
          <input
            id={`${idPrefix}-inflow`}
            name="expectedInflowAmount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={
              expectedInflowAmountPence === null ? '' : penceInput(expectedInflowAmountPence)
            }
            className={`${inputClass} w-24`}
          />
          <span className="text-sm text-ink-muted">on day</span>
          <input
            id={`${idPrefix}-inflow-day`}
            name="expectedInflowDay"
            type="number"
            min={1}
            max={31}
            placeholder="12"
            aria-label="Day of the month"
            value={dayOfMonth}
            onChange={(event) => setDayOfMonth(event.target.value)}
            className={`${inputClass} w-16`}
          />
          <span className="text-sm text-ink-muted">until</span>
          <input
            id={`${idPrefix}-inflow-until`}
            name="expectedInflowUntil"
            type="date"
            aria-label="Until (optional, inclusive)"
            value={untilDate}
            onChange={(event) => setUntilDate(event.target.value)}
            className={`${inputClass} w-40`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${idPrefix}-inflow-count`} className="text-xs text-ink-soft">
            or continuing for
          </label>
          <input
            id={`${idPrefix}-inflow-count`}
            type="number"
            min={1}
            max={240}
            value={paymentCount}
            onChange={(event) => setPaymentCount(event.target.value)}
            className={`${inputClass} w-16`}
          />
          <span className="text-xs text-ink-soft">payments</span>
          <button
            type="button"
            onClick={fillEndDate}
            className="rounded border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink-body hover:border-border-emphasis"
          >
            Fill the end date
          </button>
          {helperNote !== null ? (
            <span role="status" aria-live="polite" className="text-xs text-ink-soft">
              {helperNote}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Leave the amount and day blank to stop expecting it. The until date is optional and
          inclusive — leave it blank and the expectation runs until you stop it; next January, move
          the day from 10 to 13 and every month after that follows the new day. Expected, never
          received — borrowed money stays owed, it is not income.
        </p>
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
    return <p className="text-sm text-ink-soft">Create a pot first, then record borrowing.</p>;
  }
  if (debts.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
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
    return <p className="text-sm text-ink-soft">Create a pot first.</p>;
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
      <p className="text-sm text-ink-soft">Create at least two pots before recording a swap.</p>
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
            <p className="text-xs text-ink-muted">
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
      <p className="text-sm text-ink-soft">
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
          className="rounded border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-body"
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
      <p className="text-sm text-ink-soft">
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
          className="rounded border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-body"
        >
          Keep it
        </button>
      </div>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}
