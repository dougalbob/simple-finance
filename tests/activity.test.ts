import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InvalidActivityInputError,
  listPotActivity,
  type ActivityRow,
} from '../src/lib/records/activity';
import { createDebt, editDebt } from '../src/lib/records/debts';
import {
  createExternalMovement,
  createSwap,
  voidExternalMovement,
} from '../src/lib/records/external-movements';
import {
  archivePot,
  addCheckpoint,
  createPot,
  listPots,
  listPotsIncludingArchived,
} from '../src/lib/records/pots';
import { createPurchase, createRefund, voidPurchase } from '../src/lib/records/purchases';
import { createReceipt, listReceipts, voidReceipt } from '../src/lib/records/receipts';
import { createSchedule, materializeAndConvert } from '../src/lib/records/schedules';
import { createTransfer, voidTransfer } from '../src/lib/records/transfers';
import { createHouseholdFixture, type HouseholdFixture } from './household';

/**
 * The "All Transactions" projection (SPEC §15.3, plan decisions 101–108):
 * every record family × pot scoping × void exclusion × date window × sign
 * relative to the selected pot, plus checkpoint dividers, the split summary
 * and the row cap.
 *
 * One household, one September 2026 window on the Main account:
 *
 *   09-15  purchase (outside the window)
 *   09-21  Corner Shop £12.00            PUR   out
 *   09-22  Newsagent £4.50               PUR   out
 *   09-22  checkpoint £1,000.00          divider, not a movement
 *   09-23  Tesco £63.47 (split, 2 lines) PUR   out
 *   09-23  Main → Alex's cash £80.00     TX>   out  (TX< on the cash pot)
 *   09-24  refund of Corner Shop £5.00   REF   in
 *   09-24  borrowed from Parents £1,000  LN<   in
 *   09-25  swap out to Alex's cash £50   SW>   out  (SW< on the cash pot)
 *   09-26  Energy DD £84.55 (converted)  DD    out
 *   09-24  Salary receipt £2,450.00      BAC   in   (converted from schedule)
 *   09-27  Phone plan SO £12.00          SO    out
 *   09-27  bicycle sale £45.00 in        BAC   in   (one-off, source set)
 *   09-27  voided purchase               never rendered
 *   09-28  Acme Windows £150.00 in       TX<   in
 *   09-28  voided income £10.00          never rendered
 *   09-28  voided transfer               never rendered
 */
const ACTOR = 'alex@example.com';
const WINDOW = { dateFrom: '2026-09-20', dateTo: '2026-09-30' };

interface SeededActivity {
  fx: HouseholdFixture;
  cornerShop: number;
  splitPurchase: number;
  transferId: number;
  swapExchangeKey: string;
  ddScheduleId: number;
  soScheduleId: number;
  salaryScheduleId: number;
  voidedPurchaseId: number;
  voidedTransferId: number;
  salaryReceiptId: number;
  oneOffReceiptId: number;
  voidedReceiptId: number;
  outsidePurchaseId: number;
  energyAmountPence: number;
}

async function seedActivity(): Promise<SeededActivity> {
  const fx = await createHouseholdFixture();
  const db = fx.db;
  const groceries = fx.categoryId('Groceries', 'Weekly Shop');
  const topUp = fx.categoryId('Groceries', 'Top-up Shops');
  const fuel = fx.categoryId('Vehicle Running', 'Fuel');
  const energy = fx.categoryId('Utilities', 'Energy');
  const mobile = fx.categoryId('Utilities', 'Mobile Phones');
  const at = (date: string, time = 'T12:00:00Z') => new Date(`${date}${time}`);

  const outside = createPurchase(db, {
    supplierName: 'Old Supplier',
    potId: fx.pots.main.id,
    totalPence: 999,
    occurredDate: '2026-09-15',
    lines: [{ amountPence: 999, categoryId: groceries, targetKind: 'household' }],
    actor: ACTOR,
    now: at('2026-09-20'),
  });

  const cornerShop = createPurchase(db, {
    supplierName: 'Corner Shop',
    potId: fx.pots.main.id,
    totalPence: 1200,
    occurredDate: '2026-09-21',
    note: 'Weekly shop',
    lines: [{ amountPence: 1200, categoryId: groceries, targetKind: 'household' }],
    actor: ACTOR,
    now: at('2026-09-21'),
  });

  createPurchase(db, {
    supplierName: 'Newsagent',
    potId: fx.pots.main.id,
    totalPence: 450,
    occurredDate: '2026-09-22',
    lines: [{ amountPence: 450, categoryId: topUp, targetKind: 'household' }],
    actor: ACTOR,
    now: at('2026-09-22'),
  });

  addCheckpoint(db, {
    potId: fx.pots.main.id,
    amountPence: 100000,
    effectiveDate: '2026-09-22',
    note: 'Friday evening check',
    actor: ACTOR,
    now: at('2026-09-22', 'T20:00:00Z'),
  });

  const split = createPurchase(db, {
    supplierName: 'Tesco',
    potId: fx.pots.main.id,
    totalPence: 6347,
    occurredDate: '2026-09-23',
    note: 'Mixed receipt',
    lines: [
      { amountPence: 4198, categoryId: groceries, targetKind: 'household' },
      {
        amountPence: 2149,
        categoryId: fuel,
        targetKind: 'vehicle',
        targetId: fx.vehicles.vehicleA.id,
      },
    ],
    actor: ACTOR,
    now: at('2026-09-23'),
  });

  const transfer = createTransfer(db, {
    fromPotId: fx.pots.main.id,
    toPotId: fx.pots.alexCash.id,
    amountPence: 8000,
    occurredDate: '2026-09-23',
    note: 'Son wages',
    actor: ACTOR,
    now: at('2026-09-23'),
  });

  createRefund(db, {
    refundOfPurchaseId: cornerShop.purchase.id,
    totalPence: -500,
    occurredDate: '2026-09-24',
    note: 'Returned the milk',
    lines: [{ amountPence: -500, categoryId: groceries, targetKind: 'household' }],
    actor: ACTOR,
    now: at('2026-09-24'),
  });

  const parents = createDebt(db, {
    counterparty: 'Parents',
    direction: 'we_owe',
    note: 'Bridging loan',
    actor: ACTOR,
    now: at('2026-09-24'),
  });
  createExternalMovement(db, {
    potId: fx.pots.main.id,
    direction: 'in',
    kind: 'loan',
    amountPence: 100000,
    occurredDate: '2026-09-24',
    debtId: parents.id,
    note: 'Bridging loan',
    actor: ACTOR,
    now: at('2026-09-24'),
  });

  const swap = createSwap(db, {
    inPotId: fx.pots.alexCash.id,
    outPotId: fx.pots.main.id,
    amountPence: 5000,
    counterparty: 'Son',
    occurredDate: '2026-09-25',
    note: 'Cash for a bank transfer',
    actor: ACTOR,
    now: at('2026-09-25'),
  });

  const dd = createSchedule(db, {
    name: 'Energy DD',
    kind: 'dd',
    frequency: 'monthly',
    dueDayOfMonth: 26,
    amountPence: 8455,
    potId: fx.pots.main.id,
    categoryId: energy,
    supplierName: 'EnergyCo',
    targetKind: 'household',
    activeFrom: '2026-08-01',
    actor: ACTOR,
    now: at('2026-09-20'),
  });
  const so = createSchedule(db, {
    name: 'Phone plan',
    kind: 'so',
    frequency: 'monthly',
    dueDayOfMonth: 27,
    amountPence: 1200,
    potId: fx.pots.main.id,
    categoryId: mobile,
    targetKind: 'household',
    activeFrom: '2026-08-01',
    actor: ACTOR,
    now: at('2026-09-20'),
  });
  const salary = createSchedule(db, {
    name: 'Salary',
    kind: 'receipt',
    frequency: 'monthly',
    dueDayOfMonth: 24,
    amountPence: 245000,
    potId: fx.pots.main.id,
    targetKind: 'household',
    activeFrom: '2026-08-01',
    actor: ACTOR,
    now: at('2026-09-20'),
  });
  // Local midnight of the 27th has arrived: all three instances convert.
  materializeAndConvert(db, new Date('2026-09-27T00:30:00+01:00'));
  // The converted salary: a real receipt back-referencing its instance.
  const salaryReceipt = listReceipts(db, { potId: fx.pots.main.id }).find(
    (row) => row.scheduleInstanceId !== null,
  );

  // One-off income: the bicycle sold for cash (plan decision 110).
  const oneOff = createReceipt(db, {
    potId: fx.pots.main.id,
    amountPence: 4500,
    occurredDate: '2026-09-27',
    source: 'Sale of bicycle',
    note: 'Collected in cash',
    actor: ACTOR,
    now: at('2026-09-27'),
  });
  const voidedReceipt = createReceipt(db, {
    potId: fx.pots.main.id,
    amountPence: 1000,
    occurredDate: '2026-09-28',
    source: 'Duplicate refund',
    actor: ACTOR,
    now: at('2026-09-28'),
  });
  voidReceipt(db, {
    id: voidedReceipt.id,
    expectedVersion: voidedReceipt.version,
    reason: 'Entered twice',
    actor: ACTOR,
    now: at('2026-09-28'),
  });

  const voided = createPurchase(db, {
    supplierName: 'Mistaken Entry',
    potId: fx.pots.main.id,
    totalPence: 700,
    occurredDate: '2026-09-27',
    lines: [{ amountPence: 700, categoryId: topUp, targetKind: 'household' }],
    actor: ACTOR,
    now: at('2026-09-27'),
  });
  voidPurchase(db, {
    id: voided.purchase.id,
    expectedVersion: voided.purchase.version,
    reason: 'Entered twice',
    actor: ACTOR,
    now: at('2026-09-27'),
  });

  createExternalMovement(db, {
    potId: fx.pots.main.id,
    direction: 'in',
    kind: 'other',
    amountPence: 15000,
    occurredDate: '2026-09-28',
    counterparty: 'Acme Windows',
    note: 'Window refund',
    actor: ACTOR,
    now: at('2026-09-28'),
  });

  const voidedTransfer = createTransfer(db, {
    fromPotId: fx.pots.main.id,
    toPotId: fx.pots.samCash.id,
    amountPence: 1000,
    occurredDate: '2026-09-28',
    note: 'Gave Sam £10',
    actor: ACTOR,
    now: at('2026-09-28'),
  });
  voidTransfer(db, {
    id: voidedTransfer.id,
    expectedVersion: voidedTransfer.version,
    reason: 'Never happened',
    actor: ACTOR,
    now: at('2026-09-28'),
  });

  return {
    fx,
    cornerShop: cornerShop.purchase.id,
    splitPurchase: split.purchase.id,
    transferId: transfer.id,
    swapExchangeKey: swap.exchangeKey,
    ddScheduleId: dd.schedule.id,
    soScheduleId: so.schedule.id,
    salaryScheduleId: salary.schedule.id,
    voidedPurchaseId: voided.purchase.id,
    voidedTransferId: voidedTransfer.id,
    salaryReceiptId: salaryReceipt?.id ?? 0,
    oneOffReceiptId: oneOff.id,
    voidedReceiptId: voidedReceipt.id,
    outsidePurchaseId: outside.purchase.id,
    energyAmountPence: 8455,
  };
}

function rows(view: { entries: Array<{ kind: string; row?: ActivityRow }> }): ActivityRow[] {
  return view.entries
    .filter((entry): entry is { kind: 'row'; row: ActivityRow } => entry.kind === 'row')
    .map((entry) => entry.row);
}

describe('All Transactions projection (SPEC §15.3)', () => {
  it('projects every record family with the sketch’s codes and pot-relative signs', async () => {
    const seeded = await seedActivity();
    try {
      const view = listPotActivity(seeded.fx.db, {
        potId: seeded.fx.pots.main.id,
        ...WINDOW,
      });
      const list = rows(view);

      assert.deepEqual(
        list.map((row) => `${row.date} ${row.code} ${row.direction}`),
        [
          '2026-09-28 TX< in',
          '2026-09-27 BAC in',
          '2026-09-27 SO out',
          '2026-09-26 DD out',
          '2026-09-25 SW> out',
          '2026-09-24 REF in',
          '2026-09-24 LN< in',
          // The converted salary lands at local midnight, so it sorts below
          // the same day's later-dated rows.
          '2026-09-24 BAC in',
          '2026-09-23 PUR out',
          '2026-09-23 TX> out',
          '2026-09-22 PUR out',
          '2026-09-21 PUR out',
        ],
      );

      const byCode = (code: string) => list.find((row) => row.code === code);
      // Match on the family-qualified key: record ids repeat across tables.
      const purchase = list.find((row) => row.key === `purchase-${seeded.cornerShop}`);
      assert.equal(purchase?.source, 'Corner Shop');
      assert.equal(purchase?.category, 'Groceries / Weekly Shop (household)');
      assert.equal(purchase?.note, 'Weekly shop');
      assert.equal(purchase?.amountPence, 1200);
      assert.equal(purchase?.extraLines, 0);

      // A split shows its first line and how many more are behind the link.
      const split = list.find((row) => row.key === `purchase-${seeded.splitPurchase}`);
      assert.equal(split?.extraLines, 1);
      assert.equal(split?.category, 'Groceries / Weekly Shop (household)');
      assert.equal(split?.amountPence, 6347);

      // DD and SO stay distinct, and both link back to their schedule.
      assert.equal(byCode('DD')?.source, 'EnergyCo');
      assert.equal(byCode('DD')?.amountPence, seeded.energyAmountPence);
      assert.equal(byCode('DD')?.secondaryLink?.href, `/recurring#schedule-${seeded.ddScheduleId}`);
      assert.equal(byCode('SO')?.secondaryLink?.href, `/recurring#schedule-${seeded.soScheduleId}`);
      // A standing order with no supplier falls back to the schedule's name.
      assert.equal(byCode('SO')?.source, 'Phone plan');

      // Boundary money carries its counterparty; a loan names the debt.
      assert.equal(byCode('LN<')?.source, 'Parents');
      assert.equal(byCode('TX<')?.source, 'Acme Windows');
      assert.equal(byCode('TX<')?.note, 'Window refund');
      assert.equal(byCode('SW>')?.badge, "swap (paired, £50.00 with Alex's cash)");
      assert.equal(byCode('SW>')?.secondaryLink?.href, '/pots#swaps');

      // Internal transfers name the other pot, not a counterparty.
      assert.equal(byCode('TX>')?.source, "Alex's cash");
      assert.equal(byCode('TX>')?.note, 'Son wages');

      // Income (BAC): a one-off shows its typed source; a converted receipt
      // shows its schedule's name and links to the schedule that produced it.
      const oneOff = list.find((row) => row.key === `receipt-${seeded.oneOffReceiptId}`);
      assert.equal(oneOff?.code, 'BAC');
      assert.equal(oneOff?.source, 'Sale of bicycle');
      assert.equal(oneOff?.note, 'Collected in cash');
      assert.equal(oneOff?.direction, 'in');
      assert.equal(oneOff?.amountPence, 4500);
      assert.equal(oneOff?.secondaryLink, null);
      const converted = list.find((row) => row.key === `receipt-${seeded.salaryReceiptId}`);
      assert.equal(converted?.code, 'BAC');
      assert.equal(converted?.source, 'Salary');
      assert.equal(converted?.amountPence, 245000);
      assert.equal(
        converted?.secondaryLink?.href,
        `/recurring#schedule-${seeded.salaryScheduleId}`,
      );

      // Every row links to the canonical form that owns edit/void.
      for (const row of list) {
        if (row.family === 'purchase') {
          assert.match(row.link.href, new RegExp(`^/purchases\\?.*#purchase-${row.recordId}$`));
        } else if (row.family === 'transfer') {
          assert.equal(row.link.href, `/pots?transfer=${row.recordId}#transfer-${row.recordId}`);
        } else if (row.family === 'receipt') {
          assert.equal(row.link.href, `/income?receipt=${row.recordId}#receipt-${row.recordId}`);
        } else {
          assert.equal(row.link.href, `/pots?external=${row.recordId}#external-${row.recordId}`);
        }
      }
    } finally {
      seeded.fx.close();
    }
  });

  it('renders income (BAC) and excludes voided records and anything outside the window', async () => {
    const seeded = await seedActivity();
    try {
      const view = listPotActivity(seeded.fx.db, {
        potId: seeded.fx.pots.main.id,
        ...WINDOW,
      });
      const list = rows(view);
      const keys = list.map((row) => row.key);

      assert.equal(keys.includes(`purchase-${seeded.voidedPurchaseId}`), false, 'voided purchase');
      assert.equal(keys.includes(`transfer-${seeded.voidedTransferId}`), false, 'voided transfer');
      assert.equal(keys.includes(`receipt-${seeded.voidedReceiptId}`), false, 'voided income');
      assert.equal(keys.includes(`purchase-${seeded.outsidePurchaseId}`), false, 'out of window');
      // Income renders as BAC (v0.4.0, plan decision 109): the one-off sale
      // and the converted salary both appear, and both are inside the total.
      assert.deepEqual(
        list.filter((row) => row.code === 'BAC').map((row) => row.source),
        ['Sale of bicycle', 'Salary'],
      );
      assert.equal(view.totals.rowCount, 12);
      assert.equal(view.totals.inPence, 365000);
    } finally {
      seeded.fx.close();
    }
  });

  it('scopes to the selected pot: one transfer is red on one side and green on the other', async () => {
    const seeded = await seedActivity();
    try {
      const cash = listPotActivity(seeded.fx.db, {
        potId: seeded.fx.pots.alexCash.id,
        ...WINDOW,
      });
      const cashRows = rows(cash);
      assert.deepEqual(
        cashRows.map((row) => `${row.code} ${row.direction} ${row.source}`),
        ['SW< in Son', 'TX< in Main account'],
      );
      assert.equal(cashRows[1]?.key, `transfer-${seeded.transferId}`);
      assert.equal(cash.totals.inPence, 13000);
      assert.equal(cash.totals.outPence, 0);

      // Sam's cash holds nothing live in the window: its only transfer is voided.
      const sam = listPotActivity(seeded.fx.db, { potId: seeded.fx.pots.samCash.id, ...WINDOW });
      assert.equal(rows(sam).length, 0);
      assert.equal(sam.totals.rowCount, 0);
    } finally {
      seeded.fx.close();
    }
  });

  it('renders checkpoints as dividers below their own date, excluded from the totals', async () => {
    const seeded = await seedActivity();
    try {
      const view = listPotActivity(seeded.fx.db, {
        potId: seeded.fx.pots.main.id,
        ...WINDOW,
      });
      const dividerIndex = view.entries.findIndex((entry) => entry.kind === 'checkpoint');
      assert.notEqual(dividerIndex, -1, 'no checkpoint divider rendered');
      const divider = view.entries[dividerIndex];
      assert.equal(divider?.kind, 'checkpoint');
      if (divider?.kind !== 'checkpoint') throw new Error('unreachable');
      assert.equal(divider.checkpoint.date, '2026-09-22');
      assert.equal(divider.checkpoint.amountPence, 100000);
      assert.equal(divider.checkpoint.note, 'Friday evening check');

      // Below that day's rows, above the previous day's.
      const above = view.entries[dividerIndex - 1];
      const below = view.entries[dividerIndex + 1];
      assert.equal(above?.kind, 'row');
      if (above?.kind !== 'row') throw new Error('unreachable');
      assert.equal(above.row.date, '2026-09-22');
      if (below?.kind !== 'row') throw new Error('unreachable');
      assert.equal(below.row.date, '2026-09-21');

      // The reported figure never enters "movements shown".
      assert.equal(view.totals.inPence, 365000);
      assert.equal(view.totals.outPence, 30652);

      // Outside the window, the divider is not rendered at all.
      const later = listPotActivity(seeded.fx.db, {
        potId: seeded.fx.pots.main.id,
        dateFrom: '2026-09-23',
        dateTo: '2026-09-30',
      });
      assert.equal(
        later.entries.some((entry) => entry.kind === 'checkpoint'),
        false,
      );
    } finally {
      seeded.fx.close();
    }
  });

  it('honours the window edges, the row cap and rejects a broken range', async () => {
    const seeded = await seedActivity();
    try {
      const db = seeded.fx.db;
      const potId = seeded.fx.pots.main.id;

      // Both edges inclusive: the 21st alone.
      const oneDay = listPotActivity(db, { potId, dateFrom: '2026-09-21', dateTo: '2026-09-21' });
      assert.equal(rows(oneDay).length, 1);
      assert.equal(rows(oneDay)[0]?.key, `purchase-${seeded.cornerShop}`);

      // Cap: the page must say how many rows it hid.
      const capped = listPotActivity(db, { potId, ...WINDOW, limit: 3 });
      assert.equal(capped.totals.rowCount, 3);
      assert.equal(capped.totals.hiddenRowCount, 9);
      // The total describes only what is shown: the three newest rows are
      // the 28th's credit, the 27th's one-off income and the SO.
      assert.equal(capped.totals.outPence, 1200);
      assert.equal(capped.totals.inPence, 15000 + 4500);

      assert.throws(
        () => listPotActivity(db, { potId, dateFrom: '2026-09-30', dateTo: '2026-09-20' }),
        InvalidActivityInputError,
      );
      assert.throws(
        () => listPotActivity(db, { potId, dateFrom: 'yesterday', dateTo: '2026-09-20' }),
        InvalidActivityInputError,
      );
    } finally {
      seeded.fx.close();
    }
  });

  it('reports an honest swap badge when the pair stops balancing', async () => {
    const seeded = await seedActivity();
    try {
      const db = seeded.fx.db;
      const outLeg = rows(listPotActivity(db, { potId: seeded.fx.pots.main.id, ...WINDOW })).find(
        (row) => row.code === 'SW>',
      );
      assert.ok(outLeg);
      voidExternalMovement(db, {
        id: outLeg.recordId,
        expectedVersion: 1,
        reason: 'The cash never arrived',
        actor: ACTOR,
        now: new Date('2026-09-29T12:00:00Z'),
      });

      // The surviving leg says so, rather than implying a balanced pair.
      const cashRows = rows(listPotActivity(db, { potId: seeded.fx.pots.alexCash.id, ...WINDOW }));
      assert.equal(cashRows.find((row) => row.code === 'SW<')?.badge, 'swap · other leg voided');
      assert.equal(seeded.swapExchangeKey.length > 0, true);
    } finally {
      seeded.fx.close();
    }
  });

  it('cannot strand history: a pot with records refuses to archive', async () => {
    const seeded = await seedActivity();
    try {
      const db = seeded.fx.db;
      const samCash = seeded.fx.pots.samCash;
      createPurchase(db, {
        supplierName: 'Corner Cafe',
        potId: samCash.id,
        totalPence: 349,
        occurredDate: '2026-09-21',
        lines: [
          {
            amountPence: 349,
            categoryId: seeded.fx.categoryId('Groceries', 'Weekly Shop'),
            targetKind: 'household',
          },
        ],
        actor: ACTOR,
        now: new Date('2026-09-21T12:00:00Z'),
      });

      // The rule that makes "live pots only" safe as the target selector:
      // a pot with any history cannot be archived at all (SPEC §4).
      assert.throws(
        () =>
          archivePot(db, {
            id: samCash.id,
            expectedVersion: samCash.version,
            actor: ACTOR,
            now: new Date('2026-09-29T12:00:00Z'),
          }),
        /has records against it/,
      );

      // An empty pot can be archived; its activity view is then empty by
      // construction, so offering only live pots hides nothing.
      const empty = createPot(db, {
        label: 'Old joint account',
        kind: 'bank',
        actor: ACTOR,
        now: new Date('2026-09-20T12:00:00Z'),
      });
      archivePot(db, {
        id: empty.id,
        expectedVersion: empty.version,
        actor: ACTOR,
        now: new Date('2026-09-29T12:00:00Z'),
      });
      assert.equal(
        listPots(db).some((pot) => pot.id === empty.id),
        false,
        'archived pot still offered as a target',
      );
      assert.equal(
        listPotsIncludingArchived(db).some((pot) => pot.id === empty.id),
        true,
        'archived pot unnameable by the projection',
      );
      assert.equal(rows(listPotActivity(db, { potId: empty.id, ...WINDOW })).length, 0);
    } finally {
      seeded.fx.close();
    }
  });
});

/**
 * Expected support on All Transactions (SPEC §15.3, v0.7.0): a debt's
 * expectation appears from its due date — flagged, linked to the loan panel
 * and deliberately outside the totals — and gives way to the real borrowing
 * the moment it is recorded. It is a plan, never a movement.
 */
describe('All Transactions: expected support (v0.7.0)', () => {
  const now = new Date('2026-09-24T19:30:00+01:00');

  /** A brand-new £1,000-on-the-10th borrowing expectation, until 10 Feb 2027. */
  async function seedExpectation() {
    const fx = await createHouseholdFixture(ACTOR, now);
    const debt = createDebt(fx.db, {
      counterparty: 'Mum',
      direction: 'we_owe',
      note: 'Bridging loan',
      actor: ACTOR,
      now,
    });
    const edited = editDebt(fx.db, {
      id: debt.id,
      expectedVersion: 1,
      actor: ACTOR,
      now,
      patch: {
        expectedInflow: { amountPence: 100000, dayOfMonth: 10, untilDate: '2027-02-10' },
      },
    });
    return { fx, debt: edited };
  }

  const view = (fx: HouseholdFixture, potId: number, dateFrom: string, dateTo: string) =>
    listPotActivity(fx.db, { potId, dateFrom, dateTo });

  it('appears from its due date, flagged, and stays out of the totals', async () => {
    const { fx, debt } = await seedExpectation();
    try {
      // Nothing before the plan existed: the expectation was set on 24
      // September, so September's own 10th — already past and never planned —
      // is not rewritten as an expected row. The page shows history.
      const september = view(fx, fx.pots.main.id, '2026-09-01', '2026-09-30');
      assert.deepEqual(rows(september), []);
      assert.equal(september.totals.expectedRowCount, 0);

      // From the due date: one row, dated the Friday the money is expected
      // (Saturday 10 October → Friday 9 October, decision 7).
      const october = view(fx, fx.pots.main.id, '2026-10-01', '2026-10-31');
      const expected = rows(october);
      assert.equal(expected.length, 1);
      assert.equal(expected[0]?.code, 'EXP<');
      assert.equal(expected[0]?.family, 'expected');
      assert.equal(expected[0]?.date, '2026-10-09');
      assert.equal(expected[0]?.direction, 'in');
      assert.equal(expected[0]?.source, 'Mum');
      assert.equal(expected[0]?.amountPence, 100000);
      assert.equal(expected[0]?.note, 'Bridging loan');
      assert.equal(expected[0]?.badge, 'expected — not recorded yet');
      assert.equal(expected[0]?.link.href, `/pots#debt-${debt.id}`);
      // Not a movement: the recorded totals stay empty, and the expectation
      // is reported separately so the page can say exactly what it excludes.
      assert.equal(october.totals.rowCount, 0);
      assert.equal(october.totals.inPence, 0);
      assert.equal(october.totals.outPence, 0);
      assert.equal(october.totals.expectedRowCount, 1);
      assert.equal(october.totals.expectedInPence, 100000);

      // The arrangement ends on its until date: nothing from March onwards.
      const march = view(fx, fx.pots.main.id, '2027-03-01', '2027-03-31');
      assert.deepEqual(rows(march), []);
      assert.equal(march.totals.expectedRowCount, 0);
    } finally {
      fx.close();
    }
  });

  it('gives way to the recorded borrowing, leaving the real LN< row', async () => {
    const { fx, debt } = await seedExpectation();
    try {
      // The money arrives on the Saturday and is recorded that day.
      createExternalMovement(fx.db, {
        potId: fx.pots.main.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 100000,
        debtId: debt.id,
        occurredDate: '2026-10-10',
        note: 'October support',
        actor: ACTOR,
        now: new Date('2026-10-10T12:00:00+01:00'),
      });
      const october = view(fx, fx.pots.main.id, '2026-10-01', '2026-10-31');
      const list = rows(october);
      assert.equal(list.length, 1);
      assert.equal(list[0]?.code, 'LN<');
      assert.equal(list[0]?.source, 'Mum');
      assert.equal(list[0]?.amountPence, 100000);
      assert.equal(list[0]?.direction, 'in');
      // The expectation is gone, and the real record is counted.
      assert.equal(october.totals.expectedRowCount, 0);
      assert.equal(october.totals.inPence, 100000);
      assert.equal(october.totals.rowCount, 1);
      // November's expectation is untouched — that month has not happened.
      const november = view(fx, fx.pots.main.id, '2026-11-01', '2026-11-30');
      assert.deepEqual(
        rows(november).map((row) => row.code),
        ['EXP<'],
      );
    } finally {
      fx.close();
    }
  });

  it('is scoped to the pot the money travels through', async () => {
    const { fx, debt } = await seedExpectation();
    try {
      // Nothing borrowed yet: the expectation uses the household's default
      // pot, so it shows on Main and not on a cash pot.
      assert.equal(rows(view(fx, fx.pots.main.id, '2026-10-01', '2026-10-31')).length, 1);
      assert.deepEqual(rows(view(fx, fx.pots.alexCash.id, '2026-10-01', '2026-10-31')), []);

      // Once money has actually travelled through Alex's cash, the
      // expectation follows it — the two layers describe the same money.
      createExternalMovement(fx.db, {
        potId: fx.pots.alexCash.id,
        direction: 'in',
        kind: 'loan',
        amountPence: 5000,
        debtId: debt.id,
        occurredDate: '2026-09-15',
        actor: ACTOR,
        now: new Date('2026-09-15T12:00:00+01:00'),
      });
      assert.deepEqual(rows(view(fx, fx.pots.main.id, '2026-10-01', '2026-10-31')), []);
      assert.deepEqual(
        rows(view(fx, fx.pots.alexCash.id, '2026-10-01', '2026-10-31')).map((row) => row.code),
        ['EXP<'],
      );
    } finally {
      fx.close();
    }
  });
});
