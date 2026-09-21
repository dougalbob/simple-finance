import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  backupFilename,
  fallbackBackupFilename,
  filenameFromContentDisposition,
} from '../src/lib/backup/filename';
import { chooseDownloadFilename } from '../src/lib/backup/download';

/**
 * The v0.2.21 lesson, tested at the layer that failed (blueprint §6): a blob
 * URL does not inherit HTTP response headers, so the browser download path has
 * to carry the server filename into `anchor.download` and cope when the header
 * is absent, unusable or dangerous. The end-to-end button path is exercised in
 * the Playwright run (`e2e/backup.spec.ts`); these are the parsing rules it
 * relies on.
 */

describe('Content-Disposition filename parsing', () => {
  it('reads a quoted filename', () => {
    assert.equal(
      filenameFromContentDisposition(
        'attachment; filename="simple-finance-backup-v0.1.0-2026-09-20-213012.simple-finance-backup"',
      ),
      'simple-finance-backup-v0.1.0-2026-09-20-213012.simple-finance-backup',
    );
  });

  it('reads an unquoted token form', () => {
    assert.equal(
      filenameFromContentDisposition('attachment; filename=backup.tar.gz'),
      'backup.tar.gz',
    );
  });

  it('reads the RFC 5987 extended form, preferring it over the token form', () => {
    assert.equal(
      filenameFromContentDisposition(
        "attachment; filename=fallback.bin; filename*=UTF-8''finance%20backup.gz",
      ),
      'finance backup.gz',
    );
  });

  it('unescapes quoted pairs', () => {
    assert.equal(
      filenameFromContentDisposition('attachment; filename="receipt \\"final\\".png"'),
      'receipt "final".png',
    );
  });

  it('refuses anything that is not a plain file name', () => {
    assert.equal(filenameFromContentDisposition(null), null);
    assert.equal(filenameFromContentDisposition(''), null);
    assert.equal(filenameFromContentDisposition('attachment'), null);
    assert.equal(filenameFromContentDisposition('attachment; filename=""'), null);
    assert.equal(filenameFromContentDisposition('attachment; filename="../../etc/passwd"'), null);
    assert.equal(filenameFromContentDisposition('attachment; filename=".."'), null);
    assert.equal(filenameFromContentDisposition('attachment; filename="a/b.tar"'), null);
    // An escaped backslash is unescaped (RFC 6266 quoted-pair), which leaves a
    // plain name rather than a path separator.
    assert.equal(filenameFromContentDisposition('attachment; filename="a\\b.tar"'), 'ab.tar');
    assert.equal(filenameFromContentDisposition('attachment; filename="line\nbreak"'), null);
    assert.equal(filenameFromContentDisposition(`attachment; filename="${'x'.repeat(300)}"`), null);
  });
});

describe('download naming falls back rather than inventing a name', () => {
  it('uses the server filename when the header is usable', () => {
    const chosen = chooseDownloadFilename(
      'attachment; filename="from-server.bin"',
      '0.1.0',
      new Date('2026-09-20T20:30:12Z'),
    );
    assert.deepEqual(chosen, { filename: 'from-server.bin', usedFallback: false });
  });

  it('falls back to the versioned contract name when the header is missing', () => {
    const instant = new Date('2026-09-20T20:30:12Z');
    const chosen = chooseDownloadFilename(null, '0.1.0', instant);
    assert.equal(chosen.usedFallback, true);
    assert.equal(chosen.filename, backupFilename('0.1.0', instant));
    assert.match(
      chosen.filename,
      /^simple-finance-backup-v0\.1\.0-2026-09-20-\d{6}\.simple-finance-backup$/,
    );
  });

  it('falls back instead of trusting a hostile header', () => {
    const chosen = chooseDownloadFilename(
      'attachment; filename="../../../../home/someone/.ssh/id_rsa"',
      '0.1.0',
      new Date('2026-09-20T20:30:12Z'),
    );
    assert.equal(chosen.usedFallback, true);
    assert.equal(chosen.filename.includes('/'), false);
    assert.equal(chosen.filename.includes('id_rsa'), false);
  });

  it('renders the fallback name in Europe/London from the same instant', () => {
    // 25 October 2026 is the UK autumn change: at 01:00 UTC the clocks go back
    // to 01:00 GMT, so 00:30 UTC (BST) and 01:30 UTC (GMT) share a local wall
    // clock. The name must follow local time, not UTC.
    assert.equal(
      fallbackBackupFilename('0.1.0', new Date('2026-10-25T00:30:00Z')),
      'simple-finance-backup-v0.1.0-2026-10-25-013000.simple-finance-backup',
    );
    assert.equal(
      fallbackBackupFilename('0.1.0', new Date('2026-10-25T01:30:45Z')),
      'simple-finance-backup-v0.1.0-2026-10-25-013045.simple-finance-backup',
    );
    // Just after local midnight on 1 January is the previous year in UTC.
    assert.equal(
      fallbackBackupFilename('0.1.0', new Date('2027-01-01T00:15:00Z')),
      'simple-finance-backup-v0.1.0-2027-01-01-001500.simple-finance-backup',
    );
  });
});
