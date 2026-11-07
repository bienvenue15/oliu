/**
 * Slice 6 — payments: request, approve, pay, lock.
 *
 * Every payment is a fixed state: REQUESTED → APPROVED → PAID (locked), or REJECTED; a repeated payment is
 * BLOCKED and goes to the MD. Nothing is paid without someone else's approval; above the threshold the approver
 * confirms with a one-time code mailed to their own mailbox. A paid order never changes again (a database
 * trigger refuses it). Beneficiaries sit on protected accounts: a new account, or a change of account, waits for
 * a second person's confirmation, also with a code, before any payment can use it.
 *
 * GET  /api/beneficiaries                       the registry (masked numbers), the people who may hold a float
 * POST /api/beneficiaries                       propose a new beneficiary (PENDING until confirmed)
 * POST /api/beneficiaries/:id/change            propose a change of account (waits for a second person)
 * POST /api/beneficiaries/:id/code              mail me my code to confirm it
 * POST /api/beneficiaries/:id/confirm           confirm with the code: verified, or the account changed
 * POST /api/beneficiaries/:id/drop              drop the pending change (a new beneficiary becomes suspended)
 * POST /api/beneficiaries/:id/suspend · /reactivate
 * GET  /api/payments/setup                      lists for the request form, the threshold
 * GET  /api/payments/candidates?bookingId=&holderId=   cost lines not yet on an order
 * POST /api/payments                            request: cost lines, an office expense, a float advance, a settlement
 * GET  /api/payments?month=                     open orders, the month's decided ones, the floats, the banks
 * POST /api/payments/:id/code                   mail me my code to approve an order above the threshold
 * POST /api/payments/:id/approve                one click (with the code above the threshold)
 * POST /api/payments/:id/reject                 with a reason; the lines are free again
 * POST /api/payments/:id/pay                    record the bank or MoMo reference; the order locks
 */
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  BENEFICIARY_TYPE_LABEL,
  beneficiaryChangeInput,
  beneficiaryConfirmInput,
  beneficiaryInput,
  beneficiaryReasonInput,
  formatMoney,
  PAYMENT_KIND_LABEL,
  PAYMENT_STATUS_LABEL,
  paymentApproveInput,
  paymentPayInput,
  paymentRequestInput,
  toUsdCents,
  type BeneficiaryType,
  type Currency,
  type PaymentKind,
  type PaymentStatus,
  type PayeeAccount,
} from '@oliu/shared';
import { byAccount, byCompany, mayTouchCompany, prisma, type Scope, type Tx } from '../../db.ts';
import { audit } from '../../lib/audit.ts';
import { consumeCode, issueCode } from '../../lib/codes.ts';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.ts';
import { parseBody } from '../../lib/validate.ts';
import {
  clientIp,
  requireAuth,
  requirePermission,
  requireScreen,
  scopeOf,
} from '../../middleware/auth.ts';
import { lineSelect, rateFor, shapeLines } from '../costs/routes.ts';

export const paymentsRouter = Router();
const MODULE = 'payments';
const canReadQueue = [requireAuth, requireScreen('queue')];
const canRequest = [requireAuth, requireScreen('queue'), requirePermission('write')];
const canApprove = [requireAuth, requireScreen('queue'), requirePermission('approve')];
const canPay = [requireAuth, requireScreen('cashier'), requirePermission('pay')];
const canReadBeneficiaries = [requireAuth, requireScreen('ben')];
const canPropose = [requireAuth, requireScreen('ben'), requirePermission('write')];
const canConfirm = [requireAuth, requireScreen('ben'), requirePermission('beneficiaries')];
const APPROVAL = 'PAYMENT_APPROVAL';
const BENEFICIARY = 'BENEFICIARY_CHANGE';
const OPEN: PaymentStatus[] = ['REQUESTED', 'BLOCKED', 'APPROVED'];
/** Statuses that still count as "this was paid, or is about to be": the ones a repeat is measured against. */
const LIVE: PaymentStatus[] = ['REQUESTED', 'BLOCKED', 'APPROVED', 'PAID'];

// ---------------------------------------------------------------- helpers

function writingCompany(s: Scope): string {
  const id = s.companyId ?? s.activeCompanyId;
  if (!id) throw badRequest('Choose a company in the switcher first');
  return id;
}
const day = (d: Date) => d.toISOString().slice(0, 10);
const atUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const todayUtc = () => atUtc(day(new Date()));
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}
const monthQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
/** •••• 4471 — the registry and the queue never show a whole number; the trail keeps it. */
const masked = (n: string) => (n.length > 4 ? `•••• ${n.slice(-4)}` : n);

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
type Names = Awaited<ReturnType<typeof names>>;

async function threshold(accountId: string): Promise<number> {
  const row = await prisma.accountSettings.findUnique({
    where: { accountId },
    select: { approvalThresholdUsdCents: true },
  });
  return row?.approvalThresholdUsdCents ?? 50000;
}

function companyCode(legalName: string): string {
  const first = legalName.trim().split(/\s+/)[0] ?? '';
  return (
    first
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 6) || 'PAY'
  );
}

/** OLIU-PR-2026-0001: one counter per company and year, taken atomically. */
async function nextNumber(tx: Tx, company: { id: string; legalName: string }): Promise<string> {
  const year = new Date().getUTCFullYear();
  const rows = await tx.$queryRaw<{ next: number }[]>`
    INSERT INTO "PaymentSequence" ("companyId", "year", "next") VALUES (${company.id}::uuid, ${year}, 1)
    ON CONFLICT ("companyId", "year") DO UPDATE SET "next" = "PaymentSequence"."next" + 1
    RETURNING "next"`;
  return `${companyCode(company.legalName)}-PR-${year}-${String(rows[0]!.next).padStart(4, '0')}`;
}

// ---------------------------------------------------------------- beneficiaries

type PendingChange = PayeeAccount & { reason: string };
type BeneficiaryRow = Prisma.BeneficiaryGetPayload<{ select: typeof beneficiarySelect }>;
const beneficiarySelect = {
  id: true,
  name: true,
  type: true,
  userId: true,
  accountKind: true,
  bank: true,
  number: true,
  currency: true,
  status: true,
  note: true,
  pendingChange: true,
  pendingById: true,
  pendingAt: true,
  verifiedById: true,
  verifiedAt: true,
  suspendReason: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BeneficiarySelect;

function shapeBeneficiary(b: BeneficiaryRow, n: Names) {
  const change = b.pendingChange as PendingChange | null;
  return {
    id: b.id,
    name: b.name,
    type: b.type,
    typeLabel: BENEFICIARY_TYPE_LABEL[b.type as BeneficiaryType] ?? b.type,
    userId: b.userId,
    holder: b.userId ? (n.user.get(b.userId) ?? '—') : null,
    accountKind: b.accountKind,
    bank: b.bank,
    number: masked(b.number),
    currency: b.currency,
    status: b.status,
    note: b.note,
    /** Four-eyes: the proposer's name and the proposed account, masked, until a second person confirms. */
    pending: change
      ? {
          accountKind: change.accountKind,
          bank: change.bank,
          number: masked(change.number),
          currency: change.currency,
          reason: change.reason,
          by: b.pendingById ? (n.user.get(b.pendingById) ?? '—') : '—',
          byId: b.pendingById,
          at: b.pendingAt,
        }
      : null,
    /** A new beneficiary is also waiting: whoever typed it does not verify it. */
    proposedBy: n.user.get(b.createdById) ?? '—',
    proposedById: b.createdById,
    verifiedBy: b.verifiedById ? (n.user.get(b.verifiedById) ?? '—') : null,
    verifiedAt: b.verifiedAt,
    suspendReason: b.suspendReason,
    /** True when a payment may be approved or paid to it right now. */
    payable: b.status === 'VERIFIED' && !change,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

async function beneficiaryOf(s: Scope, id: string): Promise<BeneficiaryRow> {
  const b = await prisma.beneficiary.findFirst({
    where: { id, ...byAccount(s) },
    select: beneficiarySelect,
  });
  if (!b) throw notFound('No such beneficiary');
  return b;
}

/** Why a payment to this beneficiary cannot go ahead now, or null. */
function notPayable(b: { status: string; pendingChange: unknown; name: string }): string | null {
  if (b.status === 'SUSPENDED') return `${b.name} is suspended`;
  if (b.status === 'PENDING') return `${b.name} is not yet verified by a second person`;
  if (b.pendingChange) return `${b.name}'s account change awaits a second approval`;
  return null;
}

paymentsRouter.get('/beneficiaries', ...canReadBeneficiaries, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const [rows, n, people] = await Promise.all([
      prisma.beneficiary.findMany({
        where: byAccount(s),
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        select: beneficiarySelect,
      }),
      names(s.accountId),
      prisma.user.findMany({
        where: { accountId: s.accountId, status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, companyId: true, role: true },
      }),
    ]);
    res.json({
      beneficiaries: rows.map((b) => shapeBeneficiary(b, n)),
      people: people.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        companyName: p.companyId ? (n.company.get(p.companyId) ?? '') : '',
      })),
      me: s.userId,
    });
  } catch (e) {
    next(e);
  }
});

paymentsRouter.post('/beneficiaries', ...canPropose, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(beneficiaryInput, req.body);
    if (input.type === 'STAFF') {
      if (!input.userId)
        throw badRequest('A staff beneficiary names the person who holds the float');
      const u = await prisma.user.findFirst({
        where: { id: input.userId, accountId: s.accountId },
        select: { id: true },
      });
      if (!u) throw badRequest('That person is not on this account');
    } else input.userId = null;
    const dup = await prisma.beneficiary.findFirst({
      where: { accountId: s.accountId, name: { equals: input.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (dup) throw conflict(`"${input.name}" is already in the registry`);
    const n = await names(s.accountId);
    // The owner's rule of 30 Oct 2026: a beneficiary the MD adds is verified at once; everyone else's waits
    // for a second person. A change of account keeps the second pair of eyes for all, the MD included.
    const byMd = s.role === 'MD';
    const row = await prisma.$transaction(async (tx) => {
      const b = await tx.beneficiary.create({
        data: {
          accountId: s.accountId,
          name: input.name,
          type: input.type,
          userId: input.userId,
          accountKind: input.accountKind,
          bank: input.bank,
          number: input.number,
          currency: input.currency,
          note: input.note,
          createdById: s.userId,
          ...(byMd ? { status: 'VERIFIED', verifiedById: s.userId, verifiedAt: new Date() } : {}),
        },
        select: beneficiarySelect,
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: s.companyId,
          module: MODULE,
          action: byMd ? 'beneficiary_added_by_md' : 'beneficiary_proposed',
          entity: 'beneficiary',
          entityId: b.id,
          after: {
            name: b.name,
            type: b.type,
            accountKind: b.accountKind,
            bank: b.bank,
            number: b.number,
            currency: b.currency,
          },
          ip: clientIp(req),
        },
        tx,
      );
      return b;
    });
    res.status(201).json(shapeBeneficiary(row, n));
  } catch (e) {
    next(e);
  }
});

paymentsRouter.post('/beneficiaries/:id/change', ...canPropose, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(beneficiaryChangeInput, req.body);
    const b = await beneficiaryOf(s, String(req.params.id));
    if (b.pendingChange) throw conflict('A change is already waiting for a second person');
    if (b.status === 'PENDING')
      throw conflict('Not yet verified: drop it and type it again instead');
    const n = await names(s.accountId);
    const row = await prisma.$transaction(async (tx) => {
      const u = await tx.beneficiary.update({
        where: { id: b.id },
        data: {
          pendingChange: input as unknown as Prisma.InputJsonValue,
          pendingById: s.userId,
          pendingAt: new Date(),
        },
        select: beneficiarySelect,
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: s.companyId,
          module: MODULE,
          action: 'beneficiary_change_proposed',
          entity: 'beneficiary',
          entityId: b.id,
          before: {
            accountKind: b.accountKind,
            bank: b.bank,
            number: b.number,
            currency: b.currency,
          },
          after: input,
          ip: clientIp(req),
        },
        tx,
      );
      return u;
    });
    res.json(shapeBeneficiary(row, n));
  } catch (e) {
    next(e);
  }
});

/** What is waiting on this beneficiary, and that the caller is a second pair of eyes. */
function confirmable(b: BeneficiaryRow, s: Scope): 'VERIFY' | 'CHANGE' {
  if (b.pendingChange) {
    if (b.pendingById === s.userId)
      throw forbidden('Four eyes: the person who proposed the change does not confirm it');
    return 'CHANGE';
  }
  if (b.status === 'PENDING') {
    if (b.createdById === s.userId)
      throw forbidden('Four eyes: the person who typed the beneficiary does not verify it');
    return 'VERIFY';
  }
  throw conflict('Nothing is waiting on this beneficiary');
}

paymentsRouter.post('/beneficiaries/:id/code', ...canConfirm, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const b = await beneficiaryOf(s, String(req.params.id));
    const what = confirmable(b, s);
    const change = b.pendingChange as PendingChange | null;
    await issueCode(s.userId, BENEFICIARY, {
      subject: `OLIU — your code to confirm ${b.name}'s account`,
      text: (code) =>
        `${what === 'CHANGE' ? `A change of account for ${b.name} was proposed: ${change!.bank} ${masked(change!.number)} (${change!.currency}). ${change!.reason}` : `${b.name} was added to the registry: ${b.bank} ${masked(b.number)} (${b.currency}).`}\nYour code, if you agree: ${code}\nIt works once and expires soon.`,
    });
    await audit({
      accountId: s.accountId,
      userId: s.userId,
      companyId: s.companyId,
      module: MODULE,
      action: 'beneficiary_code_sent',
      entity: 'beneficiary',
      entityId: b.id,
      after: { what },
      ip: clientIp(req),
    });
    res.json({ sent: true });
  } catch (e) {
    next(e);
  }
});

paymentsRouter.post('/beneficiaries/:id/confirm', ...canConfirm, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { code } = parseBody(beneficiaryConfirmInput, req.body);
    const b = await beneficiaryOf(s, String(req.params.id));
    const what = confirmable(b, s);
    const n = await names(s.accountId);
    const row = await prisma.$transaction(async (tx) => {
      await consumeCode(tx, s.userId, BENEFICIARY, code);
      const change = b.pendingChange as PendingChange | null;
      const u = await tx.beneficiary.update({
        where: { id: b.id },
        data: {
          ...(change
            ? {
                accountKind: change.accountKind,
                bank: change.bank,
                number: change.number,
                currency: change.currency,
              }
            : {}),
          pendingChange: Prisma.DbNull,
          pendingById: null,
          pendingAt: null,
          status: b.status === 'SUSPENDED' ? 'SUSPENDED' : 'VERIFIED',
          verifiedById: s.userId,
          verifiedAt: new Date(),
        },
        select: beneficiarySelect,
      });
      // The old and the new numbers are kept in the trail forever, whole.
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: s.companyId,
          module: MODULE,
          action: what === 'CHANGE' ? 'beneficiary_account_changed' : 'beneficiary_verified',
          entity: 'beneficiary',
          entityId: b.id,
          before: {
            accountKind: b.accountKind,
            bank: b.bank,
            number: b.number,
            currency: b.currency,
          },
          after: {
            accountKind: u.accountKind,
            bank: u.bank,
            number: u.number,
            currency: u.currency,
            proposedBy: n.user.get((change ? b.pendingById : b.createdById) ?? '') ?? '—',
          },
          ip: clientIp(req),
        },
        tx,
      );
      return u;
    });
    res.json(shapeBeneficiary(row, n));
  } catch (e) {
    next(e);
  }
});

paymentsRouter.post('/beneficiaries/:id/drop', ...canPropose, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { reason } = parseBody(beneficiaryReasonInput, req.body);
    const b = await beneficiaryOf(s, String(req.params.id));
    if (!b.pendingChange && b.status !== 'PENDING')
      throw conflict('Nothing is waiting on this beneficiary');
    const n = await names(s.accountId);
    const row = await prisma.$transaction(async (tx) => {
      const u = await tx.beneficiary.update({
        where: { id: b.id },
        data: b.pendingChange
          ? { pendingChange: Prisma.DbNull, pendingById: null, pendingAt: null }
          : { status: 'SUSPENDED', suspendReason: reason },
        select: beneficiarySelect,
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: s.companyId,
          module: MODULE,
          action: b.pendingChange ? 'beneficiary_change_dropped' : 'beneficiary_dropped',
          entity: 'beneficiary',
          entityId: b.id,
          before: b.pendingChange ?? { status: b.status },
          after: { reason },
          ip: clientIp(req),
        },
        tx,
      );
      return u;
    });
    res.json(shapeBeneficiary(row, n));
  } catch (e) {
    next(e);
  }
});

for (const action of ['suspend', 'reactivate'] as const)
  paymentsRouter.post(`/beneficiaries/:id/${action}`, ...canConfirm, async (req, res, next) => {
    try {
      const s = scopeOf(req);
      const { reason } = parseBody(beneficiaryReasonInput, req.body);
      const b = await beneficiaryOf(s, String(req.params.id));
      if (action === 'suspend' && b.status === 'SUSPENDED') throw conflict('Already suspended');
      if (action === 'reactivate' && b.status !== 'SUSPENDED') throw conflict('Not suspended');
      const n = await names(s.accountId);
      const row = await prisma.$transaction(async (tx) => {
        const u = await tx.beneficiary.update({
          where: { id: b.id },
          data:
            action === 'suspend'
              ? { status: 'SUSPENDED', suspendReason: reason }
              : { status: b.verifiedAt ? 'VERIFIED' : 'PENDING', suspendReason: '' },
          select: beneficiarySelect,
        });
        await audit(
          {
            accountId: s.accountId,
            userId: s.userId,
            companyId: s.companyId,
            module: MODULE,
            action: `beneficiary_${action === 'suspend' ? 'suspended' : 'reactivated'}`,
            entity: 'beneficiary',
            entityId: b.id,
            before: { status: b.status },
            after: { status: u.status, reason },
            ip: clientIp(req),
          },
          tx,
        );
        return u;
      });
      res.json(shapeBeneficiary(row, n));
    } catch (e) {
      next(e);
    }
  });

// ---------------------------------------------------------------- payment orders: shape

const paymentSelect = {
  id: true,
  companyId: true,
  number: true,
  kind: true,
  purpose: true,
  beneficiaryId: true,
  beneficiary: {
    select: {
      name: true,
      bank: true,
      number: true,
      status: true,
      pendingChange: true,
      userId: true,
    },
  },
  categoryId: true,
  date: true,
  currency: true,
  amountMinor: true,
  perUsd: true,
  usdCents: true,
  status: true,
  note: true,
  requestedById: true,
  requestedAt: true,
  approvedById: true,
  approvedAt: true,
  approvedWithCode: true,
  rejectedById: true,
  rejectedAt: true,
  rejectReason: true,
  paidById: true,
  paidAt: true,
  paidRef: true,
  paidFromBankId: true,
  lockedAt: true,
  lines: {
    select: {
      id: true,
      date: true,
      currency: true,
      amountMinor: true,
      usdCents: true,
      tipId: true,
      container: { select: { number: true } },
      category: { select: { name: true } },
    },
    orderBy: { date: 'asc' },
  },
} satisfies Prisma.PaymentRequestSelect;
type PaymentRow = Prisma.PaymentRequestGetPayload<{ select: typeof paymentSelect }>;

function shapePayment(
  p: PaymentRow,
  n: Names,
  extra: {
    thresholdUsdCents: number;
    categories: Map<string, string>;
    banks: Map<string, string>;
    blocked: Map<string, { existingNumber: string; existingId: string }>;
  },
) {
  const currency = p.currency as Currency;
  const who = (id: string | null) => (id ? (n.user.get(id) ?? '—') : null);
  return {
    id: p.id,
    number: p.number,
    kind: p.kind,
    kindLabel: PAYMENT_KIND_LABEL[p.kind as PaymentKind],
    purpose: p.purpose,
    companyId: p.companyId,
    companyName: n.company.get(p.companyId) ?? '',
    beneficiary: {
      id: p.beneficiaryId,
      name: p.beneficiary.name,
      bank: p.beneficiary.bank,
      number: masked(p.beneficiary.number),
      status: p.beneficiary.status,
      /** Why the order cannot be approved or paid right now, if so. */
      hold: notPayable(p.beneficiary),
    },
    category: p.categoryId ? (extra.categories.get(p.categoryId) ?? '') : '',
    date: day(p.date),
    currency,
    amountMinor: Number(p.amountMinor),
    amount: formatMoney(p.amountMinor, currency),
    usdCents: Number(p.usdCents),
    usd: formatMoney(p.usdCents, 'USD'),
    status: p.status,
    statusLabel: PAYMENT_STATUS_LABEL[p.status as PaymentStatus],
    note: p.note,
    requestedBy: who(p.requestedById),
    requestedById: p.requestedById,
    requestedAt: p.requestedAt,
    approvedBy: who(p.approvedById),
    approvedAt: p.approvedAt,
    approvedWithCode: p.approvedWithCode,
    rejectedBy: who(p.rejectedById),
    rejectedAt: p.rejectedAt,
    rejectReason: p.rejectReason,
    paidBy: who(p.paidById),
    paidAt: p.paidAt,
    paidRef: p.paidRef,
    paidFrom: p.paidFromBankId ? (extra.banks.get(p.paidFromBankId) ?? '') : '',
    lockedAt: p.lockedAt,
    /** Above the threshold: the approver's one-time code is needed. */
    needsCode: Number(p.usdCents) > extra.thresholdUsdCents,
    blocked: extra.blocked.get(p.id) ?? null,
    lines: p.lines.map((l) => ({
      id: l.id,
      containerNumber: l.container.number,
      category: l.category.name,
      date: day(l.date),
      amount: formatMoney(l.amountMinor, l.currency as Currency),
      usd: formatMoney(l.usdCents, 'USD'),
      tip: l.tipId !== null,
    })),
  };
}

async function shapeContext(s: Scope) {
  const [n, t, cats, banks] = await Promise.all([
    names(s.accountId),
    threshold(s.accountId),
    prisma.costCategory.findMany({ where: byAccount(s), select: { id: true, name: true } }),
    prisma.bankAccount.findMany({
      where: byAccount(s),
      select: { id: true, bank: true, number: true, currency: true },
    }),
  ]);
  return {
    n,
    thresholdUsdCents: t,
    categories: new Map(cats.map((c) => [c.id, c.name])),
    banks: new Map(banks.map((b) => [b.id, `${b.bank} ${masked(b.number)} ${b.currency}`])),
  };
}

/** The open REPEAT_PAYMENT items, by payment id, so the queue shows which order it repeats. */
async function blockedBy(accountId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, { existingNumber: string; existingId: string }>();
  const items = await prisma.mdQueueItem.findMany({
    where: { accountId, kind: 'REPEAT_PAYMENT', status: 'OPEN', entityId: { in: ids } },
    select: { entityId: true, summary: true },
  });
  return new Map(
    items.map((i) => {
      const sum = i.summary as { existingNumber: string; existingId: string };
      return [i.entityId, { existingNumber: sum.existingNumber, existingId: sum.existingId }];
    }),
  );
}

async function paymentOf(s: Scope, id: string): Promise<PaymentRow> {
  const p = await prisma.paymentRequest.findFirst({
    where: { id, ...byAccount(s) },
    select: paymentSelect,
  });
  if (!p) throw notFound('No such payment order');
  if (!mayTouchCompany(s, p.companyId)) throw forbidden("That order is in another company's book");
  return p;
}

async function oneShaped(s: Scope, id: string) {
  const p = await paymentOf(s, id);
  const ctx = await shapeContext(s);
  return shapePayment(p, ctx.n, { ...ctx, blocked: await blockedBy(s.accountId, [p.id]) });
}

// ---------------------------------------------------------------- payment orders: request

paymentsRouter.get('/payments/setup', ...canReadQueue, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const [beneficiaries, categories, t, n] = await Promise.all([
      prisma.beneficiary.findMany({
        where: { ...byAccount(s), status: { not: 'SUSPENDED' } },
        orderBy: { name: 'asc' },
        select: beneficiarySelect,
      }),
      prisma.costCategory.findMany({
        where: { ...byAccount(s), active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, isTip: true },
      }),
      threshold(s.accountId),
      names(s.accountId),
    ]);
    res.json({
      beneficiaries: beneficiaries.map((b) => shapeBeneficiary(b, n)),
      categories,
      thresholdUsd: formatMoney(t, 'USD'),
      thresholdUsdCents: t,
    });
  } catch (e) {
    next(e);
  }
});

const candidatesQuery = z.object({
  bookingId: z.string().uuid().optional(),
  holderId: z.string().uuid().optional(),
});
/** Live lines in my book not yet on an order; for a float holder, their cash lines (their tips, what they typed). */
paymentsRouter.get('/payments/candidates', ...canReadQueue, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const q = parseBody(candidatesQuery, req.query);
    const holder = q.holderId
      ? await prisma.beneficiary.findFirst({
          where: { id: q.holderId, ...byAccount(s) },
          select: { userId: true },
        })
      : null;
    if (q.holderId && !holder?.userId) throw badRequest('That beneficiary holds no float');
    const rows = await prisma.costLine.findMany({
      where: {
        ...byCompany(s),
        status: 'ACTIVE',
        paymentId: null,
        ...(q.bookingId ? { bookingId: q.bookingId } : {}),
        ...(holder?.userId
          ? {
              OR: [
                { tip: { paidById: holder.userId } },
                { enteredById: holder.userId, tipId: null },
              ],
            }
          : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      select: lineSelect,
    });
    res.json(await shapeLines(rows, s.accountId));
  } catch (e) {
    next(e);
  }
});

type LineForOrder = Prisma.CostLineGetPayload<{
  select: {
    id: true;
    containerId: true;
    categoryId: true;
    bookingId: true;
    currency: true;
    amountMinor: true;
    usdCents: true;
    perUsd: true;
    tipId: true;
    enteredById: true;
    tip: { select: { paidById: true } };
    container: { select: { number: true } };
    category: { select: { name: true } };
  };
}>;

/** The lines of an order: all found, mine, live, free, in one currency. */
async function linesForOrder(s: Scope, companyId: string, ids: string[]): Promise<LineForOrder[]> {
  const rows = await prisma.costLine.findMany({
    where: { id: { in: ids }, accountId: s.accountId },
    select: {
      id: true,
      companyId: true,
      status: true,
      paymentId: true,
      containerId: true,
      categoryId: true,
      bookingId: true,
      currency: true,
      amountMinor: true,
      usdCents: true,
      perUsd: true,
      tipId: true,
      enteredById: true,
      tip: { select: { paidById: true } },
      container: { select: { number: true } },
      category: { select: { name: true } },
      payment: { select: { number: true } },
    },
  });
  if (rows.length !== new Set(ids).size) throw badRequest('A line is missing or not yours');
  for (const r of rows) {
    if (r.companyId !== companyId)
      throw forbidden(`${r.container.number} · ${r.category.name} is in another company's book`);
    if (r.status !== 'ACTIVE')
      throw badRequest(`${r.container.number} · ${r.category.name} is ${r.status.toLowerCase()}`);
    if (r.paymentId)
      throw conflict(
        `${r.container.number} · ${r.category.name} is already on ${r.payment!.number}`,
      );
  }
  if (new Set(rows.map((r) => r.currency)).size > 1)
    throw badRequest('One order, one currency: split the lines by currency');
  return rows;
}

/**
 * The repeat rule: one beneficiary + one box + one category = paid once. A line whose box and category are
 * already on a live order to the same beneficiary makes the new order BLOCKED, for the MD.
 */
async function repeatOfLines(
  accountId: string,
  beneficiaryId: string,
  lines: LineForOrder[],
): Promise<{
  existingNumber: string;
  existingId: string;
  number: string;
  category: string;
} | null> {
  for (const l of lines) {
    const hit = await prisma.costLine.findFirst({
      where: {
        accountId,
        containerId: l.containerId,
        categoryId: l.categoryId,
        id: { not: l.id },
        payment: { beneficiaryId, status: { in: LIVE } },
      },
      select: { payment: { select: { id: true, number: true } } },
    });
    if (hit?.payment)
      return {
        existingNumber: hit.payment.number,
        existingId: hit.payment.id,
        number: l.container.number,
        category: l.category.name,
      };
  }
  return null;
}

/** An office expense repeats when the same beneficiary, category, amount and date are already on a live order. */
async function repeatOfExpense(
  accountId: string,
  e: {
    beneficiaryId: string;
    categoryId: string;
    amountMinor: number;
    currency: string;
    date: Date;
  },
) {
  const hit = await prisma.paymentRequest.findFirst({
    where: {
      accountId,
      kind: 'EXPENSE',
      beneficiaryId: e.beneficiaryId,
      categoryId: e.categoryId,
      amountMinor: BigInt(e.amountMinor),
      currency: e.currency,
      date: e.date,
      status: { in: LIVE },
    },
    select: { id: true, number: true },
  });
  return hit ? { existingNumber: hit.number, existingId: hit.id } : null;
}

const sumBig = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

paymentsRouter.post('/payments', ...canRequest, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(paymentRequestInput, req.body);
    const companyId = writingCompany(s);
    const company = await prisma.company.findFirstOrThrow({
      where: { id: companyId, accountId: s.accountId },
      select: { id: true, legalName: true },
    });
    const b = await beneficiaryOf(s, input.beneficiaryId);
    if (b.status === 'SUSPENDED') throw conflict(`${b.name} is suspended`);

    // What the order is for, and how much, by kind.
    let lines: LineForOrder[] = [];
    let amountMinor: bigint;
    let usdCents: bigint;
    let perUsd: Prisma.Decimal;
    let currency: Currency;
    let date = todayUtc();
    let purpose = '';
    let categoryId: string | null = null;
    let repeat: {
      existingNumber: string;
      existingId: string;
      number?: string;
      category?: string;
    } | null = null;
    if (input.kind === 'COST' || input.kind === 'SETTLEMENT') {
      lines = await linesForOrder(s, companyId, input.costLineIds);
      if (input.kind === 'SETTLEMENT') {
        if (!b.userId)
          throw badRequest(`${b.name} holds no float: a settlement names a staff beneficiary`);
        const foreign = lines.find(
          (l) =>
            !(l.tip?.paidById === b.userId || (l.tipId === null && l.enteredById === b.userId)),
        );
        if (foreign)
          throw badRequest(
            `${foreign.container.number} · ${foreign.category.name} was not paid by ${b.name}`,
          );
      }
      currency = lines[0]!.currency as Currency;
      amountMinor = sumBig(lines.map((l) => l.amountMinor));
      usdCents = sumBig(lines.map((l) => l.usdCents));
      const rates = new Set(lines.map((l) => l.perUsd.toString()));
      perUsd =
        rates.size === 1
          ? lines[0]!.perUsd
          : new Prisma.Decimal(Number(amountMinor) / (Number(usdCents) / 100)).toDecimalPlaces(3);
      const cats = [...new Set(lines.map((l) => l.category.name))];
      const refs = (
        await prisma.booking.findMany({
          where: { id: { in: [...new Set(lines.map((l) => l.bookingId))] } },
          select: { reference: true },
        })
      ).map((b) => b.reference);
      purpose =
        ('purpose' in input ? input.purpose : '') ||
        (input.kind === 'SETTLEMENT'
          ? `Float settlement — ${lines.length} ${lines.length === 1 ? 'line' : 'lines'} · ${refs.join(', ')}`
          : `${cats.join(', ')} — ${lines.length} ${lines.length === 1 ? 'box' : 'boxes'} · ${refs.join(', ')}`);
      if (input.kind === 'COST') repeat = await repeatOfLines(s.accountId, b.id, lines);
    } else {
      if (input.kind === 'FLOAT_ADVANCE' && !b.userId)
        throw badRequest(`${b.name} holds no float: an advance names a staff beneficiary`);
      currency = input.currency;
      amountMinor = BigInt(input.amountMinor);
      if (input.kind === 'EXPENSE') {
        const cat = await prisma.costCategory.findFirst({
          where: { id: input.categoryId, ...byAccount(s), active: true },
          select: { id: true, name: true },
        });
        if (!cat) throw badRequest('Choose a category');
        categoryId = cat.id;
        date = atUtc(input.date);
        purpose = input.purpose;
        repeat = await repeatOfExpense(s.accountId, {
          beneficiaryId: b.id,
          categoryId: cat.id,
          amountMinor: input.amountMinor,
          currency,
          date,
        });
      } else purpose = input.purpose || `Float advance to ${b.name}`;
      perUsd = await rateFor(s.accountId, currency, date);
      usdCents = BigInt(toUsdCents(amountMinor, currency, perUsd.toString()));
    }

    const created = await prisma.$transaction(async (tx) => {
      const p = await tx.paymentRequest.create({
        data: {
          accountId: s.accountId,
          companyId,
          number: await nextNumber(tx, company),
          kind: input.kind,
          purpose,
          beneficiaryId: b.id,
          categoryId,
          date,
          currency,
          amountMinor,
          perUsd,
          usdCents,
          status: repeat ? 'BLOCKED' : 'REQUESTED',
          note: input.note,
          requestedById: s.userId,
        },
        select: { id: true, number: true },
      });
      if (lines.length)
        await tx.costLine.updateMany({
          where: { id: { in: lines.map((l) => l.id) } },
          data: { paymentId: p.id },
        });
      const base = {
        accountId: s.accountId,
        userId: s.userId,
        companyId,
        module: MODULE,
        entity: 'payment',
        entityId: p.id,
        ip: clientIp(req),
      };
      await audit(
        {
          ...base,
          action: 'payment_requested',
          after: {
            number: p.number,
            kind: input.kind,
            purpose,
            beneficiary: b.name,
            amount: formatMoney(amountMinor, currency),
            currency,
            usd: formatMoney(usdCents, 'USD'),
            lines: lines.map((l) => l.id),
          },
        },
        tx,
      );
      if (repeat) {
        await tx.mdQueueItem.create({
          data: {
            accountId: s.accountId,
            companyId,
            kind: 'REPEAT_PAYMENT',
            entity: 'payment',
            entityId: p.id,
            createdById: s.userId,
            summary: {
              number: p.number,
              existingNumber: repeat.existingNumber,
              existingId: repeat.existingId,
              beneficiary: b.name,
              box: repeat.number ?? '',
              category: repeat.category ?? '',
              purpose,
              amount: formatMoney(amountMinor, currency),
              currency,
            },
          },
        });
        await audit(
          {
            ...base,
            action: 'payment_blocked',
            after: { number: p.number, repeats: repeat.existingNumber, box: repeat.number ?? '' },
          },
          tx,
        );
      }
      return p;
    });
    res.status(201).json(await oneShaped(s, created.id));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- payment orders: list, floats

/** Cash in staff hands: advances paid to a holder, minus the settlements approved, per currency. */
async function floats(s: Scope, n: Names) {
  const rows = await prisma.paymentRequest.groupBy({
    by: ['beneficiaryId', 'kind', 'currency'],
    where: {
      ...byCompany(s),
      status: 'PAID',
      kind: { in: ['FLOAT_ADVANCE', 'SETTLEMENT'] },
    },
    _sum: { amountMinor: true, usdCents: true },
  });
  if (rows.length === 0) return [];
  const holders = await prisma.beneficiary.findMany({
    where: { id: { in: rows.map((r) => r.beneficiaryId) } },
    select: { id: true, name: true, userId: true },
  });
  const byKey = new Map<
    string,
    {
      beneficiaryId: string;
      holder: string;
      currency: Currency;
      advanced: bigint;
      settled: bigint;
      usd: bigint;
    }
  >();
  for (const r of rows) {
    const key = `${r.beneficiaryId}|${r.currency}`;
    const h = holders.find((x) => x.id === r.beneficiaryId);
    const row = byKey.get(key) ?? {
      beneficiaryId: r.beneficiaryId,
      holder: h?.userId ? (n.user.get(h.userId) ?? h.name) : (h?.name ?? '—'),
      currency: r.currency as Currency,
      advanced: 0n,
      settled: 0n,
      usd: 0n,
    };
    const amount = r._sum.amountMinor ?? 0n;
    const usd = r._sum.usdCents ?? 0n;
    if (r.kind === 'FLOAT_ADVANCE') {
      row.advanced += amount;
      row.usd += usd;
    } else {
      row.settled += amount;
      row.usd -= usd;
    }
    byKey.set(key, row);
  }
  return [...byKey.values()]
    .sort((a, b) => a.holder.localeCompare(b.holder))
    .map((r) => ({
      beneficiaryId: r.beneficiaryId,
      holder: r.holder,
      currency: r.currency,
      advanced: formatMoney(r.advanced, r.currency),
      settled: formatMoney(r.settled, r.currency),
      inHandMinor: Number(r.advanced - r.settled),
      inHand: formatMoney(r.advanced - r.settled, r.currency),
      inHandUsd: formatMoney(r.usd, 'USD'),
    }));
}

paymentsRouter.get('/payments', ...canReadQueue, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const q = parseBody(monthQuery, req.query);
    const month = q.month ?? day(new Date()).slice(0, 7);
    const range = monthRange(month);
    const [open, done, ctx] = await Promise.all([
      prisma.paymentRequest.findMany({
        where: { ...byCompany(s), status: { in: OPEN } },
        orderBy: { requestedAt: 'asc' },
        select: paymentSelect,
      }),
      prisma.paymentRequest.findMany({
        where: {
          ...byCompany(s),
          OR: [
            { status: 'PAID', paidAt: range },
            { status: 'REJECTED', rejectedAt: range },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 300,
        select: paymentSelect,
      }),
      shapeContext(s),
    ]);
    const blocked = await blockedBy(
      s.accountId,
      open.filter((p) => p.status === 'BLOCKED').map((p) => p.id),
    );
    const mine = s.companyId ?? s.activeCompanyId;
    const banks = await prisma.bankAccount.findMany({
      where: {
        ...byAccount(s),
        active: true,
        ...(mine
          ? { OR: [{ companyId: mine }, { company: { branches: { some: { id: mine } } } }] }
          : {}),
      },
      orderBy: [{ currency: 'asc' }, { bank: 'asc' }],
      select: { id: true, bank: true, number: true, currency: true, companyId: true },
    });
    const shape = (p: PaymentRow) => shapePayment(p, ctx.n, { ...ctx, blocked });
    const paid = done.filter((p) => p.status === 'PAID');
    res.json({
      month,
      me: s.userId,
      thresholdUsd: formatMoney(ctx.thresholdUsdCents, 'USD'),
      thresholdUsdCents: ctx.thresholdUsdCents,
      open: open.map(shape),
      done: done.map(shape),
      totals: {
        waiting: open.filter((p) => p.status === 'REQUESTED').length,
        blocked: open.filter((p) => p.status === 'BLOCKED').length,
        toPay: open.filter((p) => p.status === 'APPROVED').length,
        paidThisMonth: paid.length,
        paidUsd: formatMoney(sumBig(paid.map((p) => p.usdCents)), 'USD'),
      },
      floats: await floats(s, ctx.n),
      banks: banks.map((b) => ({
        id: b.id,
        label: `${b.bank} ${masked(b.number)} · ${b.currency}`,
        currency: b.currency,
        companyName: ctx.n.company.get(b.companyId) ?? '',
      })),
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- approve, reject, pay

/** The checks every approval goes through before the code question. */
async function approvable(s: Scope, id: string) {
  const p = await paymentOf(s, id);
  if (p.status === 'BLOCKED')
    throw conflict('Blocked as a repeat: the Managing Director rules on it first');
  if (p.status !== 'REQUESTED')
    throw conflict(`Already ${PAYMENT_STATUS_LABEL[p.status as PaymentStatus].toLowerCase()}`);
  if (p.requestedById === s.userId)
    throw forbidden('Four eyes: the person who requested a payment does not approve it');
  const hold = notPayable(p.beneficiary);
  if (hold) throw conflict(hold);
  return p;
}

paymentsRouter.post('/payments/:id/code', ...canApprove, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const p = await approvable(s, String(req.params.id));
    const t = await threshold(s.accountId);
    if (Number(p.usdCents) <= t)
      throw badRequest('Below the threshold: one click approves it, no code');
    await issueCode(s.userId, APPROVAL, {
      subject: `OLIU — your code to approve ${p.number}`,
      text: (code) =>
        `${p.number} · ${p.purpose} · ${formatMoney(p.amountMinor, p.currency as Currency)} ${p.currency} to ${p.beneficiary.name} (${p.beneficiary.bank} ${masked(p.beneficiary.number)}), above the approval threshold.\nYour code, if you agree: ${code}\nIt works once and expires soon.`,
    });
    await audit({
      accountId: s.accountId,
      userId: s.userId,
      companyId: p.companyId,
      module: MODULE,
      action: 'approval_code_sent',
      entity: 'payment',
      entityId: p.id,
      after: { number: p.number },
      ip: clientIp(req),
    });
    res.json({ sent: true });
  } catch (e) {
    next(e);
  }
});

paymentsRouter.post('/payments/:id/approve', ...canApprove, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { code } = parseBody(paymentApproveInput, req.body);
    const p = await approvable(s, String(req.params.id));
    const t = await threshold(s.accountId);
    const needsCode = Number(p.usdCents) > t;
    if (needsCode && !code)
      throw badRequest(`Above ${formatMoney(t, 'USD')}: ask for your code and type it to approve`, {
        needsCode: true,
      });
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      if (needsCode) await consumeCode(tx, s.userId, APPROVAL, code!);
      // A settlement moves no money: approving it is the whole act, and the float drops at once.
      const settled = p.kind === 'SETTLEMENT';
      await tx.paymentRequest.update({
        where: { id: p.id },
        data: {
          status: settled ? 'PAID' : 'APPROVED',
          approvedById: s.userId,
          approvedAt: now,
          approvedWithCode: needsCode,
          ...(settled ? { paidById: s.userId, paidAt: now, paidRef: 'FLOAT', lockedAt: now } : {}),
        },
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: p.companyId,
          module: MODULE,
          action: settled ? 'float_settled' : 'payment_approved',
          entity: 'payment',
          entityId: p.id,
          after: {
            number: p.number,
            amount: formatMoney(p.amountMinor, p.currency as Currency),
            currency: p.currency,
            beneficiary: p.beneficiary.name,
            withCode: needsCode,
          },
          ip: clientIp(req),
        },
        tx,
      );
    });
    res.json(await oneShaped(s, p.id));
  } catch (e) {
    next(e);
  }
});

paymentsRouter.post('/payments/:id/reject', ...canApprove, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { reason } = parseBody(beneficiaryReasonInput, req.body);
    const p = await paymentOf(s, String(req.params.id));
    if (p.status !== 'REQUESTED' && p.status !== 'APPROVED')
      throw conflict(`Already ${PAYMENT_STATUS_LABEL[p.status as PaymentStatus].toLowerCase()}`);
    await rejectOrder(s, p, reason, 'payment_rejected', clientIp(req));
    res.json(await oneShaped(s, p.id));
  } catch (e) {
    next(e);
  }
});

/** REJECTED, and the lines are free to be requested again. Also the MD's refusal of a repeat. */
async function rejectOrder(s: Scope, p: PaymentRow, reason: string, action: string, ip: string) {
  await prisma.$transaction(async (tx) => {
    await tx.paymentRequest.update({
      where: { id: p.id },
      data: {
        status: 'REJECTED',
        rejectedById: s.userId,
        rejectedAt: new Date(),
        rejectReason: reason,
      },
    });
    await tx.costLine.updateMany({ where: { paymentId: p.id }, data: { paymentId: null } });
    await audit(
      {
        accountId: s.accountId,
        userId: s.userId,
        companyId: p.companyId,
        module: MODULE,
        action,
        entity: 'payment',
        entityId: p.id,
        before: { status: p.status },
        after: { number: p.number, reason },
        ip,
      },
      tx,
    );
  });
}

paymentsRouter.post('/payments/:id/pay', ...canPay, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(paymentPayInput, req.body);
    const p = await paymentOf(s, String(req.params.id));
    if (p.status !== 'APPROVED')
      throw conflict(
        p.status === 'PAID'
          ? 'Already paid and locked'
          : 'Not approved yet: nothing is paid without an approval',
      );
    const hold = notPayable(p.beneficiary);
    if (hold) throw conflict(hold);
    if (input.bankAccountId) {
      const bank = await prisma.bankAccount.findFirst({
        where: { id: input.bankAccountId, ...byAccount(s), active: true },
        select: { companyId: true, company: { select: { parentId: true } } },
      });
      if (!bank) throw badRequest('No such bank account');
      const payer = await prisma.company.findUniqueOrThrow({
        where: { id: p.companyId },
        select: { parentId: true },
      });
      if (bank.companyId !== p.companyId && bank.companyId !== payer.parentId)
        throw badRequest("That bank account is another company's");
    }
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.paymentRequest.update({
        where: { id: p.id },
        data: {
          status: 'PAID',
          paidById: s.userId,
          paidAt: now,
          paidRef: input.reference,
          paidFromBankId: input.bankAccountId,
          lockedAt: now,
        },
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: p.companyId,
          module: MODULE,
          action: 'payment_paid_locked',
          entity: 'payment',
          entityId: p.id,
          after: {
            number: p.number,
            amount: formatMoney(p.amountMinor, p.currency as Currency),
            currency: p.currency,
            beneficiary: p.beneficiary.name,
            reference: input.reference,
          },
          ip: clientIp(req),
        },
        tx,
      );
    });
    res.json(await oneShaped(s, p.id));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- the MD's ruling on a repeat

/** Called by the MD queue's resolve route: ALLOW sends the order on to approval, REFUSE rejects it. */
export async function resolveRepeatPayment(
  s: Scope,
  item: { id: string; entityId: string; companyId: string | null; summary: unknown },
  input: { resolution: string; reason?: string | undefined },
  ip: string,
) {
  if (input.resolution !== 'ALLOW' && input.resolution !== 'REFUSE')
    throw badRequest('Allow it as genuine, or refuse it');
  if (input.resolution === 'REFUSE' && !input.reason) throw badRequest('Say why it is refused');
  const p = await paymentOf(s, item.entityId);
  if (p.status !== 'BLOCKED') throw conflict('This order is no longer blocked');
  if (input.resolution === 'REFUSE')
    await rejectOrder(s, p, `Refused by the MD: ${input.reason}`, 'repeat_payment_refused', ip);
  return prisma.$transaction(async (tx) => {
    if (input.resolution === 'ALLOW') {
      await tx.paymentRequest.update({ where: { id: p.id }, data: { status: 'REQUESTED' } });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: p.companyId,
          module: MODULE,
          action: 'repeat_payment_allowed',
          entity: 'payment',
          entityId: p.id,
          after: { number: p.number, reason: input.reason ?? '' },
          ip,
        },
        tx,
      );
    }
    return tx.mdQueueItem.update({
      where: { id: item.id },
      data: {
        status: 'RESOLVED',
        resolution: input.resolution,
        resolvedById: s.userId,
        resolvedAt: new Date(),
      },
    });
  });
}
