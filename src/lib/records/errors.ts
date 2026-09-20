/**
 * Shared errors for money-record domain modules (src/lib/records/*).
 *
 * Every correctable record carries a version counter (blueprint §3): edits
 * and voids must present the version the user saw, and a stale form fails
 * visibly instead of silently overwriting another user's work.
 */
export class VersionConflictError extends Error {
  readonly entity: string;
  readonly entityId: number;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(entity: string, entityId: number, expectedVersion: number, actualVersion: number) {
    super(
      `That ${entity} was changed by someone else (you saw version ${expectedVersion}, ` +
        `it is now version ${actualVersion}). Refresh and try again — nothing was saved.`,
    );
    this.name = 'VersionConflictError';
    this.entity = entity;
    this.entityId = entityId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/** Voiding a record that is already voided — explicit, never a silent no-op. */
export class AlreadyVoidError extends Error {
  readonly entity: string;
  readonly entityId: number;

  constructor(entity: string, entityId: number) {
    super(`That ${entity} is already voided.`);
    this.name = 'AlreadyVoidError';
    this.entity = entity;
    this.entityId = entityId;
  }
}

/** Editing a voided record — voided history stays frozen; create anew instead. */
export class RecordVoidedError extends Error {
  readonly entity: string;
  readonly entityId: number;

  constructor(entity: string, entityId: number) {
    super(`That ${entity} is voided and can no longer be edited.`);
    this.name = 'RecordVoidedError';
    this.entity = entity;
    this.entityId = entityId;
  }
}
