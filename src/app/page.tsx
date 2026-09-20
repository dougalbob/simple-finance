import { redirect } from 'next/navigation';
import { AddCheckpointForm, CreatePotForm } from '@/components/pot-forms';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { latestCheckpointPerPot, listPots, recentCheckpoints } from '@/lib/records/pots';
import { formatInstantLocal, formatRelativeAge } from '@/lib/time';

/**
 * Phase 1 vertical slice: authenticated read of persisted data (pots, latest
 * checkpoints, recent checkpoints). Honest wording only — figures are what a
 * user reported at the last checkpoint; the estimate and payday-projection
 * engines arrive in Phase 3 and nothing here implies otherwise (SPEC §1).
 */
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const pots = listPots(db);
  const latest = latestCheckpointPerPot(db);
  const recent = recentCheckpoints(db, 10);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Simple Finance</h1>
        <p className="mt-1 text-sm text-slate-600">
          Signed in as {user.email} · first-build preview (pots &amp; checkpoints)
        </p>
      </header>

      <section aria-labelledby="pots-heading" className="mb-8">
        <h2 id="pots-heading" className="mb-3 text-lg font-medium">
          Pots
        </h2>
        {pots.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
            No pots yet. Add your household&apos;s accounts and cash pots below — for this household
            that is typically two bank accounts and three cash pots.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {pots.map((pot) => {
              const checkpoint = latest.get(pot.id);
              return (
                <li key={pot.id} className="rounded border border-slate-200 bg-white p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{pot.label}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {pot.kind === 'bank' ? 'Bank' : 'Cash'}
                    </span>
                  </div>
                  {checkpoint ? (
                    <div className="mt-2">
                      <p className="text-xl font-semibold tabular-nums">
                        {formatPence(checkpoint.amountPence)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Last reported {formatRelativeAge(checkpoint.effectiveAt)} (
                        {formatInstantLocal(checkpoint.effectiveAt)}) by {checkpoint.enteredBy}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">No checkpoint yet.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mb-8 grid gap-6 md:grid-cols-2">
        <section
          aria-labelledby="add-pot-heading"
          className="rounded border border-slate-200 bg-white p-4"
        >
          <h2 id="add-pot-heading" className="mb-3 text-lg font-medium">
            Add a pot
          </h2>
          <CreatePotForm />
        </section>
        <section
          aria-labelledby="add-checkpoint-heading"
          className="rounded border border-slate-200 bg-white p-4"
        >
          <h2 id="add-checkpoint-heading" className="mb-3 text-lg font-medium">
            Record a balance checkpoint
          </h2>
          <AddCheckpointForm pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))} />
        </section>
      </div>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-3 text-lg font-medium">
          Recent checkpoints
        </h2>
        {recent.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
            Nothing recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    When
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Pot
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Reported
                  </th>
                  <th scope="col" className="px-3 py-2">
                    By
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody>
                {recent.map((checkpoint) => (
                  <tr key={checkpoint.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatInstantLocal(checkpoint.effectiveAt)}
                    </td>
                    <td className="px-3 py-2">{checkpoint.potLabel}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPence(checkpoint.amountPence)}
                    </td>
                    <td className="px-3 py-2">{checkpoint.enteredBy}</td>
                    <td className="px-3 py-2 text-slate-500">{checkpoint.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
