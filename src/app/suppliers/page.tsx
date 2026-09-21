import { and, asc, desc, eq } from 'drizzle-orm';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { supplierInteractions, supplierReferences, suppliers, purchases } from '@/lib/db/schema';
import { formatPence } from '@/lib/money';
import { addSupplierInteractionAction, addSupplierReferenceAction } from '@/app/actions';

export const dynamic = 'force-dynamic';
export default async function SuppliersPage() {
  if (!(await currentUserFromRequest()))
    return <main className="mx-auto max-w-5xl p-6">Sign in required.</main>;
  const db = getDbHandle().db;
  const rows = db.select().from(suppliers).orderBy(asc(suppliers.name)).all();
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
          Reference desk
        </p>
        <h1 className="text-3xl font-bold">Suppliers</h1>
        <p className="text-slate-600">
          Contact cards, policy references and a shared interaction log.
        </p>
      </header>
      {rows.length === 0 ? (
        <section className="rounded-xl border bg-white p-6 text-slate-600">
          Suppliers appear here after the first purchase or can be added from Quick Entry.
        </section>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {rows.map((s) => {
            const refs = db
              .select()
              .from(supplierReferences)
              .where(eq(supplierReferences.supplierId, s.id))
              .all();
            const interactions = db
              .select()
              .from(supplierInteractions)
              .where(eq(supplierInteractions.supplierId, s.id))
              .orderBy(desc(supplierInteractions.occurredAt))
              .all();
            const recent = db
              .select({ total: purchases.totalPence, date: purchases.occurredDate })
              .from(purchases)
              .where(and(eq(purchases.supplierId, s.id)))
              .orderBy(desc(purchases.occurredAt))
              .limit(5)
              .all();
            return (
              <article key={s.id} className="rounded-xl border bg-white p-5 shadow-sm">
                <h2 className="text-xl font-semibold">{s.name}</h2>
                <dl className="mt-3 space-y-1 text-sm">
                  <div>
                    <dt className="inline font-medium">Phone: </dt>
                    <dd className="inline">{s.contactPhone ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Email: </dt>
                    <dd className="inline">{s.contactEmail ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Website: </dt>
                    <dd className="inline">{s.website ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Address: </dt>
                    <dd className="inline whitespace-pre-line">{s.address ?? '—'}</dd>
                  </div>
                </dl>
                {s.notes && <p className="mt-3 text-sm text-slate-600">{s.notes}</p>}
                <h3 className="mt-5 font-semibold">References</h3>
                <form action={addSupplierReferenceAction} className="my-2 flex flex-wrap gap-1">
                  <input type="hidden" name="supplierId" value={s.id} />
                  <input
                    name="label"
                    placeholder="Label"
                    required
                    className="w-24 rounded border px-2 py-1 text-xs"
                  />
                  <input
                    name="value"
                    placeholder="Value"
                    required
                    className="w-32 rounded border px-2 py-1 text-xs"
                  />
                  <button className="rounded bg-slate-800 px-2 py-1 text-xs text-white">Add</button>
                </form>
                {refs.length ? (
                  <ul className="text-sm">
                    {refs.map((r) => (
                      <li key={r.id}>
                        <b>{r.label}:</b> {r.value}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">None recorded.</p>
                )}
                <h3 className="mt-5 font-semibold">Recent purchases</h3>
                <ul className="text-sm">
                  {recent.map((r, i) => (
                    <li key={i}>
                      {r.date} · {formatPence(r.total)}
                    </li>
                  ))}
                </ul>
                <h3 className="mt-5 font-semibold">Interaction log</h3>
                <form action={addSupplierInteractionAction} className="my-2 space-y-1">
                  <input type="hidden" name="supplierId" value={s.id} />
                  <div className="flex gap-1">
                    <select name="channel" className="rounded border px-2 py-1 text-xs">
                      <option>call</option>
                      <option>email</option>
                      <option>letter</option>
                      <option>in_person</option>
                      <option>other</option>
                    </select>
                    <input
                      name="followUpDate"
                      type="date"
                      className="rounded border px-2 py-1 text-xs"
                    />
                  </div>
                  <input
                    name="summary"
                    placeholder="What happened?"
                    required
                    className="w-full rounded border px-2 py-1 text-xs"
                  />
                  <input
                    name="outcome"
                    placeholder="Outcome (optional)"
                    className="w-full rounded border px-2 py-1 text-xs"
                  />
                  <button className="rounded bg-indigo-700 px-2 py-1 text-xs text-white">
                    Log interaction
                  </button>
                </form>
                {interactions.length ? (
                  <ul className="space-y-2 text-sm">
                    {interactions.map((i) => (
                      <li key={i.id} className="border-l-2 border-indigo-200 pl-3">
                        <b>{i.channel}</b> · {i.summary}
                        {i.outcome && <span className="block text-slate-500">{i.outcome}</span>}
                        {i.followUpDate && (
                          <span className="block text-xs text-amber-700">
                            Follow up {i.followUpDate}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No interactions yet.</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
