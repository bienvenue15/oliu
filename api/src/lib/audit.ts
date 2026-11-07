/**
 * Audit trail — append-only. Every create, change, approval, login and export is one row.
 * The table refuses UPDATE and DELETE at database level (see the migration), so nobody,
 * including the MD, can edit history.
 */
import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db.ts';
import { publish } from './events.ts';

export interface AuditInput {
  accountId: string;
  userId?: string | null;
  companyId?: string | null;
  module: string;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

export async function audit(input: AuditInput, tx: Tx | typeof prisma = prisma) {
  await tx.auditEvent.create({
    data: {
      accountId: input.accountId,
      userId: input.userId ?? null,
      companyId: input.companyId ?? null,
      module: input.module,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: input.ip ?? '',
    },
  });
  // Open browsers of the account hear that something changed and refetch; the notice carries no data.
  publish(input.accountId, {
    module: input.module,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    companyId: input.companyId ?? null,
  });
}

/** Strip secrets before a row goes into the trail. */
export function redact<T extends Record<string, unknown>>(
  row: T,
): Omit<T, 'passwordHash' | 'codeHash' | 'tokenHash'> {
  const { passwordHash: _p, codeHash: _c, tokenHash: _t, ...rest } = row as Record<string, unknown>;
  return rest as Omit<T, 'passwordHash' | 'codeHash' | 'tokenHash'>;
}
