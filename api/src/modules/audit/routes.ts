/**
 * Audit trail — read-only. GET /api/audit?module=&entity=&entityId=&limit=&before=
 * MD and Reporting Officer see the account's whole trail; a one-company user sees their company's rows
 * and account-level rows (logins, account changes).
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.ts';
import { parseBody } from '../../lib/validate.ts';
import { requireAuth, scopeOf } from '../../middleware/auth.ts';
import { canOpenScreen, type Role } from '@oliu/shared';
import { forbidden } from '../../lib/errors.ts';

export const auditRouter = Router();

const query = z.object({
  module: z.string().max(40).optional(),
  entity: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(), // id cursor, newest first
});

auditRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    if (!canOpenScreen(s.role as Role, 'aud')) throw forbidden('The audit trail is not visible to your role');
    const q = parseBody(query, req.query);
    const rows = await prisma.auditEvent.findMany({
      where: {
        accountId: s.accountId,
        ...(s.companyId ? { OR: [{ companyId: s.companyId }, { companyId: null }] } : {}),
        ...(q.module ? { module: q.module } : {}),
        ...(q.entity ? { entity: q.entity } : {}),
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.before ? { id: { lt: BigInt(q.before) } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit,
    });
    const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    res.json(rows.map((r) => ({ ...r, id: Number(r.id), userName: r.userId ? nameOf.get(r.userId) ?? '—' : 'system' })));
  } catch (e) {
    next(e);
  }
});
