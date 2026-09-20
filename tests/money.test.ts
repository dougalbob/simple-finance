import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPence, parsePence } from '../src/lib/money';

describe('parsePence', () => {
  it('parses plain two-decimal input', () => {
    assert.equal(parsePence('412.35'), 41235);
  });

  it('parses currency symbols, commas and surrounding spaces', () => {
    assert.equal(parsePence('£412.35'), 41235);
    assert.equal(parsePence('1,234.56'), 123456);
    assert.equal(parsePence(' 90 '), 9000);
  });

  it('parses whole-pound, single-decimal and leading-decimal forms', () => {
    assert.equal(parsePence('12'), 1200);
    assert.equal(parsePence('12.3'), 1230);
    assert.equal(parsePence('.5'), 50);
    assert.equal(parsePence('0'), 0);
  });

  it('parses negative amounts (overdraft balances are real)', () => {
    assert.equal(parsePence('-66.08'), -6608);
    assert.equal(parsePence('-0.01'), -1);
  });

  it('rejects more than two decimal places', () => {
    assert.equal(parsePence('12.345'), null);
  });

  it('rejects empty, dangling and malformed input', () => {
    assert.equal(parsePence(''), null);
    assert.equal(parsePence('.'), null);
    assert.equal(parsePence('-'), null);
    assert.equal(parsePence('12.'), null);
    assert.equal(parsePence('abc'), null);
    assert.equal(parsePence('1.2.3'), null);
    assert.equal(parsePence('£'), null);
  });

  it('rejects absurd magnitudes', () => {
    assert.equal(parsePence('12345678901'), null); // 11 digits of pounds
    assert.equal(parsePence('999999999999999999'), null);
  });
});

describe('formatPence', () => {
  it('formats typical amounts', () => {
    assert.equal(formatPence(41235), '£412.35');
    assert.equal(formatPence(0), '£0.00');
    assert.equal(formatPence(5), '£0.05');
    assert.equal(formatPence(90), '£0.90');
  });

  it('formats negatives and thousands separators deterministically', () => {
    assert.equal(formatPence(-6608), '-£66.08');
    assert.equal(formatPence(123456), '£1,234.56');
    assert.equal(formatPence(100000000), '£1,000,000.00');
  });

  it('rejects non-integers', () => {
    assert.throws(() => formatPence(1.5));
    assert.throws(() => formatPence(Number.NaN));
  });
});
