import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatRelativeAge } from '../src/lib/time';

describe('formatRelativeAge', () => {
  const now = new Date('2026-09-20T17:00:00Z');

  it('says "just now" for anything under a minute', () => {
    assert.equal(formatRelativeAge(new Date('2026-09-20T16:59:30Z'), now), 'just now');
    assert.equal(formatRelativeAge(new Date('2026-09-20T17:00:00Z'), now), 'just now');
  });

  it('handles minutes and hours with singular/plural', () => {
    assert.equal(formatRelativeAge(new Date('2026-09-20T16:59:00Z'), now), '1 minute ago');
    assert.equal(formatRelativeAge(new Date('2026-09-20T16:45:00Z'), now), '15 minutes ago');
    assert.equal(formatRelativeAge(new Date('2026-09-20T16:00:00Z'), now), '1 hour ago');
    assert.equal(formatRelativeAge(new Date('2026-09-20T13:00:00Z'), now), '4 hours ago');
  });

  it('handles days and weeks', () => {
    assert.equal(formatRelativeAge(new Date('2026-09-19T17:00:00Z'), now), '1 day ago');
    assert.equal(formatRelativeAge(new Date('2026-09-15T17:00:00Z'), now), '5 days ago');
    assert.equal(formatRelativeAge(new Date('2026-09-08T17:00:00Z'), now), '12 days ago');
    assert.equal(formatRelativeAge(new Date('2026-08-30T17:00:00Z'), now), '3 weeks ago');
  });

  it('never claims the future', () => {
    assert.equal(formatRelativeAge(new Date('2026-09-20T17:30:00Z'), now), 'just now');
  });
});
