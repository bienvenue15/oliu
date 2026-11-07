/**
 * Slice 5 — tips in three taps, the roadmap's runs as code:
 *  - a tip is three things: boxes, reason, amount; it becomes cost lines in the tip category at the rate of its day
 *  - the same tip sent twice from the outbox is saved once
 *  - two boxes, one amount: two lines, split, each on its own box
 *  - 80 % of the monthly cap: the MD hears of it; past 100 % the save needs the MD's code, which works once
 *  - complete later: payee, checkpoint, the receipt photo; a wrong tip voided with a reason
 *  - who may: Field Officers pay and complete their own; Finance never; the other side's box is refused
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { devOutbox } from '../src/lib/mail.ts';
import { groupSetup, inviteAndActivate, login, resetDb } from './helpers.ts';

const app = createApp();

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(resetDb);

const BOXES = ['FFAU8028326', 'PCIU9320936', 'PIDU4544108'] as const;
const today = () => new Date().toISOString().slice(0, 10);

async function world() {
  const r = await request(app).post('/api/accounts').send(groupSetup());
  const md = await login(app, 'md@oliu.test');
  const [oliu, jivah] = await prisma.company.findMany({
    where: { accountId: r.body.accountId },
    orderBy: { createdAt: 'asc' },
  });
  for (const [name, email, role, companyId] of [
    ['Divine M.', 'divine@oliu.test', 'OPS_MANAGER', oliu!.id],
    ['Peace K.', 'peace@oliu.test', 'FIELD_OFFICER', oliu!.id],
    ['Grace K.', 'grace@oliu.test', 'FIELD_OFFICER', oliu!.id],
    ['Aline U.', 'aline@oliu.test', 'FINANCE_OFFICER', oliu!.id],
    ['Amina H.', 'amina@jivah.test', 'FIELD_OFFICER', jivah!.id],
  ] as const)
    await inviteAndActivate(app, md, { name, email, role, companyId });
  const divine = await login(app, 'divine@oliu.test');
  const peace = await login(app, 'peace@oliu.test');
  const grace = await login(app, 'grace@oliu.test');
  const aline = await login(app, 'aline@oliu.test');
  const amina = await login(app, 'amina@jivah.test');
  const pil = (
    await request(app).post('/api/shipping-lines').set('Cookie', divine).send({ name: 'PIL' })
  ).body;
  const client = (
    await request(app).post('/api/clients').set('Cookie', divine).send({ name: 'Space Mining' })
  ).body;
  const booking = (
    await request(app)
      .post('/api/bookings')
      .set('Cookie', divine)
      .send({
        shippingLineId: pil.id,
        reference: 'DAR600233400',
        clientId: client.id,
        cargo: 'TANTALITE',
        containers: BOXES.map((number) => ({ number, size: '40FT', lot: '' })),
      })
  ).body;
  const boxes = booking.containers as { id: string; number: string }[];
  const tipCat = await request(app)
    .post('/api/cost-categories')
    .set('Cookie', md)
    .send({ name: 'Tip / facilitation', isTip: true });
  expect(tipCat.status).toBe(201);
  await request(app)
    .post('/api/rates')
    .set('Cookie', md)
    .send({ currency: 'RWF', date: '2026-01-01', perUsd: '1452' });
  await request(app)
    .post('/api/rates')
    .set('Cookie', md)
    .send({ currency: 'TZS', date: '2026-01-01', perUsd: '2608' });
  const reasons: Record<string, string> = {};
  for (const [i, label] of ['Checkpoint passage', 'Weighing / iminzani', 'Expediting'].entries()) {
    const x = await request(app)
      .post('/api/tip-reasons')
      .set('Cookie', md)
      .send({ label, sortOrder: i });
    expect(x.status).toBe(201);
    reasons[label] = x.body.id;
  }
  return {
    md,
    divine,
    peace,
    grace,
    aline,
    amina,
    oliu: oliu!,
    jivah: jivah!,
    booking: booking.booking,
    boxes,
    reasons,
  };
}

const tip = (cookie: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/tips')
    .set('Cookie', cookie)
    .send({ clientId: randomUUID(), currency: 'RWF', ...body });

describe("the roadmap's runs", () => {
  it('logs a tip in three taps; it becomes a cost line on the box at the rate of its day', async () => {
    const w = await world();
    const setup = await request(app).get('/api/tips/setup').set('Cookie', w.peace);
    expect(setup.status).toBe(200);
    expect(setup.body.bookings[0].reference).toBe('DAR600233400');
    expect(setup.body.bookings[0].containers).toHaveLength(3);
    expect(setup.body.reasons.map((r: { label: string }) => r.label)).toEqual([
      'Checkpoint passage',
      'Weighing / iminzani',
      'Expediting',
    ]);
    expect(setup.body.currency).toBe('RWF');
    expect(setup.body.cap).toMatchObject({ usedUsdCents: 0, capUsd: '1,000.00' });

    const r = await tip(w.peace, {
      containerIds: [w.boxes[0]!.id],
      reasonId: w.reasons['Checkpoint passage'],
      totalMinor: 20_000,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      reason: 'Checkpoint passage',
      amount: '20,000',
      currency: 'RWF',
      usd: '13.77',
      paidBy: 'Peace K.',
      companyName: 'OLIU LOGISTICS LTD',
      date: today(),
      stage: 'BOOKED',
      void: false,
    });
    expect(r.body.missing).toEqual(['payee', 'photo', 'checkpoint']);
    expect(r.body.boxes).toEqual([
      expect.objectContaining({ number: 'FFAU8028326', amount: '20,000', status: 'ACTIVE' }),
    ]);
    // It is a cost line of the box, in the tip category, in OLIU's book.
    const rec = await request(app)
      .get(`/api/containers/${w.boxes[0]!.id}/costs`)
      .set('Cookie', w.md);
    expect(rec.body.lines).toHaveLength(1);
    expect(rec.body.lines[0]).toMatchObject({
      category: 'Tip / facilitation',
      usd: '13.77',
      tipId: r.body.id,
      companyName: 'OLIU LOGISTICS LTD',
    });
    expect(rec.body.totals.usd).toBe('13.77');
  });

  it('saves the same tip from the outbox once, however many times it arrives', async () => {
    const w = await world();
    const clientId = randomUUID();
    const body = {
      clientId,
      containerIds: [w.boxes[0]!.id],
      reasonId: w.reasons['Expediting'],
      currency: 'TZS',
      totalMinor: 30_000,
      date: '2026-10-20',
    };
    const first = await request(app).post('/api/tips').set('Cookie', w.peace).send(body);
    expect(first.status).toBe(201);
    const again = await request(app).post('/api/tips').set('Cookie', w.peace).send(body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.body.id, repeated: true, date: '2026-10-20' });
    const ledger = await request(app).get('/api/tips?month=2026-10').set('Cookie', w.divine);
    expect(ledger.body.tips).toHaveLength(1);
    expect(ledger.body.totals).toMatchObject({ count: 1, usd: '11.50' });
  });

  it('splits one amount across two tapped boxes: two lines, each on its own box', async () => {
    const w = await world();
    const r = await tip(w.peace, {
      containerIds: [w.boxes[0]!.id, w.boxes[1]!.id],
      reasonId: w.reasons['Weighing / iminzani'],
      totalMinor: 15_001,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(
      r.body.boxes.map((b: { number: string; amount: string }) => [b.number, b.amount]),
    ).toEqual([
      ['FFAU8028326', '7,500'],
      ['PCIU9320936', '7,501'],
    ]);
    const b = await request(app).get(`/api/bookings/${w.booking.id}/costs`).set('Cookie', w.divine);
    expect(
      b.body.containers.map((c: { number: string; usd: string }) => [c.number, c.usd]),
    ).toEqual([
      ['FFAU8028326', '5.17'],
      ['PCIU9320936', '5.17'],
      ['PIDU4544108', '0.00'],
    ]);
    const ledger = await request(app).get('/api/tips').set('Cookie', w.divine);
    expect(ledger.body.byBox).toHaveLength(2);
    expect(ledger.body.byPerson[0]).toMatchObject({ name: 'Peace K.', count: 1, payeePct: 0 });
  });

  it("warns the MD at 80 % of the cap; past 100 % the save needs the MD's code, once", async () => {
    const w = await world();
    // A cap of USD 100 and a ceiling of USD 60, so the numbers stay small.
    expect(
      (
        await request(app)
          .patch('/api/settings')
          .set('Cookie', w.md)
          .send({ tipCapUsdCents: 10_000, tipCeilingUsdCents: 6_000 })
      ).status,
    ).toBe(200);
    const box = w.boxes[0]!.id;
    // USD 50 (RWF 72,600): fine, 50 % used.
    let r = await tip(w.peace, {
      containerIds: [box],
      reasonId: w.reasons['Expediting'],
      totalMinor: 72_600,
    });
    expect(r.status).toBe(201);
    expect(r.body.cap).toMatchObject({ usedUsd: '50.00', pct: 50 });
    expect(
      (await request(app).get('/api/md-queue').set('Cookie', w.md)).body.filter(
        (i: { kind: string }) => i.kind === 'TIP_CAP_80',
      ),
    ).toHaveLength(0);
    // USD 35 more: 85 %, the MD hears of it once.
    r = await tip(w.peace, {
      containerIds: [box],
      reasonId: w.reasons['Expediting'],
      totalMinor: 50_820,
    });
    expect(r.status).toBe(201);
    expect(r.body.cap.pct).toBe(85);
    const q = (await request(app).get('/api/md-queue').set('Cookie', w.md)).body.filter(
      (i: { kind: string }) => i.kind === 'TIP_CAP_80',
    );
    expect(q).toHaveLength(1);
    expect(q[0].summary).toMatchObject({
      companyName: 'OLIU LOGISTICS LTD',
      usedUsd: '85.00',
      capUsd: '100.00',
      pct: 85,
    });
    // USD 20 more would pass the cap: refused until the MD's code comes.
    const body = {
      clientId: randomUUID(),
      containerIds: [box],
      reasonId: w.reasons['Expediting'],
      currency: 'RWF',
      totalMinor: 29_040,
    };
    r = await request(app).post('/api/tips').set('Cookie', w.peace).send(body);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ needsMdCode: true, overCap: true, overCeiling: false });
    expect(
      (
        await request(app)
          .post('/api/tips')
          .set('Cookie', w.peace)
          .send({ ...body, mdCode: '000000' })
      ).status,
    ).toBe(403);
    // Peace asks; the code lands in the MD's mailbox; a login code would not do.
    const ask = await request(app)
      .post('/api/tips/md-code')
      .set('Cookie', w.peace)
      .send({ amount: 'RWF 29,040', reason: 'Expediting' });
    expect(ask.status).toBe(200);
    expect(ask.body.sentTo).toBe('Developer');
    const mail = devOutbox().find((m) => m.subject.includes('asks your code'));
    const code = mail?.text.match(/: (\d{6})/)?.[1];
    expect(code).toBeTruthy();
    expect(mail?.to).toBe('md@oliu.test');
    r = await request(app)
      .post('/api/tips')
      .set('Cookie', w.peace)
      .send({ ...body, mdCode: code });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ mdOverride: true, cap: { pct: 105 } });
    // The code worked once.
    expect(
      (
        await request(app)
          .post('/api/tips')
          .set('Cookie', w.peace)
          .send({ ...body, clientId: randomUUID(), mdCode: code })
      ).status,
    ).toBe(403);
    // The ceiling: one tip of USD 70 needs the code even with room under the cap.
    await request(app)
      .patch('/api/settings')
      .set('Cookie', w.md)
      .send({ tipCapUsdCents: 1_000_000 });
    r = await tip(w.peace, {
      containerIds: [box],
      reasonId: w.reasons['Expediting'],
      totalMinor: 101_640,
    });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ overCeiling: true, overCap: false });
    // The trail has the override.
    const trail = await request(app).get('/api/audit?limit=100').set('Cookie', w.md);
    expect(trail.body.some((e: { action: string }) => e.action === 'tip_override')).toBe(true);
    expect(trail.body.some((e: { action: string }) => e.action === 'tip_cap_warning')).toBe(true);
  });

  it("completes yesterday's tip later: payee, checkpoint, the receipt photo; a wrong tip is voided, not deleted", async () => {
    const w = await world();
    const r = await tip(w.peace, {
      containerIds: [w.boxes[0]!.id],
      reasonId: w.reasons['Checkpoint passage'],
      totalMinor: 8_000,
      currency: 'TZS',
      date: '2026-10-26',
    });
    const id = r.body.id as string;
    const inc = await request(app)
      .get('/api/tips?incomplete=1&month=2026-10')
      .set('Cookie', w.peace);
    expect(inc.body.tips.map((t: { id: string }) => t.id)).toEqual([id]);
    let p = await request(app)
      .patch(`/api/tips/${id}`)
      .set('Cookie', w.peace)
      .send({ payeeType: 'OFFICIAL', payeeId: '0788441210', checkpoint: 'TRA — Nyakanazi' });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({
      payeeTypeLabel: 'Official at a stop',
      payeeId: '0788441210',
      checkpoint: 'TRA — Nyakanazi',
      missing: ['photo'],
    });
    // The cost line's "paid to" follows.
    const rec = await request(app)
      .get(`/api/containers/${w.boxes[0]!.id}/costs`)
      .set('Cookie', w.md);
    expect(rec.body.lines[0].paidTo).toBe('0788441210');
    // A real JPEG header, a fake one, and one over the limit.
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(100, 1),
    ]).toString('base64');
    const photo = await request(app)
      .post(`/api/tips/${id}/photo`)
      .set('Cookie', w.peace)
      .send({ dataUrl: `data:image/jpeg;base64,${jpeg}` });
    expect(photo.status, JSON.stringify(photo.body)).toBe(201);
    const fake = Buffer.alloc(100, 7).toString('base64');
    expect(
      (
        await request(app)
          .post(`/api/tips/${id}/photo`)
          .set('Cookie', w.peace)
          .send({ dataUrl: `data:image/png;base64,${fake}` })
      ).status,
    ).toBe(400);
    const got = await request(app).get(`/api/tips/${id}/photo`).set('Cookie', w.divine);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toContain('image/jpeg');
    expect((await request(app).get(`/api/tips/${id}/photo`).set('Cookie', w.amina)).status).toBe(
      403,
    );
    p = await request(app).get('/api/tips?month=2026-10').set('Cookie', w.peace);
    expect(p.body.tips[0].missing).toEqual([]);
    expect(p.body.byPerson[0].payeePct).toBe(100);
    // Grace cannot touch Peace's tip; Divine (her manager) can; Aline (Finance) has no tip screens.
    expect(
      (await request(app).patch(`/api/tips/${id}`).set('Cookie', w.grace).send({ note: 'x' }))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/api/tips/${id}`)
          .set('Cookie', w.divine)
          .send({ note: 'checked' })
      ).status,
    ).toBe(200);
    expect((await request(app).get('/api/tips').set('Cookie', w.aline)).status).toBe(403);
    // Voided: the lines go void with the reason, the ledger and the box total drop, the row stays.
    const v = await request(app)
      .post(`/api/tips/${id}/void`)
      .set('Cookie', w.peace)
      .send({ reason: 'typed twice by hand' });
    expect(v.status).toBe(200);
    expect(v.body.void).toBe(true);
    expect(
      (await request(app).get(`/api/containers/${w.boxes[0]!.id}/costs`).set('Cookie', w.md)).body
        .totals.usd,
    ).toBe('0.00');
    const after = await request(app).get('/api/tips?month=2026-10').set('Cookie', w.divine);
    expect(after.body.tips).toHaveLength(1);
    expect(after.body.totals.count).toBe(0);
    expect(
      (
        await request(app)
          .post(`/api/tips/${id}/void`)
          .set('Cookie', w.peace)
          .send({ reason: 'again' })
      ).status,
    ).toBe(409);
  });
});

describe('the rules', () => {
  it('lets only the field roles pay, each on their own side, and the MD keep the reasons', async () => {
    const w = await world();
    const box = w.boxes[0]!.id;
    expect(
      (
        await tip(w.aline, {
          containerIds: [box],
          reasonId: w.reasons['Expediting'],
          totalMinor: 1000,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await tip(w.divine, {
          containerIds: [box],
          reasonId: w.reasons['Expediting'],
          totalMinor: 1000,
        })
      ).status,
    ).toBe(403); // the manager completes, the field pays
    const early = await tip(w.amina, {
      containerIds: [box],
      reasonId: w.reasons['Expediting'],
      totalMinor: 1000,
      currency: 'TZS',
    });
    expect(early.status).toBe(201); // paid on the spot, but the box is on OLIU's side: it waits for the MD
    expect(early.body.pendingMd).toBe(true);
    expect(
      (await tip(w.peace, { containerIds: [box], reasonId: randomUUID(), totalMinor: 1000 }))
        .status,
    ).toBe(400); // tap a reason
    expect(
      (
        await request(app)
          .post('/api/tip-reasons')
          .set('Cookie', w.divine)
          .send({ label: 'Parking' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/tip-reasons')
          .set('Cookie', w.md)
          .send({ label: 'checkpoint passage' })
      ).status,
    ).toBe(409);
    const off = await request(app)
      .patch(`/api/tip-reasons/${w.reasons['Expediting']}`)
      .set('Cookie', w.md)
      .send({ active: false });
    expect(off.status).toBe(200);
    expect(
      (
        await tip(w.peace, {
          containerIds: [box],
          reasonId: w.reasons['Expediting'],
          totalMinor: 1000,
        })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).get('/api/tips/setup').set('Cookie', w.peace)).body.reasons,
    ).toHaveLength(2);
    // After the box crosses to JIVAH, Amina pays outright; Peace's tip now waits for the MD.
    await request(app)
      .post(`/api/containers/${box}/journey`)
      .set('Cookie', w.md)
      .send({ kind: 'REACHED', stage: 'RUSUMO' });
    expect(
      (
        await tip(w.amina, {
          containerIds: [box],
          reasonId: w.reasons['Checkpoint passage'],
          totalMinor: 5000,
          currency: 'TZS',
        })
      ).status,
    ).toBe(201);
    const late = await tip(w.peace, {
      containerIds: [box],
      reasonId: w.reasons['Checkpoint passage'],
      totalMinor: 5000,
    });
    expect(late.status).toBe(201);
    expect(late.body.pendingMd).toBe(true);
    // Each in its own book (Amina's two in JIVAH's, Peace's in OLIU's); the MD sees all three.
    expect((await request(app).get('/api/tips').set('Cookie', w.divine)).body.tips).toHaveLength(1);
    expect((await request(app).get('/api/tips').set('Cookie', w.md)).body.tips).toHaveLength(3);
    const waiting = (await request(app).get('/api/md-queue').set('Cookie', w.md)).body.filter(
      (i: { kind: string }) => i.kind === 'COST_OTHER_SIDE',
    );
    expect(waiting).toHaveLength(2);
    expect(waiting[0].summary.tip).toBe(true);
    // Without a tip category nothing can be paid.
    const cats = (await request(app).get('/api/cost-categories').set('Cookie', w.md)).body;
    await request(app)
      .patch(`/api/cost-categories/${cats.find((c: { isTip: boolean }) => c.isTip).id}`)
      .set('Cookie', w.md)
      .send({ isTip: false });
    expect(
      (
        await tip(w.peace, {
          containerIds: [box],
          reasonId: w.reasons['Checkpoint passage'],
          totalMinor: 5000,
        })
      ).status,
    ).toBe(409);
  });
});
