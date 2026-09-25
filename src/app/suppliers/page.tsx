import { redirect } from 'next/navigation';
import { SupplierCardData, SupplierCardList } from '@/components/supplier-card';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { listStoredAttachments } from '@/lib/records/attachments';
import { listPurchases } from '@/lib/records/purchases';
import { listSupplierInteractions, listSupplierReferences } from '@/lib/records/supplier-details';
import { listSuppliers } from '@/lib/records/suppliers';
import { toLocalDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Suppliers (SPEC §21) — the reference desk. Collapsible contact cards with
 * label→value reference pairs, the shared interaction log (both users see
 * everything, every write is audited), and the recent purchases from that
 * supplier with their receipts. Desktop-first but fully reachable on mobile,
 * per SPEC §15.
 */
export default async function SuppliersPage() {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const today = toLocalDateString(new Date());
  const suppliers = listSuppliers(db);

  const cards: SupplierCardData[] = suppliers.map((supplier) => {
    const purchases = listPurchases(db, { supplierId: supplier.id, limit: 5 });
    return {
      supplier: {
        id: supplier.id,
        name: supplier.name,
        version: supplier.version,
        contactPhone: supplier.contactPhone,
        contactEmail: supplier.contactEmail,
        website: supplier.website,
        address: supplier.address,
        notes: supplier.notes,
      },
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
        <SupplierCardList cards={cards} />
      )}
    </main>
  );
}
