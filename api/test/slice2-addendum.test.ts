/**
 * Slice 2 addendum (24 Oct 2026) — a booking has a life of its own:
 *  - it can exist before its container numbers ("6 x 40FT expected"), and the numbers follow
 *  - it gets a file number per company and year, assigned by the system, never changed
 *  - the fill-later fields the invoice will print: ETD, ETA, ports, BL number
 *  - pending → confirmed, and cancelled with a reason: boxes withdrawn, numbers free again, nothing deleted
 *  - comments: who, when, what; readable by the other side, written by the booking's company, never edited
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { groupSetup, inviteAndActivate, login, resetDb } from './helpers.ts';

const app = createApp();
const YEAR = new Date().getUTCFullYear();

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(resetDb);

async function world() {
  const r = await request(app).post('/api/accounts').send(groupSetup());
  const md = await login(app, 'md@oliu.test');
  const [oliu, jivah] = await prisma.company.findMany({
    where: { accountId: r.body.accountId },
    orderBy: { createdAt: 'asc' },
  });
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
  const client = (
    await request(app).post('/api/clients').set('Cookie', divine).send({ name: 'Space Mining' })
  ).body;
  const base = { shippingLineId: pil.id, clientId: client.id, cargo: 'TANTALITE' };
  return { md, divine, samuel, oliu: oliu!, jivah: jivah!, base };
}

const box = (number: string, lot = '') => ({ number, size: '40FT', lot });

describe('a booking before its numbers', () => {
  it('saves with the boxes agreed, and the numbers follow one by one', async () => {
    const w = await world();
    const r = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({ ...w.base, reference: 'DAR600233400', expectedCount: 6 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.booking.fileNumber).toBe(`OLIU-${YEAR}-0001`);
    expect(r.body.booking.status).toBe('CONFIRMED');
    expect(r.body.booking.confirmedAt).not.toBeNull();
    expect(r.body.containers).toEqual([]);

    const list = await request(app).get('/api/bookings').set('Cookie', w.divine);
    expect(list.body[0]).toMatchObject({
      containerCount: 0,
      expectedCount: 6,
      expectedSize: '40FT',
    });

    const added = await request(app)
      .post(`/api/bookings/${r.body.booking.id}/containers`)
      .set('Cookie', w.divine)
      .send({ containers: [box('FFAU8028326', 'SM/AB/2026-09B-006'), box('PCIU9320936')] });
    expect(added.status).toBe(201);
    expect(added.body.containers.map((c: { status: string }) => c.status)).toEqual([
      'ACTIVE',
      'ACTIVE',
    ]);
    const again = await request(app).get('/api/bookings').set('Cookie', w.divine);
    expect(again.body[0]).toMatchObject({ containerCount: 2, expectedCount: 6 });
  });

  it('refuses a booking with neither numbers nor an agreed count', async () => {
    const w = await world();
    const r = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({ ...w.base, reference: 'DAR600233400' });
    expect(r.status).toBe(400);
    expect(r.body.details[0].path).toBe('expectedCount');
    expect(await prisma.booking.count()).toBe(0);
  });
});

describe('the file number', () => {
  it('runs per company and year, is assigned by the system and never changes', async () => {
    const w = await world();
    const make = (cookie: string, reference: string, companyHeader?: string) => {
      const req = request(app).post('/api/bookings').set('Cookie', cookie);
      if (companyHeader) req.set('X-Company', companyHeader);
      return req.send({ ...w.base, reference, expectedCount: 1 });
    };
    const a = await make(w.divine, 'DAR600233400');
    const b = await make(w.divine, 'DAR600210600');
    const c = await make(w.md, 'DAR600214900', w.oliu.id);
    expect([a, b, c].map((r) => r.body.booking.fileNumber)).toEqual([
      `OLIU-${YEAR}-0001`,
      `OLIU-${YEAR}-0002`,
      `OLIU-${YEAR}-0003`,
    ]);
    // JIVAH does not bill the client, so it makes no bookings: no JIVAH file number exists.
    expect((await make(w.samuel, 'DAR600241900')).status).toBe(403);
    expect((await make(w.md, 'DAR600241900', w.jivah.id)).status).toBe(403);
    // A patch cannot touch it: the field is simply not accepted.
    const patched = await request(app)
      .patch(`/api/bookings/${a.body.booking.id}`)
      .set('Cookie', w.divine)
      .send({ fileNumber: 'OLIU-9999-9999', vessel: 'KOTA SETIA' });
    expect(patched.status).toBe(200);
    expect(patched.body.fileNumber).toBe(`OLIU-${YEAR}-0001`);
    expect(patched.body.vessel).toBe('KOTA SETIA');
  });
});

describe('what the line tells you later', () => {
  it('ETD, ETA, ports and BL number are filled in later and come back on the booking', async () => {
    const w = await world();
    const r = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({ ...w.base, reference: 'DAR600233400', containers: [box('FFAU8028326')] });
    const id = r.body.booking.id;
    const p = await request(app).patch(`/api/bookings/${id}`).set('Cookie', w.divine).send({
      pol: 'Dar es Salaam',
      pod: 'Ningbo',
      etd: '2026-10-17',
      eta: '2026-11-20',
      blNumber: 'dar600233400',
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const d = await request(app).get(`/api/bookings/${id}`).set('Cookie', w.md);
    expect(d.body).toMatchObject({ pol: 'Dar es Salaam', pod: 'Ningbo', blNumber: 'DAR600233400' });
    expect(d.body.etd).toMatch(/^2026-10-17/);
    expect(d.body.eta).toMatch(/^2026-11-20/);
    // An emptied date field means "not known after all".
    const cleared = await request(app)
      .patch(`/api/bookings/${id}`)
      .set('Cookie', w.divine)
      .send({ eta: '' });
    expect(cleared.body.eta).toBeNull();
    const bad = await request(app)
      .patch(`/api/bookings/${id}`)
      .set('Cookie', w.divine)
      .send({ etd: '17/10/2026' });
    expect(bad.status).toBe(400);
    expect(bad.body.details[0].path).toBe('etd');
  });
});

describe('the life of a booking', () => {
  it('pending, then confirmed by the line, once', async () => {
    const w = await world();
    const r = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({ ...w.base, reference: 'DAR600233400', status: 'PENDING', expectedCount: 3 });
    expect(r.body.booking).toMatchObject({ status: 'PENDING', confirmedAt: null });
    const id = r.body.booking.id;
    expect(
      (await request(app).post(`/api/bookings/${id}/confirm`).set('Cookie', w.samuel).send({}))
        .status,
    ).toBe(403);
    const ok = await request(app)
      .post(`/api/bookings/${id}/confirm`)
      .set('Cookie', w.divine)
      .send({ confirmedOn: '2026-10-20' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('CONFIRMED');
    expect(ok.body.confirmedAt).toMatch(/^2026-10-20/);
    expect(
      (await request(app).post(`/api/bookings/${id}/confirm`).set('Cookie', w.divine).send({}))
        .status,
    ).toBe(409);
  });

  it('cancelled with a reason: boxes withdrawn, numbers free again, duplicate case closed, nothing deleted', async () => {
    const w = await world();
    const first = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({ ...w.base, reference: 'DAR600233400', containers: [box('FFAU8028326')] });
    const second = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({ ...w.base, reference: 'DAR600210600', containers: [box('FFAU8028326')] });
    expect(second.body.duplicates).toHaveLength(1);
    expect((await request(app).get('/api/md-queue').set('Cookie', w.md)).body).toHaveLength(1);

    const id = second.body.booking.id;
    expect(
      (await request(app).post(`/api/bookings/${id}/cancel`).set('Cookie', w.divine).send({}))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`/api/bookings/${id}/cancel`)
          .set('Cookie', w.samuel)
          .send({ reason: 'not mine' })
      ).status,
    ).toBe(403);
    const cancelled = await request(app)
      .post(`/api/bookings/${id}/cancel`)
      .set('Cookie', w.divine)
      .send({ reason: 'typed twice, the first one is right' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'typed twice, the first one is right',
    });
    expect(cancelled.body.cancelledAt).not.toBeNull();

    const boxes = await prisma.container.findMany({ where: { bookingId: id } });
    expect(boxes.map((b) => b.status)).toEqual(['WITHDRAWN']);
    expect((await request(app).get('/api/md-queue').set('Cookie', w.md)).body).toHaveLength(0);
    expect(await prisma.booking.count()).toBe(2); // nothing deleted
    // The first booking's box is untouched; closed to changes afterwards.
    const firstBox = await prisma.container.findFirst({
      where: { bookingId: first.body.booking.id },
    });
    expect(firstBox!.status).toBe('ACTIVE');
    expect(
      (
        await request(app)
          .post(`/api/bookings/${id}/containers`)
          .set('Cookie', w.divine)
          .send({ containers: [box('PCIU9320936')] })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/api/bookings/${id}`)
          .set('Cookie', w.divine)
          .send({ vessel: 'X' })
      ).status,
    ).toBe(409);

    // A cancelled booking's number is free: a third booking takes the same box with no duplicate.
    const cancelledFirst = await request(app)
      .post(`/api/bookings/${first.body.booking.id}/cancel`)
      .set('Cookie', w.divine)
      .send({ reason: 'client withdrew the lot' });
    expect(cancelledFirst.status).toBe(200);
    const third = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({ ...w.base, reference: 'DAR600241900', containers: [box('FFAU8028326')] });
    expect(third.status).toBe(201);
    expect(third.body.duplicates).toEqual([]);
    expect(third.body.containers[0].status).toBe('ACTIVE');

    const trail = await request(app)
      .get('/api/audit?module=shipments&limit=200')
      .set('Cookie', w.md);
    expect(trail.body.map((e: { action: string }) => e.action)).toContain('booking_cancelled');
  });
});

describe('comments', () => {
  it('are written by the booking company, read by the other side, and never edited or deleted', async () => {
    const w = await world();
    const r = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({ ...w.base, reference: 'DAR600233400', expectedCount: 2 });
    const id = r.body.booking.id;
    const c = await request(app)
      .post(`/api/bookings/${id}/comments`)
      .set('Cookie', w.divine)
      .send({ text: 'Line says vessel delayed to 20 Oct' });
    expect(c.status).toBe(201);
    expect(c.body.userName).toBe('Divine M.');
    expect(
      (
        await request(app)
          .post(`/api/bookings/${id}/comments`)
          .set('Cookie', w.samuel)
          .send({ text: 'noted' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/bookings/${id}/comments`)
          .set('Cookie', w.divine)
          .send({ text: '  ' })
      ).status,
    ).toBe(400);
    // The other side reads nothing of the booking until a box of it is on its side; the MD reads all.
    expect(
      (await request(app).get(`/api/bookings/${id}/comments`).set('Cookie', w.samuel)).status,
    ).toBe(403);
    const seen = await request(app).get(`/api/bookings/${id}/comments`).set('Cookie', w.md);
    expect(seen.status).toBe(200);
    expect(seen.body).toHaveLength(1);
    expect(seen.body[0]).toMatchObject({
      userName: 'Divine M.',
      text: 'Line says vessel delayed to 20 Oct',
    });
    const detail = await request(app).get(`/api/bookings/${id}`).set('Cookie', w.md);
    expect(detail.body.comments).toHaveLength(1);
    expect(detail.body.createdBy).toBe('Divine M.');

    // The database itself refuses to change or remove a comment.
    await expect(
      prisma.bookingComment.update({ where: { id: c.body.id }, data: { text: 'edited' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.bookingComment.delete({ where: { id: c.body.id } })).rejects.toThrow(
      /append-only/,
    );

    // A cancelled booking still takes a comment (the reason it was cancelled often needs one).
    await request(app)
      .post(`/api/bookings/${id}/cancel`)
      .set('Cookie', w.divine)
      .send({ reason: 'client withdrew' });
    expect(
      (
        await request(app)
          .post(`/api/bookings/${id}/comments`)
          .set('Cookie', w.divine)
          .send({ text: 'client will rebook in November' })
      ).status,
    ).toBe(201);
    const trail = await request(app)
      .get('/api/audit?module=shipments&limit=200')
      .set('Cookie', w.md);
    expect(trail.body.map((e: { action: string }) => e.action)).toContain('booking_commented');
  });
});
