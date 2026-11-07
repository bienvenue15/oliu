/**
 * Slice 1 — the tests of the roadmap, as code:
 *  - an account is created from the set-up questions, with branch and partner companies
 *  - twelve logins scoped correctly; a JIVAH login never sees the OLIU company
 *  - a suspended user is refused and the attempt is in the audit trail
 *  - a single-company account shows no switcher (one company only)
 *  - the audit trail cannot be edited or deleted
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { devOutbox } from '../src/lib/mail.ts';
import { groupSetup, inviteAndActivate, login, PASSWORD, resetDb, singleSetup } from './helpers.ts';

const app = createApp();

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(resetDb);

describe('account set-up', () => {
  it('creates a group with a main, a partner and a branch, and the owner as MD', async () => {
    const r = await request(app).post('/api/accounts').send(groupSetup());
    expect(r.status).toBe(201);
    const companies = await prisma.company.findMany({
      where: { accountId: r.body.accountId },
      orderBy: { createdAt: 'asc' },
    });
    expect(companies.map((c) => c.kind)).toEqual(['MAIN', 'PARTNER', 'BRANCH']);
    expect(companies[2]!.parentId).toBe(companies[0]!.id);
    expect(companies.filter((c) => c.billsClient)).toHaveLength(1);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: r.body.ownerId } });
    expect(owner.role).toBe('MD');
    expect(owner.companyId).toBeNull();
  });

  it('refuses a group with no partner, two billers, or a branch without a parent', async () => {
    const bad1 = { ...groupSetup(), companies: [groupSetup().companies[0]] };
    const bad2 = {
      ...groupSetup(),
      companies: groupSetup().companies.map((c) => ({ ...c, billsClient: true })),
    };
    const bad3 = {
      ...groupSetup(),
      companies: groupSetup().companies.map((c) =>
        c.kind === 'BRANCH' ? { ...c, parentIndex: undefined } : c,
      ),
    };
    for (const body of [bad1, bad2, bad3]) {
      const r = await request(app).post('/api/accounts').send(body);
      expect(r.status).toBe(400);
    }
    expect(await prisma.account.count()).toBe(0);
  });
});

describe('login with one-time code', () => {
  it('mails a six-digit code to the department mailbox, then opens a session', async () => {
    await request(app).post('/api/accounts').send(groupSetup());
    const r1 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'md@oliu.test', password: PASSWORD });
    expect(r1.status).toBe(200);
    expect(r1.body.challengeId).toBeDefined();
    const mail = devOutbox()[0]!;
    expect(mail.to).toBe('md@oliu.test');
    expect(mail.text).toMatch(/\d{6}/);
    const wrong = await request(app)
      .post('/api/auth/otp')
      .send({ challengeId: r1.body.challengeId, code: '000000' });
    expect(wrong.status).toBe(401);
    const cookie = await login(app, 'md@oliu.test');
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('MD');
    expect(me.body.companies).toHaveLength(3);
    expect(me.body.menus.map((m: { key: string }) => m.key)).toContain('set');
  });

  it('gives the same answer for a wrong password and an unknown e-mail', async () => {
    await request(app).post('/api/accounts').send(groupSetup());
    const a = await request(app)
      .post('/api/auth/login')
      .send({ email: 'md@oliu.test', password: 'wrong-password-1' });
    const b = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@oliu.test', password: 'wrong-password-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });

  it('rejects a forged session cookie', async () => {
    const r = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'oliu_session=00000000-0000-0000-0000-000000000000.forged');
    expect(r.status).toBe(401);
  });
});

describe('scoping — every person sees only their side', () => {
  it('a JIVAH Finance Officer never sees the OLIU company; the MD sees all', async () => {
    const r = await request(app).post('/api/accounts').send(groupSetup());
    const md = await login(app, 'md@oliu.test');
    const companies = await prisma.company.findMany({
      where: { accountId: r.body.accountId },
      orderBy: { createdAt: 'asc' },
    });
    const [oliu, jivah] = companies;
    await inviteAndActivate(app, md, {
      name: 'Charles M.',
      email: 'charles@jivah.test',
      role: 'FINANCE_OFFICER',
      companyId: jivah!.id,
    });
    const charles = await login(app, 'charles@jivah.test');

    const me = await request(app).get('/api/auth/me').set('Cookie', charles);
    expect(me.body.companies.map((c: { id: string }) => c.id)).toEqual([jivah!.id]);
    expect(me.body.menus.map((m: { key: string }) => m.key)).not.toContain('ship'); // Finance Officer: no Shipments menu
    expect(me.body.menus.map((m: { key: string }) => m.key)).toContain('pay');

    // The account page (companies, bank accounts) and the people list are the MD's screens: refused to Charles.
    expect((await request(app).get('/api/account').set('Cookie', charles)).status).toBe(403);
    expect((await request(app).get('/api/users').set('Cookie', charles)).status).toBe(403);

    // Asking for the other company through the switcher header changes nothing for a one-company user.
    const sneaky = await request(app)
      .get('/api/auth/me')
      .set('Cookie', charles)
      .set('X-Company', oliu!.id);
    expect(sneaky.status).toBe(200);
    expect(sneaky.body.companies.map((c: { id: string }) => c.id)).not.toContain(oliu!.id);

    const mdAcct = await request(app).get('/api/account').set('Cookie', md);
    expect(mdAcct.body.companies).toHaveLength(3);
  });

  it('the switcher only accepts a company of the same account', async () => {
    await request(app).post('/api/accounts').send(groupSetup());
    const other = await request(app).post('/api/accounts').send(singleSetup());
    const md = await login(app, 'md@oliu.test');
    const foreign = await prisma.company.findFirstOrThrow({
      where: { accountId: other.body.accountId },
    });
    const r = await request(app).get('/api/account').set('Cookie', md).set('X-Company', foreign.id);
    expect(r.status).toBe(403);
  });

  it('a Finance Officer cannot invite people; the MD can, and a company-bound role needs a company', async () => {
    const r = await request(app).post('/api/accounts').send(groupSetup());
    const md = await login(app, 'md@oliu.test');
    const oliu = await prisma.company.findFirstOrThrow({
      where: { accountId: r.body.accountId, kind: 'MAIN' },
    });
    await inviteAndActivate(app, md, {
      name: 'Aline U.',
      email: 'aline@oliu.test',
      role: 'FINANCE_OFFICER',
      companyId: oliu.id,
    });
    const aline = await login(app, 'aline@oliu.test');
    const denied = await request(app)
      .post('/api/users')
      .set('Cookie', aline)
      .send({ name: 'X', email: 'x@oliu.test', role: 'FIELD_OFFICER', companyId: oliu.id });
    expect(denied.status).toBe(403);
    const noCompany = await request(app)
      .post('/api/users')
      .set('Cookie', md)
      .send({ name: 'X', email: 'x@oliu.test', role: 'FIELD_OFFICER', companyId: null });
    expect(noCompany.status).toBe(400);
  });

  it('a single-company account has exactly one company and no partner', async () => {
    await request(app).post('/api/accounts').send(singleSetup());
    const owner = await login(app, 'owner@transit.test');
    const me = await request(app).get('/api/auth/me').set('Cookie', owner);
    expect(me.body.companies).toHaveLength(1);
    expect(me.body.account.package).toBe('SINGLE');
  });
});

describe('suspension and the audit trail', () => {
  it('a suspended user is refused, the attempt is recorded, and the MD can reactivate', async () => {
    const r = await request(app).post('/api/accounts').send(groupSetup());
    const md = await login(app, 'md@oliu.test');
    const oliu = await prisma.company.findFirstOrThrow({
      where: { accountId: r.body.accountId, kind: 'MAIN' },
    });
    const u = await inviteAndActivate(app, md, {
      name: 'Peace K.',
      email: 'peace@oliu.test',
      role: 'FIELD_OFFICER',
      companyId: oliu.id,
    });
    const peace = await login(app, 'peace@oliu.test');

    const s = await request(app).post(`/api/users/${u.id}/suspend`).set('Cookie', md);
    expect(s.status).toBe(200);
    // Existing session is dead, and a new login is refused with a recorded attempt.
    expect((await request(app).get('/api/auth/me').set('Cookie', peace)).status).toBe(401);
    const refused = await request(app)
      .post('/api/auth/login')
      .send({ email: 'peace@oliu.test', password: PASSWORD });
    expect(refused.status).toBe(401);
    expect(refused.body.error).toMatch(/suspended/);

    const trail = await request(app).get('/api/audit').set('Cookie', md);
    const actions = trail.body.map((e: { action: string }) => e.action);
    expect(actions).toContain('login_refused');
    expect(actions).toContain('user_suspended');

    await request(app).post(`/api/users/${u.id}/reactivate`).set('Cookie', md);
    expect(await login(app, 'peace@oliu.test')).toBeTruthy();
  });

  it('the audit table refuses UPDATE and DELETE', async () => {
    await request(app).post('/api/accounts').send(groupSetup());
    await expect(
      prisma.$executeRawUnsafe('UPDATE "AuditEvent" SET action = \'x\''),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM "AuditEvent"')).rejects.toThrow(
      /append-only/,
    );
  });

  it('a Field Officer cannot read the audit trail; a Reporting Officer can, read-only', async () => {
    const r = await request(app).post('/api/accounts').send(groupSetup());
    const md = await login(app, 'md@oliu.test');
    const oliu = await prisma.company.findFirstOrThrow({
      where: { accountId: r.body.accountId, kind: 'MAIN' },
    });
    await inviteAndActivate(app, md, {
      name: 'Peace K.',
      email: 'peace@oliu.test',
      role: 'FIELD_OFFICER',
      companyId: oliu.id,
    });
    await inviteAndActivate(app, md, {
      name: 'Claire I.',
      email: 'claire@oliu.test',
      role: 'REPORTING_OFFICER',
      companyId: null,
    });
    const peace = await login(app, 'peace@oliu.test');
    const claire = await login(app, 'claire@oliu.test');
    expect((await request(app).get('/api/audit').set('Cookie', peace)).status).toBe(403);
    const ok = await request(app).get('/api/audit').set('Cookie', claire);
    expect(ok.status).toBe(200);
    expect(ok.body.length).toBeGreaterThan(0);
    const me = await request(app).get('/api/auth/me').set('Cookie', claire);
    expect(me.body.permissions).toEqual([]);
  });
});
