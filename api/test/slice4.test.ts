/**
 * Slice 4 — journey stages and the hand-over, the roadmap's runs as code:
 *  - move one box stage by stage from the Kigali login until Rusumo; positions in between; nothing goes back by itself
 *  - confirm Rusumo: the box leaves Kigali's working list and appears on Dar's; its flag reads JIVAH; a single company never flips
 *  - release a booking: boxes at the port are pre-ticked, the straggler at Magerwa is not and is refused; the waiting box moves
 *    to a sister booking with its cost lines
 *  - leave a box at the ICD past the free days: the at-risk flag appears and a cost dated inside the spell is delay-related
 *  - the rules: who may move a box, held and returned, corrections with a reason, the tracking cadence, closing to Finance and
 *    the P&L month, a cost after closing goes to the MD, another account sees nothing
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { groupSetup, inviteAndActivate, login, resetDb, singleSetup } from './helpers.ts';

const app = createApp();

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(resetDb);

const BOXES = ['FFAU8028326', 'PCIU9320936', 'PIDU4544108'] as const;
const today = () => new Date().toISOString().slice(0, 10);
/** A moment some hours or days ago, as the screen types it: YYYY-MM-DDTHH:MM. */
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString().slice(0, 16);
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

async function world() {
  const r = await request(app).post('/api/accounts').send(groupSetup());
  const md = await login(app, 'md@oliu.test');
  const [oliu, jivah] = await prisma.company.findMany({
    where: { accountId: r.body.accountId },
    orderBy: { createdAt: 'asc' },
  });
  for (const [name, email, role, companyId] of [
    ['Divine M.', 'divine@oliu.test', 'OPS_MANAGER', oliu!.id],
    ['Jean H.', 'jean@oliu.test', 'TRANSPORT_COORDINATOR', oliu!.id],
    ['Peace K.', 'peace@oliu.test', 'FIELD_OFFICER', oliu!.id],
    ['Aline U.', 'aline@oliu.test', 'FINANCE_OFFICER', oliu!.id],
    ['Claire I.', 'claire@oliu.test', 'REPORTING_OFFICER', null],
    ['Samuel N.', 'samuel@jivah.test', 'OPS_MANAGER', jivah!.id],
  ] as const)
    await inviteAndActivate(app, md, { name, email, role, companyId });
  // One login at a time: each reads its own code from the outbox.
  const divine = await login(app, 'divine@oliu.test');
  const jean = await login(app, 'jean@oliu.test');
  const peace = await login(app, 'peace@oliu.test');
  const aline = await login(app, 'aline@oliu.test');
  const claire = await login(app, 'claire@oliu.test');
  const samuel = await login(app, 'samuel@jivah.test');
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
  const cat: Record<string, string> = {};
  for (const name of ['Clearance — Dar', 'ICD / port charges', 'Inland transport']) {
    const c = await request(app).post('/api/cost-categories').set('Cookie', md).send({ name });
    cat[name] = c.body.id;
  }
  await request(app)
    .post('/api/rates')
    .set('Cookie', md)
    .send({ currency: 'TZS', date: daysAgo(30), perUsd: '2608' });
  await request(app)
    .post('/api/rates')
    .set('Cookie', md)
    .send({ currency: 'RWF', date: daysAgo(30), perUsd: '1452' });
  return {
    md,
    divine,
    jean,
    peace,
    aline,
    claire,
    samuel,
    oliu: oliu!,
    jivah: jivah!,
    booking,
    boxes,
    cat,
  };
}

const move = (cookie: string, id: string, body: Record<string, unknown>) =>
  request(app).post(`/api/containers/${id}/journey`).set('Cookie', cookie).send(body);
const reach = (cookie: string, id: string, stage: string, extra: Record<string, unknown> = {}) =>
  move(cookie, id, { kind: 'REACHED', stage, ...extra });
const board = (cookie: string) => request(app).get('/api/board').set('Cookie', cookie);
const list = (cookie: string, qs = '') =>
  request(app).get(`/api/containers${qs}`).set('Cookie', cookie);
const cost = (cookie: string, body: Record<string, unknown>) =>
  request(app).post('/api/costs').set('Cookie', cookie).send(body);

describe("the roadmap's runs", () => {
  it('moves one box stage by stage from the Kigali login until Rusumo, with positions in between', async () => {
    const w = await world();
    const box = w.boxes[0]!;
    let r = await reach(w.jean, box.id, 'TRANSPORT', {
      place: 'Loaded at Rwamagana',
      happenedAt: hoursAgo(5),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      stage: 'TRANSPORT',
      stageLabel: 'Loaded, on the road',
      place: 'Loaded at Rwamagana',
      column: 'kigali',
    });

    r = await move(w.jean, box.id, { kind: 'UPDATE', place: 'Kayonza', happenedAt: hoursAgo(3) });
    expect(r.status).toBe(201);
    expect(r.body.place).toBe('Kayonza');
    expect(r.body.stage).toBe('TRANSPORT');

    r = await reach(w.jean, box.id, 'FIELD_RELEASE', {
      place: 'Magerwa — Gikondo',
      happenedAt: hoursAgo(1),
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      stage: 'FIELD_RELEASE',
      stageLabel: 'Released at warehouse',
      responsibleCompanyName: 'OLIU LOGISTICS LTD',
    });

    // Nothing goes back by itself, nothing is reached twice, nothing happens in the future.
    expect((await reach(w.jean, box.id, 'TRANSPORT')).status).toBe(400);
    expect((await reach(w.jean, box.id, 'FIELD_RELEASE')).status).toBe(400);
    expect((await reach(w.jean, box.id, 'RUSUMO', { happenedAt: '2030-01-01' })).status).toBe(400);
    expect((await move(w.jean, box.id, { kind: 'UPDATE' })).status).toBe(400); // where?

    const j = await request(app).get(`/api/containers/${box.id}/journey`).set('Cookie', w.divine);
    expect(j.status).toBe(200);
    expect(
      j.body.events.map((e: { kind: string; stage: string }) => `${e.kind}:${e.stage}`),
    ).toEqual(['REACHED:TRANSPORT', 'UPDATE:TRANSPORT', 'REACHED:FIELD_RELEASE']);
    expect(j.body.events[0].by).toBe('Jean H.');
    expect(j.body.nextStages.map((s: { key: string }) => s.key)).toEqual([
      'RUSUMO',
      'CHECKPOINTS',
      'ICD',
      'PORT',
      'OCEAN_FREIGHT',
    ]);
    expect(j.body.mayMove).toBe(true);

    // Skipping a stage is allowed: straight to the ICD from the warehouse.
    r = await reach(w.divine, w.boxes[1]!.id, 'ICD', { place: 'AZAM ICD' });
    expect(r.status).toBe(201);
    expect(r.body.stage).toBe('ICD');
    expect(r.body.responsibleCompanyName).toBe('JIVAH LOGISTICS LTD'); // it crossed Rusumo on the way
  });

  it("confirms Rusumo: the box leaves Kigali's working list and appears on Dar's, its flag reads JIVAH", async () => {
    const w = await world();
    const box = w.boxes[0]!;
    await reach(w.jean, box.id, 'FIELD_RELEASE', { place: 'Magerwa' });

    // Before the crossing: on Divine's list, "coming" on Samuel's board, nowhere on his list.
    expect((await list(w.divine)).body.map((c: { number: string }) => c.number)).toContain(
      box.number,
    );
    expect((await list(w.samuel)).body).toHaveLength(0);
    let sb = await board(w.samuel);
    expect(sb.body.boxes).toHaveLength(0);
    // Dar's manager sees only how many are coming, and at which stage.
    expect(sb.body.coming).toEqual([
      { stage: 'FIELD_RELEASE', label: 'Released at warehouse', count: 1 },
    ]);
    expect(sb.body.handoverStage).toBe('RUSUMO');

    const r = await reach(w.jean, box.id, 'RUSUMO', {
      place: 'Rusumo border',
      happenedAt: hoursAgo(2),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      stage: 'RUSUMO',
      stageLabel: 'Crossed Rusumo',
      responsibleCompanyName: 'JIVAH LOGISTICS LTD',
      originCompanyName: 'OLIU LOGISTICS LTD',
      column: 'rusumo',
    });

    // After: gone from Divine's list, on Samuel's; Divine still sees it under "handed over" and on the booking page.
    expect((await list(w.divine)).body.map((c: { number: string }) => c.number)).not.toContain(
      box.number,
    );
    expect((await list(w.samuel)).body.map((c: { number: string }) => c.number)).toEqual([
      box.number,
    ]);
    sb = await board(w.samuel);
    expect(sb.body.boxes.map((c: { number: string }) => c.number)).toEqual([box.number]);
    expect(sb.body.coming).toHaveLength(0);
    const db = await board(w.divine);
    expect(db.body.boxes.map((c: { number: string }) => c.number)).not.toContain(box.number);
    expect(db.body.handedOver).toEqual([{ stage: 'RUSUMO', label: 'Crossed Rusumo', count: 1 }]);
    // On her own booking page the crossed box is a count, not a row.
    const bk = await request(app)
      .get(`/api/bookings/${w.booking.booking.id}`)
      .set('Cookie', w.divine);
    expect(bk.body.containers.some((c: { id: string }) => c.id === box.id)).toBe(false);
    expect(bk.body.elsewhere).toEqual([{ stage: 'RUSUMO', label: 'Crossed Rusumo', count: 1 }]);
    // Samuel, who holds the box now, reads the booking; Divine's search no longer finds the box.
    expect(
      (await request(app).get(`/api/bookings/${w.booking.booking.id}`).set('Cookie', w.samuel))
        .status,
    ).toBe(200);
    expect((await list(w.divine, `?q=${box.number}`)).body).toHaveLength(0);
    // The MD sees every box on one board.
    expect((await board(w.md)).body.boxes).toHaveLength(3);

    // The trail says who handed it to whom.
    const trail = await request(app).get('/api/audit?limit=50').set('Cookie', w.md);
    const handed = trail.body.find((e: { action: string }) => e.action === 'handed_over');
    expect(handed).toBeTruthy();
    expect(handed.after.company).toBe('JIVAH LOGISTICS LTD');

    // Samuel's booking list now carries OLIU's booking, because a box of it is on his side; Divine's keeps it.
    expect(
      (await request(app).get('/api/bookings').set('Cookie', w.samuel)).body.map(
        (b: { reference: string }) => b.reference,
      ),
    ).toEqual(['DAR600233400']);
    const perBox = await request(app)
      .get(`/api/bookings/${w.booking.booking.id}/costs`)
      .set('Cookie', w.samuel);
    expect(perBox.body.containers.map((c: { number: string }) => c.number)).toEqual([box.number]);
    // A cost by Samuel counts; one by Divine, whose side the box has left, waits for the MD.
    const c1 = await cost(w.samuel, {
      containerIds: [box.id],
      categoryId: w.cat['Clearance — Dar'],
      date: today(),
      currency: 'TZS',
      totalMinor: 1_850_000,
    });
    expect(c1.status, JSON.stringify(c1.body)).toBe(201);
    expect(c1.body.lines[0].companyName).toBe('JIVAH LOGISTICS LTD');
    const c2 = await cost(w.divine, {
      containerIds: [box.id],
      categoryId: w.cat['Inland transport'],
      date: today(),
      currency: 'RWF',
      totalMinor: 100_000,
    });
    expect(c2.status).toBe(201);
    expect(c2.body.lines[0]).toMatchObject({
      companyName: 'OLIU LOGISTICS LTD',
      status: 'PENDING_MD',
    });
    // Samuel moves the box now; Jean, whose side it left, no longer does, nor reads its journey.
    expect((await move(w.samuel, box.id, { kind: 'UPDATE', place: 'Nyakanazi' })).status).toBe(201);
    expect((await move(w.jean, box.id, { kind: 'UPDATE', place: 'Kahama' })).status).toBe(403);
    expect(
      (await request(app).get(`/api/containers/${box.id}/journey`).set('Cookie', w.jean)).status,
    ).toBe(403);
  });

  it('never flips a single company, and holds or returns a box at the border without flipping', async () => {
    // A single company: Rusumo is just a stage.
    const acc = await request(app).post('/api/accounts').send(singleSetup());
    const owner = await login(app, 'owner@transit.test');
    // The owner spans the account; to type a booking they pick their one company in the switcher.
    const only = await prisma.company.findFirstOrThrow({
      where: { accountId: acc.body.accountId },
    });
    const line = (
      await request(app).post('/api/shipping-lines').set('Cookie', owner).send({ name: 'PIL' })
    ).body;
    const client = (
      await request(app).post('/api/clients').set('Cookie', owner).send({ name: 'Any' })
    ).body;
    const b = (
      await request(app)
        .post('/api/bookings')
        .set('Cookie', owner)
        .set('X-Company', only.id)
        .send({
          shippingLineId: line.id,
          reference: 'DAR600233401',
          clientId: client.id,
          cargo: 'TIN',
          containers: [{ number: BOXES[0], size: '40FT', lot: '' }],
        })
    ).body;
    const r = await reach(owner, b.containers[0].id, 'RUSUMO');
    expect(r.status).toBe(201);
    expect(r.body.responsibleCompanyName).toBe('Gatuna Transit Ltd');

    // The group: held at the border, then returned, then crossed and sent back.
    const w = await world();
    const box = w.boxes[0]!;
    await reach(w.jean, box.id, 'FIELD_RELEASE');
    let h = await move(w.jean, box.id, { kind: 'HELD', place: 'Rusumo', note: 'papers missing' });
    expect(h.status).toBe(201);
    expect(h.body).toMatchObject({
      held: true,
      holdReason: 'papers missing',
      stage: 'FIELD_RELEASE',
      responsibleCompanyName: 'OLIU LOGISTICS LTD',
    });
    expect((await move(w.jean, box.id, { kind: 'HELD' })).status).toBe(400); // why?
    // The papers arrive: the hold is lifted, the box has not moved.
    h = await move(w.jean, box.id, { kind: 'HOLD_LIFTED', note: 'papers received' });
    expect(h.status).toBe(201);
    expect(h.body).toMatchObject({
      held: false,
      holdReason: '',
      stage: 'FIELD_RELEASE',
      place: 'Rusumo',
    });
    expect((await move(w.jean, box.id, { kind: 'HOLD_LIFTED' })).status).toBe(400); // not held
    expect((await move(w.samuel, box.id, { kind: 'HOLD_LIFTED' })).status).toBe(403); // not his side
    expect(
      (
        await request(app).get(`/api/containers/${box.id}/journey`).set('Cookie', w.jean)
      ).body.events.map((e: { kind: string }) => e.kind),
    ).toContain('HOLD_LIFTED');
    h = await move(w.jean, box.id, { kind: 'HELD', place: 'Rusumo', note: 'papers missing' });
    h = await move(w.jean, box.id, { kind: 'RETURNED', note: 'sent back to Kigali' });
    expect(h.status).toBe(201);
    expect(h.body).toMatchObject({
      held: false,
      stage: 'FIELD_RELEASE',
      place: 'Returned from Rusumo',
    });
    await reach(w.jean, box.id, 'RUSUMO');
    expect((await list(w.samuel)).body).toHaveLength(1);
    h = await move(w.samuel, box.id, { kind: 'RETURNED', note: 'refused by TRA' });
    expect(h.status).toBe(201);
    expect(h.body).toMatchObject({
      stage: 'FIELD_RELEASE',
      responsibleCompanyName: 'OLIU LOGISTICS LTD',
    });
    expect((await list(w.samuel)).body).toHaveLength(0);
    await reach(w.jean, box.id, 'ICD');
    expect((await move(w.samuel, box.id, { kind: 'RETURNED', note: 'too late' })).status).toBe(400);
  });

  it('releases a booking: boxes at the port are pre-ticked, the straggler at Magerwa is refused and moves to a sister booking', async () => {
    const w = await world();
    const [a, b, c] = w.boxes as [
      { id: string; number: string },
      { id: string; number: string },
      { id: string; number: string },
    ];
    await reach(w.jean, a.id, 'PORT', { place: 'Dar port' });
    await reach(w.jean, b.id, 'PORT', { place: 'Dar port' });
    await reach(w.jean, c.id, 'FIELD_RELEASE', { place: 'Magerwa' });
    // A cost on the straggler, so we can watch it move with the box.
    await cost(w.divine, {
      containerIds: [c.id],
      categoryId: w.cat['Inland transport'],
      date: today(),
      currency: 'RWF',
      totalMinor: 500_000,
    });
    // The box at the port is JIVAH's now: JIVAH types its cost (Divine's would wait for the MD).
    await cost(w.samuel, {
      containerIds: [a.id],
      categoryId: w.cat['Inland transport'],
      date: today(),
      currency: 'RWF',
      totalMinor: 700_000,
    });

    const view = await request(app)
      .get(`/api/bookings/${w.booking.booking.id}/release`)
      .set('Cookie', w.samuel);
    expect(view.status).toBe(200);
    expect(
      view.body.containers.map((x: { number: string; preselected: boolean }) => [
        x.number,
        x.preselected,
      ]),
    ).toEqual([
      [a.number, true],
      [b.number, true],
    ]);
    expect(view.body.elsewhere).toBe(1); // the straggler, still on OLIU's side
    expect(view.body.mayRelease).toBe(true);
    expect(view.body.maySplit).toBe(false); // the sister number is OLIU's call: it made the booking
    // A booking with nothing on Samuel's side is closed to him: not its page, not its release view, not in his list.
    const ob = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({
        shippingLineId: (await request(app).get('/api/shipping-lines').set('Cookie', w.divine))
          .body[0].id,
        reference: 'DAR600233499',
        clientId: (await request(app).get('/api/clients').set('Cookie', w.divine)).body[0].id,
        cargo: 'TIN',
        containers: [{ number: 'TCLU1234568', size: '40FT', lot: '' }],
      });
    expect(ob.status).toBe(201);
    expect(
      (
        await request(app)
          .get(`/api/bookings/${ob.body.booking.id}/release`)
          .set('Cookie', w.samuel)
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get(`/api/bookings/${ob.body.booking.id}`).set('Cookie', w.samuel))
        .status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/bookings').set('Cookie', w.samuel)).body.map(
        (x: { reference: string }) => x.reference,
      ),
    ).not.toContain('DAR600233499');

    // Ticking the straggler is refused, with its status in the message.
    const bad = await request(app)
      .post(`/api/bookings/${w.booking.booking.id}/release`)
      .set('Cookie', w.samuel)
      .send({ containerIds: [a.id, b.id, c.id] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('not a live container');
    // On Divine's side the straggler is refused with its status named.
    const straggler = await request(app)
      .post(`/api/bookings/${w.booking.booking.id}/release`)
      .set('Cookie', w.divine)
      .send({ containerIds: [c.id] });
    expect(straggler.status).toBe(400);
    expect(straggler.body.error).toContain(c.number);
    expect(straggler.body.error).toContain('released at warehouse');

    const ok = await request(app)
      .post(`/api/bookings/${w.booking.booking.id}/release`)
      .set('Cookie', w.samuel)
      .send({ containerIds: [a.id, b.id], note: 'PIL release at Dar' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(
      ok.body.containers
        .filter((x: { released: boolean }) => x.released)
        .map((x: { number: string }) => x.number),
    ).toEqual([a.number, b.number]);
    expect(
      (
        await request(app)
          .post(`/api/bookings/${w.booking.booking.id}/release`)
          .set('Cookie', w.samuel)
          .send({ containerIds: [a.id] })
      ).status,
    ).toBe(409);
    const rel = await request(app).get('/api/releases').set('Cookie', w.samuel);
    expect(
      rel.body.map((x: { number: string; releasedBy: string }) => `${x.number}:${x.releasedBy}`),
    ).toEqual([`${a.number}:Samuel N.`, `${b.number}:Samuel N.`]);
    // Aline has no release screen; Peace neither.
    expect((await request(app).get('/api/releases').set('Cookie', w.aline)).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/bookings/${w.booking.booking.id}/release`)
          .set('Cookie', w.peace)
          .send({ containerIds: [c.id] })
      ).status,
    ).toBe(403);

    // The waiting box goes to the sister booking, with its cost line; the first booking's total drops accordingly.
    const before = await request(app)
      .get(`/api/bookings/${w.booking.booking.id}/costs`)
      .set('Cookie', w.md);
    const usd = (rwf: number) => Math.round((rwf / 1452) * 100);
    expect(before.body.totals.usdCents).toBe(usd(500_000) + usd(700_000));
    expect(
      (
        await request(app)
          .post(`/api/bookings/${w.booking.booking.id}/sister`)
          .set('Cookie', w.samuel)
          .send({ reference: 'DAR600233400A', containerIds: [c.id] })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/bookings/${w.booking.booking.id}/sister`)
          .set('Cookie', w.divine)
          .send({ reference: 'DAR600233400A', containerIds: [a.id] })
      ).status,
    ).toBe(400); // released — and on JIVAH's side, so not Divine's to move
    const sis = await request(app)
      .post(`/api/bookings/${w.booking.booking.id}/sister`)
      .set('Cookie', w.divine)
      .send({ reference: 'DAR600233400A', containerIds: [c.id] });
    expect(sis.status, JSON.stringify(sis.body)).toBe(201);
    expect(sis.body.moved).toEqual([c.number]);
    expect(sis.body.fileNumber).toMatch(/^OLIU-\d{4}-0003$/); // 0002 went to the booking above
    const sisBooking = await request(app)
      .get(`/api/bookings/${sis.body.id}`)
      .set('Cookie', w.divine);
    expect(sisBooking.body.parentId).toBe(w.booking.booking.id);
    expect(sisBooking.body.containers.map((x: { number: string }) => x.number)).toEqual([c.number]);
    const after = await request(app)
      .get(`/api/bookings/${w.booking.booking.id}/costs`)
      .set('Cookie', w.md);
    expect(after.body.containers.map((x: { number: string }) => x.number)).toEqual([
      a.number,
      b.number,
    ]);
    expect(after.body.totals.usdCents).toBe(usd(700_000));
    const sisCosts = await request(app)
      .get(`/api/bookings/${sis.body.id}/costs`)
      .set('Cookie', w.md);
    expect(sisCosts.body.totals.usdCents).toBe(usd(500_000));
    expect(
      (
        await request(app)
          .get(`/api/bookings/${w.booking.booking.id}/release`)
          .set('Cookie', w.divine)
      ).body.booking.sisters,
    ).toEqual([{ id: sis.body.id, reference: 'DAR600233400A' }]);
  });

  it('flags a box left at the ICD past the free days, and tags a cost dated inside the spell as delay-related', async () => {
    const w = await world();
    const box = w.boxes[0]!;
    // Four free days (the default). Arrived six days ago: at risk since the day after the free days ran out.
    let r = await reach(w.jean, box.id, 'ICD', { place: 'AZAM ICD', happenedAt: daysAgo(6) });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ daysAtIcd: 6, atRisk: true, icdFreeDays: 4 });
    expect(r.body.risk).toMatchObject({ source: 'ICD', since: daysAgo(1) });
    const b = await board(w.samuel);
    expect(b.body.boxes[0]).toMatchObject({ number: box.number, atRisk: true, column: 'icd' });

    // A cost dated today: delay-related. One dated on the third day: not.
    const late = await cost(w.samuel, {
      containerIds: [box.id],
      categoryId: w.cat['ICD / port charges'],
      date: today(),
      currency: 'TZS',
      totalMinor: 940_000,
    });
    expect(late.status, JSON.stringify(late.body)).toBe(201);
    expect(late.body.lines[0].delayRelated).toBe(true);
    const early = await cost(w.samuel, {
      containerIds: [box.id],
      categoryId: w.cat['ICD / port charges'],
      date: daysAgo(3),
      currency: 'TZS',
      totalMinor: 100_000,
    });
    expect(early.body.lines[0].delayRelated).toBe(false);
    const rec = await request(app).get(`/api/containers/${box.id}/costs`).set('Cookie', w.md);
    expect(rec.body.totals.delayUsdCents).toBe(Math.round((940_000 / 2608) * 100));
    expect(rec.body.totals.usdCents).toBe(
      Math.round((940_000 / 2608) * 100) + Math.round((100_000 / 2608) * 100),
    );

    // The box leaves the ICD: the spell closes today; a cost dated inside it is still delay-related, one after is not.
    r = await reach(w.samuel, box.id, 'PORT', { place: 'Dar port' });
    expect(r.body).toMatchObject({ stage: 'PORT', atRisk: false, daysAtIcd: null });
    const j = await request(app).get(`/api/containers/${box.id}/journey`).set('Cookie', w.samuel);
    expect(j.body.riskPeriods).toHaveLength(1);
    expect(j.body.riskPeriods[0]).toMatchObject({
      source: 'ICD',
      from: daysAgo(1),
      to: today(),
      openedBy: 'the system',
    });
    const inside = await cost(w.samuel, {
      containerIds: [box.id],
      categoryId: w.cat['ICD / port charges'],
      date: daysAgo(1),
      currency: 'TZS',
      totalMinor: 10_000,
    });
    expect(inside.body.lines[0].delayRelated).toBe(true);

    // By hand: a breakdown flags the second box; clearing lifts it; flagging twice is refused.
    const other = w.boxes[1]!;
    await reach(w.jean, other.id, 'TRANSPORT');
    let f = await request(app)
      .post(`/api/containers/${other.id}/risk`)
      .set('Cookie', w.jean)
      .send({ reason: 'breakdown at Nyakasanza' });
    expect(f.status).toBe(201);
    expect(f.body).toMatchObject({
      atRisk: true,
      risk: { source: 'MANUAL', reason: 'breakdown at Nyakasanza' },
    });
    expect(
      (
        await request(app)
          .post(`/api/containers/${other.id}/risk`)
          .set('Cookie', w.jean)
          .send({ reason: 'again' })
      ).status,
    ).toBe(409);
    const tagged = await cost(w.divine, {
      containerIds: [other.id],
      categoryId: w.cat['Inland transport'],
      date: today(),
      currency: 'RWF',
      totalMinor: 2_400_000,
    });
    expect(tagged.body.lines[0].delayRelated).toBe(true);
    f = await request(app)
      .post(`/api/containers/${other.id}/risk/clear`)
      .set('Cookie', w.jean)
      .send({ note: 'replacement truck arrived' });
    expect(f.status).toBe(200);
    expect(f.body.atRisk).toBe(false);
    expect(
      (
        await request(app)
          .post(`/api/containers/${other.id}/risk/clear`)
          .set('Cookie', w.jean)
          .send({})
      ).status,
    ).toBe(409);
  });
});

describe('the rules', () => {
  it('lets only the roles of the old table move a box, and only its own side', async () => {
    const w = await world();
    const box = w.boxes[0]!;
    expect((await reach(w.aline, box.id, 'TRANSPORT')).status).toBe(403); // Finance has no journey screen
    expect((await reach(w.peace, box.id, 'TRANSPORT')).status).toBe(403); // the Field Officer phones it in
    expect((await reach(w.claire, box.id, 'TRANSPORT')).status).toBe(403); // the Reporting Officer reads
    expect((await board(w.claire)).status).toBe(200);
    expect((await board(w.peace)).status).toBe(200);
    expect((await reach(w.samuel, box.id, 'TRANSPORT')).status).toBe(403); // not on JIVAH's side yet
    expect((await reach(w.jean, box.id, 'TRANSPORT')).status).toBe(201);
    // The MD must say which company they act for? No: the MD spans the account and moves any box.
    expect((await reach(w.md, box.id, 'FIELD_RELEASE')).status).toBe(201);
    // Another account sees nothing.
    await request(app).post('/api/accounts').send(singleSetup());
    const stranger = await login(app, 'owner@transit.test');
    expect(
      (await request(app).get(`/api/containers/${box.id}/journey`).set('Cookie', stranger)).status,
    ).toBe(404);
    expect((await reach(stranger, box.id, 'RUSUMO')).status).toBe(404);
  });

  it('corrects a wrong stage with a reason, and the responsible company follows', async () => {
    const w = await world();
    const box = w.boxes[0]!;
    await reach(w.jean, box.id, 'RUSUMO');
    expect((await list(w.samuel)).body).toHaveLength(1);
    const correct = (cookie: string, body: Record<string, unknown>) =>
      request(app)
        .post(`/api/containers/${box.id}/journey/correct`)
        .set('Cookie', cookie)
        .send(body);
    expect(
      (await correct(w.jean, { stage: 'FIELD_RELEASE', reason: 'typed too early' })).status,
    ).toBe(403); // the coordinator asks the manager
    expect((await correct(w.divine, { stage: 'FIELD_RELEASE' })).status).toBe(400); // a reason is required
    // The box has crossed: Kigali's manager no longer touches it; the MD puts it right.
    expect(
      (await correct(w.divine, { stage: 'FIELD_RELEASE', reason: 'typed too early' })).status,
    ).toBe(403);
    let r = await correct(w.md, {
      stage: 'FIELD_RELEASE',
      reason: 'typed too early, still at Magerwa',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({
      stage: 'FIELD_RELEASE',
      responsibleCompanyName: 'OLIU LOGISTICS LTD',
    });
    expect((await list(w.samuel)).body).toHaveLength(0);
    r = await correct(w.md, { stage: 'ICD', reason: 'it did cross, and is at AZAM' });
    expect(r.body).toMatchObject({
      stage: 'ICD',
      responsibleCompanyName: 'JIVAH LOGISTICS LTD',
      daysAtIcd: 0,
    });
    const j = await request(app).get(`/api/containers/${box.id}/journey`).set('Cookie', w.md);
    expect(j.body.events.filter((e: { kind: string }) => e.kind === 'CORRECTED')).toHaveLength(2);
    expect(j.body.events.at(-1).note).toBe('it did cross, and is at AZAM');
  });

  it('expects a position update every so many hours while the box is on the road', async () => {
    const w = await world();
    const box = w.boxes[0]!;
    expect(
      (await request(app).patch('/api/settings').set('Cookie', w.divine).send({ trackingHours: 1 }))
        .status,
    ).toBe(403);
    const st = await request(app)
      .patch('/api/settings')
      .set('Cookie', w.md)
      .send({ trackingHours: 1, icdFreeDays: 6 });
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ trackingHours: 1, icdFreeDays: 6, marginType: 'PERCENT' });
    await reach(w.jean, box.id, 'TRANSPORT', { place: 'Rwamagana', happenedAt: hoursAgo(3) });
    const onBoard = async (cookie: string) =>
      (await board(cookie)).body.boxes.find((x: { id: string }) => x.id === box.id);
    const b = await board(w.divine);
    expect(b.body.boxes[0]).toMatchObject({
      number: box.number,
      updateOverdue: true,
      hoursSinceSeen: 3,
    }); // the moved box tops the board
    expect(b.body.settings).toEqual({ trackingHours: 1, icdFreeDays: 6 });
    await move(w.jean, box.id, { kind: 'UPDATE', place: 'Kayonza' });
    expect(await onBoard(w.divine)).toMatchObject({ updateOverdue: false, place: 'Kayonza' });
    // A backdated update never makes the box "seen" earlier than it already was.
    await move(w.jean, box.id, {
      kind: 'UPDATE',
      place: 'Rwamagana again',
      happenedAt: hoursAgo(5),
    });
    expect((await onBoard(w.divine)).updateOverdue).toBe(false);
    // At the ICD nobody is driving: no update is expected.
    await reach(w.jean, box.id, 'ICD', { happenedAt: hoursAgo(2) });
    expect((await board(w.samuel)).body.boxes[0].updateOverdue).toBe(false);
    // Six free days now: a box three days in is not at risk.
    expect((await board(w.samuel)).body.boxes[0].atRisk).toBe(false);
  });

  it('closes a box to Finance in one P&L month; a cost after that goes to the MD; only the MD reopens', async () => {
    const w = await world();
    const box = w.boxes[0]!;
    await reach(w.jean, box.id, 'OCEAN_FREIGHT', { place: 'KOTA SETIA', departedOn: '2026-10-20' });
    await cost(w.samuel, {
      containerIds: [box.id],
      categoryId: w.cat['Clearance — Dar'],
      date: today(),
      currency: 'TZS',
      totalMinor: 1_850_000,
    });
    const close = (cookie: string, body: Record<string, unknown> = {}) =>
      request(app).post(`/api/containers/${box.id}/close`).set('Cookie', cookie).send(body);
    expect((await close(w.divine)).status).toBe(403); // JIVAH is responsible now
    expect((await close(w.jean)).status).toBe(403); // no handoff screen for the coordinator
    const ready = await request(app).get('/api/closed').set('Cookie', w.samuel);
    expect(
      ready.body.candidates.map((x: { number: string; costUsd: string }) => [x.number, x.costUsd]),
    ).toEqual([[box.number, '709.36']]);
    let r = await close(w.samuel, {
      closedOn: '2026-10-25',
      readyToInvoice: true,
      note: 'departed on KOTA SETIA',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      closed: true,
      plMonth: '2026-10',
      readyToInvoice: true,
      departedOn: '2026-10-20T00:00:00.000Z',
      localOnly: false,
    });
    expect((await close(w.samuel)).status).toBe(409);
    expect((await move(w.samuel, box.id, { kind: 'UPDATE', place: 'at sea' })).status).toBe(409);
    expect((await board(w.samuel)).body.boxes).toHaveLength(0); // closed boxes leave the board
    const closed = await request(app).get('/api/closed?month=2026-10').set('Cookie', w.samuel);
    expect(
      closed.body.closed.map((x: { number: string; closedBy: string; costUsd: string }) => [
        x.number,
        x.closedBy,
        x.costUsd,
      ]),
    ).toEqual([[box.number, 'Samuel N.', '709.36']]);
    expect(closed.body.totals).toEqual({ boxes: 1, costUsd: '709.36' });

    // A late invoice still lands on the box, and the MD hears of it.
    const late = await cost(w.samuel, {
      containerIds: [box.id],
      categoryId: w.cat['ICD / port charges'],
      date: today(),
      currency: 'TZS',
      totalMinor: 50_000,
    });
    expect(late.status).toBe(201);
    const q = await request(app).get('/api/md-queue').set('Cookie', w.md);
    const item = q.body.find((i: { kind: string }) => i.kind === 'COST_AFTER_CLOSE');
    expect(item).toBeTruthy();
    expect(item.summary).toMatchObject({
      number: box.number,
      category: 'ICD / port charges',
      amount: 'TZS 50,000',
    });
    // The MD notes it; it is not a duplicate to rule on, and nobody else rules.
    const note = (cookie: string, resolution: string) =>
      request(app)
        .post(`/api/md-queue/${item.id}/resolve`)
        .set('Cookie', cookie)
        .send({ resolution });
    expect((await note(w.divine, 'NOTED')).status).toBe(403);
    expect((await note(w.md, 'KEEP_NEW')).status).toBe(400);
    expect((await note(w.md, 'NOTED')).status).toBe(200);
    expect(
      (await request(app).get('/api/md-queue').set('Cookie', w.md)).body.find(
        (i: { id: string }) => i.id === item.id,
      ),
    ).toBeUndefined();

    expect(
      (
        await request(app)
          .post(`/api/containers/${box.id}/reopen`)
          .set('Cookie', w.samuel)
          .send({ reason: 'one more cost' })
      ).status,
    ).toBe(403);
    r = await request(app)
      .post(`/api/containers/${box.id}/reopen`)
      .set('Cookie', w.md)
      .send({ reason: 'one more cost to come' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ closed: false, plMonth: '' });

    // A box closed at the warehouse is local-only: it never shows as "coming" on Dar's board.
    const local = w.boxes[1]!;
    await reach(w.jean, local.id, 'FIELD_RELEASE', { place: 'Dubai' });
    expect((await board(w.samuel)).body.coming).toEqual([
      { stage: 'FIELD_RELEASE', label: 'Released at warehouse', count: 1 },
    ]);
    r = await request(app)
      .post(`/api/containers/${local.id}/close`)
      .set('Cookie', w.divine)
      .send({ plMonth: '2026-09' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ localOnly: true, plMonth: '2026-09' });
    expect((await board(w.samuel)).body.coming).toHaveLength(0);
    expect(
      (await request(app).get('/api/closed?month=2026-09').set('Cookie', w.divine)).body.closed,
    ).toHaveLength(1);
  });
});
