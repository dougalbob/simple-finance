import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { GET } from '../src/app/api/attachments/[fileKey]/route';
import { closeDbHandle, getDbHandle } from '../src/lib/db/client';
import { loadAppConfig } from '../src/lib/config';
import { attachments, auditEntries, purchases } from '../src/lib/db/schema';
import { findChildCategory } from '../src/lib/records/categories';
import { createPerson } from '../src/lib/records/people';
import { createPot } from '../src/lib/records/pots';
import { createPurchase } from '../src/lib/records/purchases';
import { createReceipt } from '../src/lib/records/receipts';
import {
  AttachmentInputError,
  AttachmentNotFoundError,
  MAX_ATTACHMENT_BYTES,
  deleteAttachment,
  isSafeFileKey,
  listStoredAttachments,
  listStoredReceiptAttachments,
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

describe('removing an attachment', () => {
  it('marks the row deleted, audits the purchase, then unlinks the file', async () => {
    const fx = await createHouseholdFixture('alex@example.com');
    try {
      const documentsDir = path.join(path.dirname(fx.handle.raw.name), 'documents');
      const purchaseId = purchaseIn(fx.db, fx);
      const stored = await storeAttachment({
        db: fx.db,
        purchaseId,
        originalName: 'weekly shop receipt.png',
        bytes: PNG_BYTES,
        actor: 'alex@example.com',
        documentsDir,
        now: new Date('2026-09-19T12:05:00Z'),
      });
      const other = await storeAttachment({
        db: fx.db,
        purchaseId,
        originalName: 'other.png',
        bytes: PNG_BYTES,
        actor: 'alex@example.com',
        documentsDir,
      });

      const removed = await deleteAttachment({
        db: fx.db,
        id: stored.id,
        actor: 'sam@example.com',
        documentsDir,
        now: new Date('2026-09-19T18:00:00Z'),
      });
      assert.equal(removed.deleted, true);
      assert.equal(removed.fileRemoved, true);
      assert.equal(removed.originalName, 'weekly shop receipt.png');
      assert.equal(existsSync(path.join(documentsDir, stored.fileKey)), false);
      assert.equal(
        listStoredAttachments(fx.db, purchaseId)
          .map((row) => row.id)
          .join(','),
        String(other.id),
      );
      assert.ok(existsSync(path.join(documentsDir, other.fileKey)));

      const row = fx.db.select().from(attachments).where(eq(attachments.id, stored.id)).get();
      assert.equal(row?.state, 'deleted');
      const purchase = fx.db.select().from(purchases).where(eq(purchases.id, purchaseId)).get();
      assert.equal(
        purchase?.voidedAt ?? null,
        null,
        'removing a receipt does not void the purchase',
      );

      const audit = fx.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.action, 'attachment.delete'))
        .all();
      assert.equal(audit.length, 1);
      assert.equal(audit[0]!.actor, 'sam@example.com');
      assert.equal(audit[0]!.entity, 'purchase');
      assert.equal(audit[0]!.entityId, String(purchaseId));
      assert.match(audit[0]!.summary, /^Removed weekly shop receipt\.png \(.+, image\/png\)$/);
      const before = JSON.parse(audit[0]!.before ?? '{}') as { fileKey?: string; sha256?: string };
      assert.equal(before.fileKey, stored.fileKey);
      assert.equal(before.sha256, stored.sha256);

      const again = await deleteAttachment({
        db: fx.db,
        id: stored.id,
        actor: 'sam@example.com',
        documentsDir,
      });
      assert.equal(again.deleted, false);
      assert.equal(
        fx.db.select().from(auditEntries).where(eq(auditEntries.action, 'attachment.delete')).all()
          .length,
        1,
        'a second delete writes no second audit entry',
      );
    } finally {
      fx.close();
    }
  });

  it('treats an already-missing file as success and does not roll the row back', async () => {
    const fx = await createHouseholdFixture('alex@example.com');
    try {
      const documentsDir = path.join(path.dirname(fx.handle.raw.name), 'documents');
      const stored = await storeAttachment({
        db: fx.db,
        purchaseId: purchaseIn(fx.db, fx),
        originalName: 'receipt.png',
        bytes: PNG_BYTES,
        actor: 'alex@example.com',
        documentsDir,
      });
      await fs.rm(path.join(documentsDir, stored.fileKey));
      const removed = await deleteAttachment({
        db: fx.db,
        id: stored.id,
        actor: 'alex@example.com',
        documentsDir,
      });
      assert.equal(removed.deleted, true);
      assert.equal(removed.fileRemoved, true);
      assert.equal(
        fx.db.select().from(attachments).where(eq(attachments.id, stored.id)).get()?.state,
        'deleted',
      );
    } finally {
      fx.close();
    }
  });

  it('keeps the deleted row when the file cannot be unlinked', async () => {
    const fx = await createHouseholdFixture('alex@example.com');
    try {
      const documentsDir = path.join(path.dirname(fx.handle.raw.name), 'documents');
      const stored = await storeAttachment({
        db: fx.db,
        purchaseId: purchaseIn(fx.db, fx),
        originalName: 'receipt.png',
        bytes: PNG_BYTES,
        actor: 'alex@example.com',
        documentsDir,
      });
      const filePath = path.join(documentsDir, stored.fileKey);
      await fs.rm(filePath);
      await fs.mkdir(filePath);
      const removed = await deleteAttachment({
        db: fx.db,
        id: stored.id,
        actor: 'alex@example.com',
        documentsDir,
      });
      assert.equal(removed.deleted, true);
      assert.equal(removed.fileRemoved, false);
      assert.equal(
        fx.db.select().from(attachments).where(eq(attachments.id, stored.id)).get()?.state,
        'deleted',
        'an unlink failure must not roll the state flip back',
      );
      assert.equal(existsSync(filePath), true);
    } finally {
      fx.close();
    }
  });

  it('refuses an unknown id and will not unlink through an unsafe storage key', async () => {
    const fx = await createHouseholdFixture('alex@example.com');
    try {
      const documentsDir = path.join(path.dirname(fx.handle.raw.name), 'documents');
      await assert.rejects(
        () =>
          deleteAttachment({
            db: fx.db,
            id: 9999,
            actor: 'alex@example.com',
            documentsDir,
          }),
        AttachmentNotFoundError,
      );

      const outside = path.join(path.dirname(documentsDir), 'do-not-touch.png');
      await fs.writeFile(outside, PNG_BYTES);
      const inserted = fx.db
        .insert(attachments)
        .values({
          purchaseId: purchaseIn(fx.db, fx),
          fileKey: '../do-not-touch.png',
          originalName: 'bad.png',
          mime: 'image/png',
          sizeBytes: PNG_BYTES.length,
          sha256: 'ab',
          state: 'stored',
          createdBy: 'alex@example.com',
          createdAt: new Date('2026-09-19T12:02:00Z'),
        })
        .returning()
        .get();
      const removed = await deleteAttachment({
        db: fx.db,
        id: inserted.id,
        actor: 'alex@example.com',
        documentsDir,
      });
      assert.equal(removed.deleted, true);
      assert.equal(removed.fileRemoved, false);
      assert.ok(existsSync(outside), 'an unsafe key must not be used as a filesystem path');
    } finally {
      fx.close();
    }
  });
});

describe('documents on income records (v0.10.0, decision 138)', () => {
  it('attaches a payslip to an income record through the same pipeline', async () => {
    const fx = await createHouseholdFixture('alex@example.com');
    try {
      const documentsDir = path.join(path.dirname(fx.handle.raw.name), 'documents');
      const salary = incomeIn(fx);
      const other = incomeIn(fx);

      const first = await storeAttachment({
        db: fx.db,
        receiptId: salary,
        originalName: 'September payslip.pdf',
        bytes: PDF_BYTES,
        actor: 'alex@example.com',
        documentsDir,
      });
      await storeAttachment({
        db: fx.db,
        receiptId: salary,
        originalName: 'P60.png',
        bytes: PNG_BYTES,
        actor: 'sam@example.com',
        documentsDir,
      });
      assert.equal(first.mime, 'application/pdf');
      assert.ok(existsSync(path.join(documentsDir, first.fileKey)));

      // Several documents per record, oldest first; other records untouched.
      const byReceipt = listStoredReceiptAttachments(fx.db, [salary, other]);
      assert.deepEqual(
        byReceipt.get(salary)?.map((doc) => doc.originalName),
        ['September payslip.pdf', 'P60.png'],
      );
      assert.equal(byReceipt.get(other), undefined);
      assert.equal(listStoredReceiptAttachments(fx.db, []).size, 0);

      // The row names its income record and no purchase; the audit says so too.
      const row = fx.db.select().from(attachments).where(eq(attachments.id, first.id)).get();
      assert.equal(row?.receiptId, salary);
      assert.equal(row?.purchaseId, null);
      const audit = fx.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.action, 'attachment.store'))
        .all();
      assert.deepEqual(
        audit.map((entry) => [entry.entity, entry.entityId]),
        [
          ['receipt', String(salary)],
          ['receipt', String(salary)],
        ],
      );

      // Removal works the same way, and is audited against the income record.
      const removed = await deleteAttachment({
        db: fx.db,
        id: first.id,
        actor: 'alex@example.com',
        documentsDir,
      });
      assert.equal(removed.deleted, true);
      assert.equal(existsSync(path.join(documentsDir, first.fileKey)), false);
      assert.deepEqual(
        listStoredReceiptAttachments(fx.db, [salary])
          .get(salary)
          ?.map((doc) => doc.originalName),
        ['P60.png'],
      );
      const deletion = fx.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.action, 'attachment.delete'))
        .get();
      assert.equal(deletion?.entity, 'receipt');
      assert.equal(deletion?.entityId, String(salary));
    } finally {
      fx.close();
    }
  });

  it('needs exactly one owner that exists, and still sniffs the content', async () => {
    const fx = await createHouseholdFixture('alex@example.com');
    try {
      const documentsDir = path.join(path.dirname(fx.handle.raw.name), 'documents');
      const salary = incomeIn(fx);
      const purchase = purchaseIn(fx.db, fx);
      await assert.rejects(
        storeAttachment({
          db: fx.db,
          receiptId: 9999,
          originalName: 'payslip.pdf',
          bytes: PDF_BYTES,
          actor: 'alex@example.com',
          documentsDir,
        }),
        /income record no longer exists/,
      );
      await assert.rejects(
        storeAttachment({
          db: fx.db,
          receiptId: salary,
          purchaseId: purchase,
          originalName: 'payslip.pdf',
          bytes: PDF_BYTES,
          actor: 'alex@example.com',
          documentsDir,
        }),
        AttachmentInputError,
      );
      await assert.rejects(
        storeAttachment({
          db: fx.db,
          receiptId: salary,
          originalName: 'payslip.pdf',
          bytes: ZIP_BYTES,
          actor: 'alex@example.com',
          documentsDir,
        }),
        /Only genuine PNG, JPEG or PDF/,
      );
      // The database refuses a row with no owner or two, whatever the code does.
      assert.throws(() =>
        fx.handle.raw
          .prepare(
            `INSERT INTO attachments (purchase_id, receipt_id, file_key, original_name, mime, size_bytes, sha256, created_by, created_at)
             VALUES (?, ?, '00000000-0000-4000-8000-000000000000.pdf', 'x.pdf', 'application/pdf', 1, 'x', 'a', 0)`,
          )
          .run(purchase, salary),
      );
      assert.equal(listStoredReceiptAttachments(fx.db, [salary]).size, 0);
    } finally {
      fx.close();
    }
  });
});

/** A one-off income record inside the fixture database, for document tests. */
function incomeIn(fx: Awaited<ReturnType<typeof createHouseholdFixture>>): number {
  return createReceipt(fx.db, {
    potId: fx.pots.salary.id,
    amountPence: 210000,
    occurredDate: '2026-09-19',
    source: 'Salary',
    actor: 'alex@example.com',
    now: new Date('2026-09-19T12:01:00Z'),
  }).id;
}

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
