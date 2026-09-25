import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hasSupplierFocus,
  resolveSupplierFocus,
  supplierCardHref,
  supplierFocusKey,
  type SupplierIdentity,
} from '../src/lib/records/supplier-focus';

/**
 * "Supplier card" deep links (SPEC §21, decision 149). The links in Recurring
 * and Contracts name the supplier they came from, and the Suppliers page has to
 * agree with them: the named card is the one that opens, the filter box says
 * which supplier is being shown, and a link naming nothing we hold degrades to
 * the plain list rather than to a wrong card.
 */

const SUPPLIERS: SupplierIdentity[] = [
  { id: 1, name: 'BroadbandCo' },
  { id: 2, name: 'Corner Foods' },
  { id: 7, name: 'InsurerCo' },
];

const resolve = (params: Partial<Parameters<typeof resolveSupplierFocus>[0]>) =>
  resolveSupplierFocus({ suppliers: SUPPLIERS, ...params });

describe('supplier focus (SPEC §21, decision 149)', () => {
  it('builds the link the schedule and renewal rows use', () => {
    assert.equal(supplierCardHref(7), '/suppliers?supplierId=7');
  });

  it('opens the named card and filters to it', () => {
    assert.deepEqual(resolve({ supplierId: '2' }), { supplierId: 2, query: 'Corner Foods' });
  });

  it('accepts the ?id= alias the UI note proposed', () => {
    assert.deepEqual(resolve({ id: '7' }), { supplierId: 7, query: 'InsurerCo' });
  });

  it('prefers supplierId when both are present, and the first repeated value', () => {
    assert.deepEqual(resolve({ supplierId: '1', id: '7' }), {
      supplierId: 1,
      query: 'BroadbandCo',
    });
    assert.deepEqual(resolve({ supplierId: ['2', '1'] }), {
      supplierId: 2,
      query: 'Corner Foods',
    });
  });

  it('treats an id we do not hold as a plain visit, not a wrong card', () => {
    assert.deepEqual(resolve({ supplierId: '99' }), { supplierId: null, query: '' });
    assert.equal(hasSupplierFocus(resolve({ supplierId: '99' })), false);
  });

  it('ignores ids that are not positive integers', () => {
    for (const junk of ['0', '-3', '3.5', '3x', '', ' ', 'NaN']) {
      assert.deepEqual(resolve({ supplierId: junk }), { supplierId: null, query: '' }, junk);
    }
  });

  it('falls through a stale ?id= to a usable ?q=', () => {
    assert.deepEqual(resolve({ supplierId: '99', q: 'InsurerCo' }), {
      supplierId: 7,
      query: 'InsurerCo',
    });
  });

  it('resolves ?q= by exact name, then by the first partial match', () => {
    assert.deepEqual(resolve({ q: 'InsurerCo' }), { supplierId: 7, query: 'InsurerCo' });
    assert.deepEqual(resolve({ q: 'corner' }), { supplierId: 2, query: 'Corner Foods' });
    // Inner whitespace and case are the same identity, as everywhere else.
    assert.deepEqual(resolve({ q: '  corner   foods ' }), {
      supplierId: 2,
      query: 'Corner Foods',
    });
  });

  it('keeps a search that matches nothing as a filter, with no card to open', () => {
    assert.deepEqual(resolve({ q: 'nowhere' }), { supplierId: null, query: 'nowhere' });
    assert.equal(hasSupplierFocus(resolve({ q: 'nowhere' })), true);
  });

  it('honours the #supplier-<id> fragment the v0.12.0 notes promised', () => {
    assert.deepEqual(resolve({ hash: '#supplier-1' }), { supplierId: 1, query: 'BroadbandCo' });
    assert.deepEqual(resolve({ hash: 'supplier-2' }), { supplierId: 2, query: 'Corner Foods' });
  });

  it('honours a fragment that names a supplier, encoded or not', () => {
    assert.deepEqual(resolve({ hash: '#Corner Foods' }), { supplierId: 2, query: 'Corner Foods' });
    assert.deepEqual(resolve({ hash: '#Corner%20Foods' }), {
      supplierId: 2,
      query: 'Corner Foods',
    });
  });

  it('survives a fragment with a stray percent sign or an unknown id', () => {
    assert.deepEqual(resolve({ hash: '#100%25off' }), { supplierId: null, query: '' });
    assert.deepEqual(resolve({ hash: '#supplier-99' }), { supplierId: null, query: '' });
  });

  it('prefers the query string over the fragment, and is nothing when given nothing', () => {
    assert.deepEqual(resolve({ supplierId: '1', hash: '#supplier-2' }), {
      supplierId: 1,
      query: 'BroadbandCo',
    });
    assert.deepEqual(resolve({}), { supplierId: null, query: '' });
    assert.deepEqual(resolve({ hash: '#', q: '   ' }), { supplierId: null, query: '' });
  });
});

describe('supplier focus key (decision 149)', () => {
  it('is stable for the same link and different for a different one', () => {
    const broadband = resolve({ supplierId: '1' });
    assert.equal(supplierFocusKey(broadband), supplierFocusKey(resolve({ supplierId: '1' })));
    assert.notEqual(supplierFocusKey(broadband), supplierFocusKey(resolve({ supplierId: '2' })));
  });

  it('separates a plain visit from a focused one, and a search from a card', () => {
    assert.equal(supplierFocusKey(null), 'all-suppliers');
    assert.equal(supplierFocusKey(resolve({})), 'all-suppliers');
    assert.equal(supplierFocusKey(resolve({ q: 'nowhere' })), 'focus:search:nowhere');
    assert.notEqual(supplierFocusKey(resolve({ q: 'nowhere' })), supplierFocusKey(null));
  });
});
