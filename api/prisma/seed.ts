/**
 * Demo data: the OLIU · JIVAH account, its twelve people and the lists they work with, then the demo story
 * (prisma/demo-story.ts) typed through the API as the people would type it. The plan is in
 * docs/slices/00-demo-data.md.
 *
 *   npm run db:seed              the account, its people and its lists, idempotent; the story is played only
 *                                when the account has no bookings yet, so what you typed is never touched
 *   npm run db:seed -- --fresh   wipes the database and rebuilds everything (development only)
 *
 * Every demo login uses the password below and a code read from http://localhost:3001/dev/mail.
 * OLIU's seven people carry their real names (28 Oct 2026); JIVAH's are still the mockup's. The addresses are
 * demo addresses until the owner gives the real ones; the slice notes refer to them.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import argon2 from 'argon2';
import { config } from '../src/config.ts';
import { prisma } from '../src/db.ts';
import { uploadRoot } from '../src/modules/tips/routes.ts';
import { DEMO_PASSWORD, PEOPLE, playDemoStory, type StoryReport } from './demo-story.ts';

export { DEMO_PASSWORD };
const ACCOUNT_NAME = 'OLIU · JIVAH';

// ---------------------------------------------------------------- the account and its people

async function createAccount() {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const account = await prisma.account.create({
    data: { name: ACCOUNT_NAME, package: 'GROUP', handoverStage: 'RUSUMO' },
  });
  const oliu = await prisma.company.create({
    data: {
      accountId: account.id,
      legalName: 'OLIU LOGISTICS LTD',
      country: 'RW',
      currency: 'RWF',
      tin: '120126551',
      address: 'KK 4 Avenue, Kigali — Rwanda',
      kind: 'MAIN',
      billsClient: true,
      bankAccounts: {
        create: [
          {
            accountId: account.id,
            bank: 'Equity Bank',
            number: '4012201091332',
            currency: 'RWF',
            swift: 'EQBLRWRW',
          },
          {
            accountId: account.id,
            bank: 'Equity Bank',
            number: '4002200956916',
            currency: 'USD',
            swift: 'EQBLRWRW',
          },
          { accountId: account.id, bank: 'I&M Bank', number: '006936700122', currency: 'USD' },
          {
            accountId: account.id,
            bank: 'Bank of Kigali',
            number: '10007-7157365',
            currency: 'RWF',
            swift: 'BKBLRWRW',
          },
          {
            accountId: account.id,
            bank: 'Bank of Kigali',
            number: '10008-3003949',
            currency: 'USD',
            swift: 'BKBLRWRW',
          },
        ],
      },
    },
  });
  const jivah = await prisma.company.create({
    data: {
      accountId: account.id,
      legalName: 'JIVAH LOGISTICS LTD',
      country: 'TZ',
      currency: 'TZS',
      address: 'Dar es Salaam — Tanzania',
      kind: 'PARTNER',
      billsClient: false,
    },
  });

  type Role =
    | 'MD'
    | 'OPS_MANAGER'
    | 'FINANCE_OFFICER'
    | 'TRANSPORT_COORDINATOR'
    | 'FIELD_OFFICER'
    | 'REPORTING_OFFICER';
  type Person = {
    name: string;
    email: string;
    mailbox: string;
    role: Role;
    company: string | null;
    status?: 'SUSPENDED';
  };
  const people: Person[] = [
    { name: 'Janvier Ndikumwenayo', ...PEOPLE.janvier, role: 'MD', company: null },
    { name: 'Simbi Belise', ...PEOPLE.belise, role: 'OPS_MANAGER', company: oliu.id },
    { name: 'Kamukama Liliose', ...PEOPLE.liliose, role: 'FINANCE_OFFICER', company: oliu.id },
    {
      name: 'Kariyo Jean Damascene',
      ...PEOPLE.jean,
      role: 'TRANSPORT_COORDINATOR',
      company: oliu.id,
    },
    { name: 'Ntakanyurumwanzi Eudes', ...PEOPLE.eudes, role: 'FIELD_OFFICER', company: oliu.id },
    {
      // "Transport Officer" at OLIU, a role the system does not have; a coordinator until the owner says (register 1.4)
      name: 'Nsabimana Jean Francois Yves',
      email: 'yves.n@oliulogistics.rw',
      mailbox: 'ops@oliulogistics.rw',
      role: 'TRANSPORT_COORDINATOR',
      company: oliu.id,
    },
    {
      name: 'Tuyishime Grace',
      email: 'grace.t@oliulogistics.rw',
      mailbox: 'reports@oliulogistics.rw',
      role: 'REPORTING_OFFICER',
      company: null,
    },
    { name: 'Samuel Nyerere', ...PEOPLE.samuel, role: 'OPS_MANAGER', company: jivah.id },
    {
      name: 'Charles Mwakasege',
      email: 'charles.m@jivahlogistics.co.tz',
      mailbox: 'finance@jivahlogistics.co.tz',
      role: 'FINANCE_OFFICER',
      company: jivah.id,
      status: 'SUSPENDED',
    },
    { name: 'Joseph Mushi', ...PEOPLE.joseph, role: 'TRANSPORT_COORDINATOR', company: jivah.id },
    { name: 'Amina Hassan', ...PEOPLE.amina, role: 'FIELD_OFFICER', company: jivah.id },
    { name: 'Baraka Juma', ...PEOPLE.baraka, role: 'FIELD_OFFICER', company: jivah.id },
  ];
  for (const p of people)
    await prisma.user.create({
      data: {
        accountId: account.id,
        companyId: p.company,
        name: p.name,
        email: p.email,
        role: p.role,
        otpMailbox: p.mailbox,
        passwordHash,
        status: p.status ?? 'ACTIVE',
      },
    });
  await prisma.auditEvent.create({
    data: {
      accountId: account.id,
      module: 'accounts',
      action: 'seeded',
      entity: 'account',
      entityId: account.id,
      after: { people: people.length },
    },
  });
  console.log(
    `account "${ACCOUNT_NAME}": ${people.length} people · password for every demo login: ${DEMO_PASSWORD}`,
  );
  return account;
}

// ---------------------------------------------------------------- the lists the account works with (idempotent)

/** Slice 2: the carriers and the two clients of the October invoices. */
async function seedShipments(accountId: string) {
  const lines = [
    {
      name: 'PIL',
      usualPrefixes: ['PCIU', 'PIDU'],
      referenceHint: 'as printed on the booking confirmation',
      referencePattern: '',
    },
    {
      name: 'CMA CGM',
      usualPrefixes: ['CMAU', 'CGMU', 'ECMU'],
      referenceHint:
        '4 letters + 7 digits, then a letter for a sister booking, e.g. CMDU4471023 or CMDU4471023A',
      referencePattern: '^[A-Z]{4}\\d{7}[A-Z]?$',
    },
    {
      name: 'Maersk',
      usualPrefixes: ['MSKU', 'MRKU', 'MAEU', 'SUDU'],
      referenceHint: '9 digits, then a letter for a sister booking, e.g. 259114882',
      referencePattern: '^\\d{9}[A-Z]?$',
    },
    {
      name: 'MSC',
      usualPrefixes: ['MSCU', 'MEDU', 'MSDU'],
      referenceHint: 'as printed on the booking confirmation',
      referencePattern: '',
    },
    {
      name: 'Hapag-Lloyd',
      usualPrefixes: ['HLXU', 'HLCU', 'HLBU', 'UACU'],
      referenceHint:
        'HLCU + 3 letters + 7 digits, then a letter for a sister booking, e.g. HLCUKGL2608514',
      referencePattern: '^HLCU[A-Z]{3}\\d{7}[A-Z]?$',
    },
  ];
  for (const { name, ...shape } of lines)
    await prisma.shippingLine.upsert({
      where: { accountId_name: { accountId, name } },
      update: shape,
      create: { accountId, name, ...shape },
    });
  const clients = [
    {
      name: 'Space Mining',
      legalName: 'ZHEJIANG STAR MINING TECHNOLOGY LTD',
      address:
        'Room 6-26-399, East Building, No.673 Jiangnan Road, Ningbo High-Tech Zone, Zhejiang Province',
      country: 'CN',
    },
    { name: 'Transvera', legalName: 'TRANSVERA GROUP LTD', tin: '150003073', country: 'RW' },
  ];
  for (const c of clients)
    await prisma.client.upsert({
      where: { accountId_name: { accountId, name: c.name } },
      update: {},
      create: { accountId, ...c },
    });
  console.log(`lists in place: ${lines.length} shipping lines, ${clients.length} clients`);
}

/** Slices 3 and 5: what money is spent on (tips land in one category), the reason buttons, the figures row. */
async function seedCosts(accountId: string) {
  const categories = [
    'Shipping line',
    'Clearance — Kigali',
    'Clearance — Dar',
    'Inland transport',
    'ICD / port charges',
    'Border / transit',
    'Documents & permits',
    'Handling / stuffing',
    'Storage / demurrage',
    'Tip / facilitation',
    'Office expenses',
    'Other',
  ];
  for (const [i, name] of categories.entries())
    await prisma.costCategory.upsert({
      where: { accountId_name: { accountId, name } },
      update: { sortOrder: i, isTip: name === 'Tip / facilitation' },
      create: { accountId, name, sortOrder: i, isTip: name === 'Tip / facilitation' },
    });
  const reasons = ['Checkpoint passage', 'Weighing / iminzani', 'Expediting', 'Goodwill', 'Other'];
  for (const [i, label] of reasons.entries())
    await prisma.tipReason.upsert({
      where: { accountId_label: { accountId, label } },
      update: { sortOrder: i },
      create: { accountId, label, sortOrder: i },
    });
  // The figures the MD sets: the defaults of the register (4 free days, 12 hours, USD 50 / USD 1,000, no margin yet).
  await prisma.accountSettings.upsert({ where: { accountId }, update: {}, create: { accountId } });
  console.log(
    `lists in place: ${categories.length} cost categories, ${reasons.length} tip reasons`,
  );
}

// ---------------------------------------------------------------- fresh: wipe and rebuild (development only)

async function wipeDatabase() {
  if (config.isProd) throw new Error('--fresh is for development databases only');
  const old = await prisma.account.findFirst({
    where: { name: ACCOUNT_NAME },
    select: { id: true },
  });
  if (old) await rm(resolve(uploadRoot(), old.id), { recursive: true, force: true });
  // Everything hangs off Account by foreign key except the file counters; the trail is append-only by trigger.
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_append_only');
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditEvent", "FileSequence", "PaymentSequence", "Account" CASCADE',
  );
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" ENABLE TRIGGER audit_append_only');
  console.log('database wiped');
}

// ---------------------------------------------------------------- entry

export interface SeedOptions {
  fresh?: boolean;
  /** Play the story even if the account has bookings (tests build on a wiped database anyway). */
  story?: boolean;
  quiet?: boolean;
}

export async function runSeed(opts: SeedOptions = {}): Promise<StoryReport | null> {
  if (opts.fresh) await wipeDatabase();
  let account = await prisma.account.findFirst({ where: { name: ACCOUNT_NAME } });
  if (!account) account = await createAccount();
  else console.log(`account "${ACCOUNT_NAME}" already present — people untouched`);
  await seedShipments(account.id);
  await seedCosts(account.id);

  const bookings = await prisma.booking.count({ where: { accountId: account.id } });
  if (bookings > 0 && !opts.story) {
    console.log(
      `${bookings} bookings kept as they are · npm run db:seed -- --fresh rebuilds the demo from scratch`,
    );
    return null;
  }
  console.log('playing the demo story through the API…');
  const report = await playDemoStory({ quiet: opts.quiet });
  console.log(
    `demo story in place: ${report.bookings} bookings, ${report.containers} boxes, ${report.costLines} cost lines, ` +
      `${report.tips} tips, ${report.journeyEvents} journey entries, ${report.mdQueueOpen} rulings waiting for the MD, ${report.beneficiaries} beneficiaries, ${report.payments} payment orders`,
  );
  return report;
}

const runDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (runDirectly) {
  runSeed({ fresh: process.argv.includes('--fresh'), quiet: !process.argv.includes('--verbose') })
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error(e instanceof Error ? e.message : e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
