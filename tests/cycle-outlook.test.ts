import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createHouseholdFixture, type HouseholdFixture } from './household';
import { addCheckpoint } from '../src/lib/records/pots';
import { createPurchase } from '../src/lib/records/purchases';
import { createSchedule } from '../src/lib/records/schedules';
import { buildEntryData } from '../src/lib/records/entry-view';
import {
  getCycleOutlook,
  getMoneySnapshot,
  getProjectionView,
} from '../src/lib/records/money-view';
import { setDefaultPurchasePotId, setWeeklyGroceriesPence } from '../src/lib/records/settings';

const p = (value: number) => Math.round(value * 100);
const ACTOR = 'alex@example.com';

/**
 * The cycle outlook (SPEC §7.7, v0.9.0): what is left before income lands.
 *
 * The motivating case is the household's own: a healthy checkpoint in the
 * spending account, a mortgage leaving three days before payday, and a shop
 * trip in between. The estimate says "£500 available"; the outlook says what
 * happens when the mortgage lands. These tests pin both the household figure
 * and the per-pot one, and the agreement with the projection engine (§7.2)
 * that the two surfaces cannot drift.
 */
describe('cycle outlook: what is left before income lands', () => {
  let fixture: HouseholdFixture;
  const now = new Date('2026-09-20T17:00:00Z'); // Sunday 20 September, 18:00 local

  after(() => fixture.close());

  it('counts every bill due before income, and nothing coming in', async () => {
    fixture = await createHouseholdFixture(ACTOR, now);
    const { db, pots } = fixture;

    // £500 in the spending pot, £300 parked in the salary account.
    addCheckpoint(db, { potId: pots.main.id, amountPence: p(500), actor: ACTOR, now });
    addCheckpoint(db, { potId: pots.salary.id, amountPence: p(300), actor: ACTOR, now });
    // The mortgage: £600 on the 27th, three days before the 30th's salary.
    createSchedule(db, {
      name: 'Mortgage DD',
      kind: 'dd',
      frequency: 'monthly',
      dueDayOfMonth: 27,
      amountPence: p(600),
      potId: pots.main.id,
      supplierName: 'Fictional Mortgage Co',
      categoryId: fixture.categoryId('Housing', 'Mortgage/Rent'),
      targetKind: 'household',
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now,
    });
    createSchedule(db, {
      name: 'Salary',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 30,
      amountPence: p(2150),
      potId: pots.salary.id,
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now,
    });

    const outlook = getCycleOutlook(db, now);

    assert.equal(outlook.incomeDate, '2026-09-30');
    assert.equal(outlook.incomeSource, 'Salary');
    assert.equal(outlook.days, 10);
    assert.equal(outlook.householdAvailablePence, p(800));
    assert.equal(outlook.commitmentsPence, p(600));
    assert.equal(outlook.dayToDayPence, 0);
    // The household is £200 up before the salary lands — but see the pot below.
    assert.equal(outlook.freeToSpendPence, p(200));
    assert.equal(outlook.lowDate, '2026-09-27');

    const main = outlook.pots.find((pot) => pot.potId === pots.main.id);
    assert.ok(main);
    // The spending pot itself would bounce: £500 − £600.
    assert.equal(main.estimatePence, p(500));
    assert.equal(main.spendablePence, p(-100));
    assert.equal(main.shortfallPence, p(100));
    assert.deepEqual(main.outgoing, [
      { name: 'Mortgage DD', amountPence: p(600), dueDate: '2026-09-27' },
    ]);

    const salary = outlook.pots.find((pot) => pot.potId === pots.salary.id);
    assert.ok(salary);
    assert.equal(salary.spendablePence, p(300));
    assert.equal(salary.shortfallPence, null);
  });

  it('agrees with the projection engine (the low point before payday)', () => {
    const { db } = fixture;
    const projection = getProjectionView(db, now);
    assert.ok(projection, 'the projection exists once a checkpoint and income schedule do');
    // Same window, same arithmetic: with no other receipts in the window the
    // engine's low is exactly the outlook's "free to spend".
    assert.equal(projection.result.days, getCycleOutlook(db, now).days);
    assert.equal(
      projection.result.projectedLowPence,
      getCycleOutlook(db, now).freeToSpendPence,
      'the till figure and the projection panel must not disagree',
    );
  });

  it('counts projected shops and fills household-wide, never per pot', async () => {
    const { db } = fixture;
    // A weekly shop figure with no recorded shop yet: the projection puts the
    // next one tomorrow (SPEC §7.3), inside the window.
    setWeeklyGroceriesPence(db, p(45), ACTOR, now);

    const outlook = getCycleOutlook(db, now);
    // Two shops land inside the ten-day window (tomorrow, then the 7-day
    // cadence), so the household figure carries both.
    assert.equal(outlook.dayToDayPence, p(90));
    assert.equal(outlook.freeToSpendPence, p(110)); // 800 − 600 − 90
    // Per pot the figure stays bills-only: groceries are paid from whichever
    // pot the household uses that day, so they cannot be pinned to this one.
    const main = outlook.pots.find((pot) => pot.potId === fixture.pots.main.id);
    assert.ok(main);
    assert.equal(main.spendablePence, p(-100));
  });

  it('adds recorded spending to the shortfall, not just the bills', async () => {
    const { db, pots } = fixture;
    // A checkpoint at 17:30 and spending at 17:45: the estimate (SPEC §7.1)
    // must carry the spending, and so must the shortfall.
    const checkpointAt = new Date(now.getTime() + 30 * 60 * 1000);
    const purchaseAt = new Date(now.getTime() + 45 * 60 * 1000);
    const readAt = new Date(now.getTime() + 60 * 60 * 1000);
    addCheckpoint(db, {
      potId: pots.main.id,
      amountPence: p(500),
      actor: ACTOR,
      now: checkpointAt,
    });
    createPurchase(db, {
      potId: pots.main.id,
      totalPence: p(120),
      occurredAt: purchaseAt,
      paidByPersonId: fixture.people.alex.id,
      supplierName: 'Fictional Supplies',
      actor: ACTOR,
      lines: [
        {
          amountPence: p(120),
          categoryId: fixture.categoryId('Groceries', 'Weekly Shop'),
          targetKind: 'household',
        },
      ],
      now: readAt,
    });

    const outlook = getCycleOutlook(db, readAt);
    const main = outlook.pots.find((pot) => pot.potId === pots.main.id);
    assert.ok(main);
    assert.equal(main.estimatePence, p(380)); // 500 − 120 already spent
    assert.equal(main.spendablePence, p(-220)); // 380 − 600
    assert.equal(main.shortfallPence, p(220));
  });

  it('says nothing it cannot know: no income, no window, no figure', async () => {
    const { db, pots } = await createHouseholdFixture(ACTOR, now);
    addCheckpoint(db, { potId: pots.main.id, amountPence: p(500), actor: ACTOR, now });

    const outlook = getCycleOutlook(db, now);
    assert.equal(outlook.incomeDate, null);
    assert.equal(outlook.freeToSpendPence, null);
    assert.equal(outlook.lowDate, null);
    assert.equal(outlook.commitmentsPence, 0);
    // Without a window there is no "before income lands" figure per pot
    // either — the estimate on the review pages is the honest one.
    assert.equal(outlook.pots.find((pot) => pot.potId === pots.main.id)?.spendablePence, null);

    // And with no checkpoint at all the household figure is null, not zero.
    const empty = await createHouseholdFixture(ACTOR, now);
    assert.equal(getCycleOutlook(empty.db, now).freeToSpendPence, null);
    empty.close();
  });
});

/**
 * The Quick Entry data builder (SPEC §15.1, §7.7): the pot the till form
 * starts on is the household's choice, and the two balance figures the panel
 * shows come from the same outlook the review pages use.
 */
describe('quick entry data: default pot and balance context', () => {
  let fixture: HouseholdFixture;
  const now = new Date('2026-09-20T17:00:00Z');

  after(() => fixture.close());

  it('starts on the configured pot, with both figures and no cash balance', async () => {
    fixture = await createHouseholdFixture(ACTOR, now);
    const { db, pots } = fixture;
    addCheckpoint(db, { potId: pots.main.id, amountPence: p(500), actor: ACTOR, now });
    addCheckpoint(db, { potId: pots.alexCash.id, amountPence: p(42.1), actor: ACTOR, now });
    createSchedule(db, {
      name: 'Salary',
      kind: 'receipt',
      frequency: 'monthly',
      dueDayOfMonth: 30,
      amountPence: p(2150),
      potId: pots.salary.id,
      activeFrom: '2026-09-01',
      actor: ACTOR,
      now,
    });

    // Nothing configured: the form starts with no pot, exactly as SPEC §15.1
    // asks — no guessing from a pot label.
    assert.equal(buildEntryData(db, now).defaultPotId, null);

    setDefaultPurchasePotId(db, pots.salary.id, ACTOR, now);
    const data = buildEntryData(db, now);
    assert.equal(data.defaultPotId, pots.salary.id);

    const main = data.pots.find((pot) => pot.id === pots.main.id);
    assert.ok(main);
    assert.equal(main.kind, 'bank');
    assert.equal(main.checkpoint?.amountPence, p(500));
    assert.equal(main.checkpoint?.ageLabel, 'just now');
    assert.equal(main.estimatePence, p(500));
    assert.equal(main.spendablePence, p(500)); // no bills due from it

    // Cash pots never carry a reported balance into the form: the household
    // counts the notes (SPEC §15.1).
    const cash = data.pots.find((pot) => pot.id === pots.alexCash.id);
    assert.ok(cash);
    assert.equal(cash.kind, 'cash');
    assert.equal(cash.checkpoint, null);
    assert.equal(cash.estimatePence, p(42.1));

    // The household headline rides along for the panel.
    assert.equal(data.cycle.incomeDate, '2026-09-30');
    assert.equal(data.cycle.incomeDateLabel, 'Wed 30 Sept');
    assert.equal(data.cycle.freeToSpendPence, p(542.1));
    const snapshot = getMoneySnapshot(db, now);
    assert.equal(data.cycle.householdAvailablePence, snapshot.householdAvailablePence);
  });
});
