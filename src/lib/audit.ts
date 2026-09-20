import type { Db } from './db/client';
import { auditEntries } from './db/schema';

/**
 * Transaction type handed to audit writers — same transaction as the change
 * being audited (blueprint §3).
 */
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface AuditEntryInput {
  actor: string;
  action: string;
  entity: string;
  entityId: string | number;
  summary: string;
  before?: unknown;
  after?: unknown;
  now: Date;
}

export function recordAudit(tx: DbTx, input: AuditEntryInput): void {
  tx.insert(auditEntries)
    .values({
      actor: input.actor,
      action: input.action,
      entity: input.entity,
      entityId: String(input.entityId),
      summary: input.summary,
      before: input.before === undefined ? null : JSON.stringify(input.before),
      after: input.after === undefined ? null : JSON.stringify(input.after),
      createdAt: input.now,
    })
    .run();
}
