'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { purchases } from '@/lib/db/schema';
import { formatPence, parsePence } from '@/lib/money';
import {
  initialActionState,
  type ActionState,
  type PurchaseActionState,
  type DuplicateNoticeState,
} from '@/lib/action-state';
import {
  addCheckpoint,
  createPot,
  InvalidCheckpointInputError,
  PotNotFoundError,
} from '@/lib/records/pots';
import { createPerson, listPeople } from '@/lib/records/people';
import { createPurchase } from '@/lib/records/purchases';
import { voidPurchase } from '@/lib/records/purchases';
import { findChildCategory } from '@/lib/records/categories';
import { createVehicle } from '@/lib/records/vehicles';
import { AlreadyVoidError, RecordVoidedError, VersionConflictError } from '@/lib/records/errors';
import {
  checkpointEntrySchema,
  fuelEntrySchema,
  potIdSchema,
  potKindSchema,
  potLabelSchema,
  purchaseEntrySchema,
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
  const effectiveDateRaw = formData.get('effectiveDate');
  const parsed = checkpointEntrySchema.safeParse({
    potId: potId.data,
    amountPence: amount,
    effectiveDate:
      typeof effectiveDateRaw === 'string' && effectiveDateRaw !== '' ? effectiveDateRaw : null,
    note: typeof formData.get('note') === 'string' ? formData.get('note') : '',
  });
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Check the balance fields.') };
  }

  try {
    addCheckpoint(getDbHandle().db, {
      potId: parsed.data.potId,
      amountPence: parsed.data.amountPence,
      effectiveDate: parsed.data.effectiveDate ?? undefined,
      effectiveAt: parsed.data.effectiveDate === null ? new Date() : undefined,
      note: parsed.data.note,
      actor: user.email,
    });
  } catch (err) {
    if (err instanceof PotNotFoundError || err instanceof InvalidCheckpointInputError) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The checkpoint could not be saved. Please try again.' };
  }
  revalidatePath('/');
  return { status: 'ok', message: `Checkpoint saved: ${formatPence(parsed.data.amountPence)}.` };
}

/** Add Purchase — the primary quick-entry action. The browser may help, but
 * this action parses and validates the complete split again at the boundary. */
export async function addPurchaseAction(
  _previous: PurchaseActionState,
  formData: FormData,
): Promise<PurchaseActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return purchaseError(NOT_SIGNED_IN.message ?? 'Not signed in.');

  const raw = parsePurchaseForm(formData);
  if (!raw.success) return purchaseError(raw.message);
  const db = getDbHandle().db;
  const paidByPersonId = resolvePaidByPerson(db, raw.data.paidByPersonId, user.email);
  if (paidByPersonId === null) {
    return purchaseError('Set up at least one household person before recording a purchase.');
  }

  try {
    const result = createPurchase(db, {
      supplierName: raw.data.supplierName,
      potId: raw.data.potId,
      totalPence: raw.data.totalPence,
      paidByPersonId,
      occurredDate: raw.data.occurredDate ?? undefined,
      note: raw.data.note,
      lines: raw.data.lines,
      actor: user.email,
    });
    revalidatePath('/');
    return purchaseOk(
      `Purchase saved: ${formatPence(result.purchase.totalPence)}.`,
      result.duplicateNotice === null
        ? null
        : duplicateNoticeState(db, result.duplicateNotice.purchaseId, result.duplicateNotice),
    );
  } catch (err) {
    return purchaseError(domainMessage(err, 'The purchase could not be saved. Please try again.'));
  }
}

/** Add Fuel uses the same purchase domain path, with Fuel and a vehicle target
 * fixed by the server. The form therefore only asks for amount plus the few
 * visible defaults a user may override. */
export async function addFuelAction(
  _previous: PurchaseActionState,
  formData: FormData,
): Promise<PurchaseActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return purchaseError(NOT_SIGNED_IN.message ?? 'Not signed in.');

  const amountRaw = formData.get('amount');
  const amount = parsePence(typeof amountRaw === 'string' ? amountRaw : '');
  const parsed = fuelEntrySchema.safeParse({
    supplierName: textOrNull(formData.get('supplierName')),
    potId: numberOrNull(formData.get('potId')),
    vehicleId: numberOrNull(formData.get('vehicleId')),
    paidByPersonId: numberOrNull(formData.get('paidByPersonId')),
    amountPence: amount,
    occurredDate: textOrNull(formData.get('occurredDate')),
    note: textOrNull(formData.get('note')),
  });
  if (!parsed.success) return purchaseError(firstIssue(parsed.error, 'Check the fuel fields.'));

  const db = getDbHandle().db;
  const fuel = findChildCategory(db, 'Vehicle Running', 'Fuel');
  if (fuel === null)
    return purchaseError('The Fuel category is missing. Run the current database migration.');
  const paidByPersonId = resolvePaidByPerson(db, parsed.data.paidByPersonId, user.email);
  if (paidByPersonId === null) {
    return purchaseError('Set up at least one household person before recording fuel.');
  }
  try {
    const result = createPurchase(db, {
      supplierName: parsed.data.supplierName,
      potId: parsed.data.potId,
      totalPence: parsed.data.amountPence,
      paidByPersonId,
      occurredDate: parsed.data.occurredDate ?? undefined,
      note: parsed.data.note,
      lines: [
        {
          amountPence: parsed.data.amountPence,
          categoryId: fuel.id,
          targetKind: 'vehicle',
          targetId: parsed.data.vehicleId,
        },
      ],
      actor: user.email,
    });
    revalidatePath('/');
    return purchaseOk(
      `Fuel saved: ${formatPence(result.purchase.totalPence)}.`,
      result.duplicateNotice === null
        ? null
        : duplicateNoticeState(db, result.duplicateNotice.purchaseId, result.duplicateNotice),
    );
  } catch (err) {
    return purchaseError(
      domainMessage(err, 'The fuel entry could not be saved. Please try again.'),
    );
  }
}

/** A dedicated void action is used by the non-blocking duplicate notice. */
export async function voidDuplicatePurchaseAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const id = positiveNumber(formData.get('purchaseId'));
  const version = positiveNumber(formData.get('version'));
  if (id === null || version === null) {
    return {
      status: 'error',
      message: 'That duplicate link is incomplete. Refresh and try again.',
    };
  }
  try {
    voidPurchase(getDbHandle().db, {
      id,
      expectedVersion: version,
      actor: user.email,
      reason: 'Duplicate entry resolved from the quick-entry notice.',
    });
    revalidatePath('/');
    return { status: 'ok', message: `Entry #${id} voided. The saved history is retained.` };
  } catch (err) {
    if (
      err instanceof AlreadyVoidError ||
      err instanceof VersionConflictError ||
      err instanceof RecordVoidedError
    ) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'That entry could not be voided. Refresh and try again.' };
  }
}

function parsePurchaseForm(
  formData: FormData,
):
  | { success: true; data: ReturnType<typeof purchaseEntrySchema.parse> }
  | { success: false; message: string } {
  const amountRaw = formData.get('amount');
  const amount = parsePence(typeof amountRaw === 'string' ? amountRaw : '');
  let lines: unknown;
  try {
    lines = JSON.parse(
      typeof formData.get('linesJson') === 'string' ? String(formData.get('linesJson')) : 'null',
    );
  } catch {
    return { success: false, message: 'The split lines were not readable. Please try again.' };
  }
  const parsed = purchaseEntrySchema.safeParse({
    supplierName: textOrNull(formData.get('supplierName')),
    potId: numberOrNull(formData.get('potId')),
    totalPence: amount,
    paidByPersonId: numberOrNull(formData.get('paidByPersonId')),
    occurredDate: textOrNull(formData.get('occurredDate')),
    note: textOrNull(formData.get('note')),
    lines,
  });
  if (!parsed.success)
    return { success: false, message: firstIssue(parsed.error, 'Check the purchase fields.') };
  return { success: true, data: parsed.data };
}

function resolvePaidByPerson(
  db: ReturnType<typeof getDbHandle>['db'],
  explicit: number | null,
  email: string,
): number | null {
  const people = listPeople(db);
  if (people.length === 0) return null;
  if (explicit !== null) return explicit;
  const localPart =
    email
      .split('@')[0]
      ?.replace(/[._-]+/g, ' ')
      .toLowerCase() ?? '';
  const matched = people.find((person) => localPart.includes(person.label.toLowerCase()));
  return matched?.id ?? people[0]?.id ?? null;
}

function duplicateNoticeState(
  db: ReturnType<typeof getDbHandle>['db'],
  purchaseId: number,
  notice: { enteredBy: string; totalPence: number; minutesAgo: number },
): DuplicateNoticeState {
  const row = db.select().from(purchases).where(eq(purchases.id, purchaseId)).get();
  return {
    purchaseId,
    version: row?.version ?? 1,
    enteredBy: notice.enteredBy,
    totalPence: notice.totalPence,
    minutesAgo: notice.minutesAgo,
  };
}

function purchaseOk(
  message: string,
  duplicateNotice: DuplicateNoticeState | null,
): PurchaseActionState {
  return { status: 'ok', message, duplicateNotice };
}
function purchaseError(message: string): PurchaseActionState {
  return { status: 'error', message, duplicateNotice: null };
}
function textOrNull(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
function numberOrNull(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}
function positiveNumber(value: FormDataEntryValue | null): number | null {
  const number = numberOrNull(value);
  return number !== null && number > 0 ? number : null;
}
function firstIssue(error: { issues: Array<{ message?: string }> }, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}
function domainMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function addPersonAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const label = formData.get('label');
  if (typeof label !== 'string' || label.trim() === '')
    return { status: 'error', message: 'Give the person a name.' };
  try {
    createPerson(getDbHandle().db, { label, actor: user.email });
    revalidatePath('/');
    return { status: 'ok', message: 'Person added.' };
  } catch (err) {
    return { status: 'error', message: domainMessage(err, 'The person could not be saved.') };
  }
}

export async function addVehicleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const label = formData.get('label');
  const ownerPersonId = numberOrNull(formData.get('ownerPersonId'));
  if (typeof label !== 'string' || label.trim() === '')
    return { status: 'error', message: 'Give the vehicle a name.' };
  try {
    createVehicle(getDbHandle().db, { label, ownerPersonId, actor: user.email });
    revalidatePath('/');
    return { status: 'ok', message: 'Vehicle added.' };
  } catch (err) {
    return { status: 'error', message: domainMessage(err, 'The vehicle could not be saved.') };
  }
}
