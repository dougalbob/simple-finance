'use client';
import { uploadAttachmentAction } from '@/app/actions';
export function AttachmentForm({ purchaseId }: { purchaseId: number }) {
  return (
    <form
      action={async (formData) => {
        await uploadAttachmentAction(formData);
      }}
      className="mt-2 flex flex-wrap items-center gap-2 text-xs"
    >
      <input type="hidden" name="purchaseId" value={purchaseId} />
      <input
        name="file"
        type="file"
        accept="image/png,image/jpeg,application/pdf"
        capture="environment"
        required
        className="max-w-[180px]"
      />
      <button className="rounded bg-slate-800 px-2 py-1 text-white">Attach</button>
    </form>
  );
}
