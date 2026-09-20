import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backupFilename } from '../src/lib/backup/filename';

/**
 * The filename contract (blueprint §6, SPEC §18.3): date and 24-hour time
 * generated from ONE instant, in Europe/London, seconds included.
 * UK DST 2026: forward 29 March (01:00 GMT → 02:00 BST), back 25 October.
 */
describe('backupFilename', () => {
  it('renders summer instants in BST (UTC+1)', () => {
    assert.equal(
      backupFilename('0.1.0', new Date('2026-06-15T12:34:56Z')),
      'simple-finance-backup-v0.1.0-2026-06-15-133456.simple-finance-backup',
    );
  });

  it('renders winter instants in GMT', () => {
    assert.equal(
      backupFilename('0.1.0', new Date('2026-01-15T12:34:56Z')),
      'simple-finance-backup-v0.1.0-2026-01-15-123456.simple-finance-backup',
    );
  });

  it('rolls the date at local midnight, not UTC midnight', () => {
    assert.equal(
      backupFilename('0.1.0', new Date('2026-07-14T23:05:00Z')),
      'simple-finance-backup-v0.1.0-2026-07-15-000500.simple-finance-backup',
    );
  });

  it('handles the spring-forward transition (29 March 2026)', () => {
    // 00:30 UTC is 00:30 GMT; an hour later UTC it is already 02:30 BST.
    assert.equal(
      backupFilename('0.1.0', new Date('2026-03-29T00:30:00Z')),
      'simple-finance-backup-v0.1.0-2026-03-29-003000.simple-finance-backup',
    );
    assert.equal(
      backupFilename('0.1.0', new Date('2026-03-29T01:30:00Z')),
      'simple-finance-backup-v0.1.0-2026-03-29-023000.simple-finance-backup',
    );
  });

  it('handles the autumn-back transition (25 October 2026)', () => {
    // 00:30 UTC is still 01:30 BST (the repeated hour begins at 01:00 UTC).
    assert.equal(
      backupFilename('0.1.0', new Date('2026-10-25T00:30:00Z')),
      'simple-finance-backup-v0.1.0-2026-10-25-013000.simple-finance-backup',
    );
  });

  it('embeds the given app version', () => {
    assert.ok(
      backupFilename('9.9.9', new Date('2026-06-15T12:34:56Z')).startsWith(
        'simple-finance-backup-v9.9.9-',
      ),
    );
  });
});
