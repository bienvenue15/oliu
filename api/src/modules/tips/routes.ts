/**
 * Tips — facilitation payments, three taps (roadmap slice 5).
 *
 * The fastest screen in the system, used standing up, under pressure, with no signal. A tip is the boxes
 * tapped, a reason, an amount; everything else is optional and can follow later from a calmer screen. Its
 * money is cost lines in the account's tip category, one per box, through the same split, rate and delay
 * rules as any other cost — so the container record and the booking total are right without anyone
 * retyping. The phone makes a `clientId` before saving, so a tip sent twice from the outbox is saved once.
 * One tip above the ceiling, or a company's month above the cap, needs the MD's six-digit code.
 *
 * GET  /api/tip-reasons · POST (MD) · PATCH /:id (MD)   the reason buttons
 * GET  /api/tips/setup                                 what the phone needs: bookings and boxes on my side, reasons, figures
 * POST /api/tips                                       a tip (idempotent on clientId)
 * POST /api/tips/md-code                               mails the MD a code for a tip past the ceiling or the cap
 * GET  /api/tips?month=&mine=                          the ledger: by person, by box; the cap used
 * PATCH /api/tips/:id                                  complete later: who was paid, where, a note
 * POST /api/tips/:id/photo · GET /api/tips/:id/photo   the receipt photo, kept outside the web root
 * POST /api/tips/:id/void                              a wrong tip: its lines voided with a reason, nothing deleted
 */
import { Router, json } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import {
  formatMoney,
  STAGE_LABEL,
  TIP_PAYEE_LABEL,
  TIP_PAYEE_TYPES,
  tipInput,
  tipPatch,
  tipPhotoInput,
  tipReasonInput,
  type Stage,
} from '@oliu/shared';
import { config } from '../../config.ts';
import {
  byAccount,
  byCompany,
  bySide,
  mayTouchCompany,
  prisma,
  type Scope,
  type Tx,
} from '../../db.ts';
import { audit } from '../../lib/audit.ts';
import { newOtpCode, sha256 } from '../../lib/crypto.ts';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.ts';
import { sendMail } from '../../lib/mail.ts';
import { parseBody } from '../../lib/validate.ts';
import {
  clientIp,
  requireAuth,
  requirePermission,
  requireRole,
  requireScreen,
  scopeOf,
} from '../../middleware/auth.ts';
import { prepareCost, writeCost } from '../costs/routes.ts';

export const tipsRouter = Router();
const MODULE = 'tips';
const canTip = [requireAuth, requireScreen('tip'), requirePermission('write')];
const canComplete = [requireAuth, requireScreen('tiplat'), requirePermission('write')];
const canReadLedger = [requireAuth, requireScreen('tiplat')];
const TIP_OVERRIDE = 'TIP_OVERRIDE';
const CAP_WARNING_AT = 0.8;

// ---------------------------------------------------------------- helpers

function writingCompany(s: Scope): string {
  const id = s.companyId ?? s.activeCompanyId;
  if (!id) throw badRequest('Choose a company in the switcher first');
  return id;
}
const day = (d: Date) => d.toISOString().slice(0, 10);
const atUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const monthOf = (d: Date) => d.toISOString().slice(0, 7);
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

/** Company and people names; inside a transaction pass `tx`, the local database has one connection. */
async function names(accountId: string, db: Tx | typeof prisma = prisma) {
  const [companies, users] = await Promise.all([
    db.company.findMany({ where: { accountId }, select: { id: true, legalName: true } }),
    db.user.findMany({ where: { accountId }, select: { id: true, name: true } }),
  ]);
  return {
    company: new Map(companies.map((c) => [c.id, c.legalName])),
    user: new Map(users.map((u) => [u.id, u.name])),
  };
}

async function tipFigures(accountId: string) {
  const row = await prisma.accountSettings.findUnique({
    where: { accountId },
    select: { tipCeilingUsdCents: true, tipCapUsdCents: true },
  });
  return row ?? { tipCeilingUsdCents: 5000, tipCapUsdCents: 100000 };
}

/** US cents tipped by a company in a month: the live tip lines, so a voided tip leaves the figure. */
async function capUsed(
  tx: Tx | typeof prisma,
  accountId: string,
  companyId: string,
  month: string,
): Promise<number> {
  const r = await tx.costLine.aggregate({
    where: {
      accountId,
      companyId,
      tipId: { not: null },
      status: 'ACTIVE',
      date: monthRange(month),
    },
    _sum: { usdCents: true },
  });
  return Number(r._sum.usdCents ?? 0);
}

const tipSelect = {
  id: true,
  companyId: true,
  clientId: true,
  bookingId: true,
  date: true,
  currency: true,
  amountMinor: true,
  usdCents: true,
  payeeType: true,
  payeeId: true,
  checkpoint: true,
  stage: true,
  note: true,
  receiptPath: true,
  mdOverride: true,
  paidById: true,
  createdAt: true,
  reason: { select: { id: true, label: true } },
  lines: {
    select: {
      id: true,
      status: true,
      amountMinor: true,
      usdCents: true,
      delayRelated: true,
      container: { select: { id: true, number: true } },
    },
  },
} satisfies Prisma.TipSelect;
type TipRow = Prisma.TipGetPayload<{ select: typeof tipSelect }>;

function shapeTip(t: TipRow, n: Awaited<ReturnType<typeof names>>, bookingRef: string) {
  const live = t.lines.filter((l) => l.status === 'ACTIVE');
  return {
    id: t.id,
    clientId: t.clientId,
    companyId: t.companyId,
    companyName: n.company.get(t.companyId) ?? '',
    booking: { id: t.bookingId, reference: bookingRef },
    date: day(t.date),
    currency: t.currency,
    amountMinor: Number(t.amountMinor),
    amount: formatMoney(t.amountMinor, t.currency as 'USD'),
    usdCents: Number(t.usdCents),
    usd: formatMoney(t.usdCents, 'USD'),
    reason: t.reason.label,
    reasonId: t.reason.id,
    payeeType: t.payeeType,
    payeeTypeLabel: t.payeeType ? TIP_PAYEE_LABEL[t.payeeType] : '',
    payeeId: t.payeeId,
    checkpoint: t.checkpoint,
    stage: t.stage,
    stageLabel: t.stage ? STAGE_LABEL[t.stage as Stage] : '',
    note: t.note,
    hasPhoto: t.receiptPath !== '',
    mdOverride: t.mdOverride,
    void: t.lines.length > 0 && t.lines.every((l) => l.status === 'VOID'),
    /** Typed on a box of the other side: counts nowhere until the MD approves. */
    pendingMd: t.lines.some((l) => l.status === 'PENDING_MD'),
    delayRelated: live.some((l) => l.delayRelated),
    /** What a calmer screen still has to add. */
    missing: [
      ...(t.payeeId ? [] : ['payee']),
      ...(t.receiptPath ? [] : ['photo']),
      ...(t.checkpoint ? [] : ['checkpoint']),
    ],
    boxes: t.lines.map((l) => ({
      id: l.container.id,
      number: l.container.number,
      amount: formatMoney(l.amountMinor, t.currency as 'USD'),
      usdCents: Number(l.usdCents),
      usd: formatMoney(l.usdCents, 'USD'),
      status: l.status,
    })),
    paidBy: n.user.get(t.paidById) ?? '—',
    paidById: t.paidById,
    createdAt: t.createdAt,
  };
}

async function shapeTips(rows: TipRow[], accountId: string) {
  const n = await names(accountId);
  const ids = [...new Set(rows.map((r) => r.bookingId))];
  const bookings = ids.length
    ? await prisma.booking.findMany({
        where: { id: { in: ids } },
        select: { id: true, reference: true },
      })
    : [];
  const ref = new Map(bookings.map((b) => [b.id, b.reference]));
  return rows.map((r) => shapeTip(r, n, ref.get(r.bookingId) ?? ''));
}

// ---------------------------------------------------------------- reasons

tipsRouter.get('/tip-reasons', requireAuth, requireScreen('cfg'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    res.json(
      await prisma.tipReason.findMany({
        where: byAccount(s),
        orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { label: 'asc' }],
      }),
    );
  } catch (e) {
    next(e);
  }
});

tipsRouter.post('/tip-reasons', requireAuth, requireRole('MD'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(tipReasonInput, req.body);
    const dup = await prisma.tipReason.findFirst({
      where: { accountId: s.accountId, label: { equals: input.label, mode: 'insensitive' } },
      select: { id: true },
    });
    if (dup) throw conflict(`Reason "${input.label}" already exists`);
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.tipReason.create({ data: { accountId: s.accountId, ...input } });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          module: MODULE,
          action: 'reason_added',
          entity: 'tip_reason',
          entityId: r.id,
          after: input,
          ip: clientIp(req),
        },
        tx,
      );
      return r;
    });
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

tipsRouter.patch('/tip-reasons/:id', requireAuth, requireRole('MD'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const patch = parseBody(tipReasonInput.partial(), req.body);
    const before = await prisma.tipReason.findFirst({
      where: { id: String(req.params.id), ...byAccount(s) },
    });
    if (!before) throw notFound('Reason not found');
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.tipReason.update({ where: { id: before.id }, data: patch });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          module: MODULE,
          action: 'reason_updated',
          entity: 'tip_reason',
          entityId: r.id,
          before: { label: before.label, active: before.active, sortOrder: before.sortOrder },
          after: patch,
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

// ---------------------------------------------------------------- what the phone needs

/**
 * Everything the tip screen shows, in one call, so the phone can keep it for when there is no signal: the live
 * bookings on this side with their boxes and stages, the reason buttons, the figures and how much of the cap is used.
 */
tipsRouter.get('/tips/setup', requireAuth, requireScreen('tip'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const mine = s.companyId ?? s.activeCompanyId;
    const since = new Date(Date.now() - 60 * 86_400_000);
    const [boxes, reasons, figures, companies] = await Promise.all([
      prisma.container.findMany({
        where: {
          ...byAccount(s),
          status: 'ACTIVE',
          closedAt: null,
          booking: { status: { not: 'CANCELLED' }, createdAt: { gte: since } },
          ...bySide(s),
        },
        orderBy: [{ booking: { createdAt: 'desc' } }, { createdAt: 'asc' }],
        take: 500,
        select: {
          id: true,
          number: true,
          size: true,
          stage: true,
          lastPlace: true,
          booking: {
            select: {
              id: true,
              reference: true,
              fileNumber: true,
              client: { select: { name: true } },
            },
          },
        },
      }),
      prisma.tipReason.findMany({
        where: { ...byAccount(s), active: true },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      }),
      tipFigures(s.accountId),
      prisma.company.findMany({
        where: byAccount(s),
        select: { id: true, currency: true, legalName: true },
      }),
    ]);
    const bookings = new Map<
      string,
      { id: string; reference: string; fileNumber: string; client: string; containers: unknown[] }
    >();
    for (const c of boxes) {
      const b = bookings.get(c.booking.id) ?? {
        id: c.booking.id,
        reference: c.booking.reference,
        fileNumber: c.booking.fileNumber,
        client: c.booking.client.name,
        containers: [],
      };
      b.containers.push({
        id: c.id,
        number: c.number,
        size: c.size,
        stage: c.stage,
        stageLabel: STAGE_LABEL[c.stage as Stage],
        place: c.lastPlace,
      });
      bookings.set(c.booking.id, b);
    }
    const month = monthOf(new Date());
    const used = mine ? await capUsed(prisma, s.accountId, mine, month) : 0;
    const company = companies.find((c) => c.id === mine);
    res.json({
      bookings: [...bookings.values()],
      reasons: reasons.map((r) => ({ id: r.id, label: r.label })),
      payeeTypes: TIP_PAYEE_TYPES.map((k) => ({ key: k, label: TIP_PAYEE_LABEL[k] })),
      currency: company?.currency ?? 'USD',
      companyName: company?.legalName ?? '',
      figures,
      cap: {
        month,
        usedUsdCents: used,
        usedUsd: formatMoney(used, 'USD'),
        capUsd: formatMoney(figures.tipCapUsdCents, 'USD'),
        pct: figures.tipCapUsdCents ? Math.round((100 * used) / figures.tipCapUsdCents) : 0,
      },
      ceilingUsd: formatMoney(figures.tipCeilingUsdCents, 'USD'),
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- the MD's code

const mdCodeLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

/** The MD(s) of the account get a six-digit code in their mailbox; the tip is then sent again with it. */
tipsRouter.post('/tips/md-code', mdCodeLimiter, ...canTip, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { amount, reason } = parseBody(
      z.object({ amount: z.string().max(60).default(''), reason: z.string().max(80).default('') }),
      req.body ?? {},
    );
    const mds = await prisma.user.findMany({
      where: { accountId: s.accountId, role: 'MD', status: 'ACTIVE' },
      select: { id: true, name: true, otpMailbox: true },
    });
    if (mds.length === 0) throw conflict('No active Managing Director on this account');
    const asker = await prisma.user.findUniqueOrThrow({
      where: { id: s.userId },
      select: { name: true },
    });
    const code = newOtpCode();
    const md = mds[0]!;
    await prisma.$transaction(async (tx) => {
      await tx.otpChallenge.create({
        data: {
          userId: md.id,
          codeHash: sha256(code),
          purpose: TIP_OVERRIDE,
          expiresAt: new Date(Date.now() + config.OTP_MINUTES * 60_000),
        },
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: s.companyId,
          module: MODULE,
          action: 'md_code_requested',
          entity: 'user',
          entityId: md.id,
          after: { amount, reason },
          ip: clientIp(req),
        },
        tx,
      );
    });
    await sendMail(
      md.otpMailbox,
      `OLIU — ${asker.name} asks your code for a tip${amount ? ` of ${amount}` : ''}`,
      `${asker.name} wants to pay a tip${amount ? ` of ${amount}` : ''}${reason ? ` (${reason})` : ''} that is past the ceiling or the monthly cap.\nYour code, if you agree: ${code}\nIt expires in ${config.OTP_MINUTES} minutes. Give it to them by voice; it works once.`,
    );
    res.json({ sentTo: md.name, expiresInMinutes: config.OTP_MINUTES });
  } catch (e) {
    next(e);
  }
});

/** Burns a valid MD code for this account, or throws. */
async function useMdCode(tx: Tx, accountId: string, code: string) {
  const open = await tx.otpChallenge.findMany({
    where: {
      purpose: TIP_OVERRIDE,
      usedAt: null,
      expiresAt: { gt: new Date() },
      attempts: { lt: 5 },
      user: { accountId, role: 'MD' },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, codeHash: true },
  });
  const hit = open.find((c) => c.codeHash === sha256(code));
  if (!hit) {
    if (open[0])
      await tx.otpChallenge.update({
        where: { id: open[0].id },
        data: { attempts: { increment: 1 } },
      });
    throw forbidden("That is not the Managing Director's code, or it expired");
  }
  await tx.otpChallenge.update({ where: { id: hit.id }, data: { usedAt: new Date() } });
}

// ---------------------------------------------------------------- the tip itself

tipsRouter.post('/tips', ...canTip, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const companyId = writingCompany(s);
    const input = parseBody(tipInput, req.body);

    // Sent twice from the outbox: the first save stands.
    const already = await prisma.tip.findUnique({
      where: { accountId_clientId: { accountId: s.accountId, clientId: input.clientId } },
      select: tipSelect,
    });
    if (already) {
      res.status(200).json({ ...(await shapeTips([already], s.accountId))[0], repeated: true });
      return;
    }

    const [reason, category, boxes] = await Promise.all([
      prisma.tipReason.findFirst({
        where: { id: input.reasonId, ...byAccount(s), active: true },
        select: { id: true, label: true },
      }),
      prisma.costCategory.findFirst({
        where: { ...byAccount(s), isTip: true, active: true },
        select: { id: true },
      }),
      prisma.container.findMany({
        where: { id: { in: input.containerIds }, ...byAccount(s), status: 'ACTIVE' },
        select: {
          id: true,
          number: true,
          stage: true,
          responsibleCompanyId: true,
          booking: { select: { companyId: true } },
        },
      }),
    ]);
    if (!reason) throw badRequest('Tap a reason from the list');
    if (!category)
      throw conflict('No cost category is marked as the tip category (Settings → Configuration)');
    if (boxes.length !== new Set(input.containerIds).size)
      throw badRequest('One of the boxes is not a live container of your account');
    // A box on the other side may still be tipped (money left someone's hand), but it waits for the MD.

    const date = input.date ?? day(new Date());
    const prepared = await prepareCost(s, companyId, {
      containerIds: input.containerIds,
      categoryId: category.id,
      date,
      currency: input.currency,
      totalMinor: input.totalMinor,
      paidTo: input.payeeId,
      reference: '',
      note: input.note,
      method: 'EQUAL',
    });
    const usdCents = prepared.usdCentsTotal;
    const figures = await tipFigures(s.accountId);
    const month = monthOf(atUtc(date));
    const usedBefore = await capUsed(prisma, s.accountId, companyId, month);
    const overCeiling = figures.tipCeilingUsdCents > 0 && usdCents > figures.tipCeilingUsdCents;
    const overCap = figures.tipCapUsdCents > 0 && usedBefore + usdCents > figures.tipCapUsdCents;
    if ((overCeiling || overCap) && !input.mdCode) {
      res.status(409).json({
        error: overCeiling
          ? `This tip (${formatMoney(usdCents, 'USD')} USD) is above the ceiling of ${formatMoney(figures.tipCeilingUsdCents, 'USD')} USD; it needs the Managing Director's code`
          : `This tip would take the month past the cap of ${formatMoney(figures.tipCapUsdCents, 'USD')} USD (${formatMoney(usedBefore, 'USD')} used); it needs the Managing Director's code`,
        needsMdCode: true,
        overCeiling,
        overCap,
      });
      return;
    }

    const ip = clientIp(req);
    const stage = boxes[0]!.stage;
    const id = await prisma.$transaction(async (tx) => {
      if (overCeiling || overCap) await useMdCode(tx, s.accountId, input.mdCode!);
      const tip = await tx.tip.create({
        data: {
          accountId: s.accountId,
          companyId,
          clientId: input.clientId,
          reasonId: reason.id,
          bookingId: prepared.bookingId,
          date: atUtc(date),
          currency: input.currency,
          amountMinor: BigInt(input.totalMinor),
          usdCents: BigInt(usdCents),
          payeeType: input.payeeType ?? null,
          payeeId: input.payeeId,
          checkpoint: input.checkpoint,
          stage,
          note: input.note,
          mdOverride: overCeiling || overCap,
          paidById: s.userId,
        },
      });
      const written = await writeCost(tx, s, companyId, prepared, ip, {
        tipId: tip.id,
        action: 'tip_paid',
      });
      if (written.pendingLineIds.length)
        await audit(
          {
            accountId: s.accountId,
            userId: s.userId,
            companyId,
            module: MODULE,
            action: 'tip_pending_md',
            entity: 'tip',
            entityId: tip.id,
            after: { lines: written.pendingLineIds.length },
            ip,
          },
          tx,
        );
      await tx.tip.update({ where: { id: tip.id }, data: { splitId: written.splitId } });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId,
          module: MODULE,
          action: 'tip_paid',
          entity: 'tip',
          entityId: tip.id,
          after: {
            boxes: boxes.map((b) => b.number),
            reason: reason.label,
            currency: input.currency,
            amountMinor: input.totalMinor,
            usdCents,
            payeeType: input.payeeType ?? null,
            payeeId: input.payeeId,
            checkpoint: input.checkpoint,
            stage,
            mdOverride: overCeiling || overCap,
            date,
          },
          ip,
        },
        tx,
      );
      if (overCeiling || overCap)
        await audit(
          {
            accountId: s.accountId,
            userId: s.userId,
            companyId,
            module: MODULE,
            action: 'tip_override',
            entity: 'tip',
            entityId: tip.id,
            after: { overCeiling, overCap, usdCents },
            ip,
          },
          tx,
        );
      // Crossing 80 % of the month's cap: once per company and month, the MD hears of it.
      const usedAfter = usedBefore + usdCents;
      if (
        figures.tipCapUsdCents > 0 &&
        usedBefore < figures.tipCapUsdCents * CAP_WARNING_AT &&
        usedAfter >= figures.tipCapUsdCents * CAP_WARNING_AT
      ) {
        const seen = await tx.mdQueueItem.findFirst({
          where: { accountId: s.accountId, companyId, kind: 'TIP_CAP_80', entityId: tip.id },
        });
        if (!seen) {
          const companyName = (await names(s.accountId, tx)).company.get(companyId) ?? '';
          await tx.mdQueueItem.create({
            data: {
              accountId: s.accountId,
              companyId,
              kind: 'TIP_CAP_80',
              entity: 'tip',
              entityId: tip.id,
              summary: {
                companyName,
                month,
                usedUsd: formatMoney(usedAfter, 'USD'),
                capUsd: formatMoney(figures.tipCapUsdCents, 'USD'),
                pct: Math.round((100 * usedAfter) / figures.tipCapUsdCents),
              },
              createdById: s.userId,
            },
          });
          await audit(
            {
              accountId: s.accountId,
              userId: s.userId,
              companyId,
              module: MODULE,
              action: 'tip_cap_warning',
              entity: 'tip',
              entityId: tip.id,
              after: { month, usedUsdCents: usedAfter, capUsdCents: figures.tipCapUsdCents },
              ip,
            },
            tx,
          );
        }
      }
      return tip.id;
    });
    const row = await prisma.tip.findUniqueOrThrow({ where: { id }, select: tipSelect });
    const usedAfter = await capUsed(prisma, s.accountId, companyId, month);
    res.status(201).json({
      ...(await shapeTips([row], s.accountId))[0],
      cap: {
        month,
        usedUsdCents: usedAfter,
        usedUsd: formatMoney(usedAfter, 'USD'),
        capUsd: formatMoney(figures.tipCapUsdCents, 'USD'),
        pct: figures.tipCapUsdCents ? Math.round((100 * usedAfter) / figures.tipCapUsdCents) : 0,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- the ledger

const ledgerQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  /** Only the tips I paid (the Field Officer's own list). */
  mine: z.coerce.boolean().default(false),
  incomplete: z.coerce.boolean().default(false),
});

tipsRouter.get('/tips', ...canReadLedger, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const q = parseBody(ledgerQuery, req.query);
    const month = q.month ?? monthOf(new Date());
    const rows = await prisma.tip.findMany({
      where: {
        ...byCompany(s),
        date: monthRange(month),
        ...(q.mine || s.role === 'FIELD_OFFICER' ? { paidById: s.userId } : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      select: tipSelect,
    });
    const tips = (await shapeTips(rows, s.accountId)).filter(
      (t) => !q.incomplete || (t.missing.length > 0 && !t.void),
    );
    const live = tips.filter((t) => !t.void && !t.pendingMd);
    const byPerson = new Map<
      string,
      { name: string; count: number; usdCents: number; withPayee: number }
    >();
    const byBox = new Map<string, { number: string; count: number; usdCents: number }>();
    for (const t of live) {
      const p = byPerson.get(t.paidById) ?? { name: t.paidBy, count: 0, usdCents: 0, withPayee: 0 };
      p.count++;
      p.usdCents += t.usdCents;
      if (t.payeeId) p.withPayee++;
      byPerson.set(t.paidById, p);
      for (const b of t.boxes) {
        if (b.status !== 'ACTIVE') continue;
        const x = byBox.get(b.id) ?? { number: b.number, count: 0, usdCents: 0 };
        x.count++;
        x.usdCents += b.usdCents;
        byBox.set(b.id, x);
      }
    }
    const figures = await tipFigures(s.accountId);
    const mine = s.companyId ?? s.activeCompanyId;
    const used = mine
      ? await capUsed(prisma, s.accountId, mine, month)
      : live.reduce((a, t) => a + t.usdCents, 0);
    res.json({
      month,
      tips,
      byPerson: [...byPerson.entries()].map(([id, p]) => ({
        id,
        ...p,
        usd: formatMoney(p.usdCents, 'USD'),
        payeePct: p.count ? Math.round((100 * p.withPayee) / p.count) : 0,
      })),
      byBox: [...byBox.entries()].map(([id, b]) => ({
        id,
        ...b,
        usd: formatMoney(b.usdCents, 'USD'),
      })),
      totals: {
        count: live.length,
        usdCents: live.reduce((a, t) => a + t.usdCents, 0),
        usd: formatMoney(
          live.reduce((a, t) => a + t.usdCents, 0),
          'USD',
        ),
      },
      cap: {
        usedUsdCents: used,
        usedUsd: formatMoney(used, 'USD'),
        capUsd: formatMoney(figures.tipCapUsdCents, 'USD'),
        pct: figures.tipCapUsdCents ? Math.round((100 * used) / figures.tipCapUsdCents) : 0,
      },
    });
  } catch (e) {
    next(e);
  }
});

/** The tip this caller may complete: their own, or any in their company's book for a manager or the MD. */
async function ownTip(s: Scope, id: string) {
  const t = await prisma.tip.findFirst({ where: { id, ...byAccount(s) }, select: tipSelect });
  if (!t) throw notFound('Tip not found');
  if (!mayTouchCompany(s, t.companyId)) throw forbidden("This tip is in the other company's book");
  if (s.role === 'FIELD_OFFICER' && t.paidById !== s.userId)
    throw forbidden('You can complete your own tips');
  return t;
}

tipsRouter.patch('/tips/:id', ...canComplete, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const patch = parseBody(tipPatch, req.body);
    const before = await ownTip(s, String(req.params.id));
    const row = await prisma.$transaction(async (tx) => {
      const t = await tx.tip.update({ where: { id: before.id }, data: patch, select: tipSelect });
      if (patch.payeeId !== undefined)
        await tx.costLine.updateMany({
          where: { tipId: before.id },
          data: { paidTo: patch.payeeId },
        });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: before.companyId,
          module: MODULE,
          action: 'tip_completed',
          entity: 'tip',
          entityId: before.id,
          before: {
            payeeType: before.payeeType,
            payeeId: before.payeeId,
            checkpoint: before.checkpoint,
            note: before.note,
          },
          after: patch,
          ip: clientIp(req),
        },
        tx,
      );
      return t;
    });
    res.json((await shapeTips([row], s.accountId))[0]);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- the receipt photo

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  webp: (b) =>
    b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
export const uploadRoot = () => resolve(config.UPLOAD_DIR ?? 'uploads');

tipsRouter.post(
  '/tips/:id/photo',
  json({ limit: '9mb' }),
  ...canComplete,
  async (req, res, next) => {
    try {
      const s = scopeOf(req);
      const { dataUrl } = parseBody(tipPhotoInput, req.body);
      const tip = await ownTip(s, String(req.params.id));
      const kind = dataUrl.slice(11, dataUrl.indexOf(';'));
      const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES)
        throw badRequest('The photo is empty or above 6 MB');
      if (!MAGIC[kind]?.(bytes)) throw badRequest('That file is not the photo it claims to be');
      const ext = kind === 'jpeg' ? 'jpg' : kind;
      const rel = `${s.accountId}/${tip.id}.${ext}`;
      const dir = resolve(uploadRoot(), s.accountId);
      await mkdir(dir, { recursive: true });
      await writeFile(resolve(uploadRoot(), rel), bytes);
      await prisma.$transaction(async (tx) => {
        await tx.tip.update({
          where: { id: tip.id },
          data: { receiptPath: rel, receiptType: `image/${kind}` },
        });
        await audit(
          {
            accountId: s.accountId,
            userId: s.userId,
            companyId: tip.companyId,
            module: MODULE,
            action: 'tip_photo_attached',
            entity: 'tip',
            entityId: tip.id,
            after: { bytes: bytes.length, type: `image/${kind}` },
            ip: clientIp(req),
          },
          tx,
        );
      });
      res.status(201).json({ ok: true, bytes: bytes.length });
    } catch (e) {
      next(e);
    }
  },
);

tipsRouter.get('/tips/:id/photo', ...canReadLedger, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const tip = await prisma.tip.findFirst({
      where: { id: String(req.params.id), ...byAccount(s) },
      select: { companyId: true, receiptPath: true, receiptType: true },
    });
    if (!tip || !tip.receiptPath) throw notFound('No photo on this tip');
    if (!mayTouchCompany(s, tip.companyId))
      throw forbidden("This tip is in the other company's book");
    res
      .type(tip.receiptType)
      .sendFile(
        resolve(uploadRoot(), tip.receiptPath),
        (err) => err && next(notFound('The photo file is missing')),
      );
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- a wrong tip

tipsRouter.post('/tips/:id/void', ...canComplete, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { reason } = parseBody(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    const tip = await ownTip(s, String(req.params.id));
    const live = tip.lines.filter((l) => l.status === 'ACTIVE');
    if (live.length === 0) throw conflict('This tip is already void');
    await prisma.$transaction(async (tx) => {
      await tx.costLine.updateMany({
        where: { id: { in: live.map((l) => l.id) } },
        data: { status: 'VOID', voidReason: reason },
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: tip.companyId,
          module: MODULE,
          action: 'tip_voided',
          entity: 'tip',
          entityId: tip.id,
          before: { usdCents: Number(tip.usdCents), lines: live.length },
          after: { reason },
          ip: clientIp(req),
        },
        tx,
      );
    });
    const row = await prisma.tip.findUniqueOrThrow({ where: { id: tip.id }, select: tipSelect });
    res.json((await shapeTips([row], s.accountId))[0]);
  } catch (e) {
    next(e);
  }
});
