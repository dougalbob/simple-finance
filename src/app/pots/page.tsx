import { redirect } from 'next/navigation';
import { AddCheckpointForm, CreatePotForm } from '@/components/pot-forms';
import { PotEditForm } from '@/components/settings-forms';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { getMoneySnapshot } from '@/lib/records/money-view';
import { checkpointsForPot, listPots } from '@/lib/records/pots';
import { formatInstantLocal, formatRelativeAge } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Accounts & Pots (SPEC §15.2): every pot with its reported figure,
 * estimate, overdraft context, edit form and checkpoint history.
 * Checkpoints are immutable — correcting the balance records a new
 * checkpoint; the old one stays (blueprint §4).
 */
export default async function PotsPage() {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const now = new Date();
  const pots = listPots(db);
  const money = getMoneySnapshot(db, now);

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
          and a few cash pots.
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
    </main>
  );
}
