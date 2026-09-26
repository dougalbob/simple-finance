import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  estimatePot,
  householdEstimatePence,
  isRecordDateOnly,
  recordIsAfterCheckpoint,
  type CheckpointFacts,
  type PotEstimateInput,
  type SignedMovement,
} from '../src/lib/records/estimates';
import { endOfLocalDate } from '../src/lib/time';

/**
 * The estimate engine (docs/SPEC.md §7.1) including the comparison-
 * precision rule and scenario E5's assume-cleared behaviour.
 *
 * E5: Saturday the 21st 16:00 Sam buys £45.99 (Main). Sunday the 22nd
 * 17:00 Alex checkpoints Main at £412.35 — the bank ledger does NOT yet
 * include the pending purchase, but the app assumes it is included and
 * reports £412.35 (overstating until the purchase clears). Here the
 * purchase is timestamped *before* the checkpoint, so it is not
 * subtracted — the same arithmetic the E5 honesty walkthrough describes.
 */

const CHECKPOINT = new Date('2026-09-22T17:00:00+01:00'); // Sunday the 22nd, 17:00

const p = (value: number) => Math.round(value * 100);

function movement(
  pence: number,
  occurredAt: Date,
  occurredDate: string,
  enteredAt?: Date,
): SignedMovement {
  return {
    signedPence: pence,
    occurredAt,
    occurredDate,
    ...(enteredAt === undefined ? {} : { enteredAt }),
  };
}

describe('estimate: comparison precision (SPEC §7.1)', () => {
  const checkpoint: CheckpointFacts = { amountPence: p(100), effectiveAt: CHECKPOINT };

  it('timed records compare by instant: before the checkpoint excluded, after included', () => {
    const before = movement(-p(45.99), new Date('2026-09-21T16:00:00+01:00'), '2026-09-21');
    const after = movement(-p(20), new Date('2026-09-22T17:30:00+01:00'), '2026-09-22');
    const atCheckpointInstant = movement(-p(5), CHECKPOINT, '2026-09-22');
    assert.equal(recordIsAfterCheckpoint(before, checkpoint), false);
    assert.equal(recordIsAfterCheckpoint(after, checkpoint), true);
    // Strictly after: a record at the exact checkpoint instant is part of the
    // reported balance (the checkpoint was taken at that moment).
    assert.equal(recordIsAfterCheckpoint(atCheckpointInstant, checkpoint), false);
  });

  it('a date-only DEBIT sharing the checkpoint date counts as after (conservative)', () => {
    const sameDay = movement(-p(10), endOfLocalDate('2026-09-22'), '2026-09-22');
    assert.equal(isRecordDateOnly(sameDay), true);
    assert.equal(recordIsAfterCheckpoint(sameDay, checkpoint), true);
    const previousDay = movement(-p(10), endOfLocalDate('2026-09-21'), '2026-09-21');
    assert.equal(recordIsAfterCheckpoint(previousDay, checkpoint), false);
  });

  it('a date-only CREDIT sharing the checkpoint date is absorbed when entry order is unknown', () => {
    // No enteredAt: the order within the day is unknown. Absorbing is the
    // safe direction — counting it would overstate (the pre-v0.2.1
    // double-count, E13).
    const sameDayCredit = movement(p(80), endOfLocalDate('2026-09-22'), '2026-09-22');
    assert.equal(recordIsAfterCheckpoint(sameDayCredit, checkpoint), false);
    // A credit on a LATER date still counts — the checkpoint cannot include it.
    const laterCredit = movement(p(80), endOfLocalDate('2026-09-23'), '2026-09-23');
    assert.equal(recordIsAfterCheckpoint(laterCredit, checkpoint), true);
    // …and a credit on an earlier date is inside the checkpoint.
    const earlierCredit = movement(p(80), endOfLocalDate('2026-09-21'), '2026-09-21');
    assert.equal(recordIsAfterCheckpoint(earlierCredit, checkpoint), false);
  });

  it('a date-only CREDIT recorded after the checkpoint counts; one recorded before is absorbed', () => {
    const recordedBefore = movement(
      p(80),
      endOfLocalDate('2026-09-22'),
      '2026-09-22',
      new Date('2026-09-22T09:00:00+01:00'),
    );
    const recordedAfter = movement(
      p(1500),
      endOfLocalDate('2026-09-22'),
      '2026-09-22',
      new Date('2026-09-22T18:00:00+01:00'),
    );
    const reported = { ...checkpoint, enteredAt: new Date('2026-09-22T12:00:00+01:00') };
    // Written down before the count: already inside the reported figure (E13).
    assert.equal(recordIsAfterCheckpoint(recordedBefore, reported), false);
    // Written down after the count: cannot already be inside it.
    assert.equal(recordIsAfterCheckpoint(recordedAfter, reported), true);
    // Equal entry instants are not strictly after — treat as already counted.
    const recordedAtTheSameInstant = movement(
      p(80),
      endOfLocalDate('2026-09-22'),
      '2026-09-22',
      reported.enteredAt,
    );
    assert.equal(recordIsAfterCheckpoint(recordedAtTheSameInstant, reported), false);
  });

  it('a timed record on the checkpoint date before the checkpoint time is excluded', () => {
    const morning = movement(-p(10), new Date('2026-09-22T09:00:00+01:00'), '2026-09-22');
    assert.equal(recordIsAfterCheckpoint(morning, checkpoint), false);
  });
});

describe('estimate: per-pot and household totals', () => {
  it('E5: checkpoint + pre-checkpoint pending purchase → estimate equals the checkpoint', () => {
    const input: PotEstimateInput = {
      potId: 1,
      checkpoint: { amountPence: p(412.35), effectiveAt: CHECKPOINT },
      movements: [
        // Saturday 21st 16:00 — before the checkpoint instant → assumed cleared.
        movement(-p(45.99), new Date('2026-09-21T16:00:00+01:00'), '2026-09-21'),
      ],
    };
    const result = estimatePot(input);
    assert.equal(result.estimatePence, p(412.35));
    assert.equal(result.countedMovements, 0);
  });

  it('a purchase after the checkpoint is subtracted; a refund adds back', () => {
    const input: PotEstimateInput = {
      potId: 1,
      checkpoint: { amountPence: p(412.35), effectiveAt: CHECKPOINT },
      movements: [
        movement(-p(63.47), new Date('2026-09-27T14:10:00+01:00'), '2026-09-27'),
        // Refund of the same purchase: negative total → signed = +63.47.
        movement(p(63.47), new Date('2026-09-27T15:00:00+01:00'), '2026-09-27'),
      ],
    };
    const result = estimatePot(input);
    assert.equal(result.estimatePence, p(412.35));
    assert.equal(result.countedMovements, 2);
  });

  it('transfers: two legs move value between pots, the household total is unchanged', () => {
    const main: PotEstimateInput = {
      potId: 1,
      checkpoint: { amountPence: p(100), effectiveAt: CHECKPOINT },
      movements: [
        movement(p(400), new Date('2026-09-25T10:00:00+01:00'), '2026-09-25'), // in
      ],
    };
    const salary: PotEstimateInput = {
      potId: 2,
      checkpoint: { amountPence: p(900), effectiveAt: CHECKPOINT },
      movements: [
        movement(-p(400), new Date('2026-09-25T10:00:00+01:00'), '2026-09-25'), // out
      ],
    };
    const results = [estimatePot(main), estimatePot(salary)];
    assert.equal(results[0]?.estimatePence, p(500));
    assert.equal(results[1]?.estimatePence, p(500));
    assert.equal(householdEstimatePence(results), p(1000));
  });

  it('receipts add to the estimate (income, SPEC §11.3)', () => {
    const input: PotEstimateInput = {
      potId: 2,
      checkpoint: { amountPence: p(520), effectiveAt: CHECKPOINT },
      movements: [movement(p(2150), new Date('2026-10-26T00:00:00+01:00'), '2026-10-26')],
    };
    const result = estimatePot(input);
    assert.equal(result.estimatePence, p(2670));
  });

  it('a pot with no checkpoint has no estimate, ever', () => {
    const input: PotEstimateInput = {
      potId: 3,
      checkpoint: null,
      movements: [movement(-p(10), new Date('2026-09-25T10:00:00+01:00'), '2026-09-25')],
    };
    const result = estimatePot(input);
    assert.equal(result.estimatePence, null);
    assert.equal(householdEstimatePence([result]), null);
  });

  it('a later checkpoint absorbs the movement (E6: counted exactly once at every stage)', () => {
    // Backdated record for the 24th, entered the 25th: after the 22nd
    // checkpoint → subtracted.
    const record = movement(-p(12.5), new Date('2026-09-24T00:00:00+01:00'), '2026-09-24');
    const first = estimatePot({
      potId: 1,
      checkpoint: { amountPence: p(412.35), effectiveAt: CHECKPOINT },
      movements: [record],
    });
    assert.equal(first.estimatePence, p(412.35) - p(12.5));
    // The Wednesday-evening checkpoint now includes it → excluded.
    const second = estimatePot({
      potId: 1,
      checkpoint: { amountPence: p(400), effectiveAt: new Date('2026-09-25T18:00:00+01:00') },
      movements: [record],
    });
    assert.equal(second.estimatePence, p(400));
  });
});

/**
 * E13 — a same-day credit recorded *before* a same-day checkpoint is absorbed
 * (v0.2.1 double-count fix, refined so a credit recorded *after* the
 * checkpoint counts — SPEC §7.1). The engine-level shape of the £180 repro:
 * a cash pot checkpointed £20 on the 22nd, a date-only swap-in of £80 on the
 * 23rd, then timed checkpoints on the 23rd taken after the swap was written
 * down. Pre-v0.2.1 the second and third reads were £180 (10000 + 8000).
 */
describe('estimate: E13 same-day credit double-count (SPEC §7.1 entry-order tie-break)', () => {
  const swapEnteredAt = new Date('2026-09-23T10:00:00+01:00');
  const swapIn = movement(p(80), endOfLocalDate('2026-09-23'), '2026-09-23', swapEnteredAt);
  const run = (effectiveAt: Date) =>
    estimatePot({
      potId: 1,
      checkpoint: { amountPence: p(100), effectiveAt, enteredAt: effectiveAt },
      movements: [swapIn],
    }).estimatePence;

  it('the five-step repro reads 2000 / 10000 / 10000 / 10000 / 10000', () => {
    // Step 1: the 22nd checkpoint, before the swap, reads £20.
    const before = estimatePot({
      potId: 1,
      checkpoint: { amountPence: p(20), effectiveAt: new Date('2026-09-22T10:00:00+01:00') },
      movements: [],
    });
    assert.equal(before.estimatePence, p(20));
    // Step 2: the date-only swap-in on the 23rd counts against the 22nd
    // checkpoint (later date) → £20 + £80 = £100. Correct.
    const afterSwap = estimatePot({
      potId: 1,
      checkpoint: { amountPence: p(20), effectiveAt: new Date('2026-09-22T10:00:00+01:00') },
      movements: [swapIn],
    });
    assert.equal(afterSwap.estimatePence, p(100));
    // Step 3: timed £100 checkpoint at 23 Sept 12:00, written down after the
    // swap — the same-day credit is absorbed, not added. Pre-fix this read £180.
    assert.equal(run(new Date('2026-09-23T12:00:00+01:00')), p(100));
    // Step 4: a second same-day checkpoint cannot fix it either — pre-fix
    // still £180, because no same-day checkpoint could absorb the credit.
    assert.equal(run(new Date('2026-09-23T18:00:00+01:00')), p(100));
    // Step 5: the next-day checkpoint reads £100 — the credit is now inside
    // it (it always self-corrects by the next date, for both signs).
    assert.equal(run(new Date('2026-09-24T09:00:00+01:00')), p(100));
  });

  it('the debit mirror stays counted: same-day spending understates, safely', () => {
    const shop = movement(-p(10), endOfLocalDate('2026-09-23'), '2026-09-23');
    const result = estimatePot({
      potId: 1,
      checkpoint: { amountPence: p(100), effectiveAt: new Date('2026-09-23T12:00:00+01:00') },
      movements: [shop],
    });
    // The purchase is still subtracted even though the bank may already have
    // taken it in the £100 — understating is the safe direction (SPEC §7.1).
    assert.equal(result.estimatePence, p(90));
    assert.equal(result.countedMovements, 1);
  });

  it('a swap recorded before the checkpoint: in-leg absorbs, out-leg still counts', () => {
    const enteredAt = new Date('2026-09-23T10:00:00+01:00');
    const checkpoint = {
      amountPence: p(100),
      effectiveAt: new Date('2026-09-23T12:00:00+01:00'),
      enteredAt: new Date('2026-09-23T12:00:00+01:00'),
    };
    const inLeg = estimatePot({
      potId: 1,
      checkpoint,
      movements: [movement(p(80), endOfLocalDate('2026-09-23'), '2026-09-23', enteredAt)],
    });
    const outLeg = estimatePot({
      potId: 2,
      checkpoint,
      movements: [movement(-p(80), endOfLocalDate('2026-09-23'), '2026-09-23', enteredAt)],
    });
    // In-leg absorbed (already in the count), out-leg counted (a same-day
    // debit still understates). The household estimate reads £80 LOW until
    // the next checkpoint — the accepted cost of recording the swap first.
    assert.equal(inLeg.estimatePence, p(100));
    assert.equal(outLeg.estimatePence, p(20));
  });

  it('a transfer recorded after the checkpoint moves both pots (2026-09-26 field report)', () => {
    // Natwest checkpointed at −£443.65, then £1,500 moved in from Nationwide.
    // The inbound leg is a date-only credit on the checkpoint's own day, but
    // it was written down afterwards, so it cannot already be in the report.
    const reportedAt = new Date('2026-09-26T09:00:00+01:00');
    const movedAt = new Date('2026-09-26T11:00:00+01:00');
    const natwest = estimatePot({
      potId: 1,
      checkpoint: { amountPence: -p(443.65), effectiveAt: reportedAt, enteredAt: reportedAt },
      movements: [movement(p(1500), endOfLocalDate('2026-09-26'), '2026-09-26', movedAt)],
    });
    const nationwide = estimatePot({
      potId: 2,
      checkpoint: {
        amountPence: p(1552.44),
        effectiveAt: new Date('2026-09-20T10:00:00+01:00'),
        enteredAt: new Date('2026-09-20T10:00:00+01:00'),
      },
      movements: [movement(-p(1500), endOfLocalDate('2026-09-26'), '2026-09-26', movedAt)],
    });
    assert.equal(natwest.estimatePence, p(1056.35));
    assert.equal(natwest.countedMovements, 1);
    assert.equal(nationwide.estimatePence, p(52.44));
    // Both legs count, so the household total is unchanged by the transfer.
    assert.equal(householdEstimatePence([natwest, nationwide]), p(1056.35) + p(52.44));
  });
});
