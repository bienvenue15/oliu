/**
 * Slice 2 — the runs of the roadmap, as code:
 *  - the eighteen real containers of the two October invoices enter with no retyping
 *  - a wrong check digit is refused, and the right digit is named
 *  - a number that already exists is neither rejected nor accepted: both entries go to the MD, who rules
 *  - the other side finds a box by number, read-only, with its booking and client
 *  - a line's booking-number shape is enforced; its usual owner codes only produce a note
 *  - a Finance Officer cannot book; another account never sees the booking; the trail has every step
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { checkContainerNumber } from '@oliu/shared';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { groupSetup, inviteAndActivate, login, resetDb, singleSetup } from './helpers.ts';

const app = createApp();

/** The containers on INVOICE TO SPACE MINING ON 03.10.2026 and INVOICE TO TRANSVERA ON 04.10.2026. */
const SPACE_MINING = [
  ['FFAU8028326', 'SM/AB/2026-09B-006'],
  ['PCIU9320936', 'SM/AB/2026-09B-007'],
  ['PCIU8878266', 'SM/AB/2026-09B-005'],
  ['GLDU9067500', 'SM/AB/2026-09B-009'],
  ['HPCU4743967', 'SM/AB/2026-09B-011'],
  ['GAOU7500478', 'SM/AB/2026-09B-008'],
  ['GCXU5105809', 'SM/AB/2026-09B-010'],
  ['PIDU4544108', 'SM/AB/2026-09B-012'],
  ['FFAU8024608', 'SM/AB/2026-09B-013'],
  ['PCIU9040977', 'SM/AB/2026-09B-014'],
  ['PCIU9154223', 'SM/AB/2026-09B-015'],
  ['HPCU5173344', 'SM/AB/2026-09B-016'],
] as const;
const TRANSVERA = [
  ['PCIU0016178', 'SFN/LIS/002/RH/SEP-26'],
  ['PCIU1809371', 'SFN/LIS/001/RH/SEP-26'],
  ['PCIU1619134', 'SFN/LIS/004/RH/SEP-26'],
  ['PIDU2026877', 'SFN/LIS/003/RH/SEP-26'],
  ['PCIU2892210', 'SFN/LIS/006/RH/SEP-26'],
  ['GCXU5178913', 'SFN/LIS/005/RH/SEP-26'],
] as const;
const boxes = (list: readonly (readonly [string, string])[]) =>
  list.map(([number, lot]) => ({ number, size: '40FT', lot }));
const thisMonth = new Date().toISOString().slice(0, 7);

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(resetDb);

/** The OLIU · JIVAH account with an Operations Manager on each side, the PIL line and the two clients. */
async function world() {
  const r = await request(app).post('/api/accounts').send(groupSetup());
  const md = await login(app, 'md@oliu.test');
  const companies = await prisma.company.findMany({
    where: { accountId: r.body.accountId },
    orderBy: { createdAt: 'asc' },
  });
  const [oliu, jivah] = companies;
  await inviteAndActivate(app, md, {
    name: 'Divine M.',
    email: 'divine@oliu.test',
    role: 'OPS_MANAGER',
    companyId: oliu!.id,
  });
  await inviteAndActivate(app, md, {
    name: 'Samuel N.',
    email: 'samuel@jivah.test',
    role: 'OPS_MANAGER',
    companyId: jivah!.id,
  });
  const divine = await login(app, 'divine@oliu.test');
  const samuel = await login(app, 'samuel@jivah.test');
  const pil = (
    await request(app)
      .post('/api/shipping-lines')
      .set('Cookie', divine)
      .send({ name: 'PIL', usualPrefixes: ['PCIU', 'PIDU'] })
  ).body;
  const spaceMining = (
    await request(app)
      .post('/api/clients')
      .set('Cookie', divine)
      .send({ name: 'Space Mining', legalName: 'ZHEJIANG STAR MINING TECHNOLOGY LTD' })
  ).body;
  const transvera = (
    await request(app)
      .post('/api/clients')
      .set('Cookie', divine)
      .send({ name: 'Transvera', tin: '150003073' })
  ).body;
  return {
    accountId: r.body.accountId as string,
    md,
    divine,
    samuel,
    oliu: oliu!,
    jivah: jivah!,
    pil,
    spaceMining,
    transvera,
  };
}

describe('the container number', () => {
  it('accepts the eighteen real numbers of the two October invoices, normalising what was typed', () => {
    for (const [n] of [...SPACE_MINING, ...TRANSVERA])
      expect(checkContainerNumber(n).ok, n).toBe(true);
    expect(checkContainerNumber('pciu 932093-6')).toEqual({ number: 'PCIU9320936', ok: true });
  });

  it('refuses a wrong check digit and says what it should be', () => {
    const c = checkContainerNumber('PCIU9320935');
    expect(c.ok).toBe(false);
    expect(c.expectedDigit).toBe(6);
    expect(c.reason).toMatch(/should be 6/);
    expect(checkContainerNumber('PCIU93209').ok).toBe(false);
    expect(checkContainerNumber('PCIA9320936').reason).toMatch(/fourth letter/);
  });
});

describe('booking and container', () => {
  it('the eighteen boxes of the two October invoices enter with no retyping', async () => {
    const w = await world();
    const sm = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({
        shippingLineId: w.pil.id,
        reference: 'DAR600233400',
        clientId: w.spaceMining.id,
        cargo: 'tantalite',
        vessel: 'Kota Setia',
        destination: 'Ningbo, China',
        containers: boxes(SPACE_MINING),
      });
    expect(sm.status, JSON.stringify(sm.body)).toBe(201);
    expect(sm.body.containers).toHaveLength(12);
    expect(sm.body.duplicates).toEqual([]);
    expect(sm.body.booking.cargo).toBe('TANTALITE');
    expect(sm.body.booking.vessel).toBe('KOTA SETIA');
    const tv = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({
        shippingLineId: w.pil.id,
        reference: 'DAR600210600',
        clientId: w.transvera.id,
        cargo: 'TANTALITE',
        vessel: 'KOTA SETIA',
        containers: boxes(TRANSVERA),
      });
    expect(tv.status).toBe(201);

    const list = await request(app)
      .get(`/api/containers?month=${thisMonth}`)
      .set('Cookie', w.divine);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(18);
    expect(list.body.every((c: { status: string }) => c.status === 'ACTIVE')).toBe(true);
    const lots = list.body.map((c: { lot: string }) => c.lot);
    expect(lots).toContain('SM/AB/2026-09B-006');
    expect(lots).toContain('SFN/LIS/005/RH/SEP-26');

    const bookings = await request(app)
      .get(`/api/bookings?month=${thisMonth}`)
      .set('Cookie', w.divine);
    expect(
      bookings.body.map((b: { reference: string; containerCount: number }) => [
        b.reference,
        b.containerCount,
      ]),
    ).toEqual([
      ['DAR600210600', 6],
      ['DAR600233400', 12],
    ]);
    expect(bookings.body[0].companyName).toBe('OLIU LOGISTICS LTD');
    expect(bookings.body[0].client.name).toBe('Transvera');
  });

  it('a wrong check digit is refused by the API with the right digit named, and nothing is saved', async () => {
    const w = await world();
    const r = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({
        shippingLineId: w.pil.id,
        reference: 'DAR600233400',
        clientId: w.spaceMining.id,
        cargo: 'TANTALITE',
        containers: [{ number: 'PCIU9320935', size: '40FT', lot: '' }],
      });
    expect(r.status).toBe(400);
    expect(r.body.details[0].path).toBe('containers.0.number');
    expect(r.body.details[0].message).toMatch(/should be 6/);
    expect(await prisma.booking.count()).toBe(0);
    const check = await request(app)
      .get('/api/containers/check?number=PCIU9320935')
      .set('Cookie', w.divine);
    expect(check.body.ok).toBe(false);
    expect(check.body.expectedDigit).toBe(6);
  });

  it('a number that already exists is neither rejected nor accepted: both entries go to the MD, who rules', async () => {
    const w = await world();
    const first = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({
        shippingLineId: w.pil.id,
        reference: 'DAR600233400',
        clientId: w.spaceMining.id,
        cargo: 'TANTALITE',
        containers: boxes(SPACE_MINING.slice(0, 3)),
      });
    expect(first.status).toBe(201);
    const check = await request(app)
      .get('/api/containers/check?number=FFAU8028326')
      .set('Cookie', w.divine);
    expect(check.body.existing.bookingReference).toBe('DAR600233400');

    const second = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({
        shippingLineId: w.pil.id,
        reference: 'DAR600241900',
        clientId: w.spaceMining.id,
        cargo: 'TANTALITE',
        containers: [
          { number: 'FFAU8028326', size: '40FT', lot: 'again' },
          { number: 'PCIU9320936', size: '40FT', lot: 'again' },
          { number: 'PIDU4544108', size: '40FT', lot: 'new' },
        ],
      });
    expect(second.status).toBe(201);
    expect(second.body.duplicates).toEqual([
      { number: 'FFAU8028326', existingBooking: 'DAR600233400' },
      { number: 'PCIU9320936', existingBooking: 'DAR600233400' },
    ]);
    const statuses = second.body.containers.map((c: { status: string }) => c.status);
    expect(statuses).toEqual(['DUPLICATE', 'DUPLICATE', 'ACTIVE']);
    // Still exactly one ACTIVE record per number in the account.
    expect(
      await prisma.container.count({ where: { number: 'FFAU8028326', status: 'ACTIVE' } }),
    ).toBe(1);

    // The Operations Manager cannot rule; the MD sees both sides of each case.
    expect((await request(app).get('/api/md-queue').set('Cookie', w.divine)).status).toBe(403);
    const queue = await request(app).get('/api/md-queue').set('Cookie', w.md);
    expect(queue.status).toBe(200);
    expect(queue.body).toHaveLength(2);
    const [caseA, caseB] = queue.body;
    expect(caseA.existingBox.booking.reference).toBe('DAR600233400');
    expect(caseA.newBox.booking.reference).toBe('DAR600241900');
    expect(caseA.newBox.createdBy).toBe('Divine M.');
    expect(
      (
        await request(app)
          .post(`/api/md-queue/${caseA.id}/resolve`)
          .set('Cookie', w.divine)
          .send({ resolution: 'WITHDRAW_NEW' })
      ).status,
    ).toBe(403);

    // Ruling 1: withdraw the new entry. Ruling 2: keep the new entry, the older one is withdrawn.
    expect(
      (
        await request(app)
          .post(`/api/md-queue/${caseA.id}/resolve`)
          .set('Cookie', w.md)
          .send({ resolution: 'WITHDRAW_NEW' })
      ).status,
    ).toBe(200);
    expect(
      (await prisma.container.findUniqueOrThrow({ where: { id: caseA.newBox.id } })).status,
    ).toBe('WITHDRAWN');
    expect(
      (await prisma.container.findUniqueOrThrow({ where: { id: caseA.existingBox.id } })).status,
    ).toBe('ACTIVE');
    expect(
      (
        await request(app)
          .post(`/api/md-queue/${caseB.id}/resolve`)
          .set('Cookie', w.md)
          .send({ resolution: 'KEEP_NEW' })
      ).status,
    ).toBe(200);
    expect(
      (await prisma.container.findUniqueOrThrow({ where: { id: caseB.newBox.id } })).status,
    ).toBe('ACTIVE');
    expect(
      (await prisma.container.findUniqueOrThrow({ where: { id: caseB.existingBox.id } })).status,
    ).toBe('WITHDRAWN');
    expect(
      (
        await request(app)
          .post(`/api/md-queue/${caseB.id}/resolve`)
          .set('Cookie', w.md)
          .send({ resolution: 'KEEP_NEW' })
      ).status,
    ).toBe(409);
    expect((await request(app).get('/api/md-queue').set('Cookie', w.md)).body).toHaveLength(0);

    // Ruling 3, on a fresh case: it was a typo — correct the number.
    const third = await request(app)
      .post(`/api/bookings/${second.body.booking.id}/containers`)
      .set('Cookie', w.divine)
      .send({ containers: [{ number: 'PCIU8878266', size: '40FT', lot: 'typo' }] });
    expect(third.body.duplicates).toHaveLength(1);
    const [caseC] = (await request(app).get('/api/md-queue').set('Cookie', w.md)).body;
    const bad = await request(app)
      .post(`/api/md-queue/${caseC.id}/resolve`)
      .set('Cookie', w.md)
      .send({ resolution: 'CORRECT_NUMBER', number: 'PIDU4544108' });
    expect(bad.status).toBe(400); // also taken
    const good = await request(app)
      .post(`/api/md-queue/${caseC.id}/resolve`)
      .set('Cookie', w.md)
      .send({ resolution: 'CORRECT_NUMBER', number: 'GLDU9067500' });
    expect(good.status).toBe(200);
    const fixed = await prisma.container.findUniqueOrThrow({ where: { id: caseC.newBox.id } });
    expect([fixed.number, fixed.status]).toEqual(['GLDU9067500', 'ACTIVE']);

    const trail = await request(app)
      .get('/api/audit?module=shipments&limit=200')
      .set('Cookie', w.md);
    const actions = trail.body.map((e: { action: string }) => e.action);
    for (const a of [
      'booking_created',
      'container_added',
      'container_duplicate_flagged',
      'duplicate_resolved',
    ])
      expect(actions).toContain(a);
  });

  it('the other side finds a box by number, read-only, with its booking and client', async () => {
    const w = await world();
    const sm = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({
        shippingLineId: w.pil.id,
        reference: 'DAR600233400',
        clientId: w.spaceMining.id,
        cargo: 'TANTALITE',
        vessel: 'KOTA SETIA',
        containers: boxes(SPACE_MINING.slice(0, 2)),
      });
    // JIVAH's own list is empty — nothing has reached their side yet.
    expect((await request(app).get('/api/containers').set('Cookie', w.samuel)).body).toEqual([]);
    expect((await request(app).get('/api/bookings').set('Cookie', w.samuel)).body).toEqual([]);
    // But a box is found by number, with everything needed to recognise it.
    const found = await request(app).get('/api/containers?q=pciu 932093').set('Cookie', w.samuel);
    expect(found.body).toHaveLength(1);
    expect(found.body[0].number).toBe('PCIU9320936');
    expect(found.body[0].booking).toMatchObject({
      reference: 'DAR600233400',
      client: 'Space Mining',
      vessel: 'KOTA SETIA',
      companyName: 'OLIU LOGISTICS LTD',
      line: 'PIL',
    });
    const detail = await request(app)
      .get(`/api/bookings/${sm.body.booking.id}`)
      .set('Cookie', w.samuel);
    expect(detail.status).toBe(200);
    expect(detail.body.mayEdit).toBe(false);
    // Read-only means read-only.
    expect(
      (
        await request(app)
          .patch(`/api/bookings/${sm.body.booking.id}`)
          .set('Cookie', w.samuel)
          .send({ vessel: 'X' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/bookings/${sm.body.booking.id}/containers`)
          .set('Cookie', w.samuel)
          .send({ containers: boxes(SPACE_MINING.slice(2, 3)) })
      ).status,
    ).toBe(403);
    // The owner of the booking may fill the later fields and add boxes.
    const mine = await request(app)
      .get(`/api/bookings/${sm.body.booking.id}`)
      .set('Cookie', w.divine);
    expect(mine.body.mayEdit).toBe(true);
    expect(
      (
        await request(app)
          .patch(`/api/bookings/${sm.body.booking.id}`)
          .set('Cookie', w.divine)
          .send({ voyage: '0126W', destination: 'Ningbo' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/bookings/${sm.body.booking.id}/containers`)
          .set('Cookie', w.divine)
          .send({ containers: boxes(SPACE_MINING.slice(2, 3)) })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .post(`/api/bookings/${sm.body.booking.id}/containers`)
          .set('Cookie', w.divine)
          .send({ containers: boxes(SPACE_MINING.slice(2, 3)) })
      ).status,
    ).toBe(400); // already on it
    // JIVAH makes its own booking on its own side.
    const theirs = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.samuel)
      .send({
        shippingLineId: w.pil.id,
        reference: 'DAR600214900',
        clientId: w.transvera.id,
        cargo: 'TANTALITE',
        containers: boxes(TRANSVERA.slice(0, 1)),
      });
    expect(theirs.status).toBe(201);
    expect(theirs.body.booking.companyId).toBe(w.jivah.id);
  });

  it("a line's booking-number shape is enforced; its usual owner codes only produce a note", async () => {
    const w = await world();
    const cma = (
      await request(app)
        .post('/api/shipping-lines')
        .set('Cookie', w.divine)
        .send({
          name: 'CMA CGM',
          usualPrefixes: ['CMAU', 'CGMU'],
          referenceHint: '4 letters + 7 digits',
          referencePattern: '^[A-Z]{4}\\d{7}$',
        })
    ).body;
    const body = {
      shippingLineId: cma.id,
      clientId: w.spaceMining.id,
      cargo: 'LITHIUM',
      containers: [{ number: 'FFAU8028326', size: '40FT', lot: '' }],
    };
    const wrong = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({ ...body, reference: 'ABC123' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.details[0]).toEqual({
      path: 'reference',
      message: 'CMA CGM booking numbers look like: 4 letters + 7 digits',
    });
    const right = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({ ...body, reference: 'cmdu4471023' });
    expect(right.status).toBe(201);
    expect(right.body.booking.reference).toBe('CMDU4471023');
    expect(right.body.notes[0]).toMatch(
      /FFAU8028326: owner code FFAU is not one CMA CGM usually uses/,
    );
    expect(
      (
        await request(app)
          .post('/api/shipping-lines')
          .set('Cookie', w.divine)
          .send({ name: 'cma cgm' })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post('/api/shipping-lines')
          .set('Cookie', w.divine)
          .send({ name: 'Bad', referencePattern: '[' })
      ).status,
    ).toBe(400);
  });

  it('the MD books for the company in the switcher; a Finance Officer cannot book; another account never sees it', async () => {
    const w = await world();
    const body = {
      shippingLineId: w.pil.id,
      reference: 'DAR600233400',
      clientId: w.spaceMining.id,
      cargo: 'TANTALITE',
      containers: boxes(SPACE_MINING.slice(0, 1)),
    };
    expect((await request(app).post('/api/bookings').set('Cookie', w.md).send(body)).status).toBe(
      400,
    ); // no company chosen
    const asJivah = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.md)
      .set('X-Company', w.jivah.id)
      .send(body);
    expect(asJivah.status).toBe(201);
    expect(asJivah.body.booking.companyId).toBe(w.jivah.id);
    expect((await request(app).get('/api/bookings').set('Cookie', w.md)).body).toHaveLength(1); // the MD with no switcher: every company
    expect(
      (await request(app).get('/api/bookings').set('Cookie', w.md).set('X-Company', w.oliu.id))
        .body,
    ).toHaveLength(0);
    expect(
      (await request(app).get('/api/bookings?month=2020-01').set('Cookie', w.md)).body,
    ).toHaveLength(0);

    await inviteAndActivate(app, w.md, {
      name: 'Aline U.',
      email: 'aline@oliu.test',
      role: 'FINANCE_OFFICER',
      companyId: w.oliu.id,
    });
    const aline = await login(app, 'aline@oliu.test');
    expect(
      (
        await request(app)
          .post('/api/bookings')
          .set('Cookie', aline)
          .send({ ...body, reference: 'DAR600241900' })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).post('/api/clients').set('Cookie', aline).send({ name: 'X' })).status,
    ).toBe(403);

    await request(app).post('/api/accounts').send(singleSetup());
    const stranger = await login(app, 'owner@transit.test');
    expect((await request(app).get('/api/containers?q=FFAU').set('Cookie', stranger)).body).toEqual(
      [],
    );
    expect(
      (await request(app).get(`/api/bookings/${asJivah.body.booking.id}`).set('Cookie', stranger))
        .status,
    ).toBe(404);
    expect((await request(app).get('/api/shipping-lines').set('Cookie', stranger)).body).toEqual(
      [],
    );
  });
});
