import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkpointEntrySchema, fuelEntrySchema, purchaseEntrySchema } from '../src/lib/validation';

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
