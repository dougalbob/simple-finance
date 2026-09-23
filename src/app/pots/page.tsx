import { redirect } from 'next/navigation';
import {
  ArchivePotForm,
  DebtEditForm,
  DebtForm,
  LoanMovementForm,
  OtherMovementForm,
  SwapForm,
} from '@/components/external-forms';
import { AddCheckpointForm, CreatePotForm } from '@/components/pot-forms';
import { VoidForm } from '@/components/record-forms';
import { PotEditForm } from '@/components/settings-forms';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { debtBalanceLabel, listDebtsWithBalances } from '@/lib/records/debts';
import { listExternalMovements, type ExternalMovement } from '@/lib/records/external-movements';
import { getMoneySnapshot } from '@/lib/records/money-view';
import { checkpointsForPot, listPots } from '@/lib/records/pots';
import { formatInstantLocal, formatRelativeAge, toLocalDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Accounts & Pots (SPEC §15.2): every pot with its reported figure,
 * estimate, overdraft context, edit form and checkpoint history.
 * Checkpoints are immutable — correcting the balance records a new
 * checkpoint; the old one stays (blueprint §4).
 *
 * Also home to the household boundary (SPEC §10.2): informal debts with
 * their derived balances, and the borrowing/repayment/swap/other movements
 * that move money across it.
 */
export default async function PotsPage() {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const now = new Date();
  const today = toLocalDateString(now);
  const pots = listPots(db);
  const money = getMoneySnapshot(db, now);
  const debts = listDebtsWithBalances(db);
  const recentExternal = listExternalMovements(db, { includeVoided: true, limit: 20 });
  const potNames = new Map(pots.map((pot) => [pot.id, pot.label]));

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
          Accounts &amp; pots
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Where the money sits</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Reported figures, not a bank sync. A pot with no checkpoint has no estimate, by design —
          the app never guesses balances.
        </p>
      </header>

      {pots.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No pots yet. Add the household&apos;s pots below — a typical setup has two bank accounts
          and a cash pot each.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {pots.map((pot) => {
            const view = money.pots.find((entry) => entry.pot.id === pot.id);
            const latest = view?.latestCheckpoint ?? null;
            const estimate = view?.estimatePence ?? null;
            const history = checkpointsForPot(db, pot.id, 10);
            return (
              <section
                key={pot.id}
                aria-labelledby={`pot-${pot.id}-heading`}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 id={`pot-${pot.id}-heading`} className="text-lg font-semibold">
                      {pot.label}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {pot.kind === 'bank' ? 'Bank account' : 'Cash pot'}
                    </p>
                  </div>
                  {estimate !== null ? (
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold tabular-nums text-emerald-800">
                      ≈ {formatPence(estimate)}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-500">
                      no estimate
                    </span>
                  )}
                </div>

                {latest !== null ? (
                  <p className="mt-2 text-sm text-slate-600">
                    Last reported{' '}
                    <span className="font-semibold tabular-nums text-slate-900">
                      {formatPence(latest.amountPence)}
                    </span>{' '}
                    {formatRelativeAge(latest.effectiveAt)} (
                    {formatInstantLocal(latest.effectiveAt)})
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    No checkpoint yet — record what this pot holds below.
                  </p>
                )}

                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-xs text-slate-500">Overdraft limit</dt>
                    <dd className="font-medium tabular-nums">
                      {pot.overdraftLimitPence === null
                        ? '—'
                        : formatPence(pot.overdraftLimitPence)}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-xs text-slate-500">Warning threshold</dt>
                    <dd className="font-medium tabular-nums">
                      {pot.warningThresholdPence === null
                        ? '—'
                        : formatPence(pot.warningThresholdPence)}
                    </dd>
                  </div>
                </dl>

                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700">
                    Edit pot
                  </summary>
                  <div className="mt-2">
                    <PotEditForm
                      potId={pot.id}
                      version={pot.version}
                      label={pot.label}
                      kind={pot.kind}
                      overdraftLimitPence={pot.overdraftLimitPence}
                      warningThresholdPence={pot.warningThresholdPence}
                    />
                  </div>
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <ArchivePotForm potId={pot.id} version={pot.version} label={pot.label} />
                  </div>
                </details>

                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700">
                    Checkpoint history ({history.length})
                  </summary>
                  {history.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">Nothing recorded yet.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-slate-100">
                      {history.map((checkpoint) => (
                        <li
                          key={checkpoint.id}
                          className="flex items-baseline justify-between gap-2 py-1.5 text-sm"
                        >
                          <span>
                            {formatInstantLocal(checkpoint.effectiveAt)}
                            <span className="ml-2 text-xs text-slate-500">
                              {checkpoint.enteredBy}
                              {checkpoint.note !== null && checkpoint.note !== ''
                                ? ` — ${checkpoint.note}`
                                : ''}
                            </span>
                          </span>
                          <span className="tabular-nums">
                            {formatPence(checkpoint.amountPence)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="add-pot-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="add-pot-heading" className="mb-3 text-lg font-semibold">
            Add a pot
          </h2>
          <CreatePotForm />
        </section>
        <section
          aria-labelledby="add-checkpoint-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="add-checkpoint-heading" className="mb-3 text-lg font-semibold">
            Record a balance checkpoint
          </h2>
          <AddCheckpointForm pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))} />
          <p className="mt-2 text-xs text-slate-500">
            A checkpoint is an immutable correction — it never deletes what happened before.
          </p>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="debts-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="debts-heading" className="text-lg font-semibold">
            Owed &amp; owing
          </h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">
            Informal debts — money borrowed or lent outside the household. Balances derive from the
            movements below, so they can never drift.
          </p>
          {debts.length === 0 ? (
            <p className="mb-3 text-sm text-slate-500">No debts tracked.</p>
          ) : (
            <ul className="mb-4 divide-y divide-slate-100">
              {debts.map(({ debt, balancePence, movementCount }) => (
                <li key={debt.id} className="py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">
                      {debt.counterparty}{' '}
                      <span className="font-normal text-slate-500">
                        ({debt.direction === 'we_owe' ? 'we owe' : 'owed to us'})
                      </span>
                    </span>
                    <span
                      className={`tabular-nums ${balancePence === 0 ? 'text-slate-500' : 'font-semibold text-slate-900'}`}
                    >
                      {debtBalanceLabel(debt, balancePence)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {movementCount === 0
                      ? 'no movements yet'
                      : `${movementCount} movement${movementCount === 1 ? '' : 's'}`}
                    {debt.note !== null && debt.note !== '' ? ` — ${debt.note}` : ''}
                  </p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-medium text-slate-600">
                      Edit
                    </summary>
                    <div className="mt-2">
                      <DebtEditForm
                        idPrefix={`debt-edit-${debt.id}`}
                        debtId={debt.id}
                        version={debt.version}
                        counterparty={debt.counterparty}
                        note={debt.note}
                      />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mb-2 text-sm font-semibold">Track someone new</h3>
          <DebtForm idPrefix="pots-debt" />
        </section>

        <section
          aria-labelledby="borrow-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="borrow-heading" className="text-lg font-semibold">
            Borrow &amp; repay
          </h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">
            Borrowing raises the pot estimate and what you owe together — never income. Repayments
            reduce what you owe — never spending.
          </p>
          <LoanMovementForm
            idPrefix="pots-loan"
            pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))}
            debts={debts.map(({ debt }) => ({
              id: debt.id,
              counterparty: debt.counterparty,
              direction: debt.direction,
            }))}
            today={today}
          />
        </section>

        <section
          aria-labelledby="swap-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="swap-heading" className="text-lg font-semibold">
            Swap with someone outside
          </h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">
            Cash in one hand, a bank transfer in the other — recorded as one pair, so the household
            total provably does not move.
          </p>
          <SwapForm
            idPrefix="pots-swap"
            pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))}
            today={today}
          />
        </section>

        <section
          aria-labelledby="other-money-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="other-money-heading" className="text-lg font-semibold">
            Other money in &amp; out
          </h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">
            Anything else across the household boundary — always with a note saying what it was.
          </p>
          <OtherMovementForm
            idPrefix="pots-other"
            pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))}
            today={today}
          />
        </section>
      </div>

      <section
        aria-labelledby="external-history-heading"
        className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 id="external-history-heading" className="text-lg font-semibold">
          Recent money across the boundary
        </h2>
        <p className="mb-3 mt-1 text-sm text-slate-600">
          Borrowing, repayments, swaps and other money — newest first. Voiding keeps the history.
        </p>
        {recentExternal.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentExternal.map((movement) => (
              <li key={movement.id} className="py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span
                    className={
                      movement.voidedAt !== null ? 'text-slate-400 line-through' : undefined
                    }
                  >
                    {describeExternal(movement)} · {potNames.get(movement.potId) ?? '—'}
                    <span className="ml-2 text-xs text-slate-500">
                      {movement.occurredDate} · {movement.enteredBy}
                      {movement.note !== null && movement.note !== '' ? ` — ${movement.note}` : ''}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {movement.direction === 'in' ? '+' : '−'}
                    {formatPence(movement.amountPence)}
                  </span>
                </div>
                {movement.voidedAt === null ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-medium text-slate-600">
                      Void
                    </summary>
                    <div className="mt-2">
                      <VoidForm
                        kind="external"
                        recordId={movement.id}
                        expectedVersion={movement.version}
                        summary={describeExternal(movement)}
                      />
                    </div>
                  </details>
                ) : (
                  <p className="text-xs text-slate-400">
                    Voided{movement.voidReason ? ` — ${movement.voidReason}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function describeExternal(movement: ExternalMovement): string {
  const amount = formatPence(movement.amountPence);
  if (movement.kind === 'loan') {
    return movement.direction === 'in'
      ? `Borrowed ${amount} from ${movement.counterparty}`
      : `Repaid ${amount} to ${movement.counterparty}`;
  }
  if (movement.kind === 'swap') {
    return movement.direction === 'in'
      ? `Swap in ${amount} with ${movement.counterparty}`
      : `Swap out ${amount} with ${movement.counterparty}`;
  }
  return movement.direction === 'in'
    ? `Received ${amount} from ${movement.counterparty}`
    : `Paid ${amount} to ${movement.counterparty}`;
}
