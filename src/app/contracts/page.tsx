import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RenewalEditForm } from '@/components/schedule-forms';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import { listPeople } from '@/lib/records/people';
import { listRenewals } from '@/lib/records/renewals';
import { daysBetween } from '@/lib/records/dates';
import { listSchedulesWithContractEnds } from '@/lib/records/schedules';
import { supplierCardHref } from '@/lib/records/supplier-focus';
import { upcomingSupplierFollowUps } from '@/lib/records/supplier-details';
import { listSuppliers } from '@/lib/records/suppliers';
import { getContractEndWarningLeadDays, getRenewalWarningLeadDays } from '@/lib/records/settings';
import { listVehicles } from '@/lib/records/vehicles';
import { toLocalDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Contracts & Renewals (SPEC §22.3): the full list — renewal records with
 * their per-item leads and the fixed-term contract ends carried by DD/SO
 * schedules, plus the interaction follow-up dates from the Suppliers page and
 * the history the annual advance leaves behind.
 *
 * Both lists are informational. Nothing here stops a bank instruction: past
 * contract end dates read "rolled / awaiting review" because the household's
 * direct debit keeps going until they change it at the bank (SPEC §22.1).
 */
export default async function ContractsPage() {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const today = toLocalDateString(new Date());
  const renewals = listRenewals(db);
  const contracts = listSchedulesWithContractEnds(db);
  const suppliers = listSuppliers(db);
  const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  const people = listPeople(db);
  const vehicles = listVehicles(db);
  const defaultRenewalLead = getRenewalWarningLeadDays(db);
  const contractLead = getContractEndWarningLeadDays(db);
  const followUps = upcomingSupplierFollowUps(db, today);

  const targetLabel = (kind: string, id: number | null): string => {
    if (kind === 'person' && id !== null)
      return people.find((person) => person.id === id)?.label ?? 'person';
    if (kind === 'vehicle' && id !== null)
      return vehicles.find((vehicle) => vehicle.id === id)?.label ?? 'vehicle';
    return 'household';
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Plan ahead</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Contracts &amp; Renewals</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Dates are reminders only. The app never changes a bank instruction and never stops a
          direct debit on its own — an end date tells you it is time to shop around, and the
          payments keep being forecast until you edit or cancel the schedule here.
        </p>
      </header>

      <div className="space-y-6">
        <section
          aria-labelledby="contract-ends-heading"
          className="rounded-xl border border-border bg-surface p-5 shadow-sm"
        >
          <h2 id="contract-ends-heading" className="text-lg font-semibold">
            Fixed-term contract ends
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            From the DD/SO schedules. Alerts start {contractLead} days ahead (change that on
            Settings).
          </p>
          {contracts.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              No contract end dates recorded yet. Add one while editing a direct debit on{' '}
              <Link className="text-accent hover:underline" href="/recurring">
                Recurring Payments
              </Link>
              .
            </p>
          ) : (
            <div className="mt-3 divide-y divide-border-hairline">
              {contracts.map((schedule) => {
                const days = daysBetween(today, schedule.contractEndsOn);
                const rolled = schedule.contractEndsOn < today;
                const supplierName =
                  schedule.supplierId !== null
                    ? (supplierNames.get(schedule.supplierId) ?? null)
                    : null;
                return (
                  <div key={schedule.id} className="flex flex-wrap items-baseline gap-x-3 py-3">
                    <span className="font-medium">{schedule.name}</span>
                    <span className="text-sm text-ink-soft">
                      ends {schedule.contractEndsOn} · {formatPence(schedule.amountPence)} ·{' '}
                      {schedule.frequency}
                      {supplierName !== null ? ` · ${supplierName}` : ''}
                    </span>
                    {rolled ? (
                      <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning">
                        rolled / awaiting review
                      </span>
                    ) : (
                      <span className="text-xs text-ink-muted">
                        {days === 0 ? 'ends today' : `in ${days} days`}
                      </span>
                    )}
                    {supplierName !== null && schedule.supplierId !== null ? (
                      <Link
                        href={supplierCardHref(schedule.supplierId)}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        {supplierName} card →
                      </Link>
                    ) : null}
                    <Link
                      href={`/recurring#schedule-edit-${schedule.id}`}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      Edit the schedule →
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section
          aria-labelledby="renewals-heading"
          className="rounded-xl border border-border bg-surface p-5 shadow-sm"
        >
          <h2 id="renewals-heading" className="text-lg font-semibold">
            Renewals
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            Insurance and anything else that auto-renews. Each item has its own warning lead
            (default {defaultRenewalLead} days); a repeating date advances a year automatically once
            it passes.
          </p>
          {renewals.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              No renewals recorded. Add one on{' '}
              <Link className="text-accent hover:underline" href="/recurring">
                Recurring Payments
              </Link>{' '}
              and it will raise a key date before it falls due.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border-hairline">
              {renewals.map((renewal) => {
                const days = daysBetween(today, renewal.nextRenewalDate);
                const inWindow = days >= 0 && days <= renewal.warnDaysBefore;
                return (
                  <li key={renewal.id} className="py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-medium">{renewal.label}</span>
                      <span className="text-sm text-ink-soft">
                        renews {renewal.nextRenewalDate} · warn {renewal.warnDaysBefore} days ·{' '}
                        {renewal.repeatsAnnually ? 'annual' : 'one-off'}
                      </span>
                      {inWindow ? (
                        <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning">
                          {days === 0 ? 'renews today' : `in ${days} days`}
                        </span>
                      ) : days < 0 ? (
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-muted">
                          overdue by {Math.abs(days)} days
                        </span>
                      ) : null}
                      <span className="text-xs text-ink-muted">
                        {targetLabel(renewal.targetKind, renewal.targetId)}
                        {renewal.supplierId !== null
                          ? ` · ${supplierNames.get(renewal.supplierId) ?? 'supplier'}`
                          : ''}
                      </span>
                    </div>
                    {renewal.advancedFrom !== null ? (
                      <p className="mt-1 text-xs text-ink-muted">
                        Previously {renewal.advancedFrom} — advanced automatically when the date
                        passed.
                      </p>
                    ) : null}
                    {renewal.notes !== null && renewal.notes !== '' ? (
                      <p className="mt-1 text-sm text-ink-soft">{renewal.notes}</p>
                    ) : null}
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">
                        Edit renewal
                      </summary>
                      <div className="mt-2 max-w-2xl">
                        <RenewalEditForm
                          renewalId={renewal.id}
                          version={renewal.version}
                          label={renewal.label}
                          nextRenewalDate={renewal.nextRenewalDate}
                          warnDaysBefore={renewal.warnDaysBefore}
                          repeatsAnnually={renewal.repeatsAnnually}
                          supplierId={renewal.supplierId}
                          supplierOptions={suppliers.map((supplier) => ({
                            id: supplier.id,
                            label: supplier.name,
                          }))}
                          targetKind={renewal.targetKind}
                          targetId={renewal.targetId}
                          people={people.map(({ id, label }) => ({ id, label }))}
                          vehicles={vehicles.map(({ id, label }) => ({ id, label }))}
                          notes={renewal.notes ?? ''}
                        />
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="follow-ups-heading"
          className="rounded-xl border border-border bg-surface p-5 shadow-sm"
        >
          <h2 id="follow-ups-heading" className="text-lg font-semibold">
            Follow-ups you promised
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            From the supplier interaction log — so a date agreed on a phone call does not evaporate.
            No notification is sent for these (in-app only, by design).
          </p>
          {followUps.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              Nothing pending. Follow-up dates are added on the{' '}
              <Link className="text-accent hover:underline" href="/suppliers">
                Suppliers
              </Link>{' '}
              page.
            </p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {followUps.map((followUp, index) => (
                <li key={index}>
                  <span className="font-medium tabular-nums">{followUp.followUpDate}</span> ·{' '}
                  <Link
                    className="text-accent hover:underline"
                    href={supplierCardHref(followUp.supplierId)}
                  >
                    {followUp.supplierName}
                  </Link>{' '}
                  — {followUp.summary}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
