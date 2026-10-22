/**
 * @oliu/shared — the vocabulary of the system.
 *
 * Everything here is a business rule written once and read by both the API (which enforces it)
 * and the web app (which displays it). Nothing here touches a database or a screen.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Roles — exactly the six of the previous MIS. A user holds one role in one company, or in all.
// ---------------------------------------------------------------------------
export const ROLES = [
  'MD',
  'OPS_MANAGER',
  'FINANCE_OFFICER',
  'TRANSPORT_COORDINATOR',
  'FIELD_OFFICER',
  'REPORTING_OFFICER',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  MD: 'Managing Director',
  OPS_MANAGER: 'Operations Manager',
  FINANCE_OFFICER: 'Finance Officer',
  TRANSPORT_COORDINATOR: 'Transport Coordinator',
  FIELD_OFFICER: 'Field Officer',
  REPORTING_OFFICER: 'Reporting Officer',
};

/** What a role may DO. `write` absent means read-only. */
export const PERMISSIONS = [
  'approve', // approve payment requests
  'pay', // blind cost entry and pay approved orders
  'beneficiaries', // change beneficiary accounts
  'users', // manage users and roles
  'reconcile', // rule on reconciliation flags and the MD queue
  'write', // create or edit records
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  MD: ['approve', 'pay', 'beneficiaries', 'users', 'reconcile', 'write'],
  OPS_MANAGER: ['approve', 'write'],
  FINANCE_OFFICER: ['pay', 'write'],
  TRANSPORT_COORDINATOR: ['write'],
  FIELD_OFFICER: ['write'],
  REPORTING_OFFICER: [],
};

/** The MD is the only role whose scope is every company of the account. */
export const ROLES_SPANNING_ALL_COMPANIES: readonly Role[] = ['MD', 'REPORTING_OFFICER'];

// ---------------------------------------------------------------------------
// Screens — the menus of the tenant portal and the sub-tabs under them. Keys are the previous
// mockup's screen keys, so the roadmap, the mockup and the code use one name per screen.
// ---------------------------------------------------------------------------
export interface Screen {
  key: string;
  label: string;
  slice: number; // the roadmap slice that switches it on
}
export interface Menu {
  key: string;
  label: string;
  screens: Screen[];
}

export const MENUS: readonly Menu[] = [
  {
    key: 'home',
    label: 'Home',
    screens: [
      { key: 'dash', label: 'Dashboard', slice: 9 },
      { key: 'ceo', label: 'Group overview', slice: 9 },
      { key: 'ask', label: 'Ask the MIS', slice: 99 },
    ],
  },
  {
    key: 'ship',
    label: 'Shipments',
    screens: [
      { key: 'cont', label: 'Containers', slice: 2 },
      { key: 'book', label: 'New booking', slice: 2 },
      { key: 'cost', label: 'Container record', slice: 3 },
      { key: 'leg', label: 'Transport leg', slice: 99 },
      { key: 'rel', label: 'Release', slice: 4 },
      { key: 'journey', label: 'Journey stages', slice: 4 },
      { key: 'csplit', label: 'Cost & split', slice: 3 },
      { key: 'handoff', label: 'Handoff to Finance', slice: 4 },
    ],
  },
  {
    key: 'field',
    label: 'Field payments',
    screens: [
      { key: 'tip', label: 'Tip entry', slice: 5 },
      { key: 'tiplat', label: 'Complete tip', slice: 5 },
    ],
  },
  {
    key: 'pay',
    label: 'Payments',
    screens: [
      { key: 'queue', label: 'Needs payment', slice: 6 },
      { key: 'cashier', label: 'Pay — Finance Officer', slice: 6 },
      { key: 'ben', label: 'Beneficiaries', slice: 6 },
    ],
  },
  { key: 'inv', label: 'Invoices', screens: [{ key: 'inv', label: 'Invoices & clients', slice: 8 }] },
  {
    key: 'acc',
    label: 'Accounting',
    screens: [
      { key: 'exp', label: 'Office expenses', slice: 99 },
      { key: 'bank', label: 'Bank statement', slice: 99 },
      { key: 'pay', label: 'Payroll', slice: 99 },
      { key: 'gl', label: 'General ledger', slice: 99 },
    ],
  },
  { key: 'rep', label: 'Reports', screens: [{ key: 'rep', label: 'Reports', slice: 99 }] },
  {
    key: 'chk',
    label: 'Checks',
    screens: [
      { key: 'recon', label: 'Reconciliation', slice: 7 },
      { key: 'superq', label: 'MD queue', slice: 6 },
      { key: 'aud', label: 'Audit trail', slice: 1 },
    ],
  },
  { key: 'ntf', label: 'Notifications', screens: [{ key: 'ntf', label: 'Notifications & alerts', slice: 9 }] },
  {
    key: 'set',
    label: 'Settings',
    screens: [
      { key: 'adm', label: 'User management', slice: 1 },
      { key: 'cfg', label: 'Configuration', slice: 3 },
      { key: 'imp', label: 'Data import', slice: 10 },
      { key: 'sub', label: 'Company & subscription', slice: 1 },
    ],
  },
];

/** Which screens each role may open — copied from the previous MIS, unchanged. '*' = every screen. */
export const ROLE_SCREENS: Record<Role, '*' | readonly string[]> = {
  MD: '*',
  OPS_MANAGER: [
    'dash', 'ask', 'book', 'cont', 'cost', 'leg', 'rel', 'journey', 'csplit', 'handoff', 'tiplat',
    'queue', 'inv', 'ben', 'exp', 'rep', 'ntf', 'aud',
  ],
  FINANCE_OFFICER: ['dash', 'ask', 'queue', 'cashier', 'inv', 'ben', 'exp', 'bank', 'pay', 'gl', 'rep', 'ntf'],
  TRANSPORT_COORDINATOR: ['dash', 'ask', 'cont', 'cost', 'leg', 'rel', 'journey', 'csplit', 'tip', 'tiplat', 'ntf'],
  FIELD_OFFICER: ['tip', 'tiplat', 'cont', 'ntf'],
  REPORTING_OFFICER: ['dash', 'ask', 'cont', 'cost', 'inv', 'gl', 'rep', 'ntf', 'aud'],
};

export function canOpenScreen(role: Role, screenKey: string): boolean {
  const allowed = ROLE_SCREENS[role];
  return allowed === '*' || allowed.includes(screenKey);
}

/** The menus a role sees, with only the screens it may open. Empty menus disappear. */
export function menusForRole(role: Role): Menu[] {
  return MENUS.map((m) => ({ ...m, screens: m.screens.filter((s) => canOpenScreen(role, s.key)) })).filter(
    (m) => m.screens.length > 0,
  );
}

/** Where a role lands after login — copied from the previous MIS. */
export const ROLE_HOME: Record<Role, string> = {
  MD: 'dash',
  OPS_MANAGER: 'dash',
  FINANCE_OFFICER: 'queue',
  TRANSPORT_COORDINATOR: 'leg',
  FIELD_OFFICER: 'tip',
  REPORTING_OFFICER: 'rep',
};

// ---------------------------------------------------------------------------
// Accounts, packages and companies
// ---------------------------------------------------------------------------
/** Package A = one company (branches allowed). Package B = a group of partner companies working as one. */
export const PACKAGES = ['SINGLE', 'GROUP'] as const;
export type Package = (typeof PACKAGES)[number];

/** MAIN: the first company. BRANCH: an office of another company, same book. PARTNER: a separate legal company, own book. */
export const COMPANY_KINDS = ['MAIN', 'BRANCH', 'PARTNER'] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];

export const COUNTRIES = ['RW', 'TZ', 'UG', 'KE', 'BI', 'CD'] as const;
export const CURRENCIES = ['RWF', 'TZS', 'USD', 'UGX', 'KES'] as const;

/** The eight journey stages of the systems analysis §03.1; the hand-over can be any of them. */
export const STAGES = [
  'BOOKED',
  'TRANSPORT',
  'FIELD_RELEASE',
  'RUSUMO',
  'CHECKPOINTS',
  'ICD',
  'PORT',
  'OCEAN_FREIGHT',
] as const;
export type Stage = (typeof STAGES)[number];

// ---------------------------------------------------------------------------
// The set-up questions answered once when an account is created (roadmap slice 1 subset)
// ---------------------------------------------------------------------------
export const companyInput = z.object({
  legalName: z.string().trim().min(2).max(120),
  country: z.enum(COUNTRIES),
  currency: z.enum(CURRENCIES),
  tin: z.string().trim().max(40).optional().default(''),
  address: z.string().trim().max(240).optional().default(''),
  kind: z.enum(COMPANY_KINDS),
  /** For a BRANCH: the index (in this list) of the company it belongs to. */
  parentIndex: z.number().int().min(0).optional(),
  billsClient: z.boolean().default(false),
});
export type CompanyInput = z.infer<typeof companyInput>;

export const password = z
  .string()
  .min(10, 'At least 10 characters')
  .max(200)
  .refine((p) => /[a-z]/.test(p) && /[A-Z0-9]/.test(p), 'Mix lower case with upper case or digits');

export const accountSetupInput = z
  .object({
    accountName: z.string().trim().min(2).max(120),
    package: z.enum(PACKAGES),
    companies: z.array(companyInput).min(1).max(8),
    /** Stage at which the responsible company flips; null for a single company with no partner. */
    handoverStage: z.enum(STAGES).nullable().default(null),
    owner: z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().email().max(200).transform((e) => e.toLowerCase()),
      password,
    }),
  })
  .superRefine((v, ctx) => {
    const mains = v.companies.filter((c) => c.kind === 'MAIN');
    const partners = v.companies.filter((c) => c.kind === 'PARTNER');
    const billers = v.companies.filter((c) => c.billsClient);
    if (mains.length !== 1) ctx.addIssue({ code: 'custom', path: ['companies'], message: 'Exactly one MAIN company' });
    if (billers.length !== 1)
      ctx.addIssue({ code: 'custom', path: ['companies'], message: 'Exactly one company bills the client' });
    if (billers[0] && billers[0].kind === 'BRANCH')
      ctx.addIssue({ code: 'custom', path: ['companies'], message: 'A branch cannot bill; its parent company does' });
    if (v.package === 'SINGLE' && partners.length > 0)
      ctx.addIssue({ code: 'custom', path: ['package'], message: 'A single-company account has no partner companies' });
    if (v.package === 'GROUP' && partners.length === 0)
      ctx.addIssue({ code: 'custom', path: ['package'], message: 'A group needs at least one partner company' });
    if (partners.length > 0 && !v.handoverStage)
      ctx.addIssue({ code: 'custom', path: ['handoverStage'], message: 'A group needs a hand-over stage' });
    v.companies.forEach((c, i) => {
      if (c.kind === 'BRANCH') {
        const p = c.parentIndex === undefined ? undefined : v.companies[c.parentIndex];
        if (!p || p.kind === 'BRANCH' || c.parentIndex === i)
          ctx.addIssue({ code: 'custom', path: ['companies', i, 'parentIndex'], message: 'A branch needs a parent company' });
      }
    });
  });
export type AccountSetupInput = z.infer<typeof accountSetupInput>;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
export const inviteUserInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200).transform((e) => e.toLowerCase()),
  role: z.enum(ROLES),
  /** null = all companies; only allowed for roles that span the account. */
  companyId: z.string().uuid().nullable(),
  /** The department mailbox the one-time code goes to; defaults to the user's own e-mail. */
  otpMailbox: z.string().trim().email().max(200).transform((e) => e.toLowerCase()).optional(),
});
export type InviteUserInput = z.infer<typeof inviteUserInput>;

export const loginInput = z.object({
  email: z.string().trim().email().max(200).transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});
export const otpInput = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, 'Six digits'),
});
export const setPasswordInput = z.object({ token: z.string().min(20).max(200), password });

export const bankAccountInput = z.object({
  bank: z.string().trim().min(2).max(80),
  number: z.string().trim().min(4).max(40),
  currency: z.enum(CURRENCIES),
  swift: z.string().trim().max(20).optional().default(''),
});
