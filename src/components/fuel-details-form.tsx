'use client';

import { useActionState, useState } from 'react';
import { editFuelDetailsAction } from '@/app/actions';
import { initialActionState } from '@/lib/action-state';
import {
  formatLitres,
  formatMiles,
  formatPencePerLitre,
  parseLitres,
} from '@/lib/records/fuel-economy';

export interface FuelDetailsFormProps {
  purchaseId: number;
  expectedVersion: number;
  vehicleLabel: string;
  fuelPence: number;
  odometerMiles: number | null;
  fuelMillilitres: number | null;
  fullTank: boolean;
  /** The mpg (or why there is none) for the stretch this fill closed, if any. */
  economyNote: string | null;
  /** Voided purchases show their details but cannot change them. */
  editable: boolean;
}

/**
 * A fuel purchase's odometer, litres and full-tank flag (SPEC §15.1, v0.10.0
 * — decision 139). None of them is required at the pump, so this is where
 * they are added later: one line saying what is recorded, and a small form
 * behind "Fuel details" to fill in or correct it. Saving answers with the mpg
 * sentence (decision 141).
 */
export function FuelDetailsForm(props: FuelDetailsFormProps) {
  const [state, formAction, pending] = useActionState(editFuelDetailsAction, initialActionState);
  const [litres, setLitres] = useState(
    props.fuelMillilitres === null ? '' : formatLitres(props.fuelMillilitres),
  );
  const parsed = parseLitres(litres);
  const priceHint =
    parsed.ok && parsed.value !== null
      ? `= ${formatPencePerLitre(props.fuelPence, parsed.value)}`
      : 'From the pump or receipt.';
  const missing = [
    props.odometerMiles === null && props.fullTank ? 'odometer' : null,
    props.fuelMillilitres === null ? 'litres' : null,
  ].filter((item): item is string => item !== null);

  const facts = [
    props.fuelMillilitres === null ? null : `${formatLitres(props.fuelMillilitres)} L`,
    props.fuelMillilitres === null
      ? null
      : formatPencePerLitre(props.fuelPence, props.fuelMillilitres),
    props.odometerMiles === null ? null : `${formatMiles(props.odometerMiles)} miles`,
    props.fullTank ? 'full tank' : 'part fill',
  ].filter((item): item is string => item !== null);

  return (
    <div className="mt-1 text-xs" data-fuel-details={props.purchaseId}>
      <p className="text-slate-600">
        <span aria-hidden="true">⛽ </span>
        <span className="font-medium text-slate-700">{props.vehicleLabel}</span> ·{' '}
        {facts.join(' · ')}
        {props.economyNote !== null ? (
          <span className="block font-medium text-emerald-800">{props.economyNote}</span>
        ) : null}
      </p>
      {props.editable ? (
        <details className="mt-1">
          <summary className="cursor-pointer font-medium text-sky-700 hover:text-sky-900">
            {missing.length > 0 ? `Fuel details — add ${missing.join(' & ')}` : 'Fuel details'}
          </summary>
          <form action={formAction} className="mt-2 flex max-w-sm flex-col gap-2">
            <input type="hidden" name="purchaseId" value={props.purchaseId} />
            <input type="hidden" name="expectedVersion" value={props.expectedVersion} />
            <input type="hidden" name="fullTankShown" value="1" />
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 font-medium text-slate-700">
                Litres
                <input
                  name="litres"
                  value={litres}
                  onChange={(event) => setLitres(event.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 40.12"
                  className={inputClass}
                />
                <span className="font-normal text-slate-500">{priceHint}</span>
              </label>
              <label className="flex flex-col gap-1 font-medium text-slate-700">
                Odometer (miles)
                <input
                  name="odometer"
                  defaultValue={props.odometerMiles === null ? '' : String(props.odometerMiles)}
                  inputMode="numeric"
                  placeholder="e.g. 52310"
                  className={inputClass}
                />
                <span className="font-normal text-slate-500">Blank clears it.</span>
              </label>
            </div>
            <label className="flex min-h-[44px] items-center gap-2 font-medium text-slate-700">
              <input
                type="checkbox"
                name="fullTank"
                value="1"
                defaultChecked={props.fullTank}
                className="h-4 w-4 accent-slate-900"
              />
              Filled to full
            </label>
            <button
              type="submit"
              disabled={pending}
              className="self-start rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Save fuel details'}
            </button>
            {state.message !== null ? (
              <p
                role="status"
                className={state.status === 'error' ? 'text-red-700' : 'text-emerald-700'}
              >
                {state.message}
              </p>
            ) : null}
          </form>
        </details>
      ) : null}
    </div>
  );
}

const inputClass =
  'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal tabular-nums text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200';
