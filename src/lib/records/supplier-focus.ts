/**
 * Deep links into the Suppliers page (SPEC §21, decision 149).
 *
 * A schedule or a renewal paints a "Supplier card" link. Clicking it has to
 * land on the supplier it names — filtered to it, expanded, scrolled into
 * view — instead of on a collapsed list of every supplier the household has
 * ever used. The identity travels in the URL, and this module is the one place
 * that turns those parameters into a decision: the server page reads it so the
 * right card is already open in the first paint, and the client island reads it
 * again for the `#supplier-3` fragment, which a server never sees.
 *
 * Pure by design — no database, no DOM — so the rules below are unit-tested
 * (tests/supplier-focus.test.ts) rather than only exercised through a browser.
 */

export interface SupplierIdentity {
  id: number;
  name: string;
}

/** What the Suppliers page should show on arrival. */
export interface SupplierFocus {
  /** The card to expand and scroll to; null when the link named no supplier we hold. */
  supplierId: number | null;
  /** What the "Filter suppliers" box holds — the linked supplier's name. Empty = no focus. */
  query: string;
}

/** Next hands a repeated parameter through as an array; the first value wins. */
type ParamValue = string | string[] | undefined;

export interface SupplierFocusInput {
  /** `/suppliers?supplierId=3` — what the links in Recurring and Contracts emit. */
  supplierId?: ParamValue;
  /** `/suppliers?id=3` — accepted alias (the shape the UI note proposed). */
  id?: ParamValue;
  /** `/suppliers?q=Corner%20Foods` — a name search that also picks the card to open. */
  q?: ParamValue;
  /** `#supplier-3` or `#Corner Foods` — the fragment from a hand-typed link. */
  hash?: string | null;
  suppliers: SupplierIdentity[];
}

/**
 * The same identity rule as `normalizeSupplierName` in records/suppliers:
 * trimmed, inner whitespace collapsed, lower-cased. Kept local so this module
 * stays import-free and safe to pull into the client bundle.
 */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function firstValue(value: ParamValue): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** A positive integer id, or null for anything else (junk, `0`, `-2`, `3x`). */
function parseId(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function decodeHash(hash: string): string {
  const raw = hash.replace(/^#/, '').trim();
  try {
    return decodeURIComponent(raw);
  } catch {
    // A stray `%` in a hand-typed fragment is a typo, not a crash.
    return raw;
  }
}

/** The card a name search names: an exact name first, else the first containing it. */
function matchByName(query: string, suppliers: SupplierIdentity[]): number | null {
  const wanted = normalizeName(query);
  if (wanted === '') return null;
  const exact = suppliers.find((supplier) => normalizeName(supplier.name) === wanted);
  if (exact !== undefined) return exact.id;
  return suppliers.find((supplier) => normalizeName(supplier.name).includes(wanted))?.id ?? null;
}

/**
 * Focus on an id we hold, naming the supplier in the filter box too. An id we
 * do not hold (a stale link after a restore, say) is not a crash and not a
 * wrong card: it falls back to the plain list.
 */
function focusOn(id: number, suppliers: SupplierIdentity[]): SupplierFocus {
  const supplier = suppliers.find((entry) => entry.id === id);
  return supplier === undefined
    ? { supplierId: null, query: '' }
    : { supplierId: supplier.id, query: supplier.name };
}

/**
 * Resolve the URL into a focus, in order of certainty: a supplier id, then a
 * name search, then the fragment (which may be either). Nothing usable = the
 * plain list, exactly as before these links existed.
 */
export function resolveSupplierFocus(input: SupplierFocusInput): SupplierFocus {
  const bySuppliersId = parseId(firstValue(input.supplierId));
  if (bySuppliersId !== null) {
    const focus = focusOn(bySuppliersId, input.suppliers);
    if (focus.supplierId !== null) return focus;
  }

  const byAliasId = parseId(firstValue(input.id));
  if (byAliasId !== null) {
    const focus = focusOn(byAliasId, input.suppliers);
    if (focus.supplierId !== null) return focus;
  }

  const query = firstValue(input.q).trim();
  if (query !== '') {
    const matched = matchByName(query, input.suppliers);
    return matched === null ? { supplierId: null, query } : focusOn(matched, input.suppliers);
  }

  const hash = decodeHash(input.hash ?? '');
  if (hash !== '') {
    // `#supplier-3` is the card's own element id (and what the v0.12.0 notes
    // promised); a bare `#3` is accepted too.
    const hashId = parseId(hash.startsWith('supplier-') ? hash.slice('supplier-'.length) : hash);
    if (hashId !== null) return focusOn(hashId, input.suppliers);
    const matched = matchByName(hash, input.suppliers);
    if (matched !== null) return focusOn(matched, input.suppliers);
  }

  return { supplierId: null, query: '' };
}

/** Is this focus asking for anything at all? */
export function hasSupplierFocus(focus: SupplierFocus): boolean {
  return focus.supplierId !== null || focus.query !== '';
}

/** The single place a "Supplier card" link is built (Recurring, Contracts, follow-ups). */
export function supplierCardHref(supplierId: number): string {
  return `/suppliers?supplierId=${supplierId}`;
}

/**
 * Identity of a focus, used as the list's React key. A *different* deep link
 * has to remount the island with its own filter — `/suppliers?supplierId=7`
 * after `…?supplierId=3` is the same route, and React would otherwise keep the
 * first link's filter because the component instance survives. The same link
 * re-rendered by a form action keeps its key, so typed filters and open cards
 * survive an edit, exactly as they should.
 */
export function supplierFocusKey(focus: SupplierFocus | null): string {
  if (focus === null || !hasSupplierFocus(focus)) return 'all-suppliers';
  return `focus:${focus.supplierId ?? 'search'}:${focus.query}`;
}
