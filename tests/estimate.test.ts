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

function movement(pence: number, occurredAt: Date, occurredDate: string): SignedMovement {
  return { signedPence: pence, occurredAt, occurredDate };
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

  it('a date-only record sharing the checkpoint date counts as after (conservative)', () => {
    const sameDay = movement(-p(10), endOfLocalDate('2026-09-22'), '2026-09-22');
    assert.equal(isRecordDateOnly(sameDay), true);
    assert.equal(recordIsAfterCheckpoint(sameDay, checkpoint), true);
    const previousDay = movement(-p(10), endOfLocalDate('2026-09-21'), '2026-09-21');
    assert.equal(recordIsAfterCheckpoint(previousDay, checkpoint), false);
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
