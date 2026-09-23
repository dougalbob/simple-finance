import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  allocations,
  checkpoints,
  externalMovements,
  purchases,
  scheduleInstances,
  schedules,
  transfers,
} from '../db/schema';
import { formatPence } from '../money';
import { isValidLocalDate, toLocalDateString } from '../time';
import { categoryTree } from './categories';
import { listPeople } from './people';
import { listPotsIncludingArchived } from './pots';
import { listSuppliers } from './suppliers';
import { listVehicles } from './vehicles';

/**
 * The "All Transactions" projection (docs/SPEC.md §15.3, plan decisions
 * 101–108): every movement that touched one pot inside a local date window,
 * as one flat, read-only list.
 *
 * It is a **pure projection of existing records** — it writes nothing, stores
 * nothing and invents nothing. Every row carries a link to the canonical form
 * that owns the add/edit/void behaviour, because this page deliberately has
 * none. Voided records are excluded (`voided_at IS NULL` on every family) and
 * income (`receipts`, code `BAC`) is not rendered in v1 — a one-off third-party
 * credit is other money in and therefore appears as `TX<` (decision 103).
 *
 * Signs are relative to the selected pot, so one pot→pot transfer is green on
 * the receiving side and red on the sending side with no data change anywhere.
 *
 * The date column is date-only ('YYYY-MM-DD', decision 108): a date-only
 * record's instant is the end-of-local-date marker, so rendering the instant
 * would print a 23:59 time that never happened.
 */

/** The compact type codes the household sketch asked for (SPEC §15.3). */
export type ActivityCode =
  'PUR' | 'REF' | 'DD' | 'SO' | 'TX<' | 'TX>' | 'LN<' | 'LN>' | 'SW<' | 'SW>';

export const ACTIVITY_ROW_LIMIT = 500;

export class InvalidActivityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidActivityInputError';
  }
}

export interface ActivityLink {
  href: string;
  label: string;
}

export interface ActivityRow {
  /** Stable React key: family + record id. */
  key: string;
  family: 'purchase' | 'transfer' | 'external';
  recordId: number;
  /** Local calendar date, 'YYYY-MM-DD' — the only date this page shows. */
  date: string;
  code: ActivityCode;
  /** Supplier, the other pot's label, or the counterparty. */
  source: string;
  /** 'Parent / Child (Target)' for purchases; '' for everything else. */
  category: string;
  /** Allocation lines beyond the first (a split shows "+N more"). */
  extraLines: number;
  /** Always positive; `direction` carries the sign. */
  amountPence: number;
  direction: 'in' | 'out';
  note: string;
  link: ActivityLink;
  /** DD/SO → the schedule; a swap leg → the paired swap list. */
  secondaryLink: ActivityLink | null;
  /** Swap pairing state, or null. */
  badge: string | null;
}

export interface ActivityCheckpoint {
  key: string;
  date: string;
  /** The user-reported figure — never a computed balance (SPEC §15.3). */
  amountPence: number;
  note: string;
}

export type ActivityEntry =
  { kind: 'row'; row: ActivityRow } | { kind: 'checkpoint'; checkpoint: ActivityCheckpoint };

export interface ActivityTotals {
  /** Sum of the rows actually shown, credits. */
  inPence: number;
  /** Sum of the rows actually shown, debits. */
  outPence: number;
  rowCount: number;
  /** Rows in the window that fell off the cap — the page must say so. */
  hiddenRowCount: number;
}

export interface ActivityView {
  potId: number;
  dateFrom: string;
  dateTo: string;
  /** Newest first; a checkpoint divider sits below its own date's rows. */
  entries: ActivityEntry[];
  totals: ActivityTotals;
}

export interface ActivityFilters {
  potId: number;
  dateFrom: string;
  dateTo: string;
  limit?: number;
}

interface PendingRow {
  /** Epoch ms, for the cross-family sort. */
  sortAt: number;
  /** Tie-break inside one family. */
  recordId: number;
  familyRank: number;
  row: ActivityRow;
}

export function listPotActivity(db: Db, filters: ActivityFilters): ActivityView {
  const { potId, dateFrom, dateTo } = filters;
  if (!isValidLocalDate(dateFrom)) {
    throw new InvalidActivityInputError(`Invalid start date: ${dateFrom}`);
  }
  if (!isValidLocalDate(dateTo)) {
    throw new InvalidActivityInputError(`Invalid end date: ${dateTo}`);
  }
  if (dateFrom > dateTo) {
    throw new InvalidActivityInputError(`The start date ${dateFrom} is after ${dateTo}.`);
  }
  const limit = Math.min(Math.max(filters.limit ?? ACTIVITY_ROW_LIMIT, 1), 1000);

  const potLabels = new Map(listPotsIncludingArchived(db).map((pot) => [pot.id, pot.label]));
  const supplierNames = new Map(listSuppliers(db).map((supplier) => [supplier.id, supplier.name]));
  const categoryNames = new Map(
    categoryTree(db).flatMap((parent) =>
      parent.children.map((child) => [child.id, `${parent.name} / ${child.name}`] as const),
    ),
  );
  const personNames = new Map(listPeople(db).map((person) => [person.id, person.label]));
  const vehicleNames = new Map(listVehicles(db).map((vehicle) => [vehicle.id, vehicle.label]));

  const pending: PendingRow[] = [];

  // --- Purchases: PUR / REF / DD / SO -------------------------------------
  const purchaseRows = db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.potId, potId),
        isNull(purchases.voidedAt),
        gte(purchases.occurredDate, dateFrom),
        lte(purchases.occurredDate, dateTo),
      ),
    )
    .orderBy(desc(purchases.occurredAt), desc(purchases.id))
    .limit(limit)
    .all();

  const linesByPurchase = new Map<number, Array<typeof allocations.$inferSelect>>();
  if (purchaseRows.length > 0) {
    const lines = db
      .select()
      .from(allocations)
      .where(
        inArray(
          allocations.purchaseId,
          purchaseRows.map((row) => row.id),
        ),
      )
      .all();
    for (const line of lines) {
      const list = linesByPurchase.get(line.purchaseId) ?? [];
      list.push(line);
      linesByPurchase.set(line.purchaseId, list);
    }
  }
  const scheduleByInstance = scheduleKindByInstance(
    db,
    purchaseRows.map((row) => row.scheduleInstanceId).filter((id): id is number => id !== null),
  );

  for (const purchase of purchaseRows) {
    const lines = linesByPurchase.get(purchase.id) ?? [];
    const schedule =
      purchase.scheduleInstanceId === null
        ? undefined
        : scheduleByInstance.get(purchase.scheduleInstanceId);
    const isRefund = purchase.refundOfPurchaseId !== null;
    const scheduleKind = schedule?.kind;
    const code: ActivityCode = isRefund
      ? 'REF'
      : scheduleKind === 'dd'
        ? 'DD'
        : scheduleKind === 'so'
          ? 'SO'
          : 'PUR';
    const firstLine = lines[0];
    pending.push({
      sortAt: purchase.occurredAt.getTime(),
      recordId: purchase.id,
      familyRank: 0,
      row: {
        key: `purchase-${purchase.id}`,
        family: 'purchase',
        recordId: purchase.id,
        date: purchase.occurredDate,
        code,
        source:
          purchase.supplierId !== null
            ? (supplierNames.get(purchase.supplierId) ?? 'Unknown supplier')
            : // A standing order may have no supplier (SPEC §11.1: a household
              // transfer option), so fall back to the schedule's own name —
              // "Unknown supplier" would be a dead end on a dense list.
              (schedule?.name ?? 'Unknown supplier'),
        category:
          firstLine === undefined
            ? ''
            : `${categoryNames.get(firstLine.categoryId) ?? 'Category'} (${targetLabel(
                firstLine.targetKind,
                firstLine.targetId,
                personNames,
                vehicleNames,
              )})`,
        extraLines: Math.max(lines.length - 1, 0),
        // A refund's total is negative, so money came back in (SPEC §9.5).
        amountPence: Math.abs(purchase.totalPence),
        direction: purchase.totalPence < 0 ? 'in' : 'out',
        note: purchase.note ?? '',
        link: {
          href: `/purchases?potId=${potId}&from=${dateFrom}&to=${dateTo}#purchase-${purchase.id}`,
          label: 'Open this purchase',
        },
        secondaryLink:
          schedule === undefined
            ? null
            : {
                href: `/recurring#schedule-${schedule.scheduleId}`,
                label: 'Open the schedule',
              },
        badge: null,
      },
    });
  }

  // --- Transfers: TX< / TX> ------------------------------------------------
  const transferRows = db
    .select()
    .from(transfers)
    .where(
      and(
        or(eq(transfers.fromPotId, potId), eq(transfers.toPotId, potId)),
        isNull(transfers.voidedAt),
        gte(transfers.occurredDate, dateFrom),
        lte(transfers.occurredDate, dateTo),
      ),
    )
    .orderBy(desc(transfers.occurredAt), desc(transfers.id))
    .limit(limit)
    .all();

  for (const transfer of transferRows) {
    const incoming = transfer.toPotId === potId;
    const otherPotId = incoming ? transfer.fromPotId : transfer.toPotId;
    pending.push({
      sortAt: transfer.occurredAt.getTime(),
      recordId: transfer.id,
      familyRank: 1,
      row: {
        key: `transfer-${transfer.id}`,
        family: 'transfer',
        recordId: transfer.id,
        date: transfer.occurredDate,
        code: incoming ? 'TX<' : 'TX>',
        source: potLabels.get(otherPotId) ?? 'Another pot',
        category: '',
        extraLines: 0,
        amountPence: transfer.amountPence,
        direction: incoming ? 'in' : 'out',
        note: transfer.note ?? '',
        link: {
          href: `/overview?transfer=${transfer.id}#transfer-${transfer.id}`,
          label: 'Open this transfer',
        },
        secondaryLink: null,
        badge: null,
      },
    });
  }

  // --- Money across the boundary: TX / LN / SW -----------------------------
  const externalRows = db
    .select()
    .from(externalMovements)
    .where(
      and(
        eq(externalMovements.potId, potId),
        isNull(externalMovements.voidedAt),
        gte(externalMovements.occurredDate, dateFrom),
        lte(externalMovements.occurredDate, dateTo),
      ),
    )
    .orderBy(desc(externalMovements.occurredAt), desc(externalMovements.id))
    .limit(limit)
    .all();

  const swapPartners = swapPartnerByExchangeKey(
    db,
    externalRows
      .filter((row) => row.kind === 'swap' && row.exchangeKey !== null)
      .map((row) => row.exchangeKey as string),
    potId,
  );

  for (const movement of externalRows) {
    const incoming = movement.direction === 'in';
    const arrow = incoming ? '<' : '>';
    const code: ActivityCode =
      movement.kind === 'loan'
        ? (`LN${arrow}` as ActivityCode)
        : movement.kind === 'swap'
          ? (`SW${arrow}` as ActivityCode)
          : (`TX${arrow}` as ActivityCode);
    pending.push({
      sortAt: movement.occurredAt.getTime(),
      recordId: movement.id,
      familyRank: 2,
      row: {
        key: `external-${movement.id}`,
        family: 'external',
        recordId: movement.id,
        date: movement.occurredDate,
        code,
        source: movement.counterparty,
        category: '',
        extraLines: 0,
        amountPence: movement.amountPence,
        direction: incoming ? 'in' : 'out',
        note: movement.note ?? '',
        link: {
          href: `/pots?external=${movement.id}#external-${movement.id}`,
          label: 'Open this record',
        },
        secondaryLink:
          movement.kind === 'swap' ? { href: '/pots#swaps', label: 'Open the swap list' } : null,
        badge: movement.kind === 'swap' ? (swapPartners.get(movement.id) ?? null) : null,
      },
    });
  }

  // One deterministic order across families: newest first, then a stable
  // tie-break so a re-render cannot reshuffle rows sharing an instant.
  pending.sort(
    (a, b) =>
      b.sortAt - a.sortAt ||
      a.familyRank - b.familyRank ||
      b.recordId - a.recordId ||
      a.row.key.localeCompare(b.row.key),
  );
  const shown = pending.slice(0, limit);
  // The per-family fetches are capped, so the honest "how many did I hide"
  // count comes from counting the window in the database, not from what was
  // fetched (SPEC §15.3: a capped list must say so rather than imply a total).
  const windowRowCount =
    countRows(db, purchases, potId, dateFrom, dateTo) +
    countTransferRows(db, potId, dateFrom, dateTo) +
    countRows(db, externalMovements, potId, dateFrom, dateTo);
  const hiddenRowCount = Math.max(windowRowCount - shown.length, 0);

  let inPence = 0;
  let outPence = 0;
  const entries: ActivityEntry[] = shown.map((item) => {
    if (item.row.direction === 'in') inPence += item.row.amountPence;
    else outPence += item.row.amountPence;
    return { kind: 'row', row: item.row };
  });

  // Checkpoint dividers (SPEC §15.3): the reported figure inside the window,
  // sitting below its own date's rows so "everything above the line happened
  // on or after this report" reads correctly in a newest-first list.
  const checkpointRows = db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.potId, potId))
    .orderBy(desc(checkpoints.effectiveAt), desc(checkpoints.id))
    .limit(200)
    .all();
  for (const checkpoint of checkpointRows) {
    const date = toLocalDateString(checkpoint.effectiveAt);
    if (date < dateFrom || date > dateTo) continue;
    const insertAt = entries.findIndex((entry) => entry.kind === 'row' && entry.row.date < date);
    const divider: ActivityEntry = {
      kind: 'checkpoint',
      checkpoint: {
        key: `checkpoint-${checkpoint.id}`,
        date,
        amountPence: checkpoint.amountPence,
        note: checkpoint.note ?? '',
      },
    };
    if (insertAt === -1) entries.push(divider);
    else entries.splice(insertAt, 0, divider);
  }

  return {
    potId,
    dateFrom,
    dateTo,
    entries,
    totals: { inPence, outPence, rowCount: shown.length, hiddenRowCount },
  };
}

function targetLabel(
  targetKind: string,
  targetId: number | null,
  personNames: Map<number, string>,
  vehicleNames: Map<number, string>,
): string {
  if (targetKind === 'person' && targetId !== null) {
    return personNames.get(targetId) ?? 'person';
  }
  if (targetKind === 'vehicle' && targetId !== null) {
    return vehicleNames.get(targetId) ?? 'vehicle';
  }
  return 'household';
}

/** instance id → the schedule it came from, so DD and SO stay distinct. */
function scheduleKindByInstance(
  db: Db,
  instanceIds: number[],
): Map<number, { scheduleId: number; name: string; kind: 'dd' | 'so' | 'receipt' }> {
  const map = new Map<
    number,
    { scheduleId: number; name: string; kind: 'dd' | 'so' | 'receipt' }
  >();
  if (instanceIds.length === 0) return map;
  const rows = db
    .select({
      instanceId: scheduleInstances.id,
      scheduleId: schedules.id,
      name: schedules.name,
      kind: schedules.kind,
    })
    .from(scheduleInstances)
    .innerJoin(schedules, eq(schedules.id, scheduleInstances.scheduleId))
    .where(inArray(scheduleInstances.id, instanceIds))
    .all();
  for (const row of rows) {
    map.set(row.instanceId, { scheduleId: row.scheduleId, name: row.name, kind: row.kind });
  }
  return map;
}

/**
 * Swap legs shown on this pot, keyed by leg id → the pairing badge. The badge
 * says the same thing the paired list on /pots says (decision 100): balanced,
 * legs differ, or the other leg was voided.
 */
function swapPartnerByExchangeKey(
  db: Db,
  exchangeKeys: string[],
  potId: number,
): Map<number, string> {
  const badges = new Map<number, string>();
  if (exchangeKeys.length === 0) return badges;
  const legs = db
    .select()
    .from(externalMovements)
    .where(
      and(
        eq(externalMovements.kind, 'swap'),
        inArray(externalMovements.exchangeKey, [...new Set(exchangeKeys)]),
      ),
    )
    .all();
  const potLabels = new Map(listPotsIncludingArchived(db).map((pot) => [pot.id, pot.label]));
  const byKey = new Map<string, Array<typeof externalMovements.$inferSelect>>();
  for (const leg of legs) {
    if (leg.exchangeKey === null) continue;
    const list = byKey.get(leg.exchangeKey) ?? [];
    list.push(leg);
    byKey.set(leg.exchangeKey, list);
  }
  for (const leg of legs) {
    if (leg.potId !== potId || leg.exchangeKey === null) continue;
    const partner = byKey.get(leg.exchangeKey)?.find((other) => other.id !== leg.id);
    if (partner === undefined) {
      badges.set(leg.id, 'swap · no paired leg');
      continue;
    }
    const partnerPot = potLabels.get(partner.potId) ?? 'another pot';
    if (partner.voidedAt !== null) {
      badges.set(leg.id, 'swap · other leg voided');
      continue;
    }
    badges.set(
      leg.id,
      partner.amountPence === leg.amountPence
        ? `swap (paired, ${formatPence(partner.amountPence)} with ${partnerPot})`
        : `swap (legs differ, ${formatPence(partner.amountPence)} with ${partnerPot})`,
    );
  }
  return badges;
}

/** Exact live-row count in the window for a single-pot family. */
function countRows(
  db: Db,
  table: typeof purchases | typeof externalMovements,
  potId: number,
  dateFrom: string,
  dateTo: string,
): number {
  const row = db
    .select({ value: sql<number>`count(*)` })
    .from(table)
    .where(
      and(
        eq(table.potId, potId),
        isNull(table.voidedAt),
        gte(table.occurredDate, dateFrom),
        lte(table.occurredDate, dateTo),
      ),
    )
    .get();
  return row?.value ?? 0;
}

/** Exact live-row count in the window for transfers touching this pot. */
function countTransferRows(db: Db, potId: number, dateFrom: string, dateTo: string): number {
  const row = db
    .select({ value: sql<number>`count(*)` })
    .from(transfers)
    .where(
      and(
        or(eq(transfers.fromPotId, potId), eq(transfers.toPotId, potId)),
        isNull(transfers.voidedAt),
        gte(transfers.occurredDate, dateFrom),
        lte(transfers.occurredDate, dateTo),
      ),
    )
    .get();
  return row?.value ?? 0;
}
