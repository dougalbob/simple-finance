import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkpointEntrySchema,
  debtEntrySchema,
  editExternalMovementEntrySchema,
  externalMovementEntrySchema,
  fuelEntrySchema,
  purchaseEntrySchema,
  swapEntrySchema,
  voidSwapEntrySchema,
} from '../src/lib/validation';

describe('Phase 2b entry boundary schemas', () => {
  it('accepts a parsed mixed purchase payload with integer-pence lines', () => {
    const result = purchaseEntrySchema.safeParse({
      supplierName: 'Tesco',
      potId: 1,
      totalPence: 6347,
      paidByPersonId: 2,
      occurredDate: '2026-09-27',
      note: null,
      lines: [
        { amountPence: 4198, categoryId: 10, targetKind: 'household', targetId: null },
        { amountPence: 2149, categoryId: 20, targetKind: 'person', targetId: 2 },
      ],
    });
    assert.equal(result.success, true);
  });

  it('rejects a personal or vehicle line without its target', () => {
    const result = purchaseEntrySchema.safeParse({
      supplierName: null,
      potId: 1,
      totalPence: 100,
      paidByPersonId: 1,
      occurredDate: null,
      note: null,
      lines: [{ amountPence: 100, categoryId: 10, targetKind: 'vehicle', targetId: null }],
    });
    assert.equal(result.success, false);
  });

  it('keeps fuel positive and requires a vehicle id', () => {
    assert.equal(
      fuelEntrySchema.safeParse({
        supplierName: 'Petrol Station',
        potId: 1,
        vehicleId: 3,
        paidByPersonId: 2,
        amountPence: 5820,
        occurredDate: null,
        note: null,
      }).success,
      true,
    );
    assert.equal(
      fuelEntrySchema.safeParse({
        supplierName: null,
        potId: 1,
        vehicleId: null,
        paidByPersonId: 2,
        amountPence: 5820,
        occurredDate: null,
        note: null,
      }).success,
      false,
    );
  });

  it('accepts a negative checkpoint balance and rejects impossible dates', () => {
    assert.equal(
      checkpointEntrySchema.safeParse({
        potId: 1,
        amountPence: -1250,
        effectiveDate: '2026-09-20',
        note: null,
      }).success,
      true,
    );
    assert.equal(
      checkpointEntrySchema.safeParse({
        potId: 1,
        amountPence: 1250,
        effectiveDate: '2026-02-30',
        note: null,
      }).success,
      false,
    );
  });
});

describe('external money boundary schemas (SPEC §10.2)', () => {
  it('accepts borrowing linked to a debt and rejects it without one', () => {
    const base = {
      potId: 1,
      direction: 'in',
      kind: 'loan',
      amountPence: 100000,
      debtId: 2,
      counterparty: null,
      occurredDate: '2026-09-20',
      note: null,
    };
    assert.equal(externalMovementEntrySchema.safeParse(base).success, true);
    assert.equal(externalMovementEntrySchema.safeParse({ ...base, debtId: null }).success, false);
  });

  it('requires a counterparty and a note for other money', () => {
    const base = {
      potId: 1,
      direction: 'out',
      kind: 'other',
      amountPence: 500,
      debtId: null,
      counterparty: 'neighbour',
      occurredDate: '2026-09-20',
      note: 'chipped in for the fence',
    };
    assert.equal(externalMovementEntrySchema.safeParse(base).success, true);
    assert.equal(externalMovementEntrySchema.safeParse({ ...base, note: null }).success, false);
    assert.equal(
      externalMovementEntrySchema.safeParse({ ...base, counterparty: null }).success,
      false,
    );
  });

  it('accepts a swap between two pots with a named counterparty', () => {
    assert.equal(
      swapEntrySchema.safeParse({
        inPotId: 3,
        outPotId: 1,
        amountPence: 12000,
        counterparty: 'our son',
        occurredDate: '2026-09-20',
        note: null,
      }).success,
      true,
    );
    assert.equal(
      swapEntrySchema.safeParse({
        inPotId: 3,
        outPotId: 1,
        amountPence: 12000,
        counterparty: '',
        occurredDate: '2026-09-20',
        note: null,
      }).success,
      false,
    );
  });

  it('accepts a debt in either direction and rejects an empty name', () => {
    assert.equal(
      debtEntrySchema.safeParse({ counterparty: 'Mum', direction: 'we_owe', note: null }).success,
      true,
    );
    assert.equal(
      debtEntrySchema.safeParse({ counterparty: '  ', direction: 'they_owe', note: null }).success,
      false,
    );
  });

  it('edit: nullable patch fields with null defaults; identity fields required', () => {
    assert.equal(
      editExternalMovementEntrySchema.safeParse({ movementId: 7, expectedVersion: 1 }).success,
      true,
    );
    assert.equal(
      editExternalMovementEntrySchema.safeParse({ movementId: 7, expectedVersion: 0 }).success,
      false,
    );
    assert.equal(
      editExternalMovementEntrySchema.safeParse({
        movementId: 7,
        expectedVersion: 1,
        amountPence: 0,
      }).success,
      false,
    );
    // Counterparty is trimmed and capped; note nulls an existing note.
    const parsed = editExternalMovementEntrySchema.safeParse({
      movementId: 7,
      expectedVersion: 1,
      counterparty: '  Mum  ',
      note: null,
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.counterparty, 'Mum');
      assert.equal(parsed.data.note, null);
    }
  });

  it('voidSwap: requires both legs, versions and a non-empty exchange key', () => {
    assert.equal(
      voidSwapEntrySchema.safeParse({
        exchangeKey: 'abc123',
        inLegId: 1,
        outLegId: 2,
        inLegVersion: 1,
        outLegVersion: 1,
        reason: 'the swap never happened',
      }).success,
      true,
    );
    assert.equal(
      voidSwapEntrySchema.safeParse({
        exchangeKey: '  ',
        inLegId: 1,
        outLegId: 2,
        inLegVersion: 1,
        outLegVersion: 1,
      }).success,
      false,
    );
    assert.equal(
      voidSwapEntrySchema.safeParse({
        exchangeKey: 'abc123',
        inLegId: 1,
        outLegId: 2,
        inLegVersion: 0,
        outLegVersion: 1,
      }).success,
      false,
    );
  });
});
