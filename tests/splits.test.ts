import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertSplitBalanced,
  isSplitBalanced,
  splitRemainder,
  SplitValidationError,
} from '../src/lib/records/splits';

describe('split validation (SPEC §9.3 — lines must total the payment exactly)', () => {
  it('accepts the E1 mixed receipt: £41.98 + £21.49 = £63.47', () => {
    assert.doesNotThrow(() => assertSplitBalanced(6347, [4198, 2149]));
    assert.equal(isSplitBalanced(6347, [4198, 2149]), true);
    assert.equal(splitRemainder(6347, [4198, 2149]), 0);
  });

  it('reports the remainder for the “assign remaining £X to…” helper', () => {
    assert.equal(splitRemainder(6347, [4198]), 2149);
    assert.equal(splitRemainder(6347, []), 6347);
    assert.equal(splitRemainder(6347, [7000]), -653);
    assert.equal(isSplitBalanced(6347, [4198]), false);
  });

  it('rejects short and over lines with the gap in the message', () => {
    assert.throws(() => assertSplitBalanced(6347, [4198]), SplitValidationError);
    assert.throws(() => assertSplitBalanced(6347, [4198, 2150]), SplitValidationError);
    try {
      assertSplitBalanced(6347, [4198]);
      assert.fail('expected a total_mismatch error');
    } catch (err) {
      assert.ok(err instanceof SplitValidationError);
      assert.equal(err.code, 'total_mismatch');
      assert.match(err.message, /£21\.49 short/);
    }
  });

  it('requires at least one line and a non-zero total', () => {
    assert.throws(() => assertSplitBalanced(6347, []), SplitValidationError);
    assert.throws(() => assertSplitBalanced(0, [0]), SplitValidationError);
    assert.throws(() => assertSplitBalanced(63.47, [6347]), SplitValidationError);
    assert.throws(() => assertSplitBalanced(Number.NaN, [1]), SplitValidationError);
    try {
      assertSplitBalanced(6347, []);
      assert.fail('expected a no_lines error');
    } catch (err) {
      assert.ok(err instanceof SplitValidationError);
      assert.equal(err.code, 'no_lines');
    }
  });

  it('rejects zero and non-integer line amounts', () => {
    assert.throws(() => assertSplitBalanced(6347, [6347, 0]), SplitValidationError);
    assert.throws(() => assertSplitBalanced(6347, [4198.5, 2148.5]), SplitValidationError);
    try {
      assertSplitBalanced(6347, [6347, 0]);
      assert.fail('expected a zero_line_amount error');
    } catch (err) {
      assert.ok(err instanceof SplitValidationError);
      assert.equal(err.code, 'zero_line_amount');
      assert.equal(err.lineIndex, 1);
    }
  });

  it('keeps purchase lines positive and refund lines negative (no mixed signs)', () => {
    // Refunds split into negative lines.
    assert.doesNotThrow(() => assertSplitBalanced(-2149, [-2149]));
    assert.doesNotThrow(() => assertSplitBalanced(-6347, [-4198, -2149]));
    // A negative line inside a purchase is a refund in disguise — record it as one.
    assert.throws(() => assertSplitBalanced(6347, [8496, -2149]), SplitValidationError);
    assert.throws(() => assertSplitBalanced(-2149, [-3000, 851]), SplitValidationError);
    try {
      assertSplitBalanced(6347, [8496, -2149]);
      assert.fail('expected a mixed_sign_line error');
    } catch (err) {
      assert.ok(err instanceof SplitValidationError);
      assert.equal(err.code, 'mixed_sign_line');
      assert.equal(err.lineIndex, 1);
      assert.match(err.message, /refund/);
    }
  });

  it('accepts line objects as well as bare amounts', () => {
    assert.equal(isSplitBalanced(6347, [{ amountPence: 4198 }, { amountPence: 2149 }]), true);
    assert.equal(splitRemainder(6347, [{ amountPence: 4198 }]), 2149);
  });

  it('isSplitBalanced never throws — invalid input is simply unbalanced', () => {
    assert.equal(isSplitBalanced(0, [0]), false);
    assert.equal(isSplitBalanced(6347, [Number.NaN]), false);
    assert.equal(isSplitBalanced(Number.NaN, []), false);
  });
});
