/**
 * Accounts, companies, people — the spine.
 *
 * POST /api/accounts                 create an account from the set-up questions (public; the owner becomes the MD)
 * GET  /api/account                  the account with its companies and bank accounts
 * PATCH /api/companies/:id           edit a company's details (MD)
 * POST /api/companies/:id/banks      add a bank account (MD; four-eyes comes with the Payments slice)
 * GET  /api/users                    people of the account (MD) — scoped to their company for others
 * POST /api/users                    invite (MD)
 * POST /api/users/:id/suspend | reactivate | reinvite   (MD)
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  accountSetupInput, bankAccountInput, inviteUserInput, ROLES_SPANNING_ALL_COMPANIES, type Role,
} from '@oliu/shared';
import { byAccount, prisma } from '../../db.ts';
import { config } from '../../config.ts';
import { audit, redact } from '../../lib/audit.ts';
import { hashPassword } from '../../lib/crypto.ts';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.ts';
import { parseBody } from '../../lib/validate.ts';
import { clientIp, requireAuth, requirePermission, scopeOf } from '../../middleware/auth.ts';
import { issueToken } from '../identity/routes.ts';

export const accountsRouter = Router();
const setupLimiter = rateLimit({ windowMs: 60 * 60_000, limit: config.isTest ? 1000 : 5, standardHeaders: true, legacyHeaders: false });

// ---------------------------------------------------------------- create an account (the set-up questions)
accountsRouter.post('/accounts', setupLimiter, async (req, res, next) => {
  try {
    const input = parseBody(accountSetupInput, req.body);
    const existing = await prisma.user.findFirst({ where: { email: input.owner.email }, select: { id: true } });
    if (existing) throw conflict('That e-mail already has a login');

    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: { name: input.accountName, package: input.package, handoverStage: input.handoverStage },
      });
      // Companies first without parents, then wire branches to their parent by index.
      const created = [];
      for (const c of input.companies) {
        created.push(
          await tx.company.create({
            data: {
              accountId: account.id, legalName: c.legalName, country: c.country, currency: c.currency,
              tin: c.tin, address: c.address, kind: c.kind, billsClient: c.billsClient,
            },
          }),
        );
      }
      for (let i = 0; i < input.companies.length; i++) {
        const c = input.companies[i]!;
        if (c.kind === 'BRANCH' && c.parentIndex !== undefined) {
          await tx.company.update({ where: { id: created[i]!.id }, data: { parentId: created[c.parentIndex]!.id } });
        }
      }
      const owner = await tx.user.create({
        data: {
          accountId: account.id, companyId: null, name: input.owner.name, email: input.owner.email,
          role: 'MD', passwordHash: await hashPassword(input.owner.password), otpMailbox: input.owner.email, status: 'ACTIVE',
        },
      });
      await audit({ accountId: account.id, userId: owner.id, module: 'accounts', action: 'account_created', entity: 'account', entityId: account.id, after: { name: account.name, package: account.package, companies: created.map((c) => c.legalName) }, ip: clientIp(req) }, tx);
      return { account, owner };
    });
    res.status(201).json({ accountId: result.account.id, ownerId: result.owner.id });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- read the account
accountsRouter.get('/account', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: s.accountId },
      include: {
        companies: {
          orderBy: { createdAt: 'asc' },
          include: { bankAccounts: { where: { active: true }, orderBy: { createdAt: 'asc' } }, parent: { select: { id: true, legalName: true } } },
        },
      },
    });
    // A one-company user sees their company (and, for a branch, its parent) only.
    const companies = s.companyId ? account.companies.filter((c) => c.id === s.companyId || c.parentId === s.companyId) : account.companies;
    res.json({ ...account, companies });
  } catch (e) {
    next(e);
  }
});

const companyPatch = z.object({
  legalName: z.string().trim().min(2).max(120).optional(),
  tin: z.string().trim().max(40).optional(),
  address: z.string().trim().max(240).optional(),
});
accountsRouter.patch('/companies/:id', requireAuth, requirePermission('users'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const patch = parseBody(companyPatch, req.body);
    const before = await prisma.company.findFirst({ where: { id: String(req.params.id), ...byAccount(s) } });
    if (!before) throw notFound('Company not found');
    const after = await prisma.$transaction(async (tx) => {
      const c = await tx.company.update({ where: { id: before.id }, data: patch });
      await audit({ accountId: s.accountId, userId: s.userId, companyId: c.id, module: 'accounts', action: 'company_updated', entity: 'company', entityId: c.id, before: patchOf(before, patch), after: patch, ip: clientIp(req) }, tx);
      return c;
    });
    res.json(after);
  } catch (e) {
    next(e);
  }
});

accountsRouter.post('/companies/:id/banks', requireAuth, requirePermission('users'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(bankAccountInput, req.body);
    const company = await prisma.company.findFirst({ where: { id: String(req.params.id), ...byAccount(s) } });
    if (!company) throw notFound('Company not found');
    if (company.kind === 'BRANCH') throw badRequest('A branch uses its parent company\'s bank accounts');
    const bank = await prisma.$transaction(async (tx) => {
      const b = await tx.bankAccount.create({ data: { accountId: s.accountId, companyId: company.id, ...input } });
      await audit({ accountId: s.accountId, userId: s.userId, companyId: company.id, module: 'accounts', action: 'bank_added', entity: 'bank_account', entityId: b.id, after: input, ip: clientIp(req) }, tx);
      return b;
    });
    res.status(201).json(bank);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- people
const userSelect = { id: true, name: true, email: true, role: true, companyId: true, otpMailbox: true, status: true, createdAt: true } as const;

accountsRouter.get('/users', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    // The MD manages people; everyone else may see the colleagues of their own company (names and roles only).
    const where = s.companyId ? { accountId: s.accountId, OR: [{ companyId: s.companyId }, { companyId: null }] } : byAccount(s);
    const users = await prisma.user.findMany({ where, select: userSelect, orderBy: [{ role: 'asc' }, { name: 'asc' }] });
    res.json(users);
  } catch (e) {
    next(e);
  }
});

accountsRouter.post('/users', requireAuth, requirePermission('users'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(inviteUserInput, req.body);
    const spansAll = ROLES_SPANNING_ALL_COMPANIES.includes(input.role);
    if (input.companyId === null && !spansAll) throw badRequest('This role must be attached to one company');
    if (input.companyId) {
      const c = await prisma.company.findFirst({ where: { id: input.companyId, ...byAccount(s) }, select: { id: true } });
      if (!c) throw badRequest('That company is not in your account');
    }
    const dup = await prisma.user.findFirst({ where: { email: input.email }, select: { id: true } });
    if (dup) throw conflict('That e-mail already has a login');

    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          accountId: s.accountId, companyId: input.companyId, name: input.name, email: input.email,
          role: input.role, otpMailbox: input.otpMailbox ?? input.email, status: 'INVITED',
        },
        select: userSelect,
      });
      await audit({ accountId: s.accountId, userId: s.userId, companyId: input.companyId, module: 'accounts', action: 'user_invited', entity: 'user', entityId: u.id, after: redact(u as Record<string, unknown>), ip: clientIp(req) }, tx);
      return u;
    });
    await issueToken(user.id, s.accountId, 'SET_PASSWORD', user.email, user.name);
    res.status(201).json(user);
  } catch (e) {
    next(e);
  }
});

for (const action of ['suspend', 'reactivate', 'reinvite'] as const) {
  accountsRouter.post(`/users/:id/${action}`, requireAuth, requirePermission('users'), async (req, res, next) => {
    try {
      const s = scopeOf(req);
      const target = await prisma.user.findFirst({ where: { id: String(req.params.id), ...byAccount(s) }, select: userSelect });
      if (!target) throw notFound('User not found');
      if (target.id === s.userId) throw forbidden('You cannot change your own access');
      if (action === 'reinvite') {
        await issueToken(target.id, s.accountId, 'SET_PASSWORD', target.email, target.name);
        res.json({ ok: true });
        return;
      }
      const status = action === 'suspend' ? 'SUSPENDED' : target.status === 'SUSPENDED' ? 'ACTIVE' : target.status;
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.user.update({ where: { id: target.id }, data: { status }, select: userSelect });
        if (status === 'SUSPENDED') await tx.session.deleteMany({ where: { userId: target.id } });
        await audit({ accountId: s.accountId, userId: s.userId, companyId: target.companyId, module: 'accounts', action: action === 'suspend' ? 'user_suspended' : 'user_reactivated', entity: 'user', entityId: target.id, before: { status: target.status }, after: { status }, ip: clientIp(req) }, tx);
        return u;
      });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  });
}

function patchOf<T extends Record<string, unknown>>(row: T, patch: Partial<Record<keyof T, unknown>>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) out[k] = row[k];
  return out;
}

export type { Role };
