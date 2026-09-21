import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ProjectionSettingsForm } from '@/components/recurring';
import {
  CategoryTreeEditor,
  PotEditForm,
  TargetRenameForm,
  WarningLeadsForm,
} from '@/components/settings-forms';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { categoryTree } from '@/lib/records/categories';
import { listPeople } from '@/lib/records/people';
import { listPots } from '@/lib/records/pots';
import { getProjectionView } from '@/lib/records/money-view';
import {
  getContractEndWarningLeadDays,
  getMonthlyFuelByVehicle,
  getRenewalWarningLeadDays,
  getWeeklyGroceriesPence,
} from '@/lib/records/settings';
import { listVehicles } from '@/lib/records/vehicles';

export const dynamic = 'force-dynamic';

/**
 * Settings (SPEC §15.2): household names, per-pot edit, the category tree
 * editor, projection figures, warning leads and the payday/income pointer.
 * Everything here is visible, editable and audited in the domain layer —
 * there are no hidden switches (blueprint §1 transparency rule).
 */
export default async function SettingsPage() {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const now = new Date();
  const people = listPeople(db);
  const vehicles = listVehicles(db);
  const pots = listPots(db);
  const tree = categoryTree(db);
  const fuelByVehicle = getMonthlyFuelByVehicle(db);
  const projection = getProjectionView(db, now);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Settings</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Household configuration</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Every change is saved with who made it and when — the audit trail keeps the before/after
          values, so nothing here is ever silently overwritten.
        </p>
      </header>

      <div className="space-y-6">
        <section
          aria-labelledby="household-names-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="household-names-heading" className="mb-1 text-lg font-semibold">
            Household names
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Names stay short and unique (up to 60 characters). Renaming never touches history —
            records keep pointing at the same person or vehicle.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {people.map((person) => (
              <div key={person.id} className="rounded-lg bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Person
                </p>
                <TargetRenameForm
                  kind="person"
                  targetId={person.id}
                  version={person.version}
                  currentLabel={person.label}
                />
              </div>
            ))}
            {vehicles.map((vehicle) => (
              <div key={vehicle.id} className="rounded-lg bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Vehicle
                </p>
                <TargetRenameForm
                  kind="vehicle"
                  targetId={vehicle.id}
                  version={vehicle.version}
                  currentLabel={vehicle.label}
                />
              </div>
            ))}
          </div>
          {people.length === 0 && vehicles.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Add people and vehicles from the home page first.
            </p>
          ) : null}
        </section>

        <section
          aria-labelledby="pots-settings-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="pots-settings-heading" className="mb-1 text-lg font-semibold">
            Pots
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Overdraft limits and warning thresholds are the numbers the projection banner is built
            from. A threshold needs a limit, and must sit at or below it.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {pots.map((pot) => (
              <div key={pot.id} className="rounded-lg bg-slate-50 p-3">
                <p className="mb-2 text-sm font-semibold text-slate-700">{pot.label}</p>
                <PotEditForm
                  potId={pot.id}
                  version={pot.version}
                  label={pot.label}
                  kind={pot.kind}
                  overdraftLimitPence={pot.overdraftLimitPence}
                  warningThresholdPence={pot.warningThresholdPence}
                />
              </div>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="categories-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="categories-heading" className="mb-1 text-lg font-semibold">
            Category tree
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Two levels: parents group children, and entries always land on a child. Retiring a child
            blocks new assignments but keeps its history; parents stay while history points at them.
            The seeded categories can be renamed, extended and retired like any other.
          </p>
          <CategoryTreeEditor
            tree={tree.map((parent) => ({
              id: parent.id,
              name: parent.name,
              version: parent.version,
              retired: parent.retiredAt !== null,
              children: parent.children.map((child) => ({
                id: child.id,
                name: child.name,
                version: child.version,
                retired: child.retiredAt !== null,
              })),
            }))}
          />
        </section>

        <section
          aria-labelledby="projection-figures-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="projection-figures-heading" className="mb-1 text-lg font-semibold">
            Projection figures
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            The configured day-to-day numbers used by the payday projection. The Insights honesty
            loop compares these with recent actuals — blank clears a figure.
          </p>
          <div className="max-w-2xl">
            <ProjectionSettingsForm
              data={{
                weeklyGroceriesPence: getWeeklyGroceriesPence(db),
                monthlyFuelPence: vehicles.map((vehicle) => ({
                  vehicleId: vehicle.id,
                  label: vehicle.label,
                  pence: fuelByVehicle.get(vehicle.id) ?? null,
                })),
              }}
            />
          </div>
        </section>

        <section
          aria-labelledby="warning-leads-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="warning-leads-heading" className="mb-1 text-lg font-semibold">
            Warning leads
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            How many days ahead the app should warn about renewals and contract end dates on the
            overview and in key dates.
          </p>
          <WarningLeadsForm
            renewalLeadDays={getRenewalWarningLeadDays(db)}
            contractEndLeadDays={getContractEndWarningLeadDays(db)}
          />
        </section>

        <section
          aria-labelledby="payday-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="payday-heading" className="mb-1 text-lg font-semibold">
            Payday &amp; income
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            The projection plans to the next expected income schedule. Income is configured as a
            receipt schedule, not as a setting here.
          </p>
          {projection !== null && projection.paydayScheduleId !== null ? (
            <p className="text-sm">
              Planning to <span className="font-semibold">{projection.paydayScheduleName}</span> —{' '}
              <Link
                href={`/recurring#schedule-edit-${projection.paydayScheduleId}`}
                className="font-medium text-sky-700 hover:underline"
              >
                edit the schedule in Recurring →
              </Link>
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              No income schedule yet. Add one in{' '}
              <Link href="/recurring" className="font-medium text-sky-700 hover:underline">
                Recurring
              </Link>{' '}
              (kind: receipt) and the projection will plan to it.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
