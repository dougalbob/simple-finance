import { redirect } from 'next/navigation';
import { AttachmentForm } from '@/components/attachment-form';
import {
  SupplierContactForm,
  SupplierInteractionForm,
  SupplierReferenceForm,
} from '@/components/supplier-forms';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { listStoredAttachments } from '@/lib/records/attachments';
import { listPurchases } from '@/lib/records/purchases';
import { listSupplierInteractions, listSupplierReferences } from '@/lib/records/supplier-details';
import { listSuppliers } from '@/lib/records/suppliers';
import { toLocalDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

const CHANNEL_LABELS: Record<string, string> = {
  call: 'Phone call',
  email: 'Email',
  letter: 'Letter',
  in_person: 'In person',
  other: 'Other',
};

/**
 * Suppliers (SPEC §21) — the reference desk. Contact cards with label→value
 * reference pairs, the shared interaction log (both users see everything, every
 * write is audited), and the recent purchases from that supplier with their
 * receipts. Desktop-first but fully reachable on mobile, per SPEC §15.
 */
export default async function SuppliersPage() {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const today = toLocalDateString(new Date());
  const suppliers = listSuppliers(db);

  const cards = suppliers.map((supplier) => {
    const purchases = listPurchases(db, { supplierId: supplier.id, limit: 5 });
    return {
      supplier,
      references: listSupplierReferences(db, supplier.id),
      interactions: listSupplierInteractions(db, supplier.id, 20),
      recentPurchases: purchases.map(({ purchase }) => ({
        id: purchase.id,
        date: toLocalDateString(new Date(purchase.occurredAt)),
        totalPence: purchase.totalPence,
        voided: purchase.voidedAt !== null,
        attachments: listStoredAttachments(db, purchase.id),
      })),
    };
  });
  const followUps = cards
    .flatMap((card) =>
      card.interactions
        .filter((interaction) => interaction.followUpDate !== null)
        .map((interaction) => ({
          supplier: card.supplier.name,
          date: interaction.followUpDate!,
          summary: interaction.summary,
        })),
    )
    .filter((item) => item.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
          Reference desk
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Suppliers</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          When something goes wrong, the number, the policy reference and the history of the
          conversation are here — not dug out of a drawer. Both of us see everything, and every
          entry records who wrote it.
        </p>
      </header>

      {followUps.length > 0 ? (
        <section
          aria-labelledby="supplier-follow-ups"
          className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4"
        >
          <h2 id="supplier-follow-ups" className="text-sm font-semibold text-amber-900">
            Promised follow-ups
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {followUps.map((item, index) => (
              <li key={index}>
                <span className="font-medium tabular-nums">{item.date}</span> · {item.supplier} —{' '}
                {item.summary}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cards.length === 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">
          Suppliers appear here after the first purchase, or can be added while entering one.
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {cards.map(({ supplier, references, interactions, recentPurchases }) => (
            <article
              key={supplier.id}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 className="text-xl font-semibold tracking-tight">{supplier.name}</h2>
              <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="font-medium text-slate-500">Phone</dt>
                <dd>
                  {supplier.contactPhone !== null ? (
                    <a
                      className="text-sky-700 hover:underline"
                      href={`tel:${supplier.contactPhone.replace(/\s+/g, '')}`}
                    >
                      {supplier.contactPhone}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt className="font-medium text-slate-500">Email</dt>
                <dd>
                  {supplier.contactEmail !== null ? (
                    <a
                      className="text-sky-700 hover:underline"
                      href={`mailto:${supplier.contactEmail}`}
                    >
                      {supplier.contactEmail}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt className="font-medium text-slate-500">Website</dt>
                <dd className="break-words">{supplier.website ?? '—'}</dd>
                <dt className="font-medium text-slate-500">Address</dt>
                <dd className="whitespace-pre-line">{supplier.address ?? '—'}</dd>
              </dl>
              {supplier.notes !== null && supplier.notes !== '' ? (
                <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{supplier.notes}</p>
              ) : null}
              <SupplierContactForm
                supplier={{
                  id: supplier.id,
                  name: supplier.name,
                  version: supplier.version,
                  contactPhone: supplier.contactPhone,
                  contactEmail: supplier.contactEmail,
                  website: supplier.website,
                  address: supplier.address,
                  notes: supplier.notes,
                }}
              />

              <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">
                References
              </h3>
              <SupplierReferenceForm supplierId={supplier.id} />
              {references.length > 0 ? (
                <ul className="text-sm">
                  {references.map((reference) => (
                    <li key={reference.id}>
                      <span className="font-medium">{reference.label}:</span> {reference.value}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">
                  None recorded — policy or account numbers go here.
                </p>
              )}

              <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Interaction log
              </h3>
              <SupplierInteractionForm supplierId={supplier.id} />
              {interactions.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {interactions.map((interaction) => (
                    <li key={interaction.id} className="border-l-2 border-indigo-200 pl-3">
                      <span className="font-medium">
                        {CHANNEL_LABELS[interaction.channel] ?? interaction.channel}
                      </span>{' '}
                      · {interaction.summary}
                      <span className="block text-xs text-slate-500">
                        {toLocalDateString(new Date(interaction.occurredAt))} ·{' '}
                        {interaction.createdBy}
                      </span>
                      {interaction.outcome !== null && interaction.outcome !== '' ? (
                        <span className="block text-slate-500">{interaction.outcome}</span>
                      ) : null}
                      {interaction.followUpDate !== null ? (
                        <span className="block text-xs text-amber-700">
                          Follow up {interaction.followUpDate}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No interactions yet.</p>
              )}

              <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Recent purchases
              </h3>
              {recentPurchases.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {recentPurchases.map((purchase) => (
                    <li key={purchase.id}>
                      <span className={purchase.voided ? 'text-slate-400 line-through' : ''}>
                        {purchase.date} · {formatPence(purchase.totalPence)}
                      </span>
                      <AttachmentForm purchaseId={purchase.id} attachments={purchase.attachments} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">
                  Nothing recorded against this supplier yet.
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
