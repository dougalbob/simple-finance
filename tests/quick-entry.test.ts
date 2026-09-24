import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  editDistance,
  followedLineAmount,
  nearestSupplierName,
  normalizeSupplierQuery,
  rankSupplierMatches,
} from '../src/lib/records/quick-entry';

/**
 * The pure half of the mobile Quick Entry rule: which value Line 1 of "Split
 * the payment" should show when the payment amount changes. The takeover flag
 * itself is client state in `PurchaseForm` and is checked in the Playwright
 * suite (`e2e/home.spec.ts`).
 */
describe('followedLineAmount', () => {
  it('mirrors a valid total in exact pence form', () => {
    assert.deepEqual(followedLineAmount('85'), { action: 'set', amount: '85.00' });
    assert.deepEqual(followedLineAmount('8'), { action: 'set', amount: '8.00' });
    assert.deepEqual(followedLineAmount('84.50'), { action: 'set', amount: '84.50' });
    assert.deepEqual(followedLineAmount('8.5'), { action: 'set', amount: '8.50' });
    assert.deepEqual(followedLineAmount('£1,234.56'), { action: 'set', amount: '1234.56' });
  });

  it('does not freeze on the first valid number: 8 then 85 must become 85.00', () => {
    assert.deepEqual(followedLineAmount('8'), { action: 'set', amount: '8.00' });
    assert.deepEqual(followedLineAmount('85'), { action: 'set', amount: '85.00' });
  });

  it('follows a correction from 85 down to 84.50', () => {
    assert.deepEqual(followedLineAmount('85.00'), { action: 'set', amount: '85.00' });
    assert.deepEqual(followedLineAmount('84.5'), { action: 'set', amount: '84.50' });
  });

  it('clears a deleted or zero total — a removed amount must not linger', () => {
    assert.deepEqual(followedLineAmount(''), { action: 'clear' });
    assert.deepEqual(followedLineAmount('  '), { action: 'clear' });
    assert.deepEqual(followedLineAmount('0'), { action: 'clear' });
    assert.deepEqual(followedLineAmount('0.00'), { action: 'clear' });
    assert.deepEqual(followedLineAmount('£0.00'), { action: 'clear' });
  });

  it('holds the last mirrored value while the total is half-typed', () => {
    assert.deepEqual(followedLineAmount('85.'), { action: 'hold' });
    assert.deepEqual(followedLineAmount('.'), { action: 'hold' });
    assert.deepEqual(followedLineAmount('1.2.3'), { action: 'hold' });
    assert.deepEqual(followedLineAmount('12.345'), { action: 'hold' });
    assert.deepEqual(followedLineAmount('abc'), { action: 'hold' });
  });

  it('never writes a negative total', () => {
    assert.deepEqual(followedLineAmount('-5'), { action: 'hold' });
    assert.deepEqual(followedLineAmount('-0.01'), { action: 'hold' });
  });
});

/**
 * The supplier typeahead's ranking (SPEC §15.1, v0.9.0). The old
 * `<datalist>` handed the list to a browser popup; the new list is filtered
 * here, so this is the part that decides what the household sees after one
 * keystroke at a till. Pure — the tappable rows themselves are covered by
 * `e2e/home.spec.ts`.
 */
describe('supplier typeahead ranking', () => {
  // Recents first, then alphabetical — the order `listSuppliersForEntry`
  // hands over. Fictional names, like every fixture here.
  const suppliers = [
    { id: 1, name: 'Corner Foods' },
    { id: 2, name: 'The Corner Cafe' },
    { id: 3, name: 'InsurerCo' },
    { id: 4, name: 'BroadbandCo' },
  ];

  it('shows recents-first when the field is empty', () => {
    assert.deepEqual(
      rankSupplierMatches(suppliers, '', 2).map((supplier) => supplier.name),
      ['Corner Foods', 'The Corner Cafe'],
    );
    assert.deepEqual(
      rankSupplierMatches(suppliers, '   ', 2),
      rankSupplierMatches(suppliers, '', 2),
    );
  });

  it('filters case-insensitively on any part of the name, prefix matches first', () => {
    assert.deepEqual(
      rankSupplierMatches(suppliers, 'CO').map((supplier) => supplier.name),
      // "Corner Foods" starts with it and ranks first; the rest merely
      // contain it, shortest name first.
      ['Corner Foods', 'InsurerCo', 'BroadbandCo', 'The Corner Cafe'],
    );
    assert.deepEqual(
      rankSupplierMatches(suppliers, 'corner').map((supplier) => supplier.name),
      ['Corner Foods', 'The Corner Cafe'],
    );
    assert.deepEqual(
      rankSupplierMatches(suppliers, 'zzz').map((supplier) => supplier.name),
      [],
    );
  });

  it('adds a new name by typing — no match means no suggestion, never a block', () => {
    assert.deepEqual(rankSupplierMatches(suppliers, 'Brand New Shop'), []);
  });

  it('suggests the near match within an edit distance of 2, never an exact one', () => {
    assert.equal(nearestSupplierName(suppliers, 'InsureCo')?.name, 'InsurerCo');
    assert.equal(nearestSupplierName(suppliers, 'Corner Food')?.name, 'Corner Foods');
    // An exact name is not suggested back, and an empty field suggests nothing.
    assert.equal(nearestSupplierName(suppliers, 'Corner Foods'), null);
    assert.equal(nearestSupplierName(suppliers, '   '), null);
    assert.equal(nearestSupplierName(suppliers, 'completely different'), null);
  });

  it('normalises whitespace and case before matching', () => {
    assert.equal(normalizeSupplierQuery('  Corner   FOODS '), 'corner foods');
    assert.equal(editDistance('corner', 'corner'), 0);
    assert.equal(editDistance('corner', 'corners'), 1);
    assert.equal(editDistance('corner', 'kormer'), 2); // two substitutions, still a prompt
  });
});
