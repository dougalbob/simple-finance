'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import { formatPence, parsePence, penceInput } from '@/lib/money';
import {
  followedLineAmount,
  nearestSupplierName,
  normalizeSupplierQuery,
  rankSupplierMatches,
} from '@/lib/records/quick-entry';
import { TransferForm } from '@/components/record-forms';
import {
  DebtForm,
  LoanMovementForm,
  OtherMovementForm,
  SwapForm,
} from '@/components/external-forms';

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

export interface EntryCheckpoint {
  amountPence: number;
  /** When the household reported it (ISO), for the timestamp tooltip. */
  effectiveAtIso: string;
  /** Rendered on the server ("2 days ago") so the client never re-derives time. */
  ageLabel: string;
  /** Rendered on the server: the absolute local time of the report. */
  reportedAtLabel: string;
}

export interface EntryDueLine {
  name: string;
  amountPence: number;
  dueDate: string;
  /** Rendered on the server, e.g. "Fri 27 Sep". */
  dueLabel: string;
}

export interface EntryPotOption {
  id: number;
  label: string;
  /** Bank pots show a reported balance; cash pots never do (SPEC §15.1). */
  kind: 'bank' | 'cash';
  /** The last reported balance (SPEC §5); null when never checkpointed, or for cash. */
  checkpoint: EntryCheckpoint | null;
  /** Available now (SPEC §7.1); null when the pot has no checkpoint. */
  estimatePence: number | null;
  /** What is left after this pot's own bills leave, before income lands (SPEC §7.7). */
  spendablePence: number | null;
  /** How far short of its own bills the pot would be; null when it covers them. */
  shortfallPence: number | null;
  /** The bills that leave this pot before income lands, soonest first. */
  dueBeforeIncome: EntryDueLine[];
}

/**
 * The household-wide half of the balance display (SPEC §7.7): what is left
 * once everything already expected to leave before the next income has left.
 * Deliberately excludes the income itself — the dip before it lands is the
 * number that decides whether a card bounces.
 */
export interface EntryCycleOutlook {
  incomeDate: string | null;
  incomeSource: string | null;
  days: number;
  householdAvailablePence: number | null;
  /** Bills (DD/SO) due before income lands. */
  commitmentsPence: number;
  /** Projected weekly shop / fuel events due before income lands (SPEC §7.3). */
  dayToDayPence: number;
  freeToSpendPence: number | null;
  /** Rendered on the server, e.g. "Tue 30 Sep". */
  incomeDateLabel: string | null;
  lowDate: string | null;
  lowDateLabel: string | null;
}

export interface EntryDebtOption {
  id: number;
  counterparty: string;
  direction: 'we_owe' | 'they_owe';
}

export interface QuickEntryData {
  pots: EntryPotOption[];
  people: EntryPersonOption[];
  vehicles: EntryVehicleOption[];
  categories: EntryCategoryOption[];
  suppliers: EntrySupplierOption[];
  debts: EntryDebtOption[];
  defaultPotId: number | null;
  defaultPersonId: number | null;
  defaultCategoryId: number | null;
  defaultVehicleId: number | null;
  today: string;
  cycle: EntryCycleOutlook;
}

type TargetKind = 'household' | 'person' | 'vehicle';
type LineDraft = {
  amount: string;
  categoryId: number | null;
  targetKind: TargetKind;
  targetId: number | null;
};

export function QuickEntry({ data }: { data: QuickEntryData }) {
  const [mode, setMode] = useState<'purchase' | 'fuel' | 'balance' | 'move'>('purchase');
  /**
   * Until React has hydrated this island, a tap switches nothing and a
   * keystroke in a controlled input is wiped by the hydration render. So the
   * till says whether it is listening (SPEC §15.1): `data-till-ready` is the
   * form's own signal, and `inert` keeps it from silently swallowing input it
   * cannot act on yet.
   */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return (
    <section
      aria-labelledby="quick-entry-heading"
      data-till-ready={ready ? 'true' : 'false'}
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
          inert={!ready}
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
          <TabButton active={mode === 'move'} onClick={() => setMode('move')}>
            Move
          </TabButton>
        </div>
      </div>

      <div inert={!ready} className="mt-5">
        {mode === 'purchase' ? <PurchaseForm data={data} /> : null}
        {mode === 'fuel' ? <FuelForm data={data} /> : null}
        {mode === 'balance' ? <BalanceForm data={data} /> : null}
        {mode === 'move' ? <MoveForm data={data} /> : null}
      </div>
    </section>
  );
}

/**
 * Move money while it is fresh (SPEC §10.2): between the household's own
 * pots, borrowing and repayments, swaps with someone outside the household,
 * and other money in or out. The light card keeps the shared desktop forms
 * legible inside the dark quick-entry panel — one form component, both
 * pages, no drift.
 */
function MoveForm({ data }: { data: QuickEntryData }) {
  const [mode, setMode] = useState<'transfer' | 'loan' | 'swap' | 'other'>('transfer');
  return (
    <div className="rounded-xl bg-white p-3 text-slate-900 sm:p-4">
      <div
        className="mb-3 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-sm"
        role="tablist"
        aria-label="Move money type"
      >
        <MoveTabButton active={mode === 'transfer'} onClick={() => setMode('transfer')}>
          Between pots
        </MoveTabButton>
        <MoveTabButton active={mode === 'loan'} onClick={() => setMode('loan')}>
          Borrow &amp; repay
        </MoveTabButton>
        <MoveTabButton active={mode === 'swap'} onClick={() => setMode('swap')}>
          Swap
        </MoveTabButton>
        <MoveTabButton active={mode === 'other'} onClick={() => setMode('other')}>
          Other
        </MoveTabButton>
      </div>
      {mode === 'transfer' ? (
        <div>
          <p className="mb-3 text-xs text-slate-500">
            Between your own pots — the household total does not move, and spending is untouched.
          </p>
          <TransferForm pots={data.pots} today={data.today} idPrefix="quick-transfer" />
        </div>
      ) : null}
      {mode === 'loan' ? (
        <div>
          <p className="mb-3 text-xs text-slate-500">
            Borrowing raises what you owe; repayments reduce it. Never income, never spending.
          </p>
          <LoanMovementForm
            idPrefix="quick-loan"
            pots={data.pots}
            debts={data.debts}
            today={data.today}
          />
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              Someone new? Track them first
            </summary>
            <div className="mt-2">
              <DebtForm idPrefix="quick-debt" />
            </div>
          </details>
        </div>
      ) : null}
      {mode === 'swap' ? (
        <div>
          <p className="mb-3 text-xs text-slate-500">
            Cash in one hand, a bank transfer in the other — recorded as one pair, so the household
            total provably does not move.
          </p>
          <SwapForm idPrefix="quick-swap" pots={data.pots} today={data.today} />
        </div>
      ) : null}
      {mode === 'other' ? (
        <div>
          <p className="mb-3 text-xs text-slate-500">
            Anything else across the household boundary — always with a note saying what it was.
          </p>
          <OtherMovementForm idPrefix="quick-other" pots={data.pots} today={data.today} />
        </div>
      ) : null}
    </div>
  );
}

function MoveTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex-1 rounded-md px-2 py-1.5 font-medium whitespace-nowrap ${
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The till form (SPEC §15.1, redesigned v0.9.0). Panel 1 is the whole job:
 * the pot, what the bank last said, what is left before income lands, who you
 * paid, how much, save. Panel 2 holds the category, the "For" target and the
 * split lines for the purchases that need them.
 *
 * On a phone the two panels are a horizontally scrollable, scroll-snapped
 * pair — native CSS, no gesture library, and the swipe is enhancement rather
 * than a requirement: Save sits on both panels, so a purchase is always
 * completable from Panel 1 alone. On a laptop the panels are the original two
 * columns and the snap container stops scrolling.
 */
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
  /** Most purchases at a till need no note at all, so the field waits behind "+ Note". */
  const [noteOpen, setNoteOpen] = useState(false);
  /** Which swipe panel the phone is showing. Desktop shows both and ignores it. */
  const [panel, setPanel] = useState(0);
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine(data.defaultCategoryId, data)]);
  /**
   * Mobile Quick Entry (SPEC §15.1): Line 1 follows the amount typed at the
   * till, so the household types the total once and Save can enable without
   * retyping it on the split line. The flag turns off for good when the user
   * takes the line over — editing the Line 1 amount, "+ Add split", or Assign
   * remaining — and only "Add another" starts the following again.
   */
  const [lineFollowsTotal, setLineFollowsTotal] = useState(true);
  const submitGuard = useRef(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const supplierRef = useRef<HTMLInputElement | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!pending) submitGuard.current = false;
  }, [pending]);

  /**
   * Focus order at the till (SPEC §15.1): who you paid → how much → save.
   * The form lands on the supplier; picking a remembered supplier moves the
   * caret to the amount. Nothing here re-grabs focus later.
   */
  useEffect(() => {
    supplierRef.current?.focus();
  }, []);

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
    (supplier) => normalizeSupplierQuery(supplier.name) === normalizeSupplierQuery(supplierName),
  );
  const nearSupplier =
    supplierName.trim() === '' || exactSupplier
      ? null
      : nearestSupplierName(data.suppliers, supplierName);
  const selectedPot = data.pots.find((pot) => pot.id.toString() === potId) ?? null;
  const linesJson = JSON.stringify(
    lines.map((line, index) => ({
      amountPence: linePence[index] ?? 0,
      categoryId: line.categoryId ?? 0,
      targetKind: line.targetKind,
      targetId: line.targetKind === 'household' ? null : line.targetId,
    })),
  );
  // A pot is as required as a balanced split: v0.9.0 lets the form start with
  // none selected, and the server refuses a purchase without one.
  const canSave =
    pending ||
    !balanced ||
    selectedPot === null ||
    data.people.length === 0 ||
    data.pots.length === 0;

  function selectSupplier(name: string) {
    setSupplierName(name);
    const supplier = data.suppliers.find(
      (item) => normalizeSupplierQuery(item.name) === normalizeSupplierQuery(name),
    );
    if (supplier?.defaultCategoryId !== null && supplier?.defaultCategoryId !== undefined) {
      updateLine(0, { categoryId: supplier.defaultCategoryId }, true);
    }
  }

  /** Tapping a suggestion: fill the name, apply its category memory, move to Amount. */
  function pickSupplier(name: string) {
    selectSupplier(name);
    amountRef.current?.focus();
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

  /**
   * The Quick Entry amount, and the mirrored Line 1. Only the Line 1 amount
   * field takes the line over — `updateLine` is shared with category, target,
   * pot, paid-by, date and note changes (and with `selectSupplier`'s
   * most-used-category write), none of which may stop the following.
   */
  function changeTotal(value: string) {
    setTotal(value);
    if (!lineFollowsTotal) return;
    const followed = followedLineAmount(value);
    if (followed.action === 'hold') return;
    const amount = followed.action === 'set' ? followed.amount : '';
    setLines((current) => {
      const first = current[0];
      // One line only: an extra line means the user is splitting deliberately.
      if (current.length !== 1 || first === undefined || first.amount === amount) return current;
      return [{ ...first, amount }];
    });
  }

  function updateLineAmount(index: number, amount: string) {
    if (index === 0) setLineFollowsTotal(false);
    updateLine(index, { amount });
  }

  function addSplit() {
    // "+ Add split" stops the following for good: the new line stays empty and
    // Line 1 is neither cleared nor shrunk, even if the extra line is removed
    // again. Only "Add another" starts it over.
    setLineFollowsTotal(false);
    setLines((current) => [...current, newLine(data.defaultCategoryId, data)]);
  }

  function assignRemainder(index: number) {
    if (remaining === null || remaining <= 0) return;
    // Assign remaining writes a line by hand; on Line 1 that is a takeover.
    updateLineAmount(index, penceInput(remaining));
  }

  function guardSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitGuard.current) {
      event.preventDefault();
      return;
    }
    submitGuard.current = true;
  }

  /** Move the phone between the two panels (the dots); desktop ignores it. */
  function showPanel(index: number) {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const target = scroller.querySelectorAll<HTMLElement>('[data-panel]')[index];
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }

  /** Reading a scroll position back into the dots keeps them honest when the thumb does the swiping. */
  function readPanel(event: React.UIEvent<HTMLDivElement>) {
    const scroller = event.currentTarget;
    if (scroller.clientWidth === 0) return;
    setPanel(Math.round(scroller.scrollLeft / scroller.clientWidth));
  }

  function resetForAnother() {
    setTotal('');
    setSupplierName('');
    setOccurredDate('');
    setNote('');
    setNoteOpen(false);
    setLines([newLine(data.defaultCategoryId, data)]);
    setLineFollowsTotal(true);
    // A fresh entry starts where every entry starts: Panel 1, on the supplier.
    showPanel(0);
    supplierRef.current?.focus();
  }

  return (
    <form action={formAction} onSubmit={guardSubmit} className="text-slate-900">
      <div
        ref={scrollerRef}
        onScroll={readPanel}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-[1.05fr_1fr] lg:gap-4 lg:overflow-visible lg:pb-0"
      >
        {/* Panel 1 — record it */}
        <div data-panel="0" className="min-w-full snap-start lg:min-w-0">
          <div className="space-y-3 rounded-xl bg-white p-3">
            <ChipSelect
              label="Pot"
              name="potId"
              value={potId}
              onChange={setPotId}
              options={data.pots.map((pot) => ({ value: pot.id, label: pot.label }))}
            />
            {potId === '' ? (
              <p className="text-xs font-semibold text-amber-700">
                Choose the pot this came out of — no default is set, so nothing is preselected.
              </p>
            ) : null}
            <PotBalance pot={selectedPot} />
            <CycleSummary cycle={data.cycle} />

            <SupplierTypeahead
              inputRef={supplierRef}
              value={supplierName}
              options={data.suppliers}
              categories={data.categories}
              onChange={selectSupplier}
              onPick={pickSupplier}
            />
            {nearSupplier ? (
              <p className="text-xs text-amber-700">
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

            <Field label="Amount">
              <input
                ref={amountRef}
                name="amount"
                value={total}
                onChange={(event) => changeTotal(event.target.value)}
                inputMode="decimal"
                required
                placeholder="0.00"
                className={`${inputClass} text-2xl font-semibold tabular-nums`}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <ChipSelect
                label="Paid by"
                name="paidByPersonId"
                value={paidByPersonId}
                onChange={setPaidByPersonId}
                options={data.people.map((person) => ({ value: person.id, label: person.label }))}
              />
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

            {noteOpen ? (
              <Field label="Note (optional)">
                <input
                  name="note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={280}
                  autoFocus
                  placeholder="What should future-us know?"
                  className={inputClass}
                />
              </Field>
            ) : (
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="rounded-lg px-1 py-2 text-sm font-semibold text-sky-700 underline decoration-dotted"
              >
                + Note
              </button>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={canSave}
                className="min-h-[48px] flex-1 rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? 'Saving…' : 'Save purchase'}
              </button>
              {state.status === 'ok' ? (
                <button
                  type="button"
                  onClick={resetForAnother}
                  className="min-h-[48px] rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  Add another
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Panel 2 — the details (category, target, splits) */}
        <div data-panel="1" className="min-w-full snap-start lg:min-w-0">
          <div className="space-y-3 rounded-xl bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">Category &amp; allocation</h3>
                <p className="text-xs text-slate-500">
                  Each line needs a leaf category and one target.
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

            <p className="rounded-md bg-slate-50 px-2 py-1.5 text-xs tabular-nums text-slate-600">
              {allocationSummary(lines, data)}
            </p>

            <div className="space-y-3">
              {lines.map((line, index) => (
                <div key={index} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="grid gap-2 sm:grid-cols-[0.8fr_1.2fr]">
                    <label className="text-xs font-semibold text-slate-600">
                      {lines.length > 1 ? `Line ${index + 1} amount` : 'Amount'}
                      <input
                        aria-label={`Line ${index + 1} amount`}
                        value={line.amount}
                        onChange={(event) => updateLineAmount(index, event.target.value)}
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
                          updateLine(
                            index,
                            { categoryId: Number(event.target.value) || null },
                            true,
                          )
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
                  <div className="mt-2 space-y-1.5">
                    <div
                      role="group"
                      aria-label={`For line ${index + 1}`}
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      <span className="mr-0.5 text-xs font-semibold text-slate-600">For</span>
                      <TargetChip
                        active={line.targetKind === 'household'}
                        onClick={() =>
                          updateLine(index, { targetKind: 'household', targetId: null })
                        }
                      >
                        Household
                      </TargetChip>
                      <TargetChip
                        active={line.targetKind === 'person'}
                        onClick={() =>
                          updateLine(index, {
                            targetKind: 'person',
                            targetId: data.people[0]?.id ?? null,
                          })
                        }
                      >
                        Person
                      </TargetChip>
                      <TargetChip
                        active={line.targetKind === 'vehicle'}
                        onClick={() =>
                          updateLine(index, {
                            targetKind: 'vehicle',
                            targetId: data.vehicles[0]?.id ?? null,
                          })
                        }
                      >
                        Vehicle
                      </TargetChip>
                    </div>
                    {line.targetKind === 'person' ? (
                      <div
                        role="group"
                        aria-label={`Person for line ${index + 1}`}
                        className="flex flex-wrap gap-1.5"
                      >
                        {data.people.map((person) => (
                          <TargetChip
                            key={person.id}
                            active={line.targetId === person.id}
                            onClick={() => updateLine(index, { targetId: person.id })}
                          >
                            {person.label}
                          </TargetChip>
                        ))}
                      </div>
                    ) : null}
                    {line.targetKind === 'vehicle' ? (
                      <div
                        role="group"
                        aria-label={`Vehicle for line ${index + 1}`}
                        className="flex flex-wrap gap-1.5"
                      >
                        {data.vehicles.map((vehicle) => (
                          <TargetChip
                            key={vehicle.id}
                            active={line.targetId === vehicle.id}
                            onClick={() => updateLine(index, { targetId: vehicle.id })}
                          >
                            {vehicle.label}
                          </TargetChip>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {remaining !== null && remaining > 0 ? (
                    <button
                      type="button"
                      onClick={() => assignRemainder(index)}
                      className="mt-2 rounded-lg border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Assign remaining
                    </button>
                  ) : null}
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))
                      }
                      className="mt-2 block text-xs font-semibold text-red-700 underline"
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
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              + Add split
            </button>
            <input type="hidden" name="linesJson" value={linesJson} readOnly />

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={canSave}
                className="min-h-[48px] flex-1 rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? 'Saving…' : 'Save purchase'}
              </button>
              {state.status === 'ok' ? (
                <button
                  type="button"
                  onClick={resetForAnother}
                  className="min-h-[48px] rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  Add another
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <PanelHint panel={panel} onShow={showPanel} />
      {/* One message for the whole form, whichever panel saved it. */}
      <EntryMessage state={state} />
    </form>
  );
}

/**
 * The pot's own two figures (SPEC §7.7): the **last reported checkpoint** —
 * what the bank showed when the household last looked, with its age, exactly
 * as it is stored, not an estimate and not a projection — and, only when the
 * alarm is real, the shortfall that pot would hit before income lands. Cash
 * pots show nothing: the household counts the notes, and a stale number would
 * be worse than none (SPEC §15.1).
 */
function PotBalance({ pot }: { pot: EntryPotOption | null }) {
  if (pot === null) {
    return (
      <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
        Pick the pot the money left — its last reported balance appears here.
      </p>
    );
  }
  if (pot.kind === 'cash') {
    return (
      <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
        Cash pot — no balance is shown for cash. Count the notes when it matters.
      </p>
    );
  }
  const firstDue = pot.dueBeforeIncome[0];
  return (
    <div className="rounded-lg bg-slate-50 p-2.5">
      {pot.checkpoint === null ? (
        <p className="text-xs text-slate-600">
          Never checkpointed — this pot has no reported balance and no estimate, by design.
        </p>
      ) : (
        <p className="text-xs text-slate-600">
          Last reported{' '}
          <span
            className="font-semibold tabular-nums text-slate-900"
            title={pot.checkpoint.reportedAtLabel}
          >
            {formatPence(pot.checkpoint.amountPence)}
          </span>{' '}
          · {pot.checkpoint.ageLabel}
          <span className="text-slate-400"> ({pot.checkpoint.reportedAtLabel})</span>
        </p>
      )}
      {pot.shortfallPence !== null ? (
        <p className="mt-1.5 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
          {pot.label} would be {formatPence(pot.shortfallPence)} short before income lands
          {firstDue !== undefined
            ? ` — ${firstDue.name} ${formatPence(firstDue.amountPence)} on ${firstDue.dueLabel}`
            : ''}
          .
        </p>
      ) : null}
    </div>
  );
}

/**
 * The household headline (SPEC §7.7): what is left once everything already
 * expected to leave before the next income has left. The income itself is
 * deliberately **not** counted — the household asked for the mortgage that
 * bounces three days before payday to be visible while standing in a shop,
 * and adding the salary back in would hide exactly that dip. The two lines
 * that make the figure up are always spelled out beneath it.
 */
function CycleSummary({ cycle }: { cycle: EntryCycleOutlook }) {
  if (cycle.incomeDate === null) {
    return (
      <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
        No expected income is scheduled yet, so there is no “before income lands” figure. Add it in
        Recurring payments and it appears here.
      </p>
    );
  }
  if (cycle.freeToSpendPence === null) {
    return (
      <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
        Free to spend before {cycle.incomeDateLabel}: record a balance checkpoint and this figure
        appears here.
      </p>
    );
  }
  const negative = cycle.freeToSpendPence < 0;
  return (
    <div
      className={`rounded-lg p-2.5 ${negative ? 'bg-rose-50 ring-1 ring-rose-200' : 'bg-slate-50'}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Free to spend before income
        </span>
        <span
          className={`text-2xl font-semibold tabular-nums ${negative ? 'text-rose-700' : 'text-slate-900'}`}
        >
          {formatPence(cycle.freeToSpendPence)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        {cycle.incomeSource ?? 'Income'} lands {cycle.incomeDateLabel} (
        {cycle.days === 1 ? '1 day' : `${cycle.days} days`}). {beforeIncomeSentence(cycle)}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        A projection of the records in this app — never a bank balance.
      </p>
    </div>
  );
}

/**
 * Supplier typeahead (SPEC §15.1, v0.9.0). The household's verdict on the old
 * `<datalist>` was "fiddly on a phone": it handed the list to a browser popup
 * that covers the form and behaves differently on every device. This keeps the
 * same data — recents first, matches as you type — in an inline list of
 * tappable rows. No library, no request: the options already arrived with the
 * page.
 */
function SupplierTypeahead({
  value,
  options,
  categories,
  inputRef,
  onChange,
  onPick,
}: {
  value: string;
  options: EntrySupplierOption[];
  categories: EntryCategoryOption[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onPick: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = rankSupplierMatches(options, value, 6);
  const listId = 'supplier-typeahead-list';

  function commit(name: string) {
    onPick(name);
    setOpen(false);
    setActive(-1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (matches.length === 0 ? -1 : (current + 1) % matches.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) =>
        matches.length === 0 ? -1 : (current - 1 + matches.length) % matches.length,
      );
      return;
    }
    if (event.key === 'Enter' && active >= 0) {
      // Enter with a row highlighted picks the row; otherwise it submits the
      // form, which is what a household mid-flow expects from Enter.
      const match = matches[active];
      if (match !== undefined) {
        event.preventDefault();
        commit(match.name);
      }
      return;
    }
    if (event.key === 'Escape') setOpen(false);
  }

  return (
    <div>
      <label className="block text-sm font-semibold text-slate-800">
        Supplier
        <input
          ref={inputRef}
          name="supplierName"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="e.g. Tesco (optional)"
          className={`${inputClass} mt-1`}
        />
      </label>
      <span className="mt-1 block text-xs font-normal text-slate-500">
        {value.trim() === ''
          ? 'Recent suppliers first — tap one.'
          : 'Tap a match, or keep typing a new name.'}
      </span>
      {open && matches.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Supplier suggestions"
          className="mt-1 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
        >
          {matches.map((supplier, index) => (
            <li key={supplier.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                // Keep the caret in the field so a tap never has to fight a blur.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(supplier.name)}
                className={`flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${index === active ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
              >
                <span className="font-medium">{supplier.name}</span>
                {supplier.defaultCategoryId !== null ? (
                  <span className="text-xs text-slate-500">
                    {categories.find((category) => category.id === supplier.defaultCategoryId)
                      ?.childName ?? 'remembered'}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A tappable chip for the "For" target; the hidden `linesJson` carries the value. */
function TargetChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[36px] rounded-full border px-3 py-1.5 text-sm font-medium ${
        active
          ? 'border-sky-300 bg-sky-100 text-sky-900'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

/** The phone's "there is a second panel" cue: two dots and a one-line hint. */
function PanelHint({ panel, onShow }: { panel: number; onShow: (index: number) => void }) {
  return (
    <div className="mt-3 flex items-center justify-center gap-3 lg:hidden">
      {[0, 1].map((index) => (
        <button
          key={index}
          type="button"
          aria-label={index === 0 ? 'Show the entry panel' : 'Show the details panel'}
          aria-pressed={panel === index}
          onClick={() => onShow(index)}
          className={`h-2.5 w-2.5 rounded-full ${panel === index ? 'bg-sky-300' : 'bg-slate-600'}`}
        />
      ))}
      <span className="text-xs text-slate-300">
        {panel === 0 ? 'Swipe → category & splits' : 'Swipe ← back to the entry'}
      </span>
    </div>
  );
}

/** What leaves the household before income lands, in one honest sentence. */
function beforeIncomeSentence(cycle: EntryCycleOutlook): string {
  const leaving = [
    cycle.commitmentsPence > 0 ? `${formatPence(cycle.commitmentsPence)} of bills` : null,
    cycle.dayToDayPence > 0
      ? `${formatPence(cycle.dayToDayPence)} of projected shopping & fuel`
      : null,
  ].filter((part): part is string => part !== null);
  const low =
    cycle.lowDateLabel === null ? '' : ` The money bottoms out around ${cycle.lowDateLabel}.`;
  if (leaving.length === 0) {
    return `Nothing else is expected to leave before then.${low} Nothing coming in is counted.`;
  }
  return `${leaving.join(' and ')} leave before then.${low} Nothing coming in is counted.`;
}

/** The one-line "what will be saved" summary above the lines (SPEC §15.1). */
function allocationSummary(lines: LineDraft[], data: QuickEntryData): string {
  return lines
    .map((line, index) => {
      const amount = parsePence(line.amount);
      const category = data.categories.find((item) => item.id === line.categoryId);
      const target =
        line.targetKind === 'household'
          ? 'Household'
          : line.targetKind === 'person'
            ? (data.people.find((person) => person.id === line.targetId)?.label ?? 'Person')
            : (data.vehicles.find((vehicle) => vehicle.id === line.targetId)?.label ?? 'Vehicle');
      const label = lines.length > 1 ? `Line ${index + 1}: ` : '';
      return `${label}${amount === null ? '—' : formatPence(amount)} · ${
        category === undefined ? 'no category' : `${category.parentName} / ${category.childName}`
      } · ${target}`;
    })
    .join('   |   ');
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
      {/* Light card: the dark quick-entry panel behind it made dark labels
          unreadable (contrast fix, v0.9.0). */}
      <div className="space-y-3 rounded-xl bg-white p-3">
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
        <p className="text-xs text-slate-500">
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
              placeholder="e.g. Petrol Station"
              className={inputClass}
            />
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
    <form action={formAction} onSubmit={guardSubmit} className="max-w-2xl text-slate-900">
      {/* Light card: this form used to sit straight on the dark quick-entry
          panel, which made its dark labels unreadable (contrast fix, v0.9.0). */}
      <div className="space-y-3 rounded-xl bg-white p-3">
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
          className="min-h-[48px] rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save checkpoint'}
        </button>
        <EntryMessage state={state} />
      </div>
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

const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-normal text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200';
