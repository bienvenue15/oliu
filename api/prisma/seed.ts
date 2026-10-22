/**
 * Demo data: the OLIU · JIVAH account with the twelve people of the mockup.
 * Safe to run twice — it does nothing if the account exists.
 * Every demo login uses the password below and a code read from http://localhost:3001/dev/mail.
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();
export const DEMO_PASSWORD = 'Oliu-demo-2026';

async function main() {
  const exists = await prisma.account.findFirst({ where: { name: 'OLIU · JIVAH' } });
  if (exists) {
    console.log('demo account already present — nothing to do');
    return;
  }
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  const account = await prisma.account.create({
    data: { name: 'OLIU · JIVAH', package: 'GROUP', handoverStage: 'RUSUMO' },
  });
  const oliu = await prisma.company.create({
    data: {
      accountId: account.id, legalName: 'OLIU LOGISTICS LTD', country: 'RW', currency: 'RWF', tin: '120126551',
      address: 'KK 4 Avenue, Kigali — Rwanda', kind: 'MAIN', billsClient: true,
      bankAccounts: {
        create: [
          { accountId: account.id, bank: 'Equity Bank', number: '4012201091332', currency: 'RWF', swift: 'EQBLRWRW' },
          { accountId: account.id, bank: 'Equity Bank', number: '4002200956916', currency: 'USD', swift: 'EQBLRWRW' },
          { accountId: account.id, bank: 'I&M Bank', number: '006936700122', currency: 'USD' },
          { accountId: account.id, bank: 'Bank of Kigali', number: '10007-7157365', currency: 'RWF', swift: 'BKBLRWRW' },
          { accountId: account.id, bank: 'Bank of Kigali', number: '10008-3003949', currency: 'USD', swift: 'BKBLRWRW' },
        ],
      },
    },
  });
  const jivah = await prisma.company.create({
    data: { accountId: account.id, legalName: 'JIVAH LOGISTICS LTD', country: 'TZ', currency: 'TZS', address: 'Dar es Salaam — Tanzania', kind: 'PARTNER', billsClient: false },
  });

  type P = { name: string; email: string; role: 'MD' | 'OPS_MANAGER' | 'FINANCE_OFFICER' | 'TRANSPORT_COORDINATOR' | 'FIELD_OFFICER' | 'REPORTING_OFFICER'; company: string | null; mailbox: string; status?: 'SUSPENDED' };
  const people: P[] = [
    { name: 'Eraste K.', email: 'eraste.k@oliulogistics.rw', role: 'MD', company: null, mailbox: 'management@oliulogistics.rw' },
    { name: 'Divine Mukamana', email: 'divine.m@oliulogistics.rw', role: 'OPS_MANAGER', company: oliu.id, mailbox: 'ops@oliulogistics.rw' },
    { name: 'Aline Uwase', email: 'aline.u@oliulogistics.rw', role: 'FINANCE_OFFICER', company: oliu.id, mailbox: 'finance@oliulogistics.rw' },
    { name: 'Jean Habimana', email: 'jean.h@oliulogistics.rw', role: 'TRANSPORT_COORDINATOR', company: oliu.id, mailbox: 'transport@oliulogistics.rw' },
    { name: 'Peace Kayitesi', email: 'peace.k@oliulogistics.rw', role: 'FIELD_OFFICER', company: oliu.id, mailbox: 'ops@oliulogistics.rw' },
    { name: 'Grace Keza', email: 'grace.k@oliulogistics.rw', role: 'FIELD_OFFICER', company: oliu.id, mailbox: 'ops@oliulogistics.rw' },
    { name: 'Claire Irakoze', email: 'claire.i@oliulogistics.rw', role: 'REPORTING_OFFICER', company: null, mailbox: 'reports@oliulogistics.rw' },
    { name: 'Samuel Nyerere', email: 'samuel.n@jivahlogistics.co.tz', role: 'OPS_MANAGER', company: jivah.id, mailbox: 'ops@jivahlogistics.co.tz' },
    { name: 'Charles Mwakasege', email: 'charles.m@jivahlogistics.co.tz', role: 'FINANCE_OFFICER', company: jivah.id, mailbox: 'finance@jivahlogistics.co.tz', status: 'SUSPENDED' },
    { name: 'Joseph Mushi', email: 'joseph.m@jivahlogistics.co.tz', role: 'TRANSPORT_COORDINATOR', company: jivah.id, mailbox: 'transport@jivahlogistics.co.tz' },
    { name: 'Amina Hassan', email: 'amina.h@jivahlogistics.co.tz', role: 'FIELD_OFFICER', company: jivah.id, mailbox: 'ops@jivahlogistics.co.tz' },
    { name: 'Baraka Juma', email: 'baraka.j@jivahlogistics.co.tz', role: 'FIELD_OFFICER', company: jivah.id, mailbox: 'ops@jivahlogistics.co.tz' },
  ];
  for (const p of people) {
    await prisma.user.create({
      data: { accountId: account.id, companyId: p.company, name: p.name, email: p.email, role: p.role, otpMailbox: p.mailbox, passwordHash, status: p.status ?? 'ACTIVE' },
    });
  }
  await prisma.auditEvent.create({
    data: { accountId: account.id, module: 'accounts', action: 'seeded', entity: 'account', entityId: account.id, after: { people: people.length } },
  });
  console.log(`seeded account "${account.name}" with ${people.length} people · password for every demo login: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
