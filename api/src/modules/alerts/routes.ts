/**
 * The bell: what needs this person's attention right now, in one list. Nothing is stored — every item is read
 * from the tables that own it, scoped the way the screens are, so the bell never shows what the screen would
 * refuse. Pushed alerts (phone, digest) come with slice 9; this is the in-app count.
 *
 * GET /api/alerts  → { total, items: [{ kind, severity, count, text, to }] }
 */
import { Router } from 'express';
import {
  canOpenScreen,
  ROAD_STAGES,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from '@oliu/shared';
import { byAccount, byCompany, bySide, prisma, type Scope } from '../../db.ts';
import { requireAuth, scopeOf } from '../../middleware/auth.ts';
import { journeySettings, refreshIcdRisk } from '../journey/risk.ts';

export const alertsRouter = Router();

type Severity = 'bad' | 'warn' | 'info';
interface Alert {
  kind: string;
  severity: Severity;
  count: number;
  /** One line, already worded for the count. */
  text: string;
  /** The screen that deals with it, as a path under /app. */
  to: string;
}

const may = (s: Scope, p: Permission) => ROLE_PERMISSIONS[s.role as Role].includes(p);
const opens = (s: Scope, key: string) => canOpenScreen(s.role as Role, key);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function boxAlerts(s: Scope): Promise<Alert[]> {
  if (!opens(s, 'cont')) return [];
  const settings = await journeySettings(s.accountId);
  const boxes = await prisma.container.findMany({
    where: { ...byAccount(s), ...bySide(s), status: 'ACTIVE', closedAt: null },
    select: {
      id: true,
      accountId: true,
      number: true,
      stage: true,
      stageAt: true,
      lastSeenAt: true,
      createdAt: true,
      holdReason: true,
      icdSince: true,
      closedAt: true,
    },
  });
  const now = new Date();
  for (const b of boxes)
    if (b.stage === 'ICD') await refreshIcdRisk(prisma, b, settings.icdFreeDays, now);
  const atRisk = await prisma.riskPeriod.count({
    where: { containerId: { in: boxes.map((b) => b.id) }, to: null },
  });
  const overdue = boxes.filter((b) => {
    if (!ROAD_STAGES.includes(b.stage)) return false;
    const seen = b.lastSeenAt ?? b.stageAt ?? b.createdAt;
    return (now.getTime() - seen.getTime()) / 3_600_000 >= settings.trackingHours;
  }).length;
  const held = boxes.filter((b) => b.holdReason !== '').length;
  const out: Alert[] = [];
  if (overdue)
    out.push({
      kind: 'POSITION_OVERDUE',
      severity: 'warn',
      count: overdue,
      text: `${plural(overdue, 'box', 'boxes')} on the road with no position for ${settings.trackingHours} h or more`,
      to: '/app/cont',
    });
  if (atRisk)
    out.push({
      kind: 'AT_RISK',
      severity: 'bad',
      count: atRisk,
      text: `${plural(atRisk, 'box', 'boxes')} at risk — storage is running`,
      to: '/app/cont',
    });
  if (held)
    out.push({
      kind: 'HELD',
      severity: 'bad',
      count: held,
      text: `${plural(held, 'box is', 'boxes are')} held`,
      to: '/app/cont',
    });
  return out;
}

async function paymentAlerts(s: Scope): Promise<Alert[]> {
  const out: Alert[] = [];
  if (opens(s, 'queue') && may(s, 'approve')) {
    const n = await prisma.paymentRequest.count({
      where: { ...byCompany(s), status: 'REQUESTED', requestedById: { not: s.userId } },
    });
    if (n)
      out.push({
        kind: 'TO_APPROVE',
        severity: 'warn',
        count: n,
        text: `${plural(n, 'payment waits', 'payments wait')} for your approval`,
        to: '/app/queue',
      });
  }
  if (opens(s, 'cashier') && may(s, 'pay')) {
    const n = await prisma.paymentRequest.count({ where: { ...byCompany(s), status: 'APPROVED' } });
    if (n)
      out.push({
        kind: 'TO_PAY',
        severity: 'info',
        count: n,
        text: `${plural(n, 'approved order', 'approved orders')} to pay and lock`,
        to: '/app/cashier',
      });
  }
  if (opens(s, 'ben') && may(s, 'beneficiaries')) {
    const n = await prisma.beneficiary.count({
      where: {
        ...byAccount(s),
        OR: [
          { status: 'PENDING', createdById: { not: s.userId } },
          { pendingChange: { not: { equals: null } }, pendingById: { not: s.userId } },
        ],
      },
    });
    if (n)
      out.push({
        kind: 'BENEFICIARY_TO_CONFIRM',
        severity: 'warn',
        count: n,
        text: `${plural(n, 'beneficiary waits', 'beneficiaries wait')} for your confirmation`,
        to: '/app/ben',
      });
  }
  return out;
}

async function mdAlerts(s: Scope): Promise<Alert[]> {
  if (!opens(s, 'superq') || !may(s, 'reconcile')) return [];
  const n = await prisma.mdQueueItem.count({ where: { ...byAccount(s), status: 'OPEN' } });
  return n
    ? [
        {
          kind: 'MD_RULINGS',
          severity: 'warn',
          count: n,
          text: `${plural(n, 'ruling waits', 'rulings wait')} for you — duplicates, repeats, money from the other side`,
          to: '/app/superq',
        },
      ]
    : [];
}

alertsRouter.get('/alerts', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const items = [...(await boxAlerts(s)), ...(await paymentAlerts(s)), ...(await mdAlerts(s))];
    const rank: Record<Severity, number> = { bad: 0, warn: 1, info: 2 };
    items.sort((a, b) => rank[a.severity] - rank[b.severity]);
    res.json({ total: items.reduce((n, a) => n + a.count, 0), items });
  } catch (e) {
    next(e);
  }
});
