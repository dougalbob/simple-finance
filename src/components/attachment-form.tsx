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
 * Receipts already attached to a purchase, plus the capture/upload control
 * (SPEC §23.1, §23.4). Viewing, attaching and removing are authenticated; the
 * attachment lifecycle is independent of the purchase save, so this form never
 * blocks entry and a receipt can be added or removed later.
 *
 * The chip is a container, not a link wrapping a button: a button inside an
 * anchor is invalid HTML and hydration-hostile. Removal is a two-click
 * confirm — irreversible for this installation; an older backup is the way back.
 */
export function AttachmentForm({
  purchaseId,
  attachments,
}: {
  purchaseId: number;
  attachments: readonly AttachmentSummary[];
}) {
  const [state, formAction, pending] = useActionState(uploadAttachmentAction, initialActionState);
  return (
    <div className="mt-2 space-y-1 text-xs">
      {attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex flex-wrap items-center gap-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
                <a
                  href={`/api/attachments/${attachment.fileKey}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  <span aria-hidden="true">📎</span>
                  <span className="max-w-[160px] truncate">{attachment.originalName}</span>
                  <span className="text-amber-600">{formatSize(attachment.sizeBytes)}</span>
                </a>
              </span>
              <RemoveReceiptControl
                attachmentId={attachment.id}
                originalName={attachment.originalName}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="purchaseId" value={purchaseId} />
        <label className="sr-only" htmlFor={`attachment-file-${purchaseId}`}>
          Receipt or invoice file
        </label>
        <input
          id={`attachment-file-${purchaseId}`}
          name="file"
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          capture="environment"
          required
          className="max-w-[190px] text-xs"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-slate-800 px-2 py-1 text-white disabled:opacity-60"
        >
          {pending ? 'Attaching…' : 'Attach receipt'}
        </button>
        {state.message !== null ? (
          <span
            role="status"
            className={state.status === 'error' ? 'text-red-700' : 'text-emerald-700'}
          >
            {state.message}
          </span>
        ) : null}
      </form>
    </div>
  );
}

function RemoveReceiptControl({
  attachmentId,
  originalName,
}: {
  attachmentId: number;
  originalName: string;
}) {
  const [state, formAction, pending] = useActionState(deleteAttachmentAction, initialActionState);
  const [armed, setArmed] = useState(false);
  const removeName = `Remove receipt ${originalName}`;
  const confirmName = `Confirm remove receipt ${originalName}`;
  return (
    <form action={formAction} className="inline-flex flex-wrap items-center gap-1">
      <input type="hidden" name="attachmentId" value={attachmentId} />
      {armed ? (
        <>
          <button
            type="submit"
            disabled={pending}
            aria-label={confirmName}
            className="rounded border border-red-300 bg-white px-1.5 py-0.5 font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {pending ? 'Removing…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="rounded px-1 py-0.5 text-slate-500 hover:text-slate-800"
          >
            Cancel
          </button>
          <span className="text-slate-500">
            Deletes the file from this installation. An older backup is the only way back.
          </span>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setArmed(true)}
          aria-label={removeName}
          className="rounded px-1 py-0.5 font-medium text-slate-500 hover:bg-slate-100 hover:text-red-800"
        >
          Remove
        </button>
      )}
      {state.message !== null ? (
        <span
          role="status"
          className={state.status === 'error' ? 'text-red-700' : 'text-emerald-700'}
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
