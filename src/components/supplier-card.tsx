'use client';

import { useEffect, useMemo, useState } from 'react';
import { AttachmentForm } from '@/components/attachment-form';
import {
  SupplierContactForm,
  SupplierInteractionForm,
  SupplierReferenceForm,
} from '@/components/supplier-forms';
import { formatPence } from '@/lib/money';
import { StoredAttachment } from '@/lib/records/attachments';
import {
  hasSupplierFocus,
  resolveSupplierFocus,
  SupplierFocus,
} from '@/lib/records/supplier-focus';
import { SupplierInteraction, SupplierReference } from '@/lib/records/supplier-details';
import { toLocalDateString } from '@/lib/time';

const CHANNEL_LABELS: Record<string, string> = {
  call: 'Phone call',
  email: 'Email',
  letter: 'Letter',
  in_person: 'In person',
  other: 'Other',
};

function ChevronDownIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="2.5"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function ChevronUpIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="2.5"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5-7.5" />
    </svg>
  );
}

export interface SupplierCardData {
  supplier: {
    id: number;
    name: string;
    version: number;
    contactPhone: string | null;
    contactEmail: string | null;
    website: string | null;
    address: string | null;
    notes: string | null;
  };
  references: SupplierReference[];
  interactions: SupplierInteraction[];
  recentPurchases: Array<{
    id: number;
    date: string;
    totalPence: number;
    voided: boolean;
    attachments: StoredAttachment[];
  }>;
}

export function SupplierCard({
  supplier,
  references,
  interactions,
  recentPurchases,
  isExpanded,
  onToggle,
}: SupplierCardData & {
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article
      id={`supplier-${supplier.id}`}
      className="flex scroll-mt-24 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={`supplier-details-${supplier.id}`}
        className="group flex w-full cursor-pointer items-center justify-between text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-lg"
      >
        <h2 className="text-xl font-semibold tracking-tight text-slate-900 transition-colors group-hover:text-sky-700">
          {supplier.name}
        </h2>
        <span
          className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors group-hover:bg-slate-100 group-hover:text-slate-700"
          aria-hidden="true"
        >
          {isExpanded ? (
            <ChevronUpIcon className="h-5 w-5" />
          ) : (
            <ChevronDownIcon className="h-5 w-5" />
          )}
        </span>
        <span className="sr-only">
          {isExpanded ? `Collapse ${supplier.name}` : `Expand ${supplier.name}`}
        </span>
      </button>

      {isExpanded ? (
        <div id={`supplier-details-${supplier.id}`} className="mt-4 border-t border-slate-100 pt-4">
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
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
                    {toLocalDateString(new Date(interaction.occurredAt))} · {interaction.createdBy}
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
            <p className="text-sm text-slate-500">Nothing recorded against this supplier yet.</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Bring a card into view under the sticky header. Smooth, unless the household
 * has asked the operating system for less motion.
 */
function scrollToSupplierCard(id: number): void {
  const card = document.getElementById(`supplier-${id}`);
  if (card === null) return;
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

export function SupplierCardList({
  cards,
  focus = null,
}: {
  cards: SupplierCardData[];
  /**
   * The supplier a "Supplier card" link asked for (decision 149), resolved
   * from the URL — or null on a plain visit, which behaves exactly as before.
   */
  focus?: SupplierFocus | null;
}) {
  const identities = useMemo(
    () => cards.map((card) => ({ id: card.supplier.id, name: card.supplier.name })),
    [cards],
  );
  const focusId = focus?.supplierId ?? null;
  const focusQuery = focus?.query ?? '';

  const [search, setSearch] = useState(focusQuery);
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>(() =>
    focusId === null ? {} : { [focusId]: true },
  );
  // The focus the list is currently honouring. The server resolves the query
  // string; the fragment is resolved here on mount, because the browser never
  // sends it (and the v0.12.0 notes promised `/suppliers#supplier-3` works).
  const [target, setTarget] = useState<SupplierFocus>({ supplierId: focusId, query: focusQuery });

  useEffect(() => {
    if (window.location.hash === '') return;
    setTarget((current) =>
      hasSupplierFocus(current)
        ? current
        : resolveSupplierFocus({ hash: window.location.hash, suppliers: identities }),
    );
  }, [identities]);

  useEffect(() => {
    if (!hasSupplierFocus(target)) return;
    if (target.query !== '') setSearch(target.query);
    if (target.supplierId === null) return;
    const id = target.supplierId;
    setExpandedIds((prev) => ({ ...prev, [id]: true }));
    // After paint, so the expanded card is the thing that gets scrolled to.
    const timer = window.setTimeout(() => scrollToSupplierCard(id), 0);
    return () => window.clearTimeout(timer);
  }, [target]);

  const toggle = (id: number) => {
    setExpandedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const expandAll = () => {
    const next: Record<number, boolean> = {};
    for (const card of cards) {
      next[card.supplier.id] = true;
    }
    setExpandedIds(next);
  };

  const collapseAll = () => {
    setExpandedIds({});
  };

  const filteredCards = cards.filter((c) =>
    c.supplier.name.toLowerCase().includes(search.toLowerCase().trim()),
  );

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-xs flex-1">
          <label htmlFor="supplier-search" className="sr-only">
            Filter suppliers
          </label>
          <input
            id="supplier-search"
            type="search"
            placeholder="Filter suppliers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <button
            type="button"
            onClick={expandAll}
            className="rounded px-2.5 py-1 hover:bg-slate-200 cursor-pointer"
          >
            Expand all
          </button>
          <span className="text-slate-300" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            onClick={collapseAll}
            className="rounded px-2.5 py-1 hover:bg-slate-200 cursor-pointer"
          >
            Collapse all
          </button>
        </div>
      </div>

      {filteredCards.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No suppliers match “{search}”.
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {filteredCards.map((card) => (
            <SupplierCard
              key={card.supplier.id}
              {...card}
              isExpanded={Boolean(expandedIds[card.supplier.id])}
              onToggle={() => toggle(card.supplier.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
