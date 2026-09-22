'use client';

import { useId, useState } from 'react';

export interface PurchaseFilterValues {
  from?: string;
  to?: string;
  potId?: string;
  supplierId?: string;
  categoryId?: string;
  targetKind?: string;
  targetId?: string;
  paidByPersonId?: string;
  scheduleOnly?: string;
  refundsOnly?: string;
  voidedOnly?: string;
}

/**
 * Purchases-page filters (decision 92). On a phone the fields sit inside a
 * collapsible panel so the list is the first thing on screen; tablet and
 * desktop keep the form always open. Native date/select controls are forced
 * to shrink (`min-w-0 w-full`) so they cannot spill out of the card.
 */
export function PurchaseFilterForm({
  pots,
  suppliers,
  people,
  categories,
  active,
}: {
  pots: Array<{ id: number; label: string }>;
  suppliers: Array<{ id: number; name: string }>;
  people: Array<{ id: number; label: string }>;
  categories: Array<{ id: number; parentName: string; childName: string }>;
  active: PurchaseFilterValues;
}) {
  const [open, setOpen] = useState(filtersAreActive(active));
  const panelId = useId();
  const inputClass =
    'w-full min-w-0 max-w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none';
  const labelClass = 'text-xs font-medium text-slate-600';
  const fieldClass = 'flex min-w-0 flex-col gap-1';
  const fullRowClass = `${fieldClass} col-span-2 sm:col-span-1`;

  return (
    <form
      method="GET"
      aria-label="Purchase filters"
      className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <button
        type="button"
        className="flex w-full items-center justify-center bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100 sm:hidden"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide filters' : 'Show filters'}
      </button>
      <div
        id={panelId}
        className={open ? 'border-t border-slate-200 p-4 sm:border-t-0' : 'hidden p-4 sm:block'}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className={fieldClass}>
            <label htmlFor="f-from" className={labelClass}>
              From date
            </label>
            <input
              id="f-from"
              name="from"
              type="date"
              defaultValue={active.from ?? ''}
              className={inputClass}
            />
          </div>
          <div className={fieldClass}>
            <label htmlFor="f-to" className={labelClass}>
              To date
            </label>
            <input
              id="f-to"
              name="to"
              type="date"
              defaultValue={active.to ?? ''}
              className={inputClass}
            />
          </div>
          <div className={fullRowClass}>
            <label htmlFor="f-pot" className={labelClass}>
              Pot
            </label>
            <select
              id="f-pot"
              name="potId"
              defaultValue={active.potId ?? ''}
              className={inputClass}
            >
              <option value="">Any</option>
              {pots.map((pot) => (
                <option key={pot.id} value={pot.id}>
                  {pot.label}
                </option>
              ))}
            </select>
          </div>
          <div className={fullRowClass}>
            <label htmlFor="f-supplier" className={labelClass}>
              Supplier
            </label>
            <select
              id="f-supplier"
              name="supplierId"
              defaultValue={active.supplierId ?? ''}
              className={inputClass}
            >
              <option value="">Any</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
          <div className={fullRowClass}>
            <label htmlFor="f-category" className={labelClass}>
              Category
            </label>
            <select
              id="f-category"
              name="categoryId"
              defaultValue={active.categoryId ?? ''}
              className={inputClass}
            >
              <option value="">Any</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.parentName} / {category.childName}
                </option>
              ))}
            </select>
          </div>
          <div className={fullRowClass}>
            <label htmlFor="f-paidby" className={labelClass}>
              Paid by
            </label>
            <select
              id="f-paidby"
              name="paidByPersonId"
              defaultValue={active.paidByPersonId ?? ''}
              className={inputClass}
            >
              <option value="">Anyone</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              name="scheduleOnly"
              value="1"
              defaultChecked={active.scheduleOnly === '1'}
              className="h-4 w-4 rounded border-slate-300"
            />
            From schedule
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              name="refundsOnly"
              value="1"
              defaultChecked={active.refundsOnly === '1'}
              className="h-4 w-4 rounded border-slate-300"
            />
            Refunds
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              name="voidedOnly"
              value="1"
              defaultChecked={active.voidedOnly === '1'}
              className="h-4 w-4 rounded border-slate-300"
            />
            Voided
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="submit"
              className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white"
            >
              Apply filters
            </button>
            <a
              href="/purchases"
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Clear
            </a>
          </div>
        </div>
      </div>
    </form>
  );
}

function filtersAreActive(active: PurchaseFilterValues): boolean {
  return (
    Boolean(active.from) ||
    Boolean(active.to) ||
    Boolean(active.potId) ||
    Boolean(active.supplierId) ||
    Boolean(active.categoryId) ||
    Boolean(active.targetKind) ||
    Boolean(active.targetId) ||
    Boolean(active.paidByPersonId) ||
    active.scheduleOnly === '1' ||
    active.refundsOnly === '1' ||
    active.voidedOnly === '1'
  );
}
