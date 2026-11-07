/**
 * Identity — sign in with password, then a six-digit code sent to the department mailbox.
 *
 * POST /api/auth/login        email + password  → { challengeId }  (code is e-mailed)
 * POST /api/auth/otp          challengeId + code → session cookie
 * POST /api/auth/logout
 * GET  /api/auth/me           who am I, what may I open
 * POST /api/auth/set-password token + password   (after an invitation or a reset)
 * POST /api/auth/forgot       email              (always answers OK; mails a reset link if the user exists)
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { serialize as serializeCookie } from 'cookie';
import {
  loginInput,
  otpInput,
  setPasswordInput,
  menusForRole,
  ROLE_HOME,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  type Role,
} from '@oliu/shared';
import { z } from 'zod';
import { prisma } from '../../db.ts';
import { config } from '../../config.ts';
import { audit } from '../../lib/audit.ts';
import {
  hashPassword,
  newOtpCode,
  newToken,
  sha256,
  signSessionId,
  verifyPassword,
} from '../../lib/crypto.ts';
import { badRequest, unauthorized } from '../../lib/errors.ts';
import { sendMail } from '../../lib/mail.ts';
import { parseBody } from '../../lib/validate.ts';
import { clientIp, requireAuth, SESSION_COOKIE } from '../../middleware/auth.ts';

export const identityRouter = Router();

// Brute force is slowed here and again per challenge (five attempts) below.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.isTest ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
});
const otpLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.isTest ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
});

identityRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = parseBody(loginInput, req.body);
    // Email is unique per account; a person with the same e-mail in two accounts is not supported in slice 1.
    const user = await prisma.user.findFirst({ where: { email }, include: { account: true } });
    const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, password) : false;
    if (!user || !ok) {
      // Same answer whether the e-mail exists or not.
      throw unauthorized('E-mail or password is wrong');
    }
    if (user.status === 'SUSPENDED') {
      await audit({
        accountId: user.accountId,
        userId: user.id,
        companyId: user.companyId,
        module: 'identity',
        action: 'login_refused',
        entity: 'user',
        entityId: user.id,
        after: { reason: 'suspended' },
        ip: clientIp(req),
      });
      throw unauthorized(
        'This account is suspended. Only the Managing Director can reactivate it.',
      );
    }
    if (user.status !== 'ACTIVE')
      throw unauthorized('Set your password from the invitation e-mail first');
    if (user.account.status === 'SUSPENDED')
      throw unauthorized('This company account is suspended');

    const code = newOtpCode();
    const challenge = await prisma.otpChallenge.create({
      data: {
        userId: user.id,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + config.OTP_MINUTES * 60_000),
      },
    });
    await sendMail(
      user.otpMailbox,
      `OLIU one-time code for ${user.name}`,
      `One-time code for ${user.name} (${ROLE_LABEL[user.role as Role]}): ${code}\nIt expires in ${config.OTP_MINUTES} minutes. If you did not try to sign in, tell the Managing Director.`,
    );
    res.json({
      challengeId: challenge.id,
      mailbox: maskMailbox(user.otpMailbox),
      expiresInMinutes: config.OTP_MINUTES,
    });
  } catch (e) {
    next(e);
  }
});

identityRouter.post('/otp', otpLimiter, async (req, res, next) => {
  try {
    const { challengeId, code } = parseBody(otpInput, req.body);
    const ch = await prisma.otpChallenge.findUnique({
      where: { id: challengeId },
      include: { user: true },
    });
    if (!ch || ch.usedAt || ch.expiresAt < new Date() || ch.purpose !== 'LOGIN')
      throw unauthorized('Code expired. Sign in again.');
    if (ch.attempts >= 5) throw unauthorized('Too many tries. Sign in again.');
    if (ch.codeHash !== sha256(code)) {
      await prisma.otpChallenge.update({
        where: { id: ch.id },
        data: { attempts: { increment: 1 } },
      });
      throw unauthorized('That code is not right');
    }
    const session = await prisma.$transaction(async (tx) => {
      await tx.otpChallenge.update({ where: { id: ch.id }, data: { usedAt: new Date() } });
      const s = await tx.session.create({
        data: {
          userId: ch.userId,
          expiresAt: new Date(Date.now() + config.SESSION_DAYS * 86_400_000),
          ip: clientIp(req),
          userAgent: (req.header('user-agent') ?? '').slice(0, 200),
        },
      });
      await audit(
        {
          accountId: ch.user.accountId,
          userId: ch.userId,
          companyId: ch.user.companyId,
          module: 'identity',
          action: 'login',
          entity: 'session',
          entityId: s.id,
          ip: clientIp(req),
        },
        tx,
      );
      return s;
    });
    res.setHeader(
      'Set-Cookie',
      sessionCookie(signSessionId(session.id), config.SESSION_DAYS * 86_400),
    );
    res.json({ ok: true, home: ROLE_HOME[ch.user.role as Role] });
  } catch (e) {
    next(e);
  }
});

identityRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    if (req.sessionId)
      await prisma.session.delete({ where: { id: req.sessionId } }).catch(() => undefined);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

identityRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const s = req.scope!;
    const [account, companies, user] = await Promise.all([
      prisma.account.findUniqueOrThrow({
        where: { id: s.accountId },
        select: { id: true, name: true, package: true, handoverStage: true, status: true },
      }),
      prisma.company.findMany({
        where: { accountId: s.accountId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          legalName: true,
          country: true,
          currency: true,
          kind: true,
          parentId: true,
          billsClient: true,
        },
      }),
      prisma.user.findUniqueOrThrow({
        where: { id: s.userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          companyId: true,
          otpMailbox: true,
        },
      }),
    ]);
    const role = user.role as Role;
    // Bookings, lines and clients belong to the company that bills the client; a branch follows its parent.
    const own = companies.find((c) => c.id === user.companyId);
    const booksForClients =
      !own ||
      own.billsClient ||
      (own.kind === 'BRANCH' && !!companies.find((c) => c.id === own.parentId)?.billsClient);
    res.json({
      user: { ...user, roleLabel: ROLE_LABEL[role] },
      account,
      /** A one-company user sees only their company; an all-company user sees all of them (the switcher). */
      companies: user.companyId ? companies.filter((c) => c.id === user.companyId) : companies,
      activeCompanyId: s.companyId ?? s.activeCompanyId,
      permissions: ROLE_PERMISSIONS[role],
      menus: menusForRole(role, booksForClients),
      booksForClients,
      home: ROLE_HOME[role],
    });
  } catch (e) {
    next(e);
  }
});

identityRouter.post('/set-password', loginLimiter, async (req, res, next) => {
  try {
    const { token, password } = parseBody(setPasswordInput, req.body);
    const t = await prisma.actionToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!t || t.usedAt || t.expiresAt < new Date())
      throw badRequest('This link has expired. Ask for a new invitation.');
    await prisma.$transaction(async (tx) => {
      await tx.actionToken.update({ where: { id: t.id }, data: { usedAt: new Date() } });
      await tx.user.update({
        where: { id: t.userId },
        data: {
          passwordHash: await hashPassword(password),
          status: t.user.status === 'INVITED' ? 'ACTIVE' : t.user.status,
        },
      });
      // Any old sessions die with the old password.
      await tx.session.deleteMany({ where: { userId: t.userId } });
      await audit(
        {
          accountId: t.user.accountId,
          userId: t.userId,
          module: 'identity',
          action: t.purpose === 'SET_PASSWORD' ? 'password_set' : 'password_reset',
          entity: 'user',
          entityId: t.userId,
          ip: clientIp(req),
        },
        tx,
      );
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

identityRouter.post('/forgot', loginLimiter, async (req, res, next) => {
  try {
    const { email } = parseBody(
      z.object({
        email: z
          .string()
          .trim()
          .email()
          .transform((e) => e.toLowerCase()),
      }),
      req.body,
    );
    const user = await prisma.user.findFirst({ where: { email, status: 'ACTIVE' } });
    if (user) await issueToken(user.id, user.accountId, 'RESET_PASSWORD', user.email, user.name);
    res.json({ ok: true }); // never reveals whether the e-mail exists
  } catch (e) {
    next(e);
  }
});

/** Creates a one-use link and e-mails it. Shared with the invitation flow in the accounts module. */
export async function issueToken(
  userId: string,
  accountId: string,
  purpose: 'SET_PASSWORD' | 'RESET_PASSWORD',
  to: string,
  name: string,
) {
  const token = newToken();
  await prisma.actionToken.create({
    data: {
      userId,
      purpose,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 3 * 86_400_000),
    },
  });
  const link = `${config.WEB_URL}/set-password?token=${token}`;
  await sendMail(
    to,
    purpose === 'SET_PASSWORD' ? `You are invited to OLIU, ${name}` : `Reset your OLIU password`,
    `${purpose === 'SET_PASSWORD' ? 'Choose your password here' : 'Reset your password here'}: ${link}\nThe link works once and expires in 3 days.`,
  );
  await audit({
    accountId,
    userId,
    module: 'identity',
    action: purpose === 'SET_PASSWORD' ? 'invited' : 'reset_requested',
    entity: 'user',
    entityId: userId,
  });
}

function sessionCookie(value: string, maxAgeSeconds: number) {
  return serializeCookie(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

function maskMailbox(m: string) {
  const [local, domain] = m.split('@');
  return `${(local ?? '').slice(0, 2)}…@${domain ?? ''}`;
}
