'use client';

import { useActionState, useState } from 'react';
import { deleteAttachmentAction, uploadAttachmentAction } from '@/app/actions';
import { initialActionState } from '@/lib/action-state';

export interface AttachmentSummary {
  id: number;
  fileKey: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Wording for the two kinds of owner (decision 138): a purchase carries
 * receipts and invoices, an income record carries payslips and similar.
 */
const OWNER_WORDS = {
  purchase: {
    field: 'purchaseId',
    fileLabel: 'Receipt or invoice file',
    attach: 'Attach receipt',
    noun: 'receipt',
  },
  receipt: {
    field: 'receiptId',
    fileLabel: 'Payslip or document file',
    attach: 'Attach payslip',
    noun: 'document',
  },
} as const;

/**
 * Documents already attached to a record, plus the capture/upload control
 * (SPEC §23.1, §23.4). A purchase's receipts, or since v0.10.0 an income
 * record's payslips (pass `receiptId` instead of `purchaseId`). Viewing, attaching and removing are authenticated; the
 * attachment lifecycle is independent of the purchase save, so this form never
 * blocks entry and a receipt can be added or removed later.
 *
 * The chip is a container, not a link wrapping a button: a button inside an
 * anchor is invalid HTML and hydration-hostile. Removal is a two-click
 * confirm — irreversible for this installation; an older backup is the way back.
 */
export function AttachmentForm({
  purchaseId,
  receiptId,
  attachments,
  allowUpload = true,
}: {
  purchaseId?: number;
  receiptId?: number;
  attachments: readonly AttachmentSummary[];
  /** False hides the upload control (a voided income record keeps its documents, gains none). */
  allowUpload?: boolean;
}) {
  const [state, formAction, pending] = useActionState(uploadAttachmentAction, initialActionState);
  const kind = receiptId !== undefined ? 'receipt' : 'purchase';
  const words = OWNER_WORDS[kind];
  const ownerId = (receiptId ?? purchaseId) as number;
  const inputId = `attachment-file-${kind}-${ownerId}`;
  return (
    <div className="mt-2 space-y-1 text-xs">
      {attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex flex-wrap items-center gap-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 font-medium text-warning">
                <a
                  href={`/api/attachments/${attachment.fileKey}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  <span aria-hidden="true">📎</span>
                  <span className="max-w-[160px] truncate">{attachment.originalName}</span>
                  <span className="text-warning-600">{formatSize(attachment.sizeBytes)}</span>
                </a>
              </span>
              <RemoveReceiptControl
                attachmentId={attachment.id}
                originalName={attachment.originalName}
                noun={words.noun}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {allowUpload ? (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name={words.field} value={ownerId} />
          <label className="sr-only" htmlFor={inputId}>
            {words.fileLabel}
          </label>
          <input
            id={inputId}
            name="file"
            type="file"
            accept="image/png,image/jpeg,application/pdf"
            // A till receipt is photographed on the spot, so purchases open the
            // camera. A payslip is as often a PDF from the employer's portal as a
            // sheet of paper, so income leaves the phone's own choice (files,
            // photos or camera) alone.
            capture={kind === 'purchase' ? 'environment' : undefined}
            required
            className="max-w-[190px] text-xs"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-till-inset px-2 py-1 text-till-ink disabled:opacity-60"
          >
            {pending ? 'Attaching…' : words.attach}
          </button>
          {state.message !== null ? (
            <span
              role="status"
              className={state.status === 'error' ? 'text-danger' : 'text-positive'}
            >
              {state.message}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function RemoveReceiptControl({
  attachmentId,
  originalName,
  noun,
}: {
  attachmentId: number;
  originalName: string;
  noun: string;
}) {
  const [state, formAction, pending] = useActionState(deleteAttachmentAction, initialActionState);
  const [armed, setArmed] = useState(false);
  const removeName = `Remove ${noun} ${originalName}`;
  const confirmName = `Confirm remove ${noun} ${originalName}`;
  return (
    <form action={formAction} className="inline-flex flex-wrap items-center gap-1">
      <input type="hidden" name="attachmentId" value={attachmentId} />
      {armed ? (
        <>
          <button
            type="submit"
            disabled={pending}
            aria-label={confirmName}
            className="rounded border border-danger-300 bg-surface px-1.5 py-0.5 font-medium text-danger hover:bg-danger-50 disabled:opacity-60"
          >
            {pending ? 'Removing…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="rounded px-1 py-0.5 text-ink-muted hover:text-ink-emphasis"
          >
            Cancel
          </button>
          <span className="text-ink-muted">
            Deletes the file from this installation. An older backup is the only way back.
          </span>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setArmed(true)}
          aria-label={removeName}
          className="rounded px-1 py-0.5 font-medium text-ink-muted hover:bg-surface-muted hover:text-danger-800"
        >
          Remove
        </button>
      )}
      {state.message !== null ? (
        <span role="status" className={state.status === 'error' ? 'text-danger' : 'text-positive'}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
