'use server';

import { eq } from 'drizzle-orm';
import { purchases } from '@/lib/db/schema';
import {
  addSupplierInteraction,
  addSupplierReference,
  InvalidSupplierDetailError,
} from '@/lib/records/supplier-details';
import {
  InvalidSupplierContactError,
  InvalidSupplierNameError,
  SupplierNotFoundError,
  updateSupplierContact,
} from '@/lib/records/suppliers';
import { revalidatePath } from 'next/cache';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { loadAppConfig } from '@/lib/config';
import { formatPence, parsePence } from '@/lib/money';
import {
  AttachmentInputError,
  AttachmentNotFoundError,
  deleteAttachment,
  storeAttachment,
} from '@/lib/records/attachments';
import { toLocalDateString } from '@/lib/time';
import {
  initialActionState,
  type ActionState,
  type PurchaseActionState,
  type DuplicateNoticeState,
} from '@/lib/action-state';
import {
  addCheckpoint,
  createPot,
  editPot,
  InvalidCheckpointInputError,
  InvalidPotInputError,
  PotNotFoundError,
} from '@/lib/records/pots';
import {
  createPerson,
  DuplicatePersonLabelError,
  InvalidPersonLabelError,
  listPeople,
  renamePerson,
} from '@/lib/records/people';
import {
  createPurchase,
  createRefund,
  editPurchase,
  InvalidPurchaseInputError,
  PurchaseNotFoundError,
  RefundLinkError,
  voidPurchase,
  VoidBlockedError,
} from '@/lib/records/purchases';
import {
  CategoryAlreadyRetiredError,
  CategoryLevelError,
  CategoryNotFoundError,
  createChildCategory,
  createParentCategory,
  DuplicateCategoryNameError,
  InvalidCategoryNameError,
  renameCategory,
  retireCategory,
  findChildCategory,
} from '@/lib/records/categories';
import {
  createVehicle,
  DuplicateVehicleLabelError,
  InvalidVehicleLabelError,
  renameVehicle,
} from '@/lib/records/vehicles';
import {
  createTransfer,
  InvalidTransferInputError,
  TransferNotFoundError,
  voidTransfer,
} from '@/lib/records/transfers';
import { AlreadyVoidError, RecordVoidedError, VersionConflictError } from '@/lib/records/errors';
import {
  cancelScheduleEntrySchema,
  categoryEntrySchema,
  checkpointEntrySchema,
  editPotEntrySchema,
  editPurchaseEntrySchema,
  editRenewalEntrySchema,
  editScheduleEntrySchema,
  fuelEntrySchema,
  potIdSchema,
  potKindSchema,
  potLabelSchema,
  projectionSettingsEntrySchema,
  purchaseEntrySchema,
  refundEntrySchema,
  renameTargetEntrySchema,
  renewalEntrySchema,
  scheduleEntrySchema,
  supplierContactEntrySchema,
  supplierInteractionEntrySchema,
  supplierReferenceEntrySchema,
  transferEntrySchema,
  voidRecordEntrySchema,
  warningLeadsEntrySchema,
} from '@/lib/validation';
import {
  cancelSchedule,
  createSchedule,
  editSchedule,
  ScheduleCancelledError,
  ScheduleNotFoundError,
  InvalidScheduleInputError,
} from '@/lib/records/schedules';
import {
  createRenewal,
  editRenewal,
  InvalidRenewalInputError,
  RenewalNotFoundError,
} from '@/lib/records/renewals';
import {
  InvalidSettingValueError,
  setContractEndWarningLeadDays,
  setMonthlyFuelPence,
  setRenewalWarningLeadDays,
  setWeeklyGroceriesPence,
} from '@/lib/records/settings';

export async function addSupplierReferenceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (!user) return NOT_SIGNED_IN;
  const parsed = supplierReferenceEntrySchema.safeParse({
    supplierId: Number(formData.get('supplierId')),
    label: String(formData.get('label') ?? ''),
    value: String(formData.get('value') ?? ''),
  });
  if (!parsed.success)
    return { status: 'error', message: firstIssue(parsed.error, 'Check the reference.') };
  try {
    const reference = addSupplierReference(getDbHandle().db, {
      supplierId: parsed.data.supplierId,
      label: parsed.data.label,
      value: parsed.data.value,
      actor: user.email,
    });
    revalidatePath('/suppliers');
    return { status: 'ok', message: `Saved reference “${reference.label}”.` };
  } catch (err) {
    if (err instanceof InvalidSupplierDetailError || err instanceof SupplierNotFoundError)
      return { status: 'error', message: err.message };
    throw err;
  }
}

export async function addSupplierInteractionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (!user) return NOT_SIGNED_IN;
  const parsed = supplierInteractionEntrySchema.safeParse({
    supplierId: Number(formData.get('supplierId')),
    channel: String(formData.get('channel') ?? ''),
    summary: String(formData.get('summary') ?? ''),
    outcome: textOrNull(formData.get('outcome')),
    followUpDate: textOrNull(formData.get('followUpDate')),
  });
  if (!parsed.success)
    return { status: 'error', message: firstIssue(parsed.error, 'Check the interaction.') };
  try {
    addSupplierInteraction(getDbHandle().db, {
      supplierId: parsed.data.supplierId,
      channel: parsed.data.channel,
      summary: parsed.data.summary,
      outcome: parsed.data.outcome,
      followUpDate: parsed.data.followUpDate,
      actor: user.email,
    });
    revalidatePath('/suppliers');
    revalidatePath('/contracts');
    revalidatePath('/overview');
    return { status: 'ok', message: 'Interaction logged.' };
  } catch (err) {
    if (err instanceof InvalidSupplierDetailError || err instanceof SupplierNotFoundError)
      return { status: 'error', message: err.message };
    throw err;
  }
}

export async function saveSupplierContactAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (!user) return NOT_SIGNED_IN;
  const parsed = supplierContactEntrySchema.safeParse({
    id: Number(formData.get('id')),
    expectedVersion: Number(formData.get('expectedVersion')),
    contactPhone: textOrNull(formData.get('contactPhone')),
    contactEmail: textOrNull(formData.get('contactEmail')),
    website: textOrNull(formData.get('website')),
    address: textOrNull(formData.get('address')),
    notes: textOrNull(formData.get('notes')),
  });
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Check the contact details.') };
  }
  try {
    updateSupplierContact(getDbHandle().db, {
      id: parsed.data.id,
      expectedVersion: parsed.data.expectedVersion,
      contactPhone: parsed.data.contactPhone,
      contactEmail: parsed.data.contactEmail,
      website: parsed.data.website,
      address: parsed.data.address,
      notes: parsed.data.notes,
      actor: user.email,
    });
    revalidatePath('/suppliers');
    return { status: 'ok', message: 'Contact card updated.' };
  } catch (err) {
    if (
      err instanceof InvalidSupplierContactError ||
      err instanceof SupplierNotFoundError ||
      err instanceof VersionConflictError
    )
      return { status: 'error', message: err.message };
    throw err;
  }
}

export async function uploadAttachmentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (!user) return NOT_SIGNED_IN;
  const id = Number(formData.get('purchaseId'));
  const file = formData.get('file');
  if (!Number.isInteger(id) || !(file instanceof File))
    return { status: 'error', message: 'Choose a purchase and a file.' };

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    // One shared pipeline for sniffing, limits, storage keys and the audit
    // entry (SPEC §23): the action, the serving route and the backup engine
    // cannot drift apart.
    const stored = await storeAttachment({
      db: getDbHandle().db,
      purchaseId: id,
      originalName: file.name,
      bytes,
      actor: user.email,
      documentsDir: loadAppConfig().documentsDir,
    });
    revalidatePath('/purchases');
    revalidatePath('/overview');
    revalidatePath('/suppliers');
    return { status: 'ok', message: `Attached ${stored.originalName}.` };
  } catch (err) {
    if (err instanceof AttachmentInputError) return { status: 'error', message: err.message };
    throw err;
  }
}

/**
 * Remove one receipt (SPEC §23.4). The form posts an attachment id; the
 * storage key is read from the row, never from the request. Domain errors
 * come back as a message — a filesystem failure must not be rethrown, or
 * `useActionState` leaves the button pending with nothing to explain why.
 */
export async function deleteAttachmentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (!user) return NOT_SIGNED_IN;
  const id = numberOrNull(formData.get('attachmentId'));
  if (id === null || id <= 0) {
    return {
      status: 'error',
      message: 'That receipt link is incomplete. Refresh and try again.',
    };
  }
  try {
    const result = await deleteAttachment({
      db: getDbHandle().db,
      id,
      actor: user.email,
      documentsDir: loadAppConfig().documentsDir,
    });
    revalidatePath('/purchases');
    revalidatePath('/overview');
    revalidatePath('/suppliers');
    const name = result.originalName ?? 'That receipt';
    if (!result.deleted) {
      return { status: 'ok', message: `“${name}” was already removed.` };
    }
    if (!result.fileRemoved) {
      return {
        status: 'ok',
        message: `Removed ${name} from the purchase, but the file is still in the documents folder. It will show as an unreferenced file on Settings until it is cleared.`,
      };
    }
    return { status: 'ok', message: `Removed ${name}.` };
  } catch (err) {
    if (err instanceof AttachmentNotFoundError || err instanceof AttachmentInputError) {
      return { status: 'error', message: err.message };
    }
    console.error('[attachments] deleteAttachmentAction failed', err);
    return { status: 'error', message: 'The receipt could not be removed. Please try again.' };
  }
}

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
    // Vehicle options are rendered independently on every primary page; clear
    // all of them so a vehicle added from Settings is immediately selectable.
    revalidatePages();
    return { status: 'ok', message: 'Vehicle added.' };
  } catch (err) {
    return { status: 'error', message: domainMessage(err, 'The vehicle could not be saved.') };
  }
}

/**
 * Phase 3 server actions: schedules, renewals and projection figures
 * (docs/SPEC.md §11, §22, §7.3). Same conventions as Phase 1–2b:
 * authenticated, Zod at the boundary, domain authority, audit in-transaction.
 */

export async function addScheduleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;

  const today = new Date();
  const raw = parseScheduleForm(formData, today);
  if (!raw.success) return { status: 'error', message: raw.message };
  const parsed = scheduleEntrySchema.safeParse(raw.data);
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Check the schedule fields.') };
  }
  try {
    const { schedule } = createSchedule(getDbHandle().db, {
      ...parsed.data,
      categoryId: parsed.data.kind === 'receipt' ? null : parsed.data.categoryId,
      supplierId: parsed.data.kind === 'receipt' ? null : parsed.data.supplierId,
      supplierName: parsed.data.kind === 'receipt' ? null : parsed.data.supplierName,
      activeFrom: parsed.data.activeFrom,
      actor: user.email,
    });
    revalidatePages();
    return {
      status: 'ok',
      message: `Schedule “${schedule.name}” added — it will convert automatically on its due date.`,
    };
  } catch (err) {
    if (
      err instanceof InvalidScheduleInputError ||
      err instanceof ScheduleNotFoundError ||
      err instanceof ScheduleCancelledError ||
      err instanceof SupplierNotFoundError ||
      err instanceof InvalidSupplierNameError
    ) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The schedule could not be saved. Please try again.' };
  }
}

export async function cancelScheduleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const parsed = cancelScheduleEntrySchema.safeParse({
    scheduleId: numberOrNull(formData.get('scheduleId')),
    expectedVersion: numberOrNull(formData.get('version')),
    effectiveOn: textOrNull(formData.get('effectiveOn')) ?? undefined,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstIssue(parsed.error, 'The cancellation needs an effective date (local date).'),
    };
  }
  try {
    const result = cancelSchedule(getDbHandle().db, {
      id: parsed.data.scheduleId,
      expectedVersion: parsed.data.expectedVersion,
      effectiveOn: parsed.data.effectiveOn ?? '',
      actor: user.email,
    });
    revalidatePages();
    return {
      status: 'ok',
      message: `“${result.name}” cancelled from ${parsed.data.effectiveOn} — converted history is kept.`,
    };
  } catch (err) {
    if (
      err instanceof InvalidScheduleInputError ||
      err instanceof ScheduleNotFoundError ||
      err instanceof ScheduleCancelledError ||
      err instanceof VersionConflictError
    ) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The schedule could not be cancelled. Please try again.' };
  }
}

export async function addRenewalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const parsed = renewalEntrySchema.safeParse({
    label: textOrNull(formData.get('label')) ?? '',
    nextRenewalDate: textOrNull(formData.get('nextRenewalDate')) ?? '',
    warnDaysBefore: numberOrNull(formData.get('warnDaysBefore')) ?? 21,
    repeatsAnnually:
      formData.get('repeatsAnnually') === 'on' || formData.get('repeatsAnnually') === 'true',
    supplierId: numberOrNull(formData.get('supplierId')),
    ...parseCompositeTarget(formData.get('target')),
    notes: textOrNull(formData.get('notes')),
  });
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Check the renewal fields.') };
  }
  try {
    const renewal = createRenewal(getDbHandle().db, {
      ...parsed.data,
      actor: user.email,
    });
    revalidatePages();
    return {
      status: 'ok',
      message: `Renewal “${renewal.label}” added for ${renewal.nextRenewalDate}.`,
    };
  } catch (err) {
    if (err instanceof InvalidRenewalInputError || err instanceof RenewalNotFoundError) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The renewal could not be saved. Please try again.' };
  }
}

export async function saveProjectionSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;

  const groceriesRaw = formData.get('weeklyGroceries');
  const groceries =
    groceriesRaw === null || String(groceriesRaw).trim() === ''
      ? null
      : parsePence(String(groceriesRaw));
  const fuel: Record<string, number | null> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('fuel_')) continue;
    const vehicleId = Number(key.slice('fuel_'.length));
    const text = typeof value === 'string' ? value.trim() : '';
    fuel[String(vehicleId)] = text === '' ? null : parsePence(text);
  }

  const parsed = projectionSettingsEntrySchema.safeParse({
    weeklyGroceriesPence: groceries,
    monthlyFuelPence: fuel,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstIssue(
        parsed.error,
        'Figures must be whole amounts like 90.00 (blank to clear).',
      ),
    };
  }
  try {
    const db = getDbHandle().db;
    setWeeklyGroceriesPence(db, parsed.data.weeklyGroceriesPence, user.email);
    for (const [vehicleId, pence] of Object.entries(parsed.data.monthlyFuelPence)) {
      setMonthlyFuelPence(db, Number(vehicleId), pence, user.email);
    }
    revalidatePath('/');
    return { status: 'ok', message: 'Projection figures saved. The forecast updates immediately.' };
  } catch (err) {
    if (err instanceof InvalidSettingValueError) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The figures could not be saved. Please try again.' };
  }
}

function parseScheduleForm(
  formData: FormData,
  now: Date,
): { success: true; data: Record<string, unknown> } | { success: false; message: string } {
  const amount = parsePence(
    typeof formData.get('amount') === 'string' ? String(formData.get('amount')) : '',
  );
  const data: Record<string, unknown> = {
    name: textOrNull(formData.get('name')) ?? '',
    kind: textOrNull(formData.get('kind')) ?? 'dd',
    frequency: textOrNull(formData.get('frequency')) ?? 'monthly',
    dueDayOfMonth: numberOrNull(formData.get('dueDayOfMonth')) ?? 0,
    dueMonth: numberOrNull(formData.get('dueMonth')),
    amountPence: amount,
    potId: numberOrNull(formData.get('potId')),
    categoryId: numberOrNull(formData.get('categoryId')),
    supplierId: numberOrNull(formData.get('supplierId')),
    supplierName: textOrNull(formData.get('supplierName')),
    ...parseCompositeTarget(formData.get('target')),
    contractEndsOn: textOrNull(formData.get('contractEndsOn')),
    activeFrom: textOrNull(formData.get('activeFrom')) ?? toLocalDateString(now),
    activeUntil: textOrNull(formData.get('activeUntil')),
  };
  return { success: true, data };
}

/** The "For" select submits one composite value (household | person-N | vehicle-N). */
function parseCompositeTarget(raw: FormDataEntryValue | null): {
  targetKind: string;
  targetId: number | null;
} {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const dash = value.indexOf('-');
  if (dash === -1) return { targetKind: 'household', targetId: null };
  return { targetKind: value.slice(0, dash), targetId: Number(value.slice(dash + 1)) || null };
}

/**
 * Phase 4a server actions (desktop review pages, docs/SPEC.md §15.2):
 * purchase edit/void/refund, schedule/renewal corrections, transfers, pot
 * context, household labels, the category tree editor and the key-date
 * leads. Same conventions as every earlier action: authenticated, Zod at
 * the boundary, domain authority, audit in-transaction.
 */

/** Every page that renders a corrected record (Phase 4a pages + mobile home). */
const PAGE_PATHS = [
  '/',
  '/overview',
  '/purchases',
  '/recurring',
  '/contracts',
  '/suppliers',
  '/pots',
  '/insights',
  '/settings',
];

function revalidatePages(): void {
  for (const page of PAGE_PATHS) revalidatePath(page);
}

export async function editPurchaseAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;

  const editableLines = parseEditableLines(formData);
  if (!editableLines.success) {
    return { status: 'error', message: editableLines.message };
  }
  const lines = editableLines.lines;
  const parsed = editPurchaseEntrySchema.safeParse({
    purchaseId: numberOrNull(formData.get('purchaseId')),
    expectedVersion: numberOrNull(formData.get('expectedVersion')),
    occurredDate: textOrNull(formData.get('occurredDate')),
    note: typeof formData.get('note') === 'string' ? formData.get('note') : '',
    lines,
  });
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Check the purchase fields.') };
  }

  try {
    const { purchase } = editPurchase(getDbHandle().db, {
      id: parsed.data.purchaseId,
      expectedVersion: parsed.data.expectedVersion,
      actor: user.email,
      patch: {
        totalPence: parsed.data.lines.reduce((sum, line) => sum + line.amountPence, 0),
        // Blank = unchanged (a correction should not silently re-date the record).
        ...(parsed.data.occurredDate === null ? {} : { occurredDate: parsed.data.occurredDate }),
        note: parsed.data.note,
        lines: parsed.data.lines,
      },
    });
    revalidatePages();
    return {
      status: 'ok',
      message: `Entry #${purchase.id} saved: ${formatPence(Math.abs(purchase.totalPence))}.`,
    };
  } catch (err) {
    if (
      err instanceof InvalidPurchaseInputError ||
      err instanceof PurchaseNotFoundError ||
      err instanceof RecordVoidedError ||
      err instanceof VersionConflictError ||
      err instanceof RefundLinkError
    ) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The entry could not be saved. Please try again.' };
  }
}

function parseEditableLines(
  formData: FormData,
):
  | { success: true; lines: ReturnType<typeof editPurchaseEntrySchema.parse>['lines'] }
  | { success: false; message: string } {
  let rawLines: unknown;
  try {
    rawLines = JSON.parse(
      typeof formData.get('linesJson') === 'string' ? String(formData.get('linesJson')) : 'null',
    );
  } catch {
    return { success: false, message: 'The split lines were not readable. Please try again.' };
  }
  if (!Array.isArray(rawLines)) {
    return { success: false, message: 'The split lines were not readable. Please try again.' };
  }
  const lines: ReturnType<typeof editPurchaseEntrySchema.parse>['lines'] = [];
  for (const [index, line] of rawLines.entries()) {
    if (typeof line !== 'object' || line === null) {
      return { success: false, message: 'The split lines were not readable. Please try again.' };
    }
    const record = line as Record<string, unknown>;
    const amountPence = parsePence(typeof record.amount === 'string' ? record.amount : '');
    if (amountPence === null) {
      return { success: false, message: `Line ${index + 1}: enter an amount like 12.50.` };
    }
    lines.push({
      amountPence,
      categoryId:
        typeof record.categoryId === 'number' ? record.categoryId : Number(record.categoryId),
      targetKind: record.targetKind as 'household' | 'person' | 'vehicle',
      targetId:
        record.targetId === null || record.targetId === undefined || record.targetId === ''
          ? null
          : Number(record.targetId),
    });
  }
  return { success: true, lines };
}

export async function addRefundAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;

  let lines: unknown;
  try {
    lines = JSON.parse(
      typeof formData.get('linesJson') === 'string' ? String(formData.get('linesJson')) : 'null',
    );
  } catch {
    return { status: 'error', message: 'The refund lines were not readable. Please try again.' };
  }
  const amount = parsePence(
    typeof formData.get('amount') === 'string' ? String(formData.get('amount')) : '',
  );
  const parsed = refundEntrySchema.safeParse({
    refundOfPurchaseId: numberOrNull(formData.get('refundOfPurchaseId')),
    totalPence: amount,
    potId: numberOrNull(formData.get('potId')),
    supplierName: textOrNull(formData.get('supplierName')),
    paidByPersonId: numberOrNull(formData.get('paidByPersonId')),
    occurredDate: textOrNull(formData.get('occurredDate')),
    note: typeof formData.get('note') === 'string' ? formData.get('note') : '',
    lines,
  });
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Check the refund fields.') };
  }

  try {
    // The form types positive magnitudes; the domain takes the negative
    // record (refunds are negative records, SPEC §9.5).
    const result = createRefund(getDbHandle().db, {
      refundOfPurchaseId: parsed.data.refundOfPurchaseId,
      totalPence: -parsed.data.totalPence,
      potId: parsed.data.potId,
      supplierName: parsed.data.supplierName,
      paidByPersonId: parsed.data.paidByPersonId,
      occurredDate: parsed.data.occurredDate ?? undefined,
      note: parsed.data.note,
      lines: parsed.data.lines.map((line) => ({
        amountPence: -Math.abs(line.amountPence),
        categoryId: line.categoryId,
        targetKind: line.targetKind,
        targetId: line.targetId,
      })),
      actor: user.email,
    });
    revalidatePages();
    return {
      status: 'ok',
      message: `Refund of ${formatPence(Math.abs(result.purchase.totalPence))} saved against entry #${parsed.data.refundOfPurchaseId}.`,
    };
  } catch (err) {
    if (
      err instanceof InvalidPurchaseInputError ||
      err instanceof PurchaseNotFoundError ||
      err instanceof RefundLinkError
    ) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The refund could not be saved. Please try again.' };
  }
}

export async function voidPurchaseAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const parsed = voidRecordEntrySchema.safeParse({
    recordId: numberOrNull(formData.get('recordId')),
    // `VoidForm` names its hidden field `expectedVersion` (record-forms.tsx) —
    // reading `version` here silently produced a null and every void failed
    // with "Invalid input: expected number, received null".
    expectedVersion: numberOrNull(formData.get('expectedVersion')),
    reason: typeof formData.get('reason') === 'string' ? formData.get('reason') : '',
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstIssue(parsed.error, 'The void link is incomplete — refresh and try again.'),
    };
  }
  try {
    voidPurchase(getDbHandle().db, {
      id: parsed.data.recordId,
      expectedVersion: parsed.data.expectedVersion,
      actor: user.email,
      reason: parsed.data.reason,
    });
    revalidatePages();
    return {
      status: 'ok',
      message: `Entry #${parsed.data.recordId} voided. The saved history is retained.`,
    };
  } catch (err) {
    if (
      err instanceof AlreadyVoidError ||
      err instanceof VersionConflictError ||
      err instanceof RecordVoidedError ||
      err instanceof VoidBlockedError
    ) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'That entry could not be voided. Refresh and try again.' };
  }
}

export async function addTransferAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const amount = parsePence(
    typeof formData.get('amount') === 'string' ? String(formData.get('amount')) : '',
  );
  const parsed = transferEntrySchema.safeParse({
    fromPotId: numberOrNull(formData.get('fromPotId')),
    toPotId: numberOrNull(formData.get('toPotId')),
    amountPence: amount,
    occurredDate: textOrNull(formData.get('occurredDate')),
    note: typeof formData.get('note') === 'string' ? formData.get('note') : '',
  });
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Check the transfer fields.') };
  }
  try {
    const transfer = createTransfer(getDbHandle().db, {
      fromPotId: parsed.data.fromPotId,
      toPotId: parsed.data.toPotId,
      amountPence: parsed.data.amountPence,
      occurredDate: parsed.data.occurredDate ?? undefined,
      note: parsed.data.note,
      actor: user.email,
    });
    revalidatePages();
    return {
      status: 'ok',
      message: `Transfer of ${formatPence(transfer.amountPence)} recorded — spending is untouched.`,
    };
  } catch (err) {
    if (err instanceof InvalidTransferInputError || err instanceof PotNotFoundError) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The transfer could not be saved. Please try again.' };
  }
}

export async function voidTransferAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const parsed = voidRecordEntrySchema.safeParse({
    recordId: numberOrNull(formData.get('recordId')),
    // Same contract as voidPurchaseAction: the field is `expectedVersion`.
    expectedVersion: numberOrNull(formData.get('expectedVersion')),
    reason: typeof formData.get('reason') === 'string' ? formData.get('reason') : '',
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstIssue(parsed.error, 'The void link is incomplete — refresh and try again.'),
    };
  }
  try {
    voidTransfer(getDbHandle().db, {
      id: parsed.data.recordId,
      expectedVersion: parsed.data.expectedVersion,
      actor: user.email,
      reason: parsed.data.reason,
    });
    revalidatePages();
    return { status: 'ok', message: `Transfer #${parsed.data.recordId} voided. History kept.` };
  } catch (err) {
    if (
      err instanceof AlreadyVoidError ||
      err instanceof VersionConflictError ||
      err instanceof RecordVoidedError ||
      err instanceof TransferNotFoundError
    ) {
      return { status: 'error', message: err.message };
    }
    return {
      status: 'error',
      message: 'That transfer could not be voided. Refresh and try again.',
    };
  }
}

export async function editScheduleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const amount = parsePence(
    typeof formData.get('amount') === 'string' ? String(formData.get('amount')) : '',
  );
  const parsed = editScheduleEntrySchema.safeParse({
    scheduleId: numberOrNull(formData.get('scheduleId')),
    expectedVersion: numberOrNull(formData.get('version')),
    name: typeof formData.get('name') === 'string' ? formData.get('name') : '',
    frequency: textOrNull(formData.get('frequency')) ?? 'monthly',
    dueDayOfMonth: numberOrNull(formData.get('dueDayOfMonth')) ?? 0,
    dueMonth: numberOrNull(formData.get('dueMonth')),
    amountPence: amount,
    potId: numberOrNull(formData.get('potId')),
    categoryId: numberOrNull(formData.get('categoryId')),
    supplierId: numberOrNull(formData.get('supplierId')),
    supplierName: textOrNull(formData.get('supplierName')),
    ...parseCompositeTarget(formData.get('target')),
    contractEndsOn: textOrNull(formData.get('contractEndsOn')),
    activeUntil: textOrNull(formData.get('activeUntil')),
  });
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Check the schedule fields.') };
  }
  try {
    const schedule = editSchedule(getDbHandle().db, {
      id: parsed.data.scheduleId,
      expectedVersion: parsed.data.expectedVersion,
      actor: user.email,
      patch: {
        name: parsed.data.name,
        frequency: parsed.data.frequency,
        dueDayOfMonth: parsed.data.dueDayOfMonth,
        dueMonth: parsed.data.dueMonth,
        amountPence: parsed.data.amountPence,
        potId: parsed.data.potId,
        categoryId: parsed.data.categoryId,
        supplierId: parsed.data.supplierId,
        supplierName: parsed.data.supplierName,
        targetKind: parsed.data.targetKind,
        targetId: parsed.data.targetId,
        contractEndsOn: parsed.data.contractEndsOn,
        activeUntil: parsed.data.activeUntil,
      },
    });
    revalidatePages();
    return {
      status: 'ok',
      message: `“${schedule.name}” saved — the change applies from the next instance; converted history is untouched.`,
    };
  } catch (err) {
    if (
      err instanceof InvalidScheduleInputError ||
      err instanceof ScheduleNotFoundError ||
      err instanceof ScheduleCancelledError ||
      err instanceof VersionConflictError ||
      err instanceof SupplierNotFoundError ||
      err instanceof InvalidSupplierNameError
    ) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The schedule could not be saved. Please try again.' };
  }
}

export async function editRenewalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const parsed = editRenewalEntrySchema.safeParse({
    renewalId: numberOrNull(formData.get('renewalId')),
    expectedVersion: numberOrNull(formData.get('version')),
    label: typeof formData.get('label') === 'string' ? formData.get('label') : '',
    nextRenewalDate: textOrNull(formData.get('nextRenewalDate')) ?? '',
    warnDaysBefore: numberOrNull(formData.get('warnDaysBefore')) ?? 21,
    repeatsAnnually:
      formData.get('repeatsAnnually') === 'on' || formData.get('repeatsAnnually') === 'true',
    supplierId: numberOrNull(formData.get('supplierId')),
    ...parseCompositeTarget(formData.get('target')),
    notes: typeof formData.get('notes') === 'string' ? formData.get('notes') : '',
  });
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Check the renewal fields.') };
  }
  try {
    const renewal = editRenewal(getDbHandle().db, {
      id: parsed.data.renewalId,
      expectedVersion: parsed.data.expectedVersion,
      actor: user.email,
      patch: {
        label: parsed.data.label,
        nextRenewalDate: parsed.data.nextRenewalDate,
        warnDaysBefore: parsed.data.warnDaysBefore,
        repeatsAnnually: parsed.data.repeatsAnnually,
        supplierId: parsed.data.supplierId,
        targetKind: parsed.data.targetKind,
        targetId: parsed.data.targetId,
        notes: parsed.data.notes,
      },
    });
    revalidatePages();
    return {
      status: 'ok',
      message: `Renewal “${renewal.label}” saved for ${renewal.nextRenewalDate}.`,
    };
  } catch (err) {
    if (
      err instanceof InvalidRenewalInputError ||
      err instanceof RenewalNotFoundError ||
      err instanceof VersionConflictError
    ) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The renewal could not be saved. Please try again.' };
  }
}

export async function editPotAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const limitRaw = formData.get('overdraftLimit');
  const limit =
    limitRaw === null || String(limitRaw).trim() === '' ? null : parsePence(String(limitRaw));
  const thresholdRaw = formData.get('warningThreshold');
  const threshold =
    thresholdRaw === null || String(thresholdRaw).trim() === ''
      ? null
      : parsePence(String(thresholdRaw));
  const parsed = editPotEntrySchema.safeParse({
    potId: numberOrNull(formData.get('potId')),
    expectedVersion: numberOrNull(formData.get('version')),
    label: typeof formData.get('label') === 'string' ? formData.get('label') : '',
    kind: textOrNull(formData.get('kind')) ?? 'bank',
    overdraftLimitPence: limit,
    warningThresholdPence: threshold,
  });
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Check the pot fields.') };
  }
  try {
    const pot = editPot(getDbHandle().db, {
      id: parsed.data.potId,
      expectedVersion: parsed.data.expectedVersion,
      actor: user.email,
      patch: {
        label: parsed.data.label,
        kind: parsed.data.kind,
        overdraftLimitPence: parsed.data.overdraftLimitPence,
        warningThresholdPence: parsed.data.warningThresholdPence,
      },
    });
    revalidatePages();
    return { status: 'ok', message: `Pot “${pot.label}” saved.` };
  } catch (err) {
    if (
      err instanceof InvalidPotInputError ||
      err instanceof PotNotFoundError ||
      err instanceof VersionConflictError
    ) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The pot could not be saved. Please try again.' };
  }
}

export async function renameTargetAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const parsed = renameTargetEntrySchema.safeParse({
    kind: textOrNull(formData.get('kind')) ?? 'person',
    targetId: numberOrNull(formData.get('targetId')),
    expectedVersion: numberOrNull(formData.get('version')),
    label: typeof formData.get('label') === 'string' ? formData.get('label') : '',
  });
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Check the name fields.') };
  }
  try {
    const db = getDbHandle().db;
    if (parsed.data.kind === 'person') {
      renamePerson(db, {
        id: parsed.data.targetId,
        expectedVersion: parsed.data.expectedVersion,
        label: parsed.data.label,
        actor: user.email,
      });
    } else {
      renameVehicle(db, {
        id: parsed.data.targetId,
        expectedVersion: parsed.data.expectedVersion,
        label: parsed.data.label,
        actor: user.email,
      });
    }
    revalidatePages();
    return { status: 'ok', message: `Renamed to “${parsed.data.label}”.` };
  } catch (err) {
    if (
      err instanceof InvalidPersonLabelError ||
      err instanceof DuplicatePersonLabelError ||
      err instanceof InvalidVehicleLabelError ||
      err instanceof DuplicateVehicleLabelError ||
      err instanceof VersionConflictError
    ) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The name could not be saved. Please try again.' };
  }
}

export async function saveCategoryAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const parsed = categoryEntrySchema.safeParse({
    op: textOrNull(formData.get('op')) ?? 'add-parent',
    parentId: numberOrNull(formData.get('parentId')),
    categoryId: numberOrNull(formData.get('categoryId')),
    expectedVersion: numberOrNull(formData.get('version')),
    name: typeof formData.get('name') === 'string' ? formData.get('name') : '',
  });
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Check the category fields.') };
  }
  try {
    const db = getDbHandle().db;
    const { op } = parsed.data;
    if (op === 'add-parent') {
      const category = createParentCategory(db, { name: parsed.data.name, actor: user.email });
      return { status: 'ok', message: `Category “${category.name}” added.` };
    }
    if (op === 'add-child') {
      const category = createChildCategory(db, {
        parentId: parsed.data.parentId as number,
        name: parsed.data.name,
        actor: user.email,
      });
      return { status: 'ok', message: `Category “${category.name}” added.` };
    }
    if (op === 'rename') {
      const category = renameCategory(db, {
        id: parsed.data.categoryId as number,
        expectedVersion: parsed.data.expectedVersion as number,
        name: parsed.data.name,
        actor: user.email,
      });
      return { status: 'ok', message: `Category renamed to “${category.name}”.` };
    }
    const category = retireCategory(db, {
      id: parsed.data.categoryId as number,
      expectedVersion: parsed.data.expectedVersion as number,
      actor: user.email,
    });
    return {
      status: 'ok',
      message: `“${category.name}” retired — it can no longer be assigned, and its history is preserved.`,
    };
  } catch (err) {
    if (
      err instanceof InvalidCategoryNameError ||
      err instanceof DuplicateCategoryNameError ||
      err instanceof CategoryLevelError ||
      err instanceof CategoryNotFoundError ||
      err instanceof CategoryAlreadyRetiredError ||
      err instanceof VersionConflictError
    ) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The category could not be saved. Please try again.' };
  }
}

export async function saveWarningLeadsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUserFromRequest();
  if (user === null) return NOT_SIGNED_IN;
  const parsed = warningLeadsEntrySchema.safeParse({
    renewalLeadDays: numberOrNull(formData.get('renewalLeadDays')) ?? 21,
    contractEndLeadDays: numberOrNull(formData.get('contractEndLeadDays')) ?? 21,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstIssue(parsed.error, 'Warning leads are whole days between 0 and 365.'),
    };
  }
  try {
    const db = getDbHandle().db;
    setRenewalWarningLeadDays(db, parsed.data.renewalLeadDays, user.email);
    setContractEndWarningLeadDays(db, parsed.data.contractEndLeadDays, user.email);
    revalidatePages();
    return { status: 'ok', message: 'Warning leads saved — key-date windows update immediately.' };
  } catch (err) {
    if (err instanceof InvalidSettingValueError) {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The leads could not be saved. Please try again.' };
  }
}
