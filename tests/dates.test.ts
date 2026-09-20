import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDaysLocal,
  addMonthsClamped,
  addYearsClamped,
  clampedDueDate,
  daysBetween,
  isLeapYear,
} from '../src/lib/records/dates';

describe('dates: pure local-calendar arithmetic', () => {
  it('daysBetween counts whole local days, zero within a day, negative before', () => {
    assert.equal(daysBetween('2026-09-27', '2026-10-26'), 29);
    assert.equal(daysBetween('2026-09-26', '2026-09-26'), 0);
    assert.equal(daysBetween('2026-09-27', '2026-09-26'), -1);
    assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  });

  it('addDaysLocal crosses month and year boundaries', () => {
    assert.equal(addDaysLocal('2026-08-31', 1), '2026-09-01');
    assert.equal(addDaysLocal('2026-12-31', 1), '2027-01-01');
    assert.equal(addDaysLocal('2026-02-28', 1), '2026-03-01');
    assert.equal(addDaysLocal('2024-02-28', 1), '2024-02-29');
    assert.equal(addDaysLocal('2026-09-26', -1), '2026-09-25');
  });

  it('addDaysLocal is exact across DST transitions (no instant math leaks in)', () => {
    // UK spring-forward 2026-03-29 and autumn-back 2026-10-25.
    assert.equal(addDaysLocal('2026-03-28', 1), '2026-03-29');
    assert.equal(addDaysLocal('2026-03-29', 1), '2026-03-30');
    assert.equal(addDaysLocal('2026-10-24', 1), '2026-10-25');
    assert.equal(addDaysLocal('2026-10-25', 1), '2026-10-26');
    // A week across a transition is still exactly 7 days.
    assert.equal(addDaysLocal('2026-10-19', 7), '2026-10-26');
  });

  it('clampedDueDate maps out-of-month due days to the month end (plan OQ1)', () => {
    assert.equal(clampedDueDate(31, 2026, 9), '2026-09-30');
    assert.equal(clampedDueDate(31, 2026, 6), '2026-06-30');
    assert.equal(clampedDueDate(31, 2026, 2), '2026-02-28');
    assert.equal(clampedDueDate(31, 2024, 2), '2024-02-29');
    assert.equal(clampedDueDate(15, 2026, 2), '2026-02-15');
    assert.equal(clampedDueDate(30, 2026, 1), '2026-01-30');
  });

  it('clampedDueDate rejects structurally impossible inputs, clamps legal ones', () => {
    assert.throws(() => clampedDueDate(0, 2026, 9), /between 1 and 31/);
    assert.throws(() => clampedDueDate(32, 2026, 9), /between 1 and 31/);
    assert.throws(() => clampedDueDate(15, 2026, 13), /between 1 and 12/);
    // "Due the 29th" is a legal due day — in February it clamps, it does not throw (OQ1/OQ13).
    assert.equal(clampedDueDate(29, 2026, 2), '2026-02-28');
    assert.equal(clampedDueDate(29, 2024, 2), '2024-02-29');
  });

  it('addMonthsClamped keeps in-month anniversaries and clamps to month end', () => {
    assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonthsClamped('2024-01-31', 1), '2024-02-29');
    assert.equal(addMonthsClamped('2026-01-31', 2), '2026-03-31');
    assert.equal(addMonthsClamped('2026-03-15', -1), '2026-02-15');
    assert.equal(addMonthsClamped('2026-11-30', 1), '2026-12-30');
  });

  it('addYearsClamped advances a year, with 29 Feb -> 28 Feb in non-leap years (OQ13)', () => {
    assert.equal(addYearsClamped('2026-10-12', 1), '2027-10-12');
    assert.equal(addYearsClamped('2024-02-29', 1), '2025-02-28');
    assert.equal(addYearsClamped('2024-02-29', 4), '2028-02-29');
    assert.equal(addYearsClamped('2026-12-31', 1), '2027-12-31');
  });

  it('isLeapYear follows the Gregorian rule', () => {
    assert.equal(isLeapYear(2024), true);
    assert.equal(isLeapYear(2026), false);
    assert.equal(isLeapYear(1900), false);
    assert.equal(isLeapYear(2000), true);
  });
});
