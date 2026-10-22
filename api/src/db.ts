/**
 * Database access. One Prisma client for the process.
 *
 * The scoping rule of the system lives here and in `middleware/auth.ts`:
 * every query against an account-bound table goes through `scope()` so the account
 * (and, where it applies, the company) filter is never typed by hand on a route.
 */
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : process.env.NODE_ENV === 'test' ? [] : ['error'],
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** The signed-in context every route receives. companyId null = the user spans all companies. */
export interface Scope {
  accountId: string;
  userId: string;
  role: string;
  /** The company the user is attached to, or null for MD / Reporting Officer. */
  companyId: string | null;
  /** For an all-company user: the company chosen in the switcher, if any. */
  activeCompanyId: string | null;
}

/** `where` fragment for tables that carry only accountId. */
export function byAccount(s: Scope) {
  return { accountId: s.accountId };
}

/**
 * `where` fragment for company-bound tables.
 * A one-company user always gets their own company. An all-company user gets the switcher's
 * company when one is chosen, otherwise every company of the account.
 */
export function byCompany(s: Scope) {
  const companyId = s.companyId ?? s.activeCompanyId;
  return companyId ? { accountId: s.accountId, companyId } : { accountId: s.accountId };
}

/** True when the scope may touch the given company at all. */
export function mayTouchCompany(s: Scope, companyId: string): boolean {
  return s.companyId === null || s.companyId === companyId;
}
