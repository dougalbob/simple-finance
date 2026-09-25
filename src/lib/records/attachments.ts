import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import { attachments, purchases, receipts } from '../db/schema';

/**
 * Receipt/invoice attachments (SPEC §23). One shared, framework-free pipeline
 * so the upload action, the authenticated serving route, the backup engine and
 * the restore path all agree on what a valid attachment is:
 *
 * - MIME is decided by **content sniffing** of the leading bytes, never by the
 *   filename or the browser-supplied type (SPEC §23.3);
 * - the size limit is enforced here, server-side (SPEC §23, plan OQ12: 10 MB);
 * - storage keys are server-generated under `<dataDir>/documents/` and must
 *   match a strict pattern before anything touches the filesystem — that same
 *   pattern is what makes an archive member safe to restore (SPEC §18.4);
 * - removal flips `state` to `deleted` and audits it, and only then unlinks
 *   the file (SPEC §23.4). The other way around would make the next backup
 *   fail closed if the process died in between.
 */

/** Per-file limit (plan OQ12). Enforced on upload and on restore. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type AttachmentMime = 'image/png' | 'image/jpeg' | 'application/pdf';

export const ATTACHMENT_MIMES: readonly AttachmentMime[] = [
  'image/png',
  'image/jpeg',
  'application/pdf',
];

/**
 * Server-generated storage keys: a UUID plus an extension derived from the
 * sniffed MIME. Anything else is rejected — user-controlled paths never reach
 * the filesystem (SPEC §23.2), and archive members are validated with the same
 * pattern on restore.
 */
export const FILE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|pdf)$/;

export class AttachmentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentInputError';
  }
}

/** The id does not match a row. A second delete of a row that exists is not this. */
export class AttachmentNotFoundError extends Error {
  constructor(message = 'That receipt no longer exists.') {
    super(message);
    this.name = 'AttachmentNotFoundError';
  }
}

function attachmentSizeLabel(sizeBytes: number): string {
  return `${(sizeBytes / 1024).toFixed(0)} KB`;
}

export function isSafeFileKey(fileKey: string): boolean {
  return FILE_KEY_PATTERN.test(fileKey);
}

/**
 * Content sniffing. Deliberately strict about the leading bytes: a JPEG must
 * start FF D8 FF, a PNG must carry its full 8-byte signature and a PDF must
 * start with `%PDF-`. A renamed archive or HTML file is rejected here even
 * when the browser claims `image/png`.
 */
export function sniffAttachmentMime(bytes: Buffer): AttachmentMime | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= pngSignature.length && pngSignature.every((b, i) => bytes[i] === b)) {
    return 'image/png';
  }
  return null;
}

export function extensionForMime(mime: AttachmentMime): 'png' | 'jpg' | 'pdf' {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  return 'pdf';
}

export function newFileKey(mime: AttachmentMime): string {
  return `${randomUUID()}.${extensionForMime(mime)}`;
}

/**
 * Display name used for `Content-Disposition` and download naming. Only the
 * basename survives, control characters are replaced and the length is capped
 * — the stored key, never this string, decides where the bytes live.
 */
export function sanitizeOriginalName(raw: string): string {
  // Treat a Windows-style path as a path too, so its directory part is dropped
  // on every platform rather than surviving as literal characters.
  const base = path
    .basename(raw.trim().replace(/\\/g, '/'))
    // Control characters, quotes/backslashes and the characters Windows (and
    // the Content-Disposition header) dislike, so a display name can never
    // break out of the header or the markup it lands in.
    .replace(/[\u0000-\u001f\u007f"\\/<>|*?:]/g, '_');
  const cleaned = base.replace(/\s+/g, ' ').replace(/^\.+/, '').trim();
  if (cleaned.length === 0) return 'attachment';
  return cleaned.slice(0, 200);
}

/**
 * What a document is attached to (decision 138): a purchase (receipts,
 * invoices) or, since v0.10.0, an income record (payslips). Exactly one.
 */
export type AttachmentOwner = { kind: 'purchase'; id: number } | { kind: 'receipt'; id: number };

export interface StoreAttachmentInput {
  db: Db;
  /** A purchase's receipt or invoice. Give this or `receiptId`, never both. */
  purchaseId?: number;
  /** An income record's document — a payslip, typically (v0.10.0). */
  receiptId?: number;
  originalName: string;
  bytes: Buffer;
  actor: string;
  /** `<dataDir>/documents` — from AppConfig, never from a request (SPEC §18.1). */
  documentsDir: string;
  now?: Date;
}

export interface StoredAttachment {
  id: number;
  fileKey: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * The upload half of the pipeline: validate, write the file, then record the
 * row and the audit entry together. A rejected upload writes nothing at all,
 * so the purchase is untouched and the retry is a clean retry (SPEC §23.1).
 *
 * The file is written with `wx` (never overwriting an existing key) before the
 * database row exists; a crash between the two leaves an unreferenced file,
 * which the backup's orphan report surfaces without ever deleting it (SPEC
 * §18.2). The reverse order would be worse: a stored row whose bytes are
 * missing would make the archive inconsistent.
 */
export async function storeAttachment(input: StoreAttachmentInput): Promise<StoredAttachment> {
  const owner = resolveOwner(input);
  assertOwnerExists(input.db, owner);

  if (input.bytes.length === 0) throw new AttachmentInputError('The file is empty.');
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentInputError(
      `Attachments must be 10 MB or smaller (this one is ${(input.bytes.length / (1024 * 1024)).toFixed(1)} MB).`,
    );
  }

  const mime = sniffAttachmentMime(input.bytes);
  if (mime === null) {
    throw new AttachmentInputError('Only genuine PNG, JPEG or PDF files are accepted.');
  }

  const now = input.now ?? new Date();
  const fileKey = newFileKey(mime);
  if (!isSafeFileKey(fileKey)) throw new AttachmentInputError('Could not allocate a storage key.');

  await mkdir(input.documentsDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(input.documentsDir, fileKey), input.bytes, {
    flag: 'wx',
    mode: 0o600,
  });

  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const originalName = sanitizeOriginalName(input.originalName);
  const id = input.db.transaction((tx: DbTx) => {
    const row = tx
      .insert(attachments)
      .values({
        purchaseId: owner.kind === 'purchase' ? owner.id : null,
        receiptId: owner.kind === 'receipt' ? owner.id : null,
        fileKey,
        originalName,
        mime,
        sizeBytes: input.bytes.length,
        sha256,
        state: 'stored',
        createdBy: input.actor,
        createdAt: now,
      })
      .returning({ id: attachments.id })
      .get();
    recordAudit(tx, {
      actor: input.actor,
      action: 'attachment.store',
      entity: owner.kind,
      entityId: owner.id,
      summary: `Attached ${originalName} (${attachmentSizeLabel(input.bytes.length)}, ${mime})`,
      after: { fileKey, originalName, mime, sizeBytes: input.bytes.length, sha256 },
      now,
    });
    return row.id;
  });

  return { id, fileKey, originalName, mime, sizeBytes: input.bytes.length, sha256 };
}

export interface DeleteAttachmentInput {
  db: Db;
  id: number;
  actor: string;
  /** `<dataDir>/documents` — from AppConfig, never from a request (SPEC §18.1). */
  documentsDir: string;
  now?: Date;
}

export interface DeleteAttachmentResult {
  /** True when this call flipped a `stored` row to `deleted`. */
  deleted: boolean;
  /**
   * True when the file is gone (unlinked, or already absent). False only when
   * the row was marked deleted but the bytes could not be removed — an orphan,
   * which the backup report is designed to surface. Irrelevant when `deleted`
   * is false.
   */
  fileRemoved: boolean;
  originalName: string | null;
}

/**
 * Remove one receipt (SPEC §23.4). The client supplies an id, never a storage
 * key. The row is marked `deleted` and audited in one transaction; the file
 * is unlinked only after that commit. A second call is a no-op (the
 * `state = 'stored'` guard matches nothing, so there is no second audit entry
 * and no second unlink).
 *
 * An unlink failure does not roll the database back. The row is already
 * `deleted`, so later backups do not fail closed on a missing file; a leftover
 * file is an orphan, which is the designed report.
 */
export async function deleteAttachment(
  input: DeleteAttachmentInput,
): Promise<DeleteAttachmentResult> {
  const row = input.db.select().from(attachments).where(eq(attachments.id, input.id)).get();
  if (row === undefined) throw new AttachmentNotFoundError();

  const now = input.now ?? new Date();
  const flipped = input.db.transaction((tx: DbTx) => {
    const updated = tx
      .update(attachments)
      .set({ state: 'deleted' })
      .where(and(eq(attachments.id, row.id), eq(attachments.state, 'stored')))
      .returning({ id: attachments.id })
      .all();
    if (updated.length === 0) return false;
    const owner = ownerOfRow(row);
    recordAudit(tx, {
      actor: input.actor,
      action: 'attachment.delete',
      entity: owner.kind,
      entityId: owner.id,
      summary: `Removed ${row.originalName} (${attachmentSizeLabel(row.sizeBytes)}, ${row.mime})`,
      before: {
        fileKey: row.fileKey,
        originalName: row.originalName,
        mime: row.mime,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
      },
      now,
    });
    return true;
  });

  if (!flipped) {
    return { deleted: false, fileRemoved: true, originalName: row.originalName };
  }
  return {
    deleted: true,
    fileRemoved: await unlinkStoredFile(input.documentsDir, row.fileKey),
    originalName: row.originalName,
  };
}

/**
 * Unlink a file this module minted. Anything that is not a safe storage key
 * is refused here — deletion must not grow a second path that accepts or
 * builds a key (SPEC §23.4). `ENOENT` is success: the file is already gone.
 */
async function unlinkStoredFile(documentsDir: string, fileKey: string): Promise<boolean> {
  if (!isSafeFileKey(fileKey)) {
    console.error(
      '[attachments] receipt row marked deleted but its storage key is not a safe file key; leaving the filesystem untouched',
    );
    return false;
  }
  try {
    await unlink(path.join(documentsDir, fileKey));
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return true;
    console.error(
      `[attachments] receipt ${fileKey} is deleted in the database but the file could not be removed (${code ?? 'unknown'}). It will show up in the orphan report.`,
    );
    return false;
  }
}

/** Stored attachments of one purchase, oldest first (the receipt order). */
export function listStoredAttachments(db: Db, purchaseId: number): StoredAttachment[] {
  return db
    .select({
      id: attachments.id,
      fileKey: attachments.fileKey,
      originalName: attachments.originalName,
      mime: attachments.mime,
      sizeBytes: attachments.sizeBytes,
      sha256: attachments.sha256,
    })
    .from(attachments)
    .where(and(eq(attachments.purchaseId, purchaseId), eq(attachments.state, 'stored')))
    .orderBy(asc(attachments.id))
    .all();
}

/**
 * Stored documents of many income records at once, oldest first per record —
 * the Income page lists up to two hundred rows and should not ask two hundred
 * times.
 */
export function listStoredReceiptAttachments(
  db: Db,
  receiptIds: readonly number[],
): Map<number, StoredAttachment[]> {
  const byReceipt = new Map<number, StoredAttachment[]>();
  if (receiptIds.length === 0) return byReceipt;
  const rows = db
    .select({
      receiptId: attachments.receiptId,
      id: attachments.id,
      fileKey: attachments.fileKey,
      originalName: attachments.originalName,
      mime: attachments.mime,
      sizeBytes: attachments.sizeBytes,
      sha256: attachments.sha256,
    })
    .from(attachments)
    .where(and(inArray(attachments.receiptId, [...receiptIds]), eq(attachments.state, 'stored')))
    .orderBy(asc(attachments.id))
    .all();
  for (const { receiptId, ...attachment } of rows) {
    if (receiptId === null) continue;
    const list = byReceipt.get(receiptId) ?? [];
    list.push(attachment);
    byReceipt.set(receiptId, list);
  }
  return byReceipt;
}

function resolveOwner(input: { purchaseId?: number; receiptId?: number }): AttachmentOwner {
  const hasPurchase = input.purchaseId !== undefined;
  const hasReceipt = input.receiptId !== undefined;
  if (hasPurchase === hasReceipt) {
    throw new AttachmentInputError('A document belongs to exactly one purchase or income record.');
  }
  return hasPurchase
    ? { kind: 'purchase', id: input.purchaseId as number }
    : { kind: 'receipt', id: input.receiptId as number };
}

function assertOwnerExists(db: Db, owner: AttachmentOwner): void {
  if (owner.kind === 'purchase') {
    const row = db
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.id, owner.id))
      .get();
    if (row === undefined) throw new AttachmentInputError('That purchase no longer exists.');
    return;
  }
  const row = db.select({ id: receipts.id }).from(receipts).where(eq(receipts.id, owner.id)).get();
  if (row === undefined) throw new AttachmentInputError('That income record no longer exists.');
}

function ownerOfRow(row: { purchaseId: number | null; receiptId: number | null }): AttachmentOwner {
  if (row.purchaseId !== null) return { kind: 'purchase', id: row.purchaseId };
  // The CHECK constraint guarantees one of the two is set.
  return { kind: 'receipt', id: row.receiptId as number };
}

/** Read one stored attachment's bytes from the documents directory. */
export async function readAttachmentBytes(documentsDir: string, fileKey: string): Promise<Buffer> {
  if (!isSafeFileKey(fileKey)) throw new AttachmentInputError('Unsafe attachment key.');
  return readFile(path.join(documentsDir, fileKey));
}
