/** Test helpers: a clean database, an account created through the real set-up endpoint, and a login that reads the code from the dev outbox. */
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../src/db.ts';
import { clearOutbox, devOutbox } from '../src/lib/mail.ts';

export async function resetDb() {
  // Order matters for foreign keys; audit rows are deleted with a direct statement because the trigger blocks normal deletes.
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_append_only');
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditEvent","ActionToken","OtpChallenge","Session","User","FeatureSwitch","BankAccount","Company","Account" CASCADE',
  );
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" ENABLE TRIGGER audit_append_only');
  clearOutbox();
}

export const PASSWORD = 'Test-password-2026';

export const groupSetup = (ownerEmail = 'md@oliu.test') => ({
  accountName: 'OLIU · JIVAH',
  package: 'GROUP',
  handoverStage: 'RUSUMO',
  companies: [
    {
      legalName: 'OLIU LOGISTICS LTD',
      country: 'RW',
      currency: 'RWF',
      tin: '120126551',
      kind: 'MAIN',
      billsClient: true,
    },
    {
      legalName: 'JIVAH LOGISTICS LTD',
      country: 'TZ',
      currency: 'TZS',
      kind: 'PARTNER',
      billsClient: false,
    },
    {
      legalName: 'OLIU — Rubavu office',
      country: 'RW',
      currency: 'RWF',
      kind: 'BRANCH',
      parentIndex: 0,
      billsClient: false,
    },
  ],
  owner: { name: 'Developer', email: ownerEmail, password: PASSWORD },
});

export const singleSetup = (ownerEmail = 'owner@transit.test') => ({
  accountName: 'Gatuna Transit',
  package: 'SINGLE',
  handoverStage: null,
  companies: [
    {
      legalName: 'Gatuna Transit Ltd',
      country: 'RW',
      currency: 'RWF',
      kind: 'MAIN',
      billsClient: true,
    },
  ],
  owner: { name: 'Owner', email: ownerEmail, password: PASSWORD },
});

/** Full login: password, then the six-digit code read from the development outbox. Returns the cookie. */
export async function login(app: Express, email: string, password = PASSWORD): Promise<string> {
  const r1 = await request(app).post('/api/auth/login').send({ email, password });
  if (r1.status !== 200)
    throw new Error(`login step 1 failed: ${r1.status} ${JSON.stringify(r1.body)}`);
  const mail = devOutbox().find((m) => m.subject.includes('one-time code'));
  const code = mail?.text.match(/: (\d{6})/)?.[1];
  if (!code) throw new Error('no code mailed');
  const r2 = await request(app)
    .post('/api/auth/otp')
    .send({ challengeId: r1.body.challengeId, code });
  if (r2.status !== 200)
    throw new Error(`login step 2 failed: ${r2.status} ${JSON.stringify(r2.body)}`);
  const cookie = r2.headers['set-cookie']?.[0]?.split(';')[0];
  if (!cookie) throw new Error('no cookie');
  return cookie;
}

/** Invite a user as the MD and complete the set-password link from the outbox. */
export async function inviteAndActivate(
  app: Express,
  mdCookie: string,
  body: Record<string, unknown>,
  password = PASSWORD,
) {
  const r = await request(app).post('/api/users').set('Cookie', mdCookie).send(body);
  if (r.status !== 201) throw new Error(`invite failed: ${r.status} ${JSON.stringify(r.body)}`);
  const mail = devOutbox().find(
    (m) => m.to === body.email && m.subject.startsWith('You are invited'),
  );
  const token = mail?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error('no invitation mailed');
  const r2 = await request(app).post('/api/auth/set-password').send({ token, password });
  if (r2.status !== 200) throw new Error(`set-password failed: ${r2.status}`);
  return r.body as { id: string; email: string };
}
