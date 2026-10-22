/**
 * Who is calling, and what may they touch.
 *
 * `attachSession` runs on every request: it reads the signed cookie, loads the session and the user,
 * and puts a Scope on the request. Routes then use `requireAuth`, `requireRole` or `requirePermission`.
 * The company an all-company user is looking at comes from the `X-Company` header and is checked
 * against the account; it is never trusted on its own.
 */
import type { NextFunction, Request, Response } from 'express';
import { parse as parseCookie } from 'cookie';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@oliu/shared';
import { prisma, type Scope } from '../db.ts';
import { verifySignedSessionId } from '../lib/crypto.ts';
import { forbidden, unauthorized } from '../lib/errors.ts';

export const SESSION_COOKIE = 'oliu_session';

declare module 'express-serve-static-core' {
  interface Request {
    scope?: Scope;
    sessionId?: string;
    user?: { id: string; name: string; email: string; role: Role; status: string };
  }
}

export async function attachSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const cookies = parseCookie(req.headers.cookie ?? '');
    const sessionId = verifySignedSessionId(cookies[SESSION_COOKIE]);
    if (!sessionId) return next();
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { include: { account: { select: { status: true } } } } },
    });
    if (!session || session.expiresAt < new Date()) return next();
    const u = session.user;
    if (u.status !== 'ACTIVE' || u.account.status === 'SUSPENDED') return next();

    let activeCompanyId: string | null = null;
    const wanted = req.header('x-company');
    if (u.companyId === null && wanted) {
      const ok = await prisma.company.findFirst({ where: { id: wanted, accountId: u.accountId }, select: { id: true } });
      if (!ok) throw forbidden('That company is not in your account');
      activeCompanyId = ok.id;
    }
    req.sessionId = session.id;
    req.user = { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status };
    req.scope = {
      accountId: u.accountId,
      userId: u.id,
      role: u.role,
      companyId: u.companyId,
      activeCompanyId,
    };
    // Touch the session at most once a minute; cheap and keeps "last seen" honest.
    if (Date.now() - session.lastSeen.getTime() > 60_000) {
      await prisma.session.update({ where: { id: session.id }, data: { lastSeen: new Date() } });
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.scope) return next(unauthorized());
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.scope) return next(unauthorized());
    if (!roles.includes(req.scope.role as Role)) return next(forbidden());
    next();
  };
}

export function requirePermission(p: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.scope) return next(unauthorized());
    if (!ROLE_PERMISSIONS[req.scope.role as Role].includes(p)) return next(forbidden());
    next();
  };
}

/** The Scope, guaranteed present after requireAuth. */
export function scopeOf(req: Request): Scope {
  if (!req.scope) throw unauthorized();
  return req.scope;
}

export function clientIp(req: Request): string {
  return (req.ip ?? '').slice(0, 64);
}
