import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { GET } from '../src/app/api/attachments/[fileKey]/route';
import { closeDbHandle, getDbHandle } from '../src/lib/db/client';
import { loadAppConfig } from '../src/lib/config';
import { auditEntries, attachments } from '../src/lib/db/schema';
import { findChildCategory } from '../src/lib/records/categories';
import { createPerson } from '../src/lib/records/people';
import { createPot } from '../src/lib/records/pots';
import { createPurchase } from '../src/lib/records/purchases';
import {
  AttachmentInputError,
  MAX_ATTACHMENT_BYTES,
  isSafeFileKey,
  listStoredAttachments,
  readAttachmentBytes,
  sanitizeOriginalName,
  sniffAttachmentMime,
  storeAttachment,
} from '../src/lib/records/attachments';
import { createHouseholdFixture } from './household';
import { makeTempDir } from './helpers';

/**
 * Attachment pipeline (SPEC §23.3, plan test strategy): content-sniffed MIME
 * versus a spoofed extension, the size limit, a failed upload that leaves the
 * purchase intact and retryable, orphan files that are reported but never
 * deleted, and authenticated-only serving.
 */

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF_BYTES = Buffer.from('%PDF-1.7\nbody\n%%EOF\n', 'latin1');
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const ZIP_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(32)]);

describe('attachment MIME is decided by content, not by the file name', () => {
  it('sniffs the three supported formats and rejects everything else', () => {
    assert.equal(sniffAttachmentMime(PNG_BYTES), 'image/png');
    assert.equal(sniffAttachmentMime(JPEG_BYTES), 'image/jpeg');
    assert.equal(sniffAttachmentMime(PDF_BYTES), 'application/pdf');
    assert.equal(sniffAttachmentMime(ZIP_BYTES), null);
    assert.equal(sniffAttachmentMime(Buffer.from('<html>not a receipt</html>')), null);
    assert.equal(sniffAttachmentMime(Buffer.alloc(0)), null);
    // A PNG truncated to four bytes is not a PNG.
    assert.equal(sniffAttachmentMime(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null);
  });

  it('accepts only server-generated storage keys', () => {
    assert.equal(isSafeFileKey('0e2b1c9a-1f4d-4a3b-9c7e-2b6f5a1d3c4e.png'), true);
    assert.equal(isSafeFileKey('../../etc/passwd'), false);
    assert.equal(isSafeFileKey('0e2b1c9a-1f4d-4a3b-9c7e-2b6f5a1d3c4e.txt'), false);
    assert.equal(isSafeFileKey('not-a-uuid.png'), false);
  });

  it('sanitizes display names without letting them point anywhere', () => {
    assert.equal(sanitizeOriginalName('  receipt.png '), 'receipt.png');
    assert.equal(sanitizeOriginalName('/etc/shadow'), 'shadow');
    assert.equal(sanitizeOriginalName('..\\..\\windows\\system32\\cfg'), 'cfg');
    assert.equal(sanitizeOriginalName('"><script>.png'), '___script_.png');
    assert.equal(sanitizeOriginalName('   '), 'attachment');
    assert.equal(sanitizeOriginalName('a'.repeat(400)).length, 200);
  });
});

describe('storing an attachment', () => {
  it('writes the file, the row and the audit entry, and refuses a spoofed type', async () => {
    const fx = await createHouseholdFixture('alex@example.com');
    try {
      const documentsDir = path.join(path.dirname(fx.handle.raw.name), 'documents');
      const purchase = purchaseIn(fx.db, fx);

      const stored = await storeAttachment({
        db: fx.db,
        purchaseId: purchase,
        originalName: 'weekly shop receipt.png',
        bytes: PNG_BYTES,
        actor: 'alex@example.com',
        documentsDir,
      });
      assert.equal(stored.mime, 'image/png');
      assert.equal(stored.originalName, 'weekly shop receipt.png');
      assert.ok(existsSync(path.join(documentsDir, stored.fileKey)));
      assert.deepEqual(await readAttachmentBytes(documentsDir, stored.fileKey), PNG_BYTES);

      const audit = fx.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.action, 'attachment.store'))
        .all();
      assert.equal(audit.length, 1);
      assert.equal(audit[0]!.actor, 'alex@example.com');

      // A renamed archive pretending to be a PNG is rejected and changes nothing.
      await assert.rejects(
        () =>
          storeAttachment({
            db: fx.db,
            purchaseId: purchase,
            originalName: 'receipt.png',
            bytes: ZIP_BYTES,
            actor: 'alex@example.com',
            documentsDir,
          }),
        (err: unknown) =>
          err instanceof AttachmentInputError && /genuine PNG, JPEG or PDF/.test(err.message),
      );
      assert.equal(listStoredAttachments(fx.db, purchase).length, 1);
      assert.equal(
        (await fs.readdir(documentsDir)).length,
        1,
        'a rejected upload writes no file, so the retry is a clean retry',
      );
    } finally {
      fx.close();
    }
  });

  it('enforces the size limit and rejects an empty file', async () => {
    const fx = await createHouseholdFixture('alex@example.com');
    try {
      const documentsDir = path.join(path.dirname(fx.handle.raw.name), 'documents');
      const purchase = purchaseIn(fx.db, fx);
      await assert.rejects(
        () =>
          storeAttachment({
            db: fx.db,
            purchaseId: purchase,
            originalName: 'too big.png',
            bytes: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1),
            actor: 'alex@example.com',
            documentsDir,
          }),
        AttachmentInputError,
      );
      await assert.rejects(
        () =>
          storeAttachment({
            db: fx.db,
            purchaseId: purchase,
            originalName: 'empty.png',
            bytes: Buffer.alloc(0),
            actor: 'alex@example.com',
            documentsDir,
          }),
        AttachmentInputError,
      );
      assert.equal(existsSync(documentsDir), false, 'nothing is written for a rejected upload');
    } finally {
      fx.close();
    }
  });

  it('refuses to attach to a purchase that does not exist', async () => {
    const fx = await createHouseholdFixture('alex@example.com');
    try {
      await assert.rejects(
        () =>
          storeAttachment({
            db: fx.db,
            purchaseId: 9999,
            originalName: 'receipt.png',
            bytes: PNG_BYTES,
            actor: 'alex@example.com',
            documentsDir: path.join(path.dirname(fx.handle.raw.name), 'documents'),
          }),
        AttachmentInputError,
      );
    } finally {
      fx.close();
    }
  });
});

describe('GET /api/attachments/[fileKey]', () => {
  let dataDir: string;

  before(async () => {
    dataDir = await makeTempDir('sf-attachment-route-');
    process.env.DATA_DIR = dataDir;
    process.env.AUTH_DEV_BYPASS = 'false';
    delete process.env.AUTH_DEV_IDENTITY_EMAIL;
  });

  after(() => {
    closeDbHandle();
    delete process.env.DATA_DIR;
    delete process.env.AUTH_DEV_BYPASS;
  });

  function callRoute(fileKey: string) {
    return GET(new Request(`http://localhost:3000/api/attachments/${fileKey}`), {
      params: Promise.resolve({ fileKey }),
    });
  }

  it('serves nothing to an unauthenticated request', async () => {
    const response = await callRoute('0e2b1c9a-1f4d-4a3b-9c7e-2b6f5a1d3c4e.png');
    assert.equal(response.status, 401);
  });

  it('serves a stored attachment privately, and 404s for anything else', async () => {
    process.env.AUTH_DEV_BYPASS = 'true';
    process.env.AUTH_DEV_IDENTITY_EMAIL = 'dev@example.com';
    try {
      const config = loadAppConfig();
      const { db } = getDbHandle(config);
      const pot = createPot(db, {
        label: 'Main account',
        kind: 'bank',
        actor: 'dev@example.com',
      });
      const person = createPerson(db, { label: 'Dev', actor: 'dev@example.com' });
      const category = findChildCategory(db, 'Groceries', 'Weekly Shop');
      assert.ok(category !== null);
      const saved = createPurchase(db, {
        potId: pot.id,
        totalPence: 899,
        occurredAt: new Date('2026-09-19T12:00:00Z'),
        paidByPersonId: person.id,
        supplierName: 'Corner Shop',
        actor: 'dev@example.com',
        lines: [{ amountPence: 899, categoryId: category.id, targetKind: 'household' }],
        now: new Date('2026-09-19T12:01:00Z'),
      });
      const stored = await storeAttachment({
        db,
        purchaseId: saved.purchase.id,
        originalName: 'till receipt.png',
        bytes: JPEG_BYTES,
        actor: 'dev@example.com',
        documentsDir: config.documentsDir,
      });

      const response = await callRoute(stored.fileKey);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/jpeg');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(
        response.headers.get('content-disposition'),
        'inline; filename="till receipt.png"',
      );
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), JPEG_BYTES);

      // Unsafe key shapes never reach the filesystem.
      assert.equal((await callRoute('../../etc/passwd')).status, 404);
      assert.equal((await callRoute('0e2b1c9a-1f4d-4a3b-9c7e-2b6f5a1d3c4e.txt')).status, 404);
      // A safe-looking key with no row is simply not found.
      assert.equal((await callRoute('0e2b1c9a-1f4d-4a3b-9c7e-2b6f5a1d3c4e.png')).status, 404);

      // Only `stored` rows are referenceable (SPEC §23.3).
      db.update(attachments)
        .set({ state: 'pending' })
        .where(eq(attachments.fileKey, stored.fileKey))
        .run();
      assert.equal((await callRoute(stored.fileKey)).status, 404);
    } finally {
      process.env.AUTH_DEV_BYPASS = 'false';
    }
  });
});

/** A minimal purchase inside the fixture database, for attachment tests. */
function purchaseIn(
  db: Awaited<ReturnType<typeof createHouseholdFixture>>['db'],
  fx: Awaited<ReturnType<typeof createHouseholdFixture>>,
): number {
  const saved = createPurchase(db, {
    potId: fx.pots.main.id,
    totalPence: 1234,
    occurredAt: new Date('2026-09-19T12:00:00Z'),
    paidByPersonId: fx.people.alex.id,
    supplierName: 'Corner Shop',
    actor: 'alex@example.com',
    lines: [
      {
        amountPence: 1234,
        categoryId: fx.categoryId('Groceries', 'Top-up Shops'),
        targetKind: 'household',
      },
    ],
    now: new Date('2026-09-19T12:01:00Z'),
  });
  return saved.purchase.id;
}
