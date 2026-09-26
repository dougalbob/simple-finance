import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AttachmentForm } from '@/components/attachment-form';
import { CancelScheduleForm } from '@/components/recurring';
import {
  IncomeEditForm,
  IncomeEntryForm,
  IncomeScheduleEditForm,
  IncomeScheduleForm,
} from '@/components/income-forms';
import { VoidForm } from '@/components/record-forms';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { formatPence } from '@/lib/money';
import {
  describeIncome,
  getIncomeRecord,
  incomeSummary,
  listIncomeRecords,
  listIncomeSchedules,
  type IncomeRecordView,
} from '@/lib/records/income-view';
import { listStoredReceiptAttachments, type StoredAttachment } from '@/lib/records/attachments';
import { ensureScheduleState } from '@/lib/records/money-view';
import { listPots } from '@/lib/records/pots';
import { toLocalDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Income (SPEC §6, §11.3, §15.2 — plan decisions 109–113).
 *
 * Money arriving, in the two shapes it actually arrives in:
 *
 * - **scheduled income** — the salary that lands on the same day every month
 *   and converts itself into a record on its due date (SPEC §11.2). The
 *   schedule is edited here, on a laptop: a change applies from the next
 *   instance onward, never rewriting a month that already happened.
 * - **one-off income** — the bicycle sold for cash, the bank transfer from a
 *   buyer, a refund from a third party, a gift. Recorded by hand with an
 *   optional source saying what or who it came from.
 *
 * What this page is not: an income analysis. No income-vs-spending, no
 * category breakdown, no charts (plan decision 103, SPEC §12/§16). It is
 * record-keeping and visibility — the estimate, the projection and All
 * Transactions do the rest.
 *
 * Income is desktop-shaped by the household's choice (plan decision 111):
 * it is not a till-side task, so nothing here is squeezed into the mobile
 * quick-entry panel.
 */
export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ receipt?: string }>;
}) {
  const user = await currentUserFromRequest();
  if (user === null) redirect('/unauthorized');

  const { db } = getDbHandle();
  const now = new Date();
  const today = toLocalDateString(now);
  const params = await searchParams;
  // The lazy due pass runs as on every read page (SPEC §11.2): a salary that
  // came due today is in the list below, not waiting for tomorrow.
  ensureScheduleState(db, now);

  const pots = listPots(db);
  const schedules = listIncomeSchedules(db, now);
  const summary = incomeSummary(db, now);
  // Voided income stays in the list, struck through: the page says "nothing
  // here is ever deleted", and hiding a voided row would make that a lie.
  const records = listIncomeRecords(db, { includeVoided: true, limit: 200 });
  // A deep link from All Transactions (SPEC §15.3) must land on the record it
  // names, even once that income has fallen out of the recent two hundred.
  const linkedId = Number(params.receipt);
  const linked =
    Number.isInteger(linkedId) && linkedId > 0 && records.every((row) => row.id !== linkedId)
      ? getIncomeRecord(db, linkedId)
      : null;
  const rows = linked === null ? records : [linked, ...records];
  // Payslips and other documents on each income record (v0.10.0, decision
  // 138), fetched for the whole list in one query.
  const documents = listStoredReceiptAttachments(
    db,
    rows.map((row) => row.id),
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Income</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Money coming in</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Salary that repeats, and one-off money — a sale paid in cash or by bank transfer, a
          refund, a gift. Income is not spending: it never appears in an insight and never carries a
          category.
        </p>
      </header>

      <section
        aria-label="Income summary"
        className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Next payday</p>
          {summary.nextPayday === null ? (
            <p className="mt-1 text-sm text-ink-soft">
              No scheduled income yet — add one below and the projection plans around it.
            </p>
          ) : (
            <>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatPence(summary.nextPayday.amountPence)}
              </p>
              <p className="text-sm text-ink-soft">
                {summary.nextPayday.scheduleName} · {summary.nextPayday.date} · into{' '}
                {summary.nextPayday.potLabel}
              </p>
              {summary.nextPayday.shifted ? (
                <p className="mt-1 text-xs text-warning-700">
                  The configured day falls on a weekend, so this is expected on the Friday before.
                </p>
              ) : null}
            </>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Received this month
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatPence(summary.monthToDatePence)}
          </p>
          <p className="text-sm text-ink-soft">
            Income recorded since the 1st, all pots. A figure you recorded — not a bank feed.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Where income shows up
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            Every income record raises its pot&apos;s estimate and appears in{' '}
            <Link href="/transactions" className="text-accent underline">
              All Transactions
            </Link>{' '}
            as <span className="font-semibold">BAC</span>. Scheduled income also feeds the{' '}
            <Link href="/overview" className="text-accent underline">
              to-payday projection
            </Link>
            .
          </p>
        </div>
      </section>

      <section
        aria-labelledby="scheduled-income-heading"
        className="mb-6 rounded-xl border border-border bg-surface p-4 shadow-sm"
      >
        <h2 id="scheduled-income-heading" className="text-lg font-semibold">
          Regular income (scheduled)
        </h2>
        <p className="mb-3 mt-1 max-w-3xl text-sm text-ink-soft">
          The money that repeats. Each schedule converts itself into an income record on its due
          date, so the month you are in stays honest without anyone typing. Small corrections are
          made here and apply from the next instance — a salary already paid is never rewritten.
        </p>

        {schedules.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing scheduled yet.</p>
        ) : (
          <ul className="divide-y divide-border-hairline">
            {schedules.map((schedule) => (
              <li key={schedule.scheduleId} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {schedule.name}{' '}
                      <span className="font-normal text-ink-muted">
                        — {formatPence(schedule.amountPence)}{' '}
                        {schedule.frequency === 'monthly'
                          ? schedule.excludedMonths.length > 0
                            ? 'monthly'
                            : 'a month'
                          : 'a year'}
                        , due on the {ordinal(schedule.dueDayOfMonth)}
                        {schedule.frequency === 'annual' && schedule.dueMonth !== null
                          ? ` of month ${schedule.dueMonth}`
                          : ''}
                      </span>
                    </p>
                    <p className="text-xs text-ink-muted">
                      Into {schedule.potLabel}
                      {schedule.cancelledAt !== null
                        ? ` · cancelled from ${schedule.cancelledEffectiveOn ?? '—'}`
                        : schedule.nextDueDate !== null
                          ? ` · next expected ${schedule.nextDueDate}`
                          : ' · no further instances'}
                      {schedule.lastReceivedDate !== null
                        ? ` · last received ${schedule.lastReceivedDate} (${schedule.receivedCount} recorded)`
                        : ' · nothing received yet'}
                    </p>
                    {schedule.nextDueDateShifted ? (
                      <p className="text-xs text-warning-700">
                        The {ordinal(schedule.dueDayOfMonth)} falls on a weekend — expected on the
                        Friday before.
                      </p>
                    ) : null}
                  </div>
                  {schedule.cancelledAt === null ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer font-medium text-ink-soft">
                        Edit or cancel
                      </summary>
                      <div className="mt-2 flex flex-col gap-3">
                        <IncomeScheduleEditForm
                          schedule={schedule}
                          pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))}
                        />
                        <CancelScheduleForm
                          schedule={{
                            id: schedule.scheduleId,
                            name: schedule.name,
                            kind: 'receipt',
                            frequency: schedule.frequency,
                            amountPence: schedule.amountPence,
                            dueDayOfMonth: schedule.dueDayOfMonth,
                            dueMonth: schedule.dueMonth,
                            potLabel: schedule.potLabel,
                            nextDueDate: schedule.nextDueDate,
                            version: schedule.version,
                            cancelledEffectiveOn: schedule.cancelledEffectiveOn,
                            contractEndsOn: null,
                            supplierId: null,
                            supplierName: null,
                          }}
                          today={today}
                        />
                      </div>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        <details className="mt-4 border-t border-border-hairline pt-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-body">
            Add scheduled income
          </summary>
          <div className="mt-3">
            <IncomeScheduleForm
              idPrefix="income-schedule"
              pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))}
              today={today}
            />
          </div>
        </details>
      </section>

      <section
        aria-labelledby="one-off-income-heading"
        className="mb-6 rounded-xl border border-border bg-surface p-4 shadow-sm"
      >
        <h2 id="one-off-income-heading" className="text-lg font-semibold">
          Record one-off income
        </h2>
        <p className="mb-3 mt-1 max-w-3xl text-sm text-ink-soft">
          Something sold, a refund, a gift, a one-off job — money that arrived once. Cash or bank
          transfer is simply which pot it landed in: cash into the cash pot, a transfer into the
          bank account it reached.
        </p>
        <IncomeEntryForm
          idPrefix="income-entry"
          pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))}
          today={today}
        />
      </section>

      <section
        aria-labelledby="income-history-heading"
        className="rounded-xl border border-border bg-surface p-4 shadow-sm"
      >
        <h2 id="income-history-heading" className="text-lg font-semibold">
          Income received
        </h2>
        <p className="mb-3 mt-1 max-w-3xl text-sm text-ink-soft">
          Scheduled and one-off income together, newest first. Voided income stays in the list,
          struck through with its reason — nothing here is ever deleted. Attach the payslip (a PDF
          or a photo, up to 10 MB) to any record, now or later.
        </p>
        {linked !== null ? (
          <p className="mb-2 rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-900">
            Showing the record you linked to — it is older than the two hundred most recent.
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-strong p-6 text-sm text-ink-soft">
            No income recorded yet. Once a salary schedule converts, or you record a one-off, it
            appears here.
          </p>
        ) : (
          <ul className="divide-y divide-border-hairline">
            {rows.map((record) => (
              <IncomeRow
                key={record.id}
                record={record}
                documents={documents.get(record.id) ?? []}
                pots={pots.map((pot) => ({ id: pot.id, label: pot.label }))}
                today={today}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function IncomeRow({
  record,
  documents,
  pots,
  today,
}: {
  record: IncomeRecordView;
  documents: StoredAttachment[];
  pots: Array<{ id: number; label: string }>;
  today: string;
}) {
  const summary = `${formatPence(record.amountPence)} · ${record.source} · ${record.occurredDate} · ${record.potLabel}`;
  return (
    <li id={`receipt-${record.id}`} className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className={record.voidedAt !== null ? 'text-ink-faint line-through' : undefined}>
          {record.source}
          {record.scheduleName !== null ? (
            <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-soft">
              from schedule
            </span>
          ) : null}
          <span className="ml-2 text-xs text-ink-muted">
            {record.occurredDate} · {record.potLabel} · {record.enteredBy}
            {record.note !== null && record.note !== '' ? ` — ${record.note}` : ''}
          </span>
        </span>
        <span className="tabular-nums font-semibold text-positive">
          +{formatPence(record.amountPence)}
        </span>
      </div>
      <AttachmentForm
        receiptId={record.id}
        attachments={documents}
        allowUpload={record.voidedAt === null}
      />
      {record.voidedAt === null ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs font-medium text-ink-soft">
            Correct or void
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            <IncomeEditForm record={record} pots={pots} today={today} />
            <VoidForm
              kind="receipt"
              recordId={record.id}
              expectedVersion={record.version}
              summary={describeIncome(record)}
            />
          </div>
        </details>
      ) : (
        <p className="text-xs text-ink-faint">
          Voided{record.voidReason ? ` — ${record.voidReason}` : ''} · {summary}
        </p>
      )}
    </li>
  );
}

/** 1 → "1st", 22 → "22nd" — the payday reads as a day of the month, not a number. */
function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return day % 10 === 1
    ? `${day}st`
    : day % 10 === 2
      ? `${day}nd`
      : day % 10 === 3
        ? `${day}rd`
        : `${day}th`;
}
