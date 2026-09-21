import { asc, eq } from 'drizzle-orm';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { renewals, schedules, suppliers } from '@/lib/db/schema';
import { listRenewals } from '@/lib/records/renewals';
import { formatPence } from '@/lib/money';
import { toLocalDateString } from '@/lib/time';
export const dynamic = 'force-dynamic';
export default async function ContractsPage() {
  if (!(await currentUserFromRequest())) return <main className="p-6">Sign in required.</main>;
  const db = getDbHandle().db;
  const today = toLocalDateString(new Date());
  const rs = listRenewals(db);
  const ss = db
    .select()
    .from(schedules)
    .where(eq(schedules.kind, 'dd'))
    .orderBy(asc(schedules.contractEndsOn))
    .all();
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Plan ahead</p>
        <h1 className="text-3xl font-bold">Contracts &amp; Renewals</h1>
        <p className="text-slate-600">
          Dates are reminders only. The app never changes bank instructions or stops a direct debit
          automatically.
        </p>
      </header>
      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-xl font-semibold">Renewals</h2>
        {rs.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No renewals recorded.</p>
        ) : (
          <div className="mt-3 divide-y">
            {rs.map((r) => (
              <div className="py-3" key={r.id}>
                <b>{r.label}</b>
                <span className="ml-3 text-sm text-slate-600">
                  {r.nextRenewalDate} · warn {r.warnDaysBefore} days ·{' '}
                  {r.repeatsAnnually ? 'annual' : 'one-off'}
                </span>
                {r.notes && <p className="text-sm text-slate-500">{r.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-xl font-semibold">Fixed-term contract ends</h2>
        {ss.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No contract end dates recorded.</p>
        ) : (
          <div className="mt-3 divide-y">
            {ss.map((s) => (
              <div className="py-3" key={s.id}>
                <b>{s.name}</b>
                <span className="ml-3 text-sm text-slate-600">
                  {s.contractEndsOn ?? 'No end date'} · {formatPence(s.amountPence)} · {s.frequency}
                </span>
                {s.contractEndsOn && s.contractEndsOn < today && (
                  <span className="ml-3 text-xs font-semibold text-amber-700">
                    rolled / awaiting review
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
