/**
 * Costs — cost entry and the split (roadmap slice 3).
 *
 * "What did this box cost?" Nothing is ever entered as a bare number: a cost line has a container, a
 * category, a date, a currency and the rate of its own date, copied onto the line so the USD figure can
 * always be rebuilt. One bill across several boxes is typed once and divided: equally, by weight, or by
 * hand. A line sits in the book of the company that spent the money. Totals are sums, never stored.
 *
 * GET  /api/cost-categories · POST (MD) · PATCH /:id (MD)      what money is spent on
 * GET  /api/rates?currency=&limit= · POST /api/rates (MD, Finance)   local units per US dollar, per day
 * GET  /api/rates/latest                                        the newest rate of every currency
 * GET  /api/settings · PATCH /api/settings (MD)                 the margin figure (used by slice 8)
 * POST /api/costs                                               one bill on one or more boxes of a booking
 * GET  /api/costs?month=&bookingId=&containerId=&all=           this company's lines (the MD: the switcher's)
 * PATCH /api/costs/:id · POST /api/costs/:id/void               correct the amount, or take the line out, with a reason
 * GET  /api/containers/:id/costs                                the container record: its lines and totals
 * GET  /api/bookings/:id/costs                                  totals per box of a booking
 */
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  CURRENCIES,
  costCategoryInput,
  costInput,
  costLinePatch,
  costVoidInput,
  exchangeRateInput,
  formatMoney,
  journeySettingsInput,
  paymentSettingsInput,
  settingsInput,
  splitByWeight,
  splitEqual,
  tipSettingsInput,
  toUsdCents,
  type CostInput,
  type Currency,
} from '@oliu/shared';
import {
  byAccount,
  byCompany,
  mayTouchCompany,
  prisma,
  spansAccount,
  type Scope,
  type Tx,
} from '../../db.ts';
import { audit } from '../../lib/audit.ts';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.ts';
import { parseBody } from '../../lib/validate.ts';
import { isDelayRelated, journeySettings, refreshIcdRisk } from '../journey/risk.ts';
import {
  clientIp,
  requireAuth,
  requirePermission,
  requireRole,
  requireScreen,
  scopeOf,
} from '../../middleware/auth.ts';

export const costsRouter = Router();
const MODULE = 'costs';
const canEnterCosts = [requireAuth, requireScreen('csplit'), requirePermission('write')];
const canReadRecord = [requireAuth, requireScreen('cost')];

// ---------------------------------------------------------------- helpers

function writingCompany(s: Scope): string {
  const id = s.companyId ?? s.activeCompanyId;
  if (!id) throw badRequest('Choose a company in the switcher first');
  return id;
}

async function companyNames(accountId: string): Promise<Map<string, string>> {
  const rows = await prisma.company.findMany({
    where: { accountId },
    select: { id: true, legalName: true },
    orderBy: { createdAt: 'asc' }, // the main company first; subtotals follow this order
  });
  return new Map(rows.map((r) => [r.id, r.legalName]));
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const atUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * The rate of the cost's own date: the rate typed for that day, or the most recent one before it.
 * USD needs none. No rate at all is an error the person can fix, not a silent 1.000.
 */
export async function rateFor(
  accountId: string,
  currency: Currency,
  date: Date,
): Promise<Prisma.Decimal> {
  if (currency === 'USD') return new Prisma.Decimal(1);
  const r = await prisma.exchangeRate.findFirst({
    where: { accountId, currency, date: { lte: date } },
    orderBy: { date: 'desc' },
    select: { perUsd: true },
  });
  if (!r)
    throw badRequest(
      `No ${currency} rate on or before ${day(date)}. Type the day's rate first (Settings → Configuration).`,
    );
  return r.perUsd;
}

export const lineSelect = {
  id: true,
  companyId: true,
  containerId: true,
  bookingId: true,
  categoryId: true,
  splitId: true,
  date: true,
  currency: true,
  amountMinor: true,
  perUsd: true,
  usdCents: true,
  paidTo: true,
  reference: true,
  note: true,
  status: true,
  voidReason: true,
  delayRelated: true,
  tipId: true,
  enteredById: true,
  createdAt: true,
  container: { select: { number: true, size: true } },
  category: { select: { name: true } },
  split: { select: { method: true, totalMinor: true } },
  payment: { select: { number: true, status: true } },
} satisfies Prisma.CostLineSelect;
type LineRow = Prisma.CostLineGetPayload<{ select: typeof lineSelect }>;

/** BigInt and Decimal never reach JSON raw; the screen gets numbers and ready-made strings. */
function shapeLine(
  l: LineRow,
  names: { users: Map<string, string>; companies: Map<string, string> },
) {
  const currency = l.currency as Currency;
  return {
    id: l.id,
    companyId: l.companyId,
    companyName: names.companies.get(l.companyId) ?? '',
    containerId: l.containerId,
    containerNumber: l.container.number,
    containerSize: l.container.size,
    bookingId: l.bookingId,
    category: l.category.name,
    categoryId: l.categoryId,
    date: day(l.date),
    currency,
    amountMinor: Number(l.amountMinor),
    amount: formatMoney(l.amountMinor, currency),
    perUsd: l.perUsd.toString(),
    usdCents: Number(l.usdCents),
    usd: formatMoney(l.usdCents, 'USD'),
    paidTo: l.paidTo,
    reference: l.reference,
    note: l.note,
    status: l.status,
    voidReason: l.voidReason,
    delayRelated: l.delayRelated,
    tipId: l.tipId,
    split: l.split
      ? { id: l.splitId, method: l.split.method, totalMinor: Number(l.split.totalMinor) }
      : null,
    enteredBy: names.users.get(l.enteredById) ?? '—',
    createdAt: l.createdAt,
    /** Slice 6: the payment order the line is on, if any. */
    payment: l.payment ? { number: l.payment.number, status: l.payment.status } : null,
  };
}

export async function shapeLines(rows: LineRow[], accountId: string) {
  const [users, companies] = await Promise.all([
    userNames(rows.map((r) => r.enteredById)),
    companyNames(accountId),
  ]);
  return rows.map((r) => shapeLine(r, { users, companies }));
}

/** Which lines this caller may see: their company's book, or every book for the MD without a switcher. */
function visibleLines(s: Scope) {
  return { ...byCompany(s), status: 'ACTIVE' as const };
}

// ---------------------------------------------------------------- categories

costsRouter.get('/cost-categories', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const rows = await prisma.costCategory.findMany({
      where: byAccount(s),
      orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

costsRouter.post('/cost-categories', requireAuth, requireRole('MD'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(costCategoryInput, req.body);
    const dup = await prisma.costCategory.findFirst({
      where: { accountId: s.accountId, name: { equals: input.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (dup) throw conflict(`Category "${input.name}" already exists`);
    const row = await prisma.$transaction(async (tx) => {
      const c = await tx.costCategory.create({ data: { accountId: s.accountId, ...input } });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          module: MODULE,
          action: 'category_added',
          entity: 'cost_category',
          entityId: c.id,
          after: input,
          ip: clientIp(req),
        },
        tx,
      );
      return c;
    });
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

costsRouter.patch(
  '/cost-categories/:id',
  requireAuth,
  requireRole('MD'),
  async (req, res, next) => {
    try {
      const s = scopeOf(req);
      const patch = parseBody(costCategoryInput.partial(), req.body);
      const before = await prisma.costCategory.findFirst({
        where: { id: String(req.params.id), ...byAccount(s) },
      });
      if (!before) throw notFound('Category not found');
      const row = await prisma.$transaction(async (tx) => {
        const c = await tx.costCategory.update({ where: { id: before.id }, data: patch });
        await audit(
          {
            accountId: s.accountId,
            userId: s.userId,
            module: MODULE,
            action: 'category_updated',
            entity: 'cost_category',
            entityId: c.id,
            before: { name: before.name, active: before.active, sortOrder: before.sortOrder },
            after: patch,
            ip: clientIp(req),
          },
          tx,
        );
        return c;
      });
      res.json(row);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------- rates

const ratesQuery = z.object({
  currency: z.enum(CURRENCIES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(60),
});

const shapeRate = (r: {
  id: string;
  currency: string;
  date: Date;
  perUsd: Prisma.Decimal;
  createdAt: Date;
}) => ({
  id: r.id,
  currency: r.currency,
  date: day(r.date),
  perUsd: r.perUsd.toString(),
  createdAt: r.createdAt,
});

costsRouter.get('/rates', requireAuth, requireScreen('cfg'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const q = parseBody(ratesQuery, req.query);
    const rows = await prisma.exchangeRate.findMany({
      where: { ...byAccount(s), ...(q.currency ? { currency: q.currency } : {}) },
      orderBy: [{ date: 'desc' }, { currency: 'asc' }],
      take: q.limit,
    });
    res.json(rows.map(shapeRate));
  } catch (e) {
    next(e);
  }
});

costsRouter.get('/rates/latest', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const rows = await prisma.exchangeRate.findMany({
      where: byAccount(s),
      orderBy: [{ currency: 'asc' }, { date: 'desc' }],
      distinct: ['currency'],
    });
    res.json(rows.map(shapeRate));
  } catch (e) {
    next(e);
  }
});

/** The MD or the Finance Officer types the day's rate; typing it again for the same day replaces it, on the record. */
costsRouter.post('/rates', requireAuth, requirePermission('pay'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(exchangeRateInput, req.body);
    const date = atUtc(input.date);
    const before = await prisma.exchangeRate.findUnique({
      where: {
        accountId_currency_date: { accountId: s.accountId, currency: input.currency, date },
      },
    });
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.exchangeRate.upsert({
        where: {
          accountId_currency_date: { accountId: s.accountId, currency: input.currency, date },
        },
        create: {
          accountId: s.accountId,
          currency: input.currency,
          date,
          perUsd: input.perUsd,
          enteredById: s.userId,
        },
        update: { perUsd: input.perUsd, enteredById: s.userId },
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          module: MODULE,
          action: before ? 'rate_replaced' : 'rate_entered',
          entity: 'exchange_rate',
          entityId: r.id,
          before: before ? { perUsd: before.perUsd.toString() } : undefined,
          after: { currency: input.currency, date: input.date, perUsd: input.perUsd },
          ip: clientIp(req),
        },
        tx,
      );
      return r;
    });
    res.status(before ? 200 : 201).json(shapeRate(row));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- settings (the margin figure)

const DEFAULT_SETTINGS = {
  marginType: 'PERCENT',
  marginValue: 0,
  icdFreeDays: 4,
  trackingHours: 12,
  tipCeilingUsdCents: 5000,
  tipCapUsdCents: 100000,
  approvalThresholdUsdCents: 50000,
};
/** The margin (slice 3) and the journey figures (slice 4) are saved from the same screen, any subset at a time. */
const settingsPatch = settingsInput
  .partial()
  .merge(journeySettingsInput.partial())
  .merge(tipSettingsInput.partial())
  .merge(paymentSettingsInput.partial())
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

costsRouter.get('/settings', requireAuth, requireScreen('cfg'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const row = await prisma.accountSettings.findUnique({ where: { accountId: s.accountId } });
    res.json(row ?? { accountId: s.accountId, ...DEFAULT_SETTINGS });
  } catch (e) {
    next(e);
  }
});

costsRouter.patch('/settings', requireAuth, requireRole('MD'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(settingsPatch, req.body);
    const before = await prisma.accountSettings.findUnique({ where: { accountId: s.accountId } });
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.accountSettings.upsert({
        where: { accountId: s.accountId },
        create: { accountId: s.accountId, ...input },
        update: input,
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          module: MODULE,
          action: 'settings_updated',
          entity: 'account_settings',
          entityId: s.accountId,
          before: before
            ? {
                marginType: before.marginType,
                marginValue: before.marginValue,
                icdFreeDays: before.icdFreeDays,
                trackingHours: before.trackingHours,
                tipCeilingUsdCents: before.tipCeilingUsdCents,
                tipCapUsdCents: before.tipCapUsdCents,
                approvalThresholdUsdCents: before.approvalThresholdUsdCents,
              }
            : DEFAULT_SETTINGS,
          after: input,
          ip: clientIp(req),
        },
        tx,
      );
      return r;
    });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- cost entry

/** Everything checked and computed before a cost is written; nothing touched the database yet. */
export interface PreparedCost {
  input: CostInput;
  category: { id: string; name: string };
  containers: {
    id: string;
    accountId: string;
    number: string;
    weightKg: number | null;
    bookingId: string;
    stage: string;
    icdSince: Date | null;
    closedAt: Date | null;
    responsibleCompanyId: string;
  }[];
  amounts: number[];
  bookingId: string;
  date: Date;
  perUsd: Prisma.Decimal;
  usdCentsTotal: number;
  icdFreeDays: number;
}

/**
 * Checks a cost and divides it: the category is live, the boxes are live containers of the account and of one
 * booking, the split adds up, the rate of the cost's own date exists. Tips (slice 5) go through the same door.
 */
export async function prepareCost(
  s: Scope,
  _companyId: string,
  input: CostInput,
): Promise<PreparedCost> {
  const [category, boxes] = await Promise.all([
    prisma.costCategory.findFirst({
      where: { id: input.categoryId, ...byAccount(s), active: true },
      select: { id: true, name: true },
    }),
    prisma.container.findMany({
      where: { id: { in: input.containerIds }, ...byAccount(s), status: 'ACTIVE' },
      select: {
        id: true,
        accountId: true,
        number: true,
        weightKg: true,
        bookingId: true,
        stage: true,
        icdSince: true,
        closedAt: true,
        responsibleCompanyId: true,
      },
    }),
  ]);
  if (!category) throw badRequest('Pick a cost category from the list');
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const ordered = input.containerIds.map((id) => byId.get(id));
  if (ordered.some((b) => !b))
    throw badRequest('One of the boxes is not a live container of your account');
  const containers = ordered as NonNullable<(typeof ordered)[number]>[];
  const bookingIds = new Set(containers.map((c) => c.bookingId));
  if (bookingIds.size > 1) throw badRequest('One bill is divided across boxes of one booking');
  const bookingId = containers[0]!.bookingId;

  let amounts: number[];
  if (containers.length === 1) amounts = [input.totalMinor];
  else if (input.method === 'EQUAL') amounts = splitEqual(input.totalMinor, containers.length);
  else if (input.method === 'WEIGHT') {
    const missing = containers.filter((c) => !c.weightKg || c.weightKg <= 0).map((c) => c.number);
    if (missing.length)
      throw badRequest(
        `Weight missing on ${missing.join(', ')}; type it on the box first, or split equally`,
      );
    amounts = splitByWeight(
      input.totalMinor,
      containers.map((c) => c.weightKg!),
    );
  } else amounts = input.manualMinor!;

  const date = atUtc(input.date);
  const perUsd = await rateFor(s.accountId, input.currency, date);
  const { icdFreeDays } = await journeySettings(s.accountId);
  const usdCentsTotal = amounts.reduce(
    (a, m) => a + toUsdCents(m, input.currency, perUsd.toString()),
    0,
  );
  return {
    input,
    category,
    containers,
    amounts,
    bookingId,
    date,
    perUsd,
    usdCentsTotal,
    icdFreeDays,
  };
}

/**
 * Writes a prepared cost inside the caller's transaction: one split row when several boxes, one line per box
 * with the rate copied on and the delay flag, one audit row per line, an MD-queue item for a box already closed.
 */
export async function writeCost(
  tx: Tx,
  s: Scope,
  companyId: string,
  p: PreparedCost,
  ip: string,
  link: { tipId?: string; action?: string } = {},
): Promise<{ lineIds: string[]; splitId: string | null; pendingLineIds: string[] }> {
  const { input, category, containers, amounts, bookingId, date, perUsd } = p;
  // One side, one company: money typed on a box that is on the other side counts only once the MD approves.
  const pendingLineIds: string[] = [];
  const pendingNumbers: string[] = [];
  const split =
    containers.length > 1
      ? await tx.costSplit.create({
          data: {
            accountId: s.accountId,
            companyId,
            method: input.method,
            totalMinor: BigInt(input.totalMinor),
            currency: input.currency,
            createdById: s.userId,
          },
        })
      : null;
  const lineIds: string[] = [];
  for (let i = 0; i < containers.length; i++) {
    const c = containers[i]!;
    const amountMinor = amounts[i]!;
    // The cost of a delay: the line's own date falls inside an at-risk spell of the box (slice 4).
    await refreshIcdRisk(tx, c, p.icdFreeDays);
    const delayRelated = await isDelayRelated(tx, c.id, date);
    const otherSide = !mayTouchCompany(s, c.responsibleCompanyId);
    const line = await tx.costLine.create({
      data: {
        accountId: s.accountId,
        companyId,
        containerId: c.id,
        bookingId,
        categoryId: category.id,
        splitId: split?.id ?? null,
        date,
        currency: input.currency,
        amountMinor: BigInt(amountMinor),
        perUsd,
        usdCents: BigInt(toUsdCents(amountMinor, input.currency, perUsd.toString())),
        paidTo: input.paidTo,
        reference: input.reference,
        note: input.note,
        delayRelated,
        tipId: link.tipId ?? null,
        status: otherSide ? 'PENDING_MD' : 'ACTIVE',
        enteredById: s.userId,
      },
    });
    if (otherSide) {
      pendingLineIds.push(line.id);
      pendingNumbers.push(c.number);
    }
    await audit(
      {
        accountId: s.accountId,
        userId: s.userId,
        companyId,
        module: MODULE,
        action: link.action ?? 'cost_entered',
        entity: 'cost_line',
        entityId: line.id,
        after: {
          container: c.number,
          category: category.name,
          date: input.date,
          currency: input.currency,
          amountMinor,
          perUsd: perUsd.toString(),
          usdCents: Number(line.usdCents),
          paidTo: input.paidTo,
          delayRelated,
          tipId: link.tipId ?? null,
          pendingMd: otherSide,
          split: split ? { id: split.id, method: input.method, of: containers.length } : null,
        },
        ip,
      },
      tx,
    );
    // A box already closed to Finance takes the cost, and the MD hears of it: its P&L month was settled.
    if (c.closedAt)
      await tx.mdQueueItem.create({
        data: {
          accountId: s.accountId,
          companyId,
          kind: 'COST_AFTER_CLOSE',
          entity: 'container',
          entityId: c.id,
          summary: {
            number: c.number,
            category: category.name,
            amount: `${input.currency} ${formatMoney(amountMinor, input.currency)}`,
            costLineId: line.id,
          },
          createdById: s.userId,
        },
      });
    lineIds.push(line.id);
  }
  if (pendingLineIds.length)
    await tx.mdQueueItem.create({
      data: {
        accountId: s.accountId,
        companyId,
        kind: 'COST_OTHER_SIDE',
        entity: 'cost_line',
        entityId: pendingLineIds[0]!,
        summary: {
          numbers: pendingNumbers,
          category: category.name,
          amount: `${input.currency} ${formatMoney(input.totalMinor, input.currency)}`,
          paidTo: input.paidTo,
          tip: !!link.tipId,
          costLineIds: pendingLineIds,
        },
        createdById: s.userId,
      },
    });
  return { lineIds, splitId: split?.id ?? null, pendingLineIds };
}

costsRouter.post('/costs', ...canEnterCosts, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const companyId = writingCompany(s);
    const input = parseBody(costInput, req.body);
    const prepared = await prepareCost(s, companyId, input);
    const ip = clientIp(req);
    const { lineIds } = await prisma.$transaction((tx) =>
      writeCost(tx, s, companyId, prepared, ip),
    );
    const rows = await prisma.costLine.findMany({
      where: { id: { in: lineIds } },
      select: lineSelect,
      orderBy: { createdAt: 'asc' },
    });
    res.status(201).json({ lines: await shapeLines(rows, s.accountId) });
  } catch (e) {
    next(e);
  }
});

const costsQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  bookingId: z.string().uuid().optional(),
  containerId: z.string().uuid().optional(),
  all: z.coerce.boolean().default(false),
});

costsRouter.get('/costs', requireAuth, requireScreen('csplit'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const q = parseBody(costsQuery, req.query);
    const monthRange = q.month
      ? {
          gte: atUtc(`${q.month}-01`),
          lt: new Date(Date.UTC(+q.month.slice(0, 4), +q.month.slice(5, 7), 1)),
        }
      : undefined;
    const rows = await prisma.costLine.findMany({
      where: {
        ...byCompany(s),
        ...(q.all ? {} : { status: { in: ['ACTIVE', 'PENDING_MD'] } }),
        ...(monthRange ? { date: monthRange } : {}),
        ...(q.bookingId ? { bookingId: q.bookingId } : {}),
        ...(q.containerId ? { containerId: q.containerId } : {}),
      },
      select: lineSelect,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    res.json(await shapeLines(rows, s.accountId));
  } catch (e) {
    next(e);
  }
});

/** The line of this account the caller may change: in their own book, still active. */
async function ownLine(s: Scope, id: string) {
  const l = await prisma.costLine.findFirst({ where: { id, ...byAccount(s) }, select: lineSelect });
  if (!l) throw notFound('Cost line not found');
  if (!mayTouchCompany(s, l.companyId))
    throw forbidden(
      "This line is in the other company's book; you can read your own, not change theirs",
    );
  if (l.status === 'VOID') throw conflict('This line is void; enter it again if it was real');
  return l;
}

costsRouter.patch('/costs/:id', ...canEnterCosts, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(costLinePatch, req.body);
    const before = await ownLine(s, String(req.params.id));
    const usdCents = toUsdCents(
      input.amountMinor,
      before.currency as Currency,
      before.perUsd.toString(),
    );
    const row = await prisma.$transaction(async (tx) => {
      const l = await tx.costLine.update({
        where: { id: before.id },
        data: { amountMinor: BigInt(input.amountMinor), usdCents: BigInt(usdCents) },
        select: lineSelect,
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: before.companyId,
          module: MODULE,
          action: 'cost_corrected',
          entity: 'cost_line',
          entityId: before.id,
          before: { amountMinor: Number(before.amountMinor), usdCents: Number(before.usdCents) },
          after: { amountMinor: input.amountMinor, usdCents, reason: input.reason },
          ip: clientIp(req),
        },
        tx,
      );
      return l;
    });
    res.json((await shapeLines([row], s.accountId))[0]);
  } catch (e) {
    next(e);
  }
});

costsRouter.post('/costs/:id/void', ...canEnterCosts, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { reason } = parseBody(costVoidInput, req.body);
    const before = await ownLine(s, String(req.params.id));
    const row = await prisma.$transaction(async (tx) => {
      const l = await tx.costLine.update({
        where: { id: before.id },
        data: { status: 'VOID', voidReason: reason },
        select: lineSelect,
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: before.companyId,
          module: MODULE,
          action: 'cost_voided',
          entity: 'cost_line',
          entityId: before.id,
          before: { amountMinor: Number(before.amountMinor), status: 'ACTIVE' },
          after: { status: 'VOID', reason },
          ip: clientIp(req),
        },
        tx,
      );
      return l;
    });
    res.json((await shapeLines([row], s.accountId))[0]);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- the container record and the booking's totals

/** USD cents per company for a set of lines; the MD sees every book, a one-company user only theirs. */
function totals(
  lines: { companyId: string; usdCents: number; delayRelated?: boolean }[],
  companies: Map<string, string>,
) {
  const byCompany = new Map<string, number>();
  for (const l of lines) byCompany.set(l.companyId, (byCompany.get(l.companyId) ?? 0) + l.usdCents);
  const delayCents = lines.filter((l) => l.delayRelated).reduce((a, l) => a + l.usdCents, 0);
  // In the companies' own order (main company first), only those with a line.
  const perCompany = [...companies]
    .filter(([companyId]) => byCompany.has(companyId))
    .map(([companyId, companyName]) => ({
      companyId,
      companyName,
      usdCents: byCompany.get(companyId)!,
      usd: formatMoney(byCompany.get(companyId)!, 'USD'),
    }));
  const usdCents = perCompany.reduce((a, b) => a + b.usdCents, 0);
  return {
    perCompany,
    usdCents,
    usd: formatMoney(usdCents, 'USD'),
    delayUsdCents: delayCents,
    delayUsd: formatMoney(delayCents, 'USD'),
  };
}

costsRouter.get('/containers/:id/costs', ...canReadRecord, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const c = await prisma.container.findFirst({
      where: { id: String(req.params.id), ...byAccount(s) },
      select: {
        id: true,
        number: true,
        size: true,
        lot: true,
        weightKg: true,
        stage: true,
        status: true,
        responsibleCompanyId: true,
        lastPlace: true,
        closedAt: true,
        plMonth: true,
        localOnly: true,
        booking: {
          select: {
            id: true,
            fileNumber: true,
            reference: true,
            companyId: true,
            cargo: true,
            vessel: true,
            client: { select: { name: true } },
          },
        },
      },
    });
    if (!c) throw notFound('Container not found');
    if (!spansAccount(s) && !mayTouchCompany(s, c.responsibleCompanyId))
      throw forbidden("This box is on the other company's side");
    const [rows, bookingRows, companies] = await Promise.all([
      prisma.costLine.findMany({
        where: { containerId: c.id, ...visibleLines(s) },
        select: lineSelect,
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.costLine.findMany({
        where: { bookingId: c.booking.id, ...visibleLines(s) },
        select: { companyId: true, usdCents: true, delayRelated: true },
      }),
      companyNames(s.accountId),
    ]);
    const lines = await shapeLines(rows, s.accountId);
    res.json({
      container: {
        ...c,
        responsibleCompanyName: companies.get(c.responsibleCompanyId) ?? '',
        booking: {
          ...c.booking,
          companyName: companies.get(c.booking.companyId) ?? '',
          client: c.booking.client.name,
        },
      },
      lines,
      totals: totals(lines, companies),
      bookingTotals: totals(
        bookingRows.map((r) => ({
          companyId: r.companyId,
          usdCents: Number(r.usdCents),
          delayRelated: r.delayRelated,
        })),
        companies,
      ),
    });
  } catch (e) {
    next(e);
  }
});

costsRouter.get('/bookings/:id/costs', ...canReadRecord, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const b = await prisma.booking.findFirst({
      where: { id: String(req.params.id), ...byAccount(s) },
      select: {
        id: true,
        fileNumber: true,
        reference: true,
        containers: {
          where: {
            status: { not: 'WITHDRAWN' },
            ...(spansAccount(s) ? {} : { responsibleCompanyId: s.companyId! }),
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, number: true, size: true, weightKg: true, status: true },
        },
      },
    });
    if (!b) throw notFound('Booking not found');
    const [rows, companies] = await Promise.all([
      prisma.costLine.findMany({
        where: { bookingId: b.id, ...visibleLines(s) },
        select: { containerId: true, companyId: true, usdCents: true },
      }),
      companyNames(s.accountId),
    ]);
    const perBox = new Map<string, number>();
    for (const r of rows)
      perBox.set(r.containerId, (perBox.get(r.containerId) ?? 0) + Number(r.usdCents));
    res.json({
      booking: { id: b.id, fileNumber: b.fileNumber, reference: b.reference },
      containers: b.containers.map((c) => ({
        ...c,
        usdCents: perBox.get(c.id) ?? 0,
        usd: formatMoney(perBox.get(c.id) ?? 0, 'USD'),
      })),
      totals: totals(
        rows.map((r) => ({ companyId: r.companyId, usdCents: Number(r.usdCents) })),
        companies,
      ),
    });
  } catch (e) {
    next(e);
  }
});
