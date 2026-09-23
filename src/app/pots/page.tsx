import { redirect } from 'next/navigation';
import {
  ArchivePotForm,
  DebtEditForm,
  DebtForm,
  ExternalMovementEditForm,
  LoanMovementForm,
  OtherMovementForm,
  SwapForm,
  VoidSwapPairForm,
} from '@/components/external-forms';
import { AddCheckpointForm, CreatePotForm } from '@/components/pot-forms';
import { VoidForm } from '@/components/record-forms';
import { PotEditForm } from '@/components/settings-forms';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { debtBalanceLabel, listDebtsWithBalances } from '@/lib/records/debts';
import {
  describeExternalMovement,
  listExchanges,
  listExternalMovements,
  type ExternalMovement,
} from '@/lib/records/external-movements';
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
  // Swaps grouped as pairs (SPEC §10.2) for the management list: the
  // household records a swap and then looks for it next to the pot cards —
  // this is where that list lives, with edit and void-both-legs.
  const exchanges = listExchanges(db, { includeVoided: true, limit: 20 });
  const potNames = new Map(pots.map((pot) => [pot.id, pot.label]));
  const swapsInvolving = (potId: number) =>
    exchanges.filter(
      (exchange) => exchange.inLeg?.potId === potId || exchange.outLeg?.potId === potId,
    ).length;

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

                {swapsInvolving(pot.id) > 0 ? (
                  <a
                    href="#swaps"
                    className="mt-2 inline-block text-xs font-medium text-sky-700 underline-offset-2 hover:underline"
                  >
                    Recent swaps involving {pot.label} ↓
                  </a>
                ) : null}

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
          id="swaps"
          aria-labelledby="swap-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="swap-heading" className="text-lg font-semibold">
            Swap with someone outside
          </h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">
            Cash in one hand, a bank transfer in the other — recorded as one net-zero pair. A
            same-day pair can read a little low until a checkpoint absorbs it — the safe direction
            (SPEC §7.1).
          </p>
          <SwapForm
            idPrefix="pots-swap"
            pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))}
            today={today}
          />

          <h3 className="mb-2 mt-4 text-sm font-semibold">Recent swaps</h3>
          {exchanges.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {exchanges.map((exchange) => {
                const { inLeg, outLeg } = exchange;
                const inLive = inLeg?.voidedAt === null;
                const outLive = outLeg?.voidedAt === null;
                const bothLive = inLive && outLive;
                const bothVoided = !inLive && !outLive;
                const inAmount = inLeg?.amountPence ?? 0;
                const outAmount = outLeg?.amountPence ?? 0;
                // Net across the LIVE legs: a balanced live pair reads
                // £0.00; a pair with an orphaned leg reads the difference,
                // honestly, instead of pretending.
                const net = (inLive ? inAmount : 0) - (outLive ? outAmount : 0);
                const counterparty = inLeg?.counterparty ?? outLeg?.counterparty ?? '—';
                const date = inLeg?.occurredDate ?? outLeg?.occurredDate ?? '—';
                const note = inLeg?.note ?? outLeg?.note ?? null;
                const inPot = inLeg ? (potNames.get(inLeg.potId) ?? '—') : null;
                const outPot = outLeg ? (potNames.get(outLeg.potId) ?? '—') : null;
                return (
                  <li
                    key={exchange.exchangeKey}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        {formatPence(inAmount || outAmount)} with {counterparty}
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          {date}
                          {note !== null && note !== '' ? ` — ${note}` : ''}
                        </span>
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          bothVoided
                            ? 'bg-slate-100 text-slate-500'
                            : net === 0
                              ? 'bg-emerald-50 text-emerald-800'
                              : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {bothVoided
                          ? 'voided'
                          : net === 0
                            ? 'net £0.00'
                            : `legs differ · net ${net > 0 ? '+' : '−'}${formatPence(
                                Math.abs(net),
                              )}`}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                      <p className={inLive ? undefined : 'text-slate-400 line-through'}>
                        In{' '}
                        <span className="tabular-nums font-medium text-emerald-700">
                          +{formatPence(inAmount)}
                        </span>{' '}
                        → {inPot ?? '—'}
                      </p>
                      <p className={outLive ? undefined : 'text-slate-400 line-through'}>
                        Out{' '}
                        <span className="tabular-nums font-medium text-red-700">
                          −{formatPence(outAmount)}
                        </span>{' '}
                        ← {outPot ?? '—'}
                      </p>
                    </div>
                    {bothVoided ? (
                      <p className="mt-1 text-xs text-slate-400">
                        Voided{inLeg?.voidReason ? ` — ${inLeg.voidReason}` : ''}
                      </p>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {bothLive && inLeg && outLeg ? (
                          <VoidSwapPairForm
                            idPrefix={`swap-void-${exchange.exchangeKey.slice(0, 8)}`}
                            exchangeKey={exchange.exchangeKey}
                            inLeg={{ id: inLeg.id, version: inLeg.version }}
                            outLeg={{ id: outLeg.id, version: outLeg.version }}
                            summary={`${formatPence(inAmount)} with ${counterparty}`}
                          />
                        ) : null}
                        <details className="text-xs">
                          <summary className="cursor-pointer font-medium text-slate-600">
                            Correct or void one leg
                          </summary>
                          <div className="mt-2 flex flex-col gap-2">
                            {inLeg && inLive ? (
                              <details className="rounded border border-slate-200 bg-white p-2">
                                <summary className="cursor-pointer font-medium text-slate-700">
                                  In-leg — to {inPot}
                                </summary>
                                <div className="mt-2">
                                  <ExternalMovementEditForm
                                    idPrefix={`swap-edit-in-${inLeg.id}`}
                                    movement={inLeg}
                                    pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))}
                                    today={today}
                                  />
                                </div>
                                <div className="mt-2 border-t border-slate-100 pt-2">
                                  <VoidForm
                                    kind="external"
                                    recordId={inLeg.id}
                                    expectedVersion={inLeg.version}
                                    summary={describeExternalMovement(inLeg)}
                                  />
                                </div>
                              </details>
                            ) : null}
                            {outLeg && outLive ? (
                              <details className="rounded border border-slate-200 bg-white p-2">
                                <summary className="cursor-pointer font-medium text-slate-700">
                                  Out-leg — from {outPot}
                                </summary>
                                <div className="mt-2">
                                  <ExternalMovementEditForm
                                    idPrefix={`swap-edit-out-${outLeg.id}`}
                                    movement={outLeg}
                                    pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))}
                                    today={today}
                                  />
                                </div>
                                <div className="mt-2 border-t border-slate-100 pt-2">
                                  <VoidForm
                                    kind="external"
                                    recordId={outLeg.id}
                                    expectedVersion={outLeg.version}
                                    summary={describeExternalMovement(outLeg)}
                                  />
                                </div>
                              </details>
                            ) : null}
                          </div>
                        </details>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
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
                    {describeExternalMovement(movement)} · {potNames.get(movement.potId) ?? '—'}
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
                        summary={describeExternalMovement(movement)}
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
