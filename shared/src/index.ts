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
  OPS_MANAGER: ['approve', 'beneficiaries', 'write'],
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
  {
    key: 'inv',
    label: 'Invoices',
    screens: [{ key: 'inv', label: 'Invoices & clients', slice: 8 }],
  },
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
  {
    key: 'ntf',
    label: 'Notifications',
    screens: [{ key: 'ntf', label: 'Notifications & alerts', slice: 9 }],
  },
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
    'dash',
    'ask',
    'book',
    'cont',
    'cost',
    'leg',
    'rel',
    'journey',
    'csplit',
    'handoff',
    'tiplat',
    'queue',
    'inv',
    'ben',
    'exp',
    'rep',
    'ntf',
    'aud',
  ],
  FINANCE_OFFICER: [
    'dash',
    'ask',
    'queue',
    'cashier',
    'inv',
    'ben',
    'exp',
    'bank',
    'pay',
    'gl',
    'rep',
    'ntf',
  ],
  TRANSPORT_COORDINATOR: [
    'dash',
    'ask',
    'cont',
    'cost',
    'leg',
    'rel',
    'journey',
    'csplit',
    'tip',
    'tiplat',
    'ntf',
  ],
  FIELD_OFFICER: ['tip', 'tiplat', 'cont', 'ntf'],
  REPORTING_OFFICER: ['dash', 'ask', 'cont', 'cost', 'inv', 'gl', 'rep', 'ntf', 'aud'],
};

export function canOpenScreen(role: Role, screenKey: string): boolean {
  const allowed = ROLE_SCREENS[role];
  return allowed === '*' || allowed.includes(screenKey);
}

/** Screens that belong to the company that bills the client: it makes the bookings, keeps the lines and the clients. */
export const BOOKING_SCREENS: readonly string[] = ['book'];

/**
 * The menus a role sees, with only the screens it may open. Empty menus disappear. A person of a company that
 * does not bill the client (JIVAH in OLIU · JIVAH) does not get the booking screen: bookings are the other side's.
 */
export function menusForRole(role: Role, booksForClients = true): Menu[] {
  return MENUS.map((m) => ({
    ...m,
    screens: m.screens.filter(
      (s) => canOpenScreen(role, s.key) && (booksForClients || !BOOKING_SCREENS.includes(s.key)),
    ),
  })).filter((m) => m.screens.length > 0);
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
      email: z
        .string()
        .trim()
        .email()
        .max(200)
        .transform((e) => e.toLowerCase()),
      password,
    }),
  })
  .superRefine((v, ctx) => {
    const mains = v.companies.filter((c) => c.kind === 'MAIN');
    const partners = v.companies.filter((c) => c.kind === 'PARTNER');
    const billers = v.companies.filter((c) => c.billsClient);
    if (mains.length !== 1)
      ctx.addIssue({ code: 'custom', path: ['companies'], message: 'Exactly one MAIN company' });
    if (billers.length !== 1)
      ctx.addIssue({
        code: 'custom',
        path: ['companies'],
        message: 'Exactly one company bills the client',
      });
    if (billers[0] && billers[0].kind === 'BRANCH')
      ctx.addIssue({
        code: 'custom',
        path: ['companies'],
        message: 'A branch cannot bill; its parent company does',
      });
    if (v.package === 'SINGLE' && partners.length > 0)
      ctx.addIssue({
        code: 'custom',
        path: ['package'],
        message: 'A single-company account has no partner companies',
      });
    if (v.package === 'GROUP' && partners.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['package'],
        message: 'A group needs at least one partner company',
      });
    if (partners.length > 0 && !v.handoverStage)
      ctx.addIssue({
        code: 'custom',
        path: ['handoverStage'],
        message: 'A group needs a hand-over stage',
      });
    v.companies.forEach((c, i) => {
      if (c.kind === 'BRANCH') {
        const p = c.parentIndex === undefined ? undefined : v.companies[c.parentIndex];
        if (!p || p.kind === 'BRANCH' || c.parentIndex === i)
          ctx.addIssue({
            code: 'custom',
            path: ['companies', i, 'parentIndex'],
            message: 'A branch needs a parent company',
          });
      }
    });
  });
export type AccountSetupInput = z.infer<typeof accountSetupInput>;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
export const inviteUserInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .email()
    .max(200)
    .transform((e) => e.toLowerCase()),
  role: z.enum(ROLES),
  /** null = all companies; only allowed for roles that span the account. */
  companyId: z.string().uuid().nullable(),
  /** The department mailbox the one-time code goes to; defaults to the user's own e-mail. */
  otpMailbox: z
    .string()
    .trim()
    .email()
    .max(200)
    .transform((e) => e.toLowerCase())
    .optional(),
});
export type InviteUserInput = z.infer<typeof inviteUserInput>;

export const loginInput = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(200)
    .transform((e) => e.toLowerCase()),
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

// ---------------------------------------------------------------------------
// Containers — ISO 6346 (roadmap slice 2). The container number is the unit of truth of the system:
// four letters (owner code + U), six digits, one check digit. A typo is caught before it is saved.
// ---------------------------------------------------------------------------
/** Letter values of ISO 6346: A = 10, then one more per letter, skipping every multiple of 11. */
const ISO6346_LETTER: Record<string, number> = {};
{
  let v = 10;
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (v % 11 === 0) v++;
    ISO6346_LETTER[c] = v++;
  }
}

/** The check digit for the first ten characters of a container number. */
export function containerCheckDigit(tenChars: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = tenChars[i]!;
    sum += (c >= '0' && c <= '9' ? Number(c) : ISO6346_LETTER[c]!) * 2 ** i;
  }
  return (sum % 11) % 10;
}

export interface ContainerNumberCheck {
  /** Upper case, spaces and hyphens removed. */
  number: string;
  ok: boolean;
  /** When the shape is right but the last digit is wrong: the digit it should be. */
  expectedDigit?: number;
  /** Plain-language reason when not ok. */
  reason?: string;
}

/** Normalises what a person typed and says whether it is a valid container number, and if not, why. */
export function checkContainerNumber(raw: string): ContainerNumberCheck {
  const number = raw.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z]{4}\d{7}$/.test(number)) {
    return { number, ok: false, reason: 'Four letters then seven digits, e.g. PCIU 932093 6' };
  }
  if (number[3] !== 'U' && number[3] !== 'J' && number[3] !== 'Z') {
    return { number, ok: false, reason: 'The fourth letter is U for a freight container' };
  }
  const expectedDigit = containerCheckDigit(number);
  if (expectedDigit !== Number(number[10])) {
    return {
      number,
      ok: false,
      expectedDigit,
      reason: `Check digit should be ${expectedDigit}, not ${number[10]}`,
    };
  }
  return { number, ok: true };
}

export const CONTAINER_SIZES = ['20FT', '40FT', '40HC', '45FT'] as const;
export type ContainerSize = (typeof CONTAINER_SIZES)[number];

/** Suggestions only; the cargo field accepts any text. */
export const CARGO_SUGGESTIONS = [
  'TANTALITE',
  'CASSITERITE',
  'WOLFRAMITE',
  'LITHIUM',
  'BERYLLIUM',
  'TIN',
  'COPPER',
  'GENERAL CARGO',
] as const;

/** A container number as typed; comes out normalised, or fails with the reason. */
export const containerNumber = z
  .string()
  .trim()
  .min(11)
  .max(16)
  .transform((raw, ctx) => {
    const c = checkContainerNumber(raw);
    if (!c.ok) {
      ctx.addIssue({ code: 'custom', message: c.reason! });
      return z.NEVER;
    }
    return c.number;
  });

function usableRegex(p: string): boolean {
  if (!p) return true;
  try {
    new RegExp(p);
    return true;
  } catch {
    return false;
  }
}

export const shippingLineInput = z.object({
  name: z.string().trim().min(2).max(80),
  /** Owner codes this line's boxes usually carry (PCIU, PIDU…). Another code is accepted with a note. */
  usualPrefixes: z
    .array(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{4}$/, 'Four letters'),
    )
    .max(20)
    .default([]),
  /** What this line's booking numbers look like, said to the person typing one. */
  referenceHint: z.string().trim().max(80).default(''),
  /** A regular expression the booking number must match; empty accepts anything. */
  referencePattern: z
    .string()
    .trim()
    .max(120)
    .default('')
    .refine(usableRegex, 'Not a usable pattern'),
});
export type ShippingLineInput = z.infer<typeof shippingLineInput>;

export const clientInput = z.object({
  /** The short name used on screens, e.g. Space Mining. */
  name: z.string().trim().min(2).max(80),
  legalName: z.string().trim().max(160).default(''),
  tin: z.string().trim().max(40).default(''),
  address: z.string().trim().max(240).default(''),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Two-letter country code')
    .or(z.literal(''))
    .default(''),
});
export type ClientInput = z.infer<typeof clientInput>;

export const containerInput = z.object({
  number: containerNumber,
  size: z.enum(CONTAINER_SIZES),
  /** The client's lot number for this box, as on the paper. */
  lot: z.string().trim().max(60).default(''),
});
export type ContainerInput = z.infer<typeof containerInput>;

function noRepeats(containers: { number: string }[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  containers.forEach((c, i) => {
    if (seen.has(c.number))
      ctx.addIssue({
        code: 'custom',
        path: ['containers', i, 'number'],
        message: 'Typed twice on this booking',
      });
    seen.add(c.number);
  });
}

/** A calendar date as typed in a date field, YYYY-MM-DD; an empty field means "not known yet". */
const dateField = z.preprocess(
  (v) => (v === '' ? null : v),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-17')
    .nullable(),
);

/**
 * What the line tells you after the booking: all optional at creation, filled in as the papers arrive.
 * The invoice (slice 8) prints ETD and the BL number, so they live here from the start.
 */
const fillLaterFields = {
  destination: z.string().trim().max(120).default(''),
  vessel: z.string().trim().toUpperCase().max(80).default(''),
  voyage: z.string().trim().toUpperCase().max(40).default(''),
  /** Port of loading and port of discharge, as the line names them. */
  pol: z.string().trim().max(80).default(''),
  pod: z.string().trim().max(80).default(''),
  etd: dateField.default(null),
  eta: dateField.default(null),
  blNumber: z.string().trim().toUpperCase().max(40).default(''),
};

/**
 * The shipping line's booking number, e.g. CMDU4471023. Every line's number is letters and digits,
 * 6 to 20 of them, no spaces or symbols; a line with a known shape (ShippingLine.referencePattern)
 * is checked against that shape on top of this.
 */
export const bookingReference = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z0-9]{6,20}$/,
    'A booking number is 6 to 20 letters and digits, no spaces or symbols',
  );

export const bookingInput = z
  .object({
    shippingLineId: z.string().uuid(),
    reference: bookingReference,
    clientId: z.string().uuid(),
    cargo: z.string().trim().toUpperCase().min(2).max(60),
    /** The line confirmed it (the usual case: it is typed from the confirmation) or it is still pending. */
    status: z.enum(['PENDING', 'CONFIRMED']).default('CONFIRMED'),
    confirmedOn: dateField.default(null),
    /** Boxes the line has agreed to, before their numbers are known: "6 x 40FT expected". */
    expectedCount: z.number().int().min(0).max(100).default(0),
    expectedSize: z.enum(CONTAINER_SIZES).default('40FT'),
    ...fillLaterFields,
    containers: z.array(containerInput).max(100).default([]),
  })
  .superRefine((v, ctx) => {
    noRepeats(v.containers, ctx);
    if (v.containers.length === 0 && v.expectedCount === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['expectedCount'],
        message: 'Type the container numbers, or how many boxes the line agreed to',
      });
  });
export type BookingInput = z.infer<typeof bookingInput>;

/** The fields a booking may fill in later, by the company that made it. */
export const bookingPatch = z.object({
  cargo: z.string().trim().toUpperCase().min(2).max(60).optional(),
  expectedCount: z.number().int().min(0).max(100).optional(),
  expectedSize: z.enum(CONTAINER_SIZES).optional(),
  destination: fillLaterFields.destination.optional(),
  vessel: fillLaterFields.vessel.optional(),
  voyage: fillLaterFields.voyage.optional(),
  pol: fillLaterFields.pol.optional(),
  pod: fillLaterFields.pod.optional(),
  etd: fillLaterFields.etd.optional(),
  eta: fillLaterFields.eta.optional(),
  blNumber: fillLaterFields.blNumber.optional(),
});
export type BookingPatch = z.infer<typeof bookingPatch>;

export const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Cancelling needs a reason; the booking and its boxes stay in the record, withdrawn. */
export const bookingCancelInput = z.object({ reason: z.string().trim().min(3).max(300) });

/** A comment on a booking: who, when, what — never edited, never deleted. */
export const bookingCommentInput = z.object({ text: z.string().trim().min(1).max(1000) });

/** Weight and lot may be corrected on a box; the number only through the MD's duplicate ruling. */
export const containerPatch = z.object({
  lot: z.string().trim().max(60).optional(),
  weightKg: z.number().int().min(0).max(100_000).nullable().optional(),
});

// ---------------------------------------------------------------- money (slice 3)

/**
 * Money is integer minor units, never floating point: USD in cents, RWF and TZS in whole units.
 * A rate is "units of the currency per one US dollar" on a day (RWF 1452.000), kept to three decimals.
 */
export type Currency = (typeof CURRENCIES)[number];
/** Decimal places of each currency: cents for USD and KES, whole units for RWF, TZS and UGX. */
export const CURRENCY_EXPONENT: Record<Currency, number> = {
  USD: 2,
  RWF: 0,
  TZS: 0,
  KES: 2,
  UGX: 0,
};

/** "1,909,000" or "2140.50" → minor units of the currency; refuses more decimals than the currency has. */
export function parseMoney(text: string, currency: Currency): number | null {
  const clean = text.replace(/[\s,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  const exp = CURRENCY_EXPONENT[currency];
  if (frac.length > exp) return null;
  return Number(whole) * 10 ** exp + Number((frac + '0'.repeat(exp)).slice(0, exp) || 0);
}

/** Minor units → "1,909,000" or "2,140.50" for the screen. */
export function formatMoney(minor: number | bigint, currency: Currency): string {
  const exp = CURRENCY_EXPONENT[currency];
  const n = typeof minor === 'bigint' ? Number(minor) : minor;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 10 ** exp);
  const frac = abs - whole * 10 ** exp;
  const w = whole.toLocaleString('en-US');
  return exp === 0 ? `${sign}${w}` : `${sign}${w}.${String(frac).padStart(exp, '0')}`;
}

/** Amount in minor units at `perUsd` (units per dollar, as a decimal string) → US cents, rounded half up. */
export function toUsdCents(
  amountMinor: number | bigint,
  currency: Currency,
  perUsd: string | number,
): number {
  const rate = Number(perUsd);
  if (!(rate > 0)) throw new Error('Rate must be positive');
  const units = Number(amountMinor) / 10 ** CURRENCY_EXPONENT[currency];
  return Math.round((units / rate) * 100 + Number.EPSILON);
}

/** Divides a total across n boxes; the rounding remainder goes to the last box (636,333 · 636,333 · 636,334). */
export function splitEqual(totalMinor: number, n: number): number[] {
  if (n < 1) return [];
  const base = Math.floor(totalMinor / n);
  const out = Array<number>(n).fill(base);
  out[n - 1]! += totalMinor - base * n;
  return out;
}

/** Divides a total in proportion to weights; the rounding remainder goes to the heaviest box. */
export function splitByWeight(totalMinor: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0 || sum <= 0) return [];
  const out = weights.map((w) => Math.floor((totalMinor * w) / sum));
  const used = out.reduce((a, b) => a + b, 0);
  const heaviest = weights.indexOf(Math.max(...weights));
  out[heaviest]! += totalMinor - used;
  return out;
}

const currencyCode = z.enum(CURRENCIES);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-17');
/** A rate as typed: "1452" or "2608.5" — up to three decimals, positive. */
const rateText = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, 'A rate is a number with up to three decimals, e.g. 1452 or 2608.5')
  .refine((v) => Number(v) > 0, 'A rate must be above zero');

export const costCategoryInput = z.object({
  name: z.string().trim().min(2).max(60),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  active: z.boolean().default(true),
  /** The one category tips land in (slice 5). */
  isTip: z.boolean().default(false),
});

export const exchangeRateInput = z.object({
  currency: currencyCode.refine((c) => c !== 'USD', 'USD needs no rate'),
  date: isoDay,
  perUsd: rateText,
});

export const SPLIT_METHODS = ['EQUAL', 'WEIGHT', 'MANUAL'] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

/**
 * Money spent: on one box, or one bill across several boxes of a booking. The total is typed once; the
 * system divides it. Amounts are minor units of the currency (the screen converts what was typed).
 */
export const costInput = z
  .object({
    containerIds: z.array(z.string().uuid()).min(1).max(100),
    categoryId: z.string().uuid(),
    date: isoDay,
    currency: currencyCode,
    totalMinor: z.number().int().positive().max(1_000_000_000_000),
    paidTo: z.string().trim().max(120).default(''),
    reference: z.string().trim().max(60).default(''),
    note: z.string().trim().max(300).default(''),
    method: z.enum(SPLIT_METHODS).default('EQUAL'),
    /** For MANUAL: one amount per container, same order as containerIds, summing to totalMinor. */
    manualMinor: z.array(z.number().int().nonnegative()).optional(),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.containerIds).size !== v.containerIds.length)
      ctx.addIssue({ code: 'custom', path: ['containerIds'], message: 'A box is listed twice' });
    if (v.method === 'MANUAL') {
      if (!v.manualMinor || v.manualMinor.length !== v.containerIds.length)
        ctx.addIssue({
          code: 'custom',
          path: ['manualMinor'],
          message: 'Give one amount per box',
        });
      else if (v.manualMinor.reduce((a, b) => a + b, 0) !== v.totalMinor)
        ctx.addIssue({
          code: 'custom',
          path: ['manualMinor'],
          message: 'The amounts per box must add up to the total',
        });
    }
  });
export type CostInput = z.infer<typeof costInput>;

/** Correcting one line: the amount, with a reason. Date and currency never change — void it and enter it again. */
export const costLinePatch = z.object({
  amountMinor: z.number().int().positive().max(1_000_000_000_000),
  reason: z.string().trim().min(3).max(300),
});
export const costVoidInput = z.object({ reason: z.string().trim().min(3).max(300) });

export const MARGIN_TYPES = ['PERCENT', 'FIXED_USD'] as const;
/** The company's one margin figure: a percentage of cost (basis points) or a fixed USD amount per box (cents). */
export const settingsInput = z.object({
  marginType: z.enum(MARGIN_TYPES),
  marginValue: z.number().int().min(0).max(1_000_000_000),
});

export const addContainersInput = z
  .object({ containers: z.array(containerInput).min(1).max(100) })
  .superRefine((v, ctx) => noRepeats(v.containers, ctx));

/** How the MD rules on a duplicate container: keep the new entry, withdraw it, or correct its number. NOTED closes an item that only informs (a cost after closing). */
export const DUPLICATE_RESOLUTIONS = [
  'KEEP_NEW',
  'WITHDRAW_NEW',
  'CORRECT_NUMBER',
  'NOTED',
  'APPROVE', // a cost typed on the other side's box: it counts
  'REFUSE', // …or it is voided, with a reason; a repeated payment: it is rejected
  'ALLOW', // a repeated payment that is genuine: it goes on to approval (slice 6)
] as const;
export const duplicateResolution = z.object({
  resolution: z.enum(DUPLICATE_RESOLUTIONS),
  number: containerNumber.optional(),
  reason: z.string().trim().max(300).optional(),
});

// ---------------------------------------------------------------- the journey (slice 4)

/** The words on the screen for each stage. The record keeps the eight stages; the board shows six columns. */
export const STAGE_LABEL: Record<Stage, string> = {
  BOOKED: 'Booked',
  TRANSPORT: 'Loaded, on the road',
  FIELD_RELEASE: 'Released at warehouse',
  RUSUMO: 'Crossed Rusumo',
  CHECKPOINTS: 'In transit, Tanzania',
  ICD: 'At ICD',
  PORT: 'At port',
  OCEAN_FREIGHT: 'On vessel',
};

export const STAGE_INDEX: Record<Stage, number> = Object.fromEntries(
  STAGES.map((s, i) => [s, i]),
) as Record<Stage, number>;

/** Six columns on the board; a column holds one or two stages. Checkpoints is not a place a box sits in. */
export const BOARD_COLUMNS: readonly { key: string; label: string; stages: readonly Stage[] }[] = [
  { key: 'booked', label: 'Booked', stages: ['BOOKED'] },
  { key: 'kigali', label: 'Kigali side', stages: ['TRANSPORT', 'FIELD_RELEASE'] },
  { key: 'rusumo', label: 'Crossed Rusumo', stages: ['RUSUMO', 'CHECKPOINTS'] },
  { key: 'icd', label: 'ICD', stages: ['ICD'] },
  { key: 'port', label: 'Port', stages: ['PORT'] },
  { key: 'vessel', label: 'Vessel', stages: ['OCEAN_FREIGHT'] },
];

/** Stages during which a position update is expected every `trackingHours`: the box is on a truck. */
export const ROAD_STAGES: readonly Stage[] = [
  'TRANSPORT',
  'FIELD_RELEASE',
  'RUSUMO',
  'CHECKPOINTS',
];

/** What an entry on a box's timeline says. */
export const JOURNEY_KINDS = [
  'REACHED', // the box reached a stage (the usual entry)
  'UPDATE', // a position update, no stage change
  'HELD', // held where it is, with a reason
  'HOLD_LIFTED', // the hold is over, the box has not moved
  'RETURNED', // sent back from Rusumo to the Kigali side
  'CORRECTED', // a wrong stage put right, with a reason
  'RELEASED', // the line accepted the box for loading
  'FLAGGED', // marked at risk
  'CLEARED', // the at-risk flag lifted
  'CLOSED', // closed to Finance
  'REOPENED', // reopened by the MD
] as const;
export type JourneyKind = (typeof JOURNEY_KINDS)[number];

/** A moment as typed: a date, or a date and time; an empty field means "now". */
const momentField = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/,
      'Use a date like 2026-10-17, or date and time',
    )
    .nullable(),
);

/**
 * One entry on a box's journey. REACHED needs a stage; UPDATE needs a place; HELD needs a reason in `note`;
 * HOLD_LIFTED needs a held box; RETURNED is only from Rusumo. `happenedAt` is when it happened, which may be earlier than now.
 */
export const journeyInput = z
  .object({
    kind: z.enum(['REACHED', 'UPDATE', 'HELD', 'HOLD_LIFTED', 'RETURNED']),
    stage: z.enum(STAGES).optional(),
    place: z.string().trim().max(120).default(''),
    note: z.string().trim().max(300).default(''),
    happenedAt: momentField.default(null),
    /** For the hand-over stage in a group of three or more companies: which company takes the box. */
    toCompanyId: z.string().uuid().optional(),
    /** Dates of the Ocean freight stage, filled as they become known. */
    departedOn: dateField.optional(),
    arrivedOn: dateField.optional(),
    emptyReturnedOn: dateField.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'REACHED' && !v.stage)
      ctx.addIssue({ code: 'custom', path: ['stage'], message: 'Which stage did the box reach?' });
    if (v.kind === 'REACHED' && v.stage === 'BOOKED')
      ctx.addIssue({ code: 'custom', path: ['stage'], message: 'Booked is where a box starts' });
    if (v.kind === 'UPDATE' && !v.place)
      ctx.addIssue({ code: 'custom', path: ['place'], message: 'Where is the box now?' });
    if (v.kind === 'HELD' && v.note.length < 3)
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Why is it held?' });
  });
export type JourneyInput = z.infer<typeof journeyInput>;

const reasonText = z.string().trim().min(3).max(300);

/** Putting a wrong stage right: forwards or backwards, always with a reason. */
export const stageCorrectionInput = z.object({ stage: z.enum(STAGES), reason: reasonText });

export const riskFlagInput = z.object({ reason: reasonText });
export const riskClearInput = z.object({ note: z.string().trim().max(300).default('') });

/** One sign-off for the boxes of a booking the line accepted for loading. */
export const releaseInput = z.object({
  containerIds: z.array(z.string().uuid()).min(1).max(100),
  releasedOn: dateField.default(null),
  note: z.string().trim().max(300).default(''),
});

/** The waiting boxes move to a sister booking: the first number plus a suffix the line gives. */
export const sisterBookingInput = z.object({
  reference: bookingReference,
  containerIds: z.array(z.string().uuid()).min(1).max(100),
});

const plMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'A month like 2026-08');

/** Closing a box to Finance: when, which P&L month it counts in, and whether it is ready to invoice. */
export const closeContainerInput = z.object({
  closedOn: dateField.default(null),
  plMonth: plMonth.optional(),
  readyToInvoice: z.boolean().default(false),
  note: z.string().trim().max(300).default(''),
});
export const reopenInput = z.object({ reason: reasonText });

/** The account figures of this slice: free days at the ICD before a box is at risk, hours between position updates. */
export const journeySettingsInput = z.object({
  icdFreeDays: z.number().int().min(0).max(365),
  trackingHours: z.number().int().min(1).max(168),
});

// ---------------------------------------------------------------- tips (slice 5)

/** Who received a facilitation payment. */
export const TIP_PAYEE_TYPES = ['OFFICIAL', 'AGENT', 'DRIVER', 'OTHER'] as const;
export type TipPayeeType = (typeof TIP_PAYEE_TYPES)[number];
export const TIP_PAYEE_LABEL: Record<TipPayeeType, string> = {
  OFFICIAL: 'Official at a stop',
  AGENT: 'Agent / clearing',
  DRIVER: 'Driver',
  OTHER: 'Other',
};

export const tipReasonInput = z.object({
  label: z.string().trim().min(2).max(40),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  active: z.boolean().default(true),
});

/**
 * A tip, as the phone sends it: the boxes tapped, a reason, an amount. Everything else is optional and can
 * follow later from a calmer screen. `clientId` is made on the phone so the outbox can send it twice safely.
 */
export const tipInput = z.object({
  clientId: z.string().uuid(),
  containerIds: z.array(z.string().uuid()).min(1).max(20),
  reasonId: z.string().uuid(),
  currency: currencyCode,
  totalMinor: z.number().int().positive().max(1_000_000_000_000),
  /** The day it was paid; empty means today. A tip from the outbox keeps the day it was typed. */
  date: isoDay.optional(),
  payeeType: z.enum(TIP_PAYEE_TYPES).optional(),
  payeeId: z.string().trim().max(40).default(''),
  checkpoint: z.string().trim().max(80).default(''),
  note: z.string().trim().max(300).default(''),
  /** The MD's six-digit code, when the tip is past the ceiling or the monthly cap. */
  mdCode: z
    .string()
    .regex(/^\d{6}$/, 'Six digits')
    .optional(),
});
export type TipInput = z.infer<typeof tipInput>;

/** Completing a tip later: who was paid, where, a note. The amount and the boxes never change here — void and retype. */
export const tipPatch = z
  .object({
    payeeType: z.enum(TIP_PAYEE_TYPES).nullable(),
    payeeId: z.string().trim().max(40),
    checkpoint: z.string().trim().max(80),
    note: z.string().trim().max(300),
  })
  .partial();

/** A receipt photo from the phone, as a data URL; JPEG, PNG or WebP, at most about 6 MB. */
export const tipPhotoInput = z.object({
  dataUrl: z
    .string()
    .max(8_500_000)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'A JPEG, PNG or WebP photo'),
});

/** The two tip figures of the account, in US cents: the most one tip may be, the most a company may tip in a month. */
export const tipSettingsInput = z.object({
  tipCeilingUsdCents: z.number().int().min(0).max(1_000_000_000),
  tipCapUsdCents: z.number().int().min(0).max(1_000_000_000),
});

// ---------------------------------------------------------------- payments (slice 6)

/** Who gets paid. STAFF is a person of the company who holds a cash float. */
export const BENEFICIARY_TYPES = [
  'TRANSPORTER',
  'SHIPPING_LINE',
  'CLEARING_AGENT',
  'SUPPLIER',
  'DRIVER',
  'STAFF',
  'OFFICIAL',
  'OTHER',
] as const;
export type BeneficiaryType = (typeof BENEFICIARY_TYPES)[number];
export const BENEFICIARY_TYPE_LABEL: Record<BeneficiaryType, string> = {
  TRANSPORTER: 'Transporter',
  SHIPPING_LINE: 'Shipping line',
  CLEARING_AGENT: 'Clearing agent',
  SUPPLIER: 'Supplier',
  DRIVER: 'Driver',
  STAFF: 'Staff (float holder)',
  OFFICIAL: 'Official body',
  OTHER: 'Other',
};

/** A bank account or a mobile-money wallet. */
export const PAYEE_ACCOUNT_KINDS = ['BANK', 'MOMO'] as const;
export type PayeeAccountKind = (typeof PAYEE_ACCOUNT_KINDS)[number];

const payeeAccount = z.object({
  accountKind: z.enum(PAYEE_ACCOUNT_KINDS),
  /** The bank, or the mobile-money network. */
  bank: z.string().trim().min(2).max(80),
  number: z.string().trim().min(4).max(40),
  currency: z.enum(CURRENCIES),
});
export type PayeeAccount = z.infer<typeof payeeAccount>;

/** A new beneficiary: name, type and the account it is paid on. It is PENDING until a second person verifies it. */
export const beneficiaryInput = payeeAccount.extend({
  name: z.string().trim().min(2).max(120),
  type: z.enum(BENEFICIARY_TYPES),
  /** For STAFF: the person who holds the float. */
  userId: z.string().uuid().nullable().optional().default(null),
  note: z.string().trim().max(300).optional().default(''),
});
export type BeneficiaryInput = z.infer<typeof beneficiaryInput>;

/** A change of account: proposed by one person, confirmed by another with a code. */
export const beneficiaryChangeInput = payeeAccount.extend({
  reason: z.string().trim().min(3).max(300),
});
export const beneficiaryConfirmInput = z.object({
  code: z.string().regex(/^\d{6}$/, 'Six digits'),
});
export const beneficiaryReasonInput = z.object({ reason: z.string().trim().min(3).max(300) });

/**
 * A payment order. COST: cost lines (or tip lines) already typed, paid to a registered beneficiary.
 * EXPENSE: an office bill with no box, through the same queue. FLOAT_ADVANCE: cash handed to a float holder.
 * SETTLEMENT: the holder's cash lines, settled against the float (approval settles; nothing leaves the bank).
 */
export const PAYMENT_KINDS = ['COST', 'EXPENSE', 'FLOAT_ADVANCE', 'SETTLEMENT'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  COST: 'Cost lines',
  EXPENSE: 'Office expense',
  FLOAT_ADVANCE: 'Float advance',
  SETTLEMENT: 'Float settlement',
};

export const PAYMENT_STATUSES = ['REQUESTED', 'BLOCKED', 'APPROVED', 'PAID', 'REJECTED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  REQUESTED: 'Waiting for approval',
  BLOCKED: 'Blocked — with the MD',
  APPROVED: 'Approved — to pay',
  PAID: 'Paid · locked',
  REJECTED: 'Rejected',
};

const purpose = z.string().trim().max(160).optional().default('');
const paymentNote = z.string().trim().max(300).optional().default('');
export const paymentRequestInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('COST'),
    beneficiaryId: z.string().uuid(),
    costLineIds: z.array(z.string().uuid()).min(1).max(100),
    purpose,
    note: paymentNote,
  }),
  z.object({
    kind: z.literal('EXPENSE'),
    beneficiaryId: z.string().uuid(),
    categoryId: z.string().uuid(),
    currency: z.enum(CURRENCIES),
    amountMinor: z.number().int().positive().max(1_000_000_000_000),
    date: isoDay,
    purpose: z.string().trim().min(3).max(160),
    note: paymentNote,
  }),
  z.object({
    kind: z.literal('FLOAT_ADVANCE'),
    beneficiaryId: z.string().uuid(),
    currency: z.enum(CURRENCIES),
    amountMinor: z.number().int().positive().max(1_000_000_000_000),
    purpose,
    note: paymentNote,
  }),
  z.object({
    kind: z.literal('SETTLEMENT'),
    beneficiaryId: z.string().uuid(),
    costLineIds: z.array(z.string().uuid()).min(1).max(100),
    note: paymentNote,
  }),
]);
export type PaymentRequestInput = z.infer<typeof paymentRequestInput>;

export const paymentApproveInput = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/, 'Six digits')
    .optional(),
});
export const paymentPayInput = z.object({
  /** The bank or MoMo reference of the transfer. */
  reference: z.string().trim().min(2).max(80),
  bankAccountId: z.string().uuid().nullable().optional().default(null),
});

/** Above this, in US cents, an approval needs the approver's one-time code (mailed to their mailbox). */
export const paymentSettingsInput = z.object({
  approvalThresholdUsdCents: z.number().int().min(0).max(1_000_000_000),
});
