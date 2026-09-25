'use client';

import { useActionState, useState } from 'react';
import {
  addVehicleAction,
  editPotAction,
  renameTargetAction,
  saveCategoryAction,
  saveCommitmentCategoriesAction,
  saveDefaultPurchasePotAction,
  savePersonEmailAction,
  saveWarningLeadsAction,
} from '@/app/actions';
import { initialActionState } from '@/lib/action-state';

const inputClass =
  'rounded border border-border-strong bg-surface px-2.5 py-1.5 text-sm focus:border-border-emphasis focus:outline-none';
const labelClass = 'text-xs font-medium text-ink-soft';
const submitClass =
  'rounded bg-till px-3 py-1.5 text-sm font-medium text-till-ink disabled:opacity-60';

function FormMessage({ status, message }: { status: string; message: string | null }) {
  if (message === null) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={status === 'error' ? 'text-sm text-danger' : 'text-sm text-positive'}
    >
      {message}
    </p>
  );
}

export interface TargetRenameFormProps {
  kind: 'person' | 'vehicle';
  targetId: number;
  version: number;
  currentLabel: string;
}

/** Rename a person or vehicle (names stay short and unique — SPEC §3). */
export function TargetRenameForm(props: TargetRenameFormProps) {
  const [state, formAction, pending] = useActionState(renameTargetAction, initialActionState);
  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
      id={`rename-${props.kind}-${props.targetId}`}
    >
      <input type="hidden" name="kind" value={props.kind} />
      <input type="hidden" name="targetId" value={props.targetId} />
      <input type="hidden" name="version" value={props.version} />
      <div className="flex flex-col gap-1">
        <label htmlFor={`rename-${props.kind}-${props.targetId}-label`} className={labelClass}>
          Name
        </label>
        <input
          id={`rename-${props.kind}-${props.targetId}-label`}
          name="label"
          type="text"
          required
          minLength={2}
          maxLength={60}
          defaultValue={props.currentLabel}
          className={inputClass}
        />
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Save name'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export interface AddVehicleFormProps {
  people: Array<{ id: number; label: string }>;
}

/** Add another vehicle without leaving Settings (the same fields as Home). */
export function AddVehicleForm({ people }: AddVehicleFormProps) {
  const [state, formAction, pending] = useActionState(addVehicleAction, initialActionState);
  return (
    <form
      action={formAction}
      aria-label="Add vehicle"
      className="rounded-lg border border-accent-100 bg-surface p-3"
    >
      <p className="mb-2 text-sm font-semibold text-ink-body">Add vehicle</p>
      <div className="flex flex-col gap-1">
        <label htmlFor="settings-add-vehicle-label" className={labelClass}>
          Name
        </label>
        <input
          id="settings-add-vehicle-label"
          name="label"
          type="text"
          required
          maxLength={60}
          placeholder="e.g. Vehicle B"
          className={inputClass}
        />
      </div>
      <div className="mt-2 flex flex-col gap-1">
        <label htmlFor="settings-add-vehicle-owner" className={labelClass}>
          Owner (optional)
        </label>
        <select id="settings-add-vehicle-owner" name="ownerPersonId" className={inputClass}>
          <option value="">Shared / not assigned</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} mt-3`}>
        {pending ? 'Saving…' : 'Add vehicle'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export interface PotEditFormProps {
  potId: number;
  version: number;
  label: string;
  kind: 'bank' | 'cash';
  overdraftLimitPence: number | null;
  warningThresholdPence: number | null;
}

const penceToPounds = (pence: number | null) => (pence === null ? '' : (pence / 100).toFixed(2));

/**
 * Pot editor (label, type, overdraft limit and warning threshold — decision
 * 68). Blank limit/threshold clears the value; the domain layer enforces
 * “threshold requires a limit, threshold ≤ limit”.
 */
export function PotEditForm(props: PotEditFormProps) {
  const [state, formAction, pending] = useActionState(editPotAction, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-2" id={`pot-edit-${props.potId}`}>
      <input type="hidden" name="potId" value={props.potId} />
      <input type="hidden" name="version" value={props.version} />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`pot-${props.potId}-label`} className={labelClass}>
            Pot name
          </label>
          <input
            id={`pot-${props.potId}-label`}
            name="label"
            type="text"
            required
            minLength={2}
            maxLength={60}
            defaultValue={props.label}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`pot-${props.potId}-kind`} className={labelClass}>
            Type
          </label>
          <select
            id={`pot-${props.potId}-kind`}
            name="kind"
            defaultValue={props.kind}
            className={inputClass}
          >
            <option value="bank">Bank account</option>
            <option value="cash">Cash</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`pot-${props.potId}-limit`} className={labelClass}>
            Overdraft limit (£, blank clears)
          </label>
          <input
            id={`pot-${props.potId}-limit`}
            name="overdraftLimit"
            type="text"
            inputMode="decimal"
            defaultValue={penceToPounds(props.overdraftLimitPence)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`pot-${props.potId}-threshold`} className={labelClass}>
            Warning threshold (£, blank clears)
          </label>
          <input
            id={`pot-${props.potId}-threshold`}
            name="warningThreshold"
            type="text"
            inputMode="decimal"
            defaultValue={penceToPounds(props.warningThresholdPence)}
            className={inputClass}
          />
        </div>
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Save pot'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export interface CategoryNodeData {
  id: number;
  name: string;
  version: number;
  retired: boolean;
  children: Array<{ id: number; name: string; version: number; retired: boolean }>;
}

/**
 * Category tree editor (SPEC §12, decision 73): add parent/child, rename,
 * retire children. History is never rewritten — retirement only blocks new
 * assignments. One shared action (saveCategoryAction) handles every op; this
 * component only picks the op and the row it applies to.
 */
export function CategoryTreeEditor({ tree }: { tree: CategoryNodeData[] }) {
  const [state, formAction, pending] = useActionState(saveCategoryAction, initialActionState);
  const [op, setOp] = useState<'add-parent' | 'add-child' | 'rename' | 'retire'>('add-parent');
  const [parentId, setParentId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [version, setVersion] = useState<number | null>(null);

  const pick = (
    nextOp: typeof op,
    nextParentId: number | null,
    nextCategoryId: number | null,
    nextVersion: number | null,
  ) => {
    setOp(nextOp);
    setParentId(nextParentId);
    setCategoryId(nextCategoryId);
    setVersion(nextVersion);
  };

  const needsParent = op === 'add-child';
  const needsCategory = op === 'rename' || op === 'retire';

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="category-op" className={labelClass}>
            Operation
          </label>
          <select
            id="category-op"
            value={op}
            onChange={(event) => pick(event.target.value as typeof op, null, null, null)}
            className={inputClass}
          >
            <option value="add-parent">Add a parent category</option>
            <option value="add-child">Add a child category</option>
            <option value="rename">Rename a category</option>
            <option value="retire">Retire a child category</option>
          </select>
        </div>
        {needsParent ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="category-parent" className={labelClass}>
              Under which parent
            </label>
            <select
              id="category-parent"
              value={parentId === null ? '' : String(parentId)}
              onChange={(event) =>
                pick(
                  'add-child',
                  event.target.value === '' ? null : Number(event.target.value),
                  null,
                  null,
                )
              }
              className={inputClass}
            >
              <option value="" disabled>
                Choose…
              </option>
              {tree.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {needsCategory ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="category-which" className={labelClass}>
              Which category
            </label>
            <select
              id="category-which"
              value={categoryId === null ? '' : String(categoryId)}
              onChange={(event) => {
                const value = event.target.value;
                if (value === '') {
                  pick(op, null, null, null);
                  return;
                }
                const [kind, id] = value.split(':');
                const numId = Number(id);
                if (kind === 'parent') {
                  const parent = tree.find((entry) => entry.id === numId);
                  pick(op, null, numId, parent?.version ?? null);
                } else {
                  const child = tree
                    .flatMap((parent) => parent.children)
                    .find((entry) => entry.id === numId);
                  pick(op, null, numId, child?.version ?? null);
                }
              }}
              className={inputClass}
            >
              <option value="" disabled>
                Choose…
              </option>
              {tree.map((parent) => (
                <optgroup key={parent.id} label={parent.name}>
                  <option value={`parent:${parent.id}`}>{parent.name} (parent)</option>
                  {parent.children.map((child) => (
                    <option key={child.id} value={`child:${child.id}`}>
                      {child.name}
                      {child.retired ? ' (retired)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <input type="hidden" name="op" value={op} />
      {needsParent ? <input type="hidden" name="parentId" value={parentId ?? ''} /> : null}
      {needsCategory ? <input type="hidden" name="categoryId" value={categoryId ?? ''} /> : null}
      {needsCategory && version !== null ? (
        <input type="hidden" name="version" value={version} />
      ) : null}
      {op === 'rename' || op === 'add-parent' || op === 'add-child' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="category-name" className={labelClass}>
            Name
          </label>
          <input
            id="category-name"
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={60}
            placeholder={op === 'add-parent' ? 'e.g. Home Improvement' : 'e.g. Pet Care'}
            className={inputClass}
          />
        </div>
      ) : null}
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Apply'}
      </button>
      <FormMessage status={state.status} message={state.message} />

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tree.map((parent) => (
          <li key={parent.id} className="rounded-lg border border-border bg-canvas p-2.5">
            <p className="text-sm font-semibold text-ink-emphasis">{parent.name}</p>
            <ul className="mt-1.5 space-y-0.5 text-sm">
              {parent.children.map((child) => (
                <li
                  key={child.id}
                  className={child.retired ? 'text-ink-faint line-through' : 'text-ink-soft'}
                >
                  {child.name}
                </li>
              ))}
              {parent.children.length === 0 ? (
                <li className="text-xs text-ink-faint">No children yet</li>
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
    </form>
  );
}

export interface WarningLeadsFormProps {
  renewalLeadDays: number;
  contractEndLeadDays: number;
}

/** Key-date warning windows (SPEC §21) — how many days ahead to warn. */
export function WarningLeadsForm({ renewalLeadDays, contractEndLeadDays }: WarningLeadsFormProps) {
  const [state, formAction, pending] = useActionState(saveWarningLeadsAction, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <div className="flex flex-col gap-1">
          <label htmlFor="warning-renewals" className={labelClass}>
            Renewals — warn days before
          </label>
          <input
            id="warning-renewals"
            name="renewalLeadDays"
            type="number"
            required
            min={0}
            max={365}
            defaultValue={renewalLeadDays}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="warning-contracts" className={labelClass}>
            Contract ends — warn days before
          </label>
          <input
            id="warning-contracts"
            name="contractEndLeadDays"
            type="number"
            required
            min={0}
            max={365}
            defaultValue={contractEndLeadDays}
            className={inputClass}
          />
        </div>
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Save warning leads'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export interface DefaultPurchasePotFormProps {
  pots: Array<{ id: number; label: string }>;
  defaultPotId: number | null;
}

/**
 * Which pot the till form starts on (SPEC §15.1, v0.9.0). The household's
 * default was inferred from a pot labelled "Main account", which silently
 * pointed the phone at the wrong pot. One explicit choice, saved with the
 * usual audit trail, replaces the guess.
 */
export function DefaultPurchasePotForm({ pots, defaultPotId }: DefaultPurchasePotFormProps) {
  const [state, formAction, pending] = useActionState(
    saveDefaultPurchasePotAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="flex flex-col gap-3 sm:max-w-md">
      <div className="flex flex-col gap-1">
        <label htmlFor="default-purchase-pot" className={labelClass}>
          Default pot for purchases
        </label>
        <select
          id="default-purchase-pot"
          name="potId"
          defaultValue={defaultPotId?.toString() ?? ''}
          className={inputClass}
        >
          <option value="">No default — pick a pot each time</option>
          {pots.map((pot) => (
            <option key={pot.id} value={pot.id}>
              {pot.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-ink-muted">
          Every purchase can still be recorded against any pot — this only decides where the form
          starts. A cash pot can be the default; the form simply shows no balance for cash.
        </p>
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Save default pot'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export interface PersonSignInFormProps {
  personId: number;
  personLabel: string;
  email: string | null;
  choices: string[];
}

/**
 * "Signs in as" (SPEC §15.2, decision 146): which allowlisted sign-in is this
 * person. The till then starts Paid by — and the Fuel form's vehicle — on
 * whoever is signed in, instead of on the first person for everyone.
 */
export function PersonSignInForm({ personId, personLabel, email, choices }: PersonSignInFormProps) {
  const [state, formAction, pending] = useActionState(savePersonEmailAction, initialActionState);
  const id = `person-email-${personId}`;
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-1">
      <input type="hidden" name="personId" value={personId} />
      <label htmlFor={id} className={labelClass}>
        Signs in as
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={id}
          name="email"
          defaultValue={email ?? ''}
          aria-label={`${personLabel} signs in as`}
          className={`${inputClass} min-w-0 max-w-full flex-1`}
        >
          <option value="">Not linked</option>
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending} className={submitClass}>
          {pending ? 'Saving…' : 'Save sign-in'}
        </button>
      </div>
      <p className="text-xs text-ink-muted">
        When this sign-in opens the till, Paid by starts on {personLabel} and Fuel starts on the
        vehicle {personLabel} owns.
      </p>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export interface CommitmentCategoriesFormProps {
  groups: Array<{
    parentId: number;
    parent: string;
    children: Array<{
      id: number;
      name: string;
      ticked: boolean;
      usedBySchedule: boolean;
      retired: boolean;
    }>;
  }>;
  /** 'schedules' = nothing saved yet, the ticks are the useful default. */
  source: 'configured' | 'schedules';
}

/**
 * Which child categories count as fixed commitments (SPEC §16.7 D, v0.14.0).
 * A checkbox list grouped by parent, because the household's own example is
 * exactly why parent-level would not do: Vehicle Running holds Insurance and
 * Road Tax (bills) next to Fuel (not a bill).
 */
export function CommitmentCategoriesForm({ groups, source }: CommitmentCategoriesFormProps) {
  const [state, formAction, pending] = useActionState(
    saveCommitmentCategoriesAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {source === 'schedules' ? (
        <p className="rounded bg-accent-50 px-3 py-2 text-xs text-accent-900">
          Nothing saved yet, so these are pre-ticked from the categories your direct debits and
          standing orders already use. Save to make the list your own.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <fieldset key={group.parentId} className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {group.parent}
            </legend>
            <ul className="space-y-1">
              {group.children.map((child) => (
                <li key={child.id}>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="categoryId"
                      value={child.id}
                      defaultChecked={child.ticked}
                      className="mt-1"
                    />
                    <span>
                      {child.name}
                      {child.usedBySchedule ? (
                        <span className="ml-1 text-xs text-ink-muted">· used by a schedule</span>
                      ) : null}
                      {child.retired ? (
                        <span className="ml-1 text-xs text-ink-faint">· retired</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>
      <button type="submit" disabled={pending} className={`${submitClass} self-start`}>
        {pending ? 'Saving…' : 'Save tracked commitments'}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}
