'use server';

import { revalidatePath } from 'next/cache';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence, parsePence } from '@/lib/money';
import { addCheckpoint, createPot, PotNotFoundError } from '@/lib/records/pots';
import type { ActionState } from '@/lib/action-state';
import {
  checkpointNoteSchema,
  penceAmountSchema,
  potIdSchema,
  potKindSchema,
  potLabelSchema,
} from '@/lib/validation';

/**
 * Phase 1 server actions: one validated write path (pot + checkpoint) behind
 * authentication, with audit entries written in the same transaction.
 * Zod validates at the boundary — browser validation is assistance only.
 */

const NOT_SIGNED_IN: ActionState = {
  status: 'error',
  message: 'You are not signed in. Open the app through your usual Cloudflare Access link.',
};

export async function createPotAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;

  const label = potLabelSchema.safeParse(formData.get('label'));
  if (!label.success) {
    return { status: 'error', message: label.error.issues[0]?.message ?? 'Invalid pot name' };
  }
  const kind = potKindSchema.safeParse(formData.get('kind'));
  if (!kind.success) {
    return { status: 'error', message: kind.error.issues[0]?.message ?? 'Invalid pot type' };
  }

  try {
    createPot(getDbHandle().db, {
      label: label.data,
      kind: kind.data,
      actor: user.email,
    });
  } catch {
    return { status: 'error', message: 'The pot could not be saved. Please try again.' };
  }
  revalidatePath('/');
  return { status: 'ok', message: `Pot “${label.data}” created.` };
}

export async function addCheckpointAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;

  const potId = potIdSchema.safeParse(formData.get('potId'));
  if (!potId.success) {
    return { status: 'error', message: potId.error.issues[0]?.message ?? 'Choose a pot' };
  }
  const amountRaw = formData.get('amount');
  const amount = parsePence(typeof amountRaw === 'string' ? amountRaw : '');
  if (amount === null) {
    return {
      status: 'error',
      message: 'Enter an amount like 412.35 (two decimal places at most).',
    };
  }
  const amountChecked = penceAmountSchema.safeParse(amount);
  if (!amountChecked.success) {
    return { status: 'error', message: 'That amount is out of range.' };
  }
  const note = checkpointNoteSchema.safeParse(formData.get('note') ?? '');
  if (!note.success) {
    return { status: 'error', message: note.error.issues[0]?.message ?? 'Invalid note' };
  }

  try {
    addCheckpoint(getDbHandle().db, {
      potId: potId.data,
      amountPence: amountChecked.data,
      effectiveAt: new Date(),
      note: note.data,
      actor: user.email,
    });
  } catch (err) {
    if (err instanceof PotNotFoundError) {
      return {
        status: 'error',
        message: 'That pot no longer exists. Refresh the page and try again.',
      };
    }
    return { status: 'error', message: 'The checkpoint could not be saved. Please try again.' };
  }
  revalidatePath('/');
  return { status: 'ok', message: `Checkpoint saved: ${formatPence(amountChecked.data)}.` };
}
