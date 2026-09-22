import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { followedLineAmount } from '../src/lib/records/quick-entry';

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
