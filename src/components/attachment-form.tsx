'use client';

import { useActionState } from 'react';
import { uploadAttachmentAction } from '@/app/actions';
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
 * (SPEC §23.1). Viewing and attaching are authenticated; the attachment
 * lifecycle is independent of the purchase save, so this form never blocks
 * entry and a receipt can be added days later from the phone gallery.
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
            <li key={attachment.id}>
              <a
                href={`/api/attachments/${attachment.fileKey}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 hover:bg-amber-100"
              >
                <span aria-hidden="true">📎</span>
                <span className="max-w-[160px] truncate">{attachment.originalName}</span>
                <span className="text-amber-600">{formatSize(attachment.sizeBytes)}</span>
              </a>
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
