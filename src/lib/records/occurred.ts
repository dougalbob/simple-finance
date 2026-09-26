import { endOfLocalDate, isValidLocalDate, toLocalDateString } from '../time';

/**
 * When a money record happened (SPEC §9.1): every purchase and transfer
 * carries both an instant (occurred_at, for checkpoint comparison) and the
 * local calendar date it belongs to (occurred_date, backdatable, never in
 * the future). Mobile entry stamps now; a bare date takes effect at the end
 * of that local date — the same rule as date-only checkpoints (SPEC §5).
 * Against a same-day timed checkpoint the tie-break is sign-aware (SPEC
 * §7.1): date-only debits count as after; a date-only credit counts only
 * when it was recorded after the checkpoint, otherwise it is absorbed.
 */

export class InvalidOccurredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOccurredError';
  }
}

export interface OccurredInput {
  occurredAt?: Date;
  occurredDate?: string;
  now?: Date;
}

export interface ResolvedOccurred {
  occurredAt: Date;
  occurredDate: string;
}

export function resolveOccurred(input: OccurredInput): ResolvedOccurred {
  const now = input.now ?? new Date();
  const today = toLocalDateString(now);

  if (input.occurredAt !== undefined && input.occurredDate !== undefined) {
    const occurredDate = checkedDate(input.occurredDate, today);
    const occurredAt = checkedInstant(input.occurredAt, now);
    const dateOfInstant = toLocalDateString(occurredAt);
    if (dateOfInstant !== occurredDate) {
      throw new InvalidOccurredError(
        `The date ${occurredDate} does not match the time given (that time falls on ${dateOfInstant}).`,
      );
    }
    return { occurredAt, occurredDate };
  }
  if (input.occurredDate !== undefined) {
    const occurredDate = checkedDate(input.occurredDate, today);
    return { occurredAt: endOfLocalDate(occurredDate), occurredDate };
  }
  if (input.occurredAt !== undefined) {
    const occurredAt = checkedInstant(input.occurredAt, now);
    return { occurredAt, occurredDate: toLocalDateString(occurredAt) };
  }
  return { occurredAt: now, occurredDate: today };
}

function checkedDate(raw: string, today: string): string {
  if (!isValidLocalDate(raw)) {
    throw new InvalidOccurredError(
      `Expected a date like ${today}, received ${JSON.stringify(raw)}.`,
    );
  }
  if (raw > today) {
    throw new InvalidOccurredError(
      `Money records cannot be dated in the future (${raw} is after today, ${today}). Expected money lives in schedules, not backdated purchases.`,
    );
  }
  return raw;
}

function checkedInstant(raw: Date, now: Date): Date {
  if (!(raw instanceof Date) || Number.isNaN(raw.getTime())) {
    throw new InvalidOccurredError('Expected a valid time for when the money moved.');
  }
  if (raw.getTime() > now.getTime()) {
    throw new InvalidOccurredError('Money records cannot be timed in the future.');
  }
  return raw;
}
