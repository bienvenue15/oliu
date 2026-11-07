/**
 * Slice 3 — cost entry and the split, the roadmap's runs as code:
 *  - one clearing fee on one box shows in RWF and in USD at the rate of its own date
 *  - one truck invoice for three boxes: the total is typed once, three lines appear, one per box
 *  - correcting one split line changes the booking total, because it is a sum, not a stored figure
 *  - PCIU 9084297 rebuilt from the mockup: six lines, USD 4,750.93, each line's rate at its own date
 *  - the rules: no rate is an error, weights for a weight split, manual amounts must add up, one booking per bill,
 *    each company's book is its own, who may enter what, nothing deleted, the trail has every step
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { formatMoney, parseMoney, splitByWeight, splitEqual, toUsdCents } from '@oliu/shared';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { groupSetup, inviteAndActivate, login, resetDb, singleSetup } from './helpers.ts';

const app = createApp();

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(resetDb);

const BOXES = ['FFAU8028326', 'PCIU9320936', 'PIDU4544108'] as const;

async function world() {
  const r = await request(app).post('/api/accounts').send(groupSetup());
  const md = await login(app, 'md@oliu.test');
  const [oliu, jivah] = await prisma.company.findMany({
    where: { accountId: r.body.accountId },
    orderBy: { createdAt: 'asc' },
  });
  for (const [name, email, role, companyId] of [
    ['Divine M.', 'divine@oliu.test', 'OPS_MANAGER', oliu!.id],
    ['Samuel N.', 'samuel@jivah.test', 'OPS_MANAGER', jivah!.id],
    ['Aline U.', 'aline@oliu.test', 'FINANCE_OFFICER', oliu!.id],
  ] as const)
    await inviteAndActivate(app, md, { name, email, role, companyId });
  const divine = await login(app, 'divine@oliu.test');
  const samuel = await login(app, 'samuel@jivah.test');
  const aline = await login(app, 'aline@oliu.test');

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
  for (const name of [
    'Shipping line',
    'Clearance — Kigali',
    'Clearance — Dar',
    'Inland transport',
    'ICD / port charges',
    'Tip / facilitation',
  ]) {
    const c = await request(app).post('/api/cost-categories').set('Cookie', md).send({ name });
    expect(c.status, name).toBe(201);
    cat[name] = c.body.id;
  }
  // The mockup's rates, in August: RWF 1452 on the 14th; TZS 2605, 2608 and 2610 on the 9th, 11th and 24th.
  for (const [currency, date, perUsd] of [
    ['RWF', '2026-08-14', '1452'],
    ['TZS', '2026-08-09', '2605'],
    ['TZS', '2026-08-11', '2608'],
    ['TZS', '2026-08-24', '2610'],
  ] as const) {
    const x = await request(app)
      .post('/api/rates')
      .set('Cookie', md)
      .send({ currency, date, perUsd });
    expect(x.status, `${currency} ${date}`).toBe(201);
  }
  return {
    md,
    divine,
    samuel,
    aline,
    oliu: oliu!,
    jivah: jivah!,
    booking,
    boxes,
    cat,
    pil,
    client,
  };
}

const post = (cookie: string, body: Record<string, unknown>) =>
  request(app).post('/api/costs').set('Cookie', cookie).send(body);

describe('money in @oliu/shared', () => {
  it('reads and writes integer minor units, divides and converts without floating point surprises', () => {
    expect(parseMoney('1,909,000', 'RWF')).toBe(1_909_000);
    expect(parseMoney('2,140.50', 'USD')).toBe(214_050);
    expect(parseMoney('2140', 'USD')).toBe(214_000);
    expect(parseMoney('1,909,000.5', 'RWF')).toBeNull(); // RWF has no decimals
    expect(parseMoney('12.345', 'USD')).toBeNull();
    expect(parseMoney('abc', 'USD')).toBeNull();
    expect(formatMoney(1_909_000, 'RWF')).toBe('1,909,000');
    expect(formatMoney(214_050, 'USD')).toBe('2,140.50');
    expect(splitEqual(1_909_000, 3)).toEqual([636_333, 636_333, 636_334]);
    expect(splitByWeight(1_000_000, [20_000, 30_000, 50_000])).toEqual([200_000, 300_000, 500_000]);
    expect(splitByWeight(100, [1, 1, 1]).reduce((a, b) => a + b)).toBe(100);
    expect(toUsdCents(1_850_000, 'TZS', '2605')).toBe(71_017);
    expect(toUsdCents(331_000, 'RWF', '1452')).toBe(22_796);
    expect(toUsdCents(214_000, 'USD', '1')).toBe(214_000);
  });
});

describe("the roadmap's runs", () => {
  it('one clearing fee on one box shows in RWF and in USD at the rate of its own date', async () => {
    const w = await world();
    const r = await post(w.divine, {
      containerIds: [w.boxes[1]!.id],
      categoryId: w.cat['Clearance — Kigali'],
      date: '2026-08-18', // no rate typed that day: the most recent one before it (14 Aug, 1452) applies
      currency: 'RWF',
      totalMinor: 331_000,
      paidTo: 'RwandaClear',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.lines).toHaveLength(1);
    const l = r.body.lines[0];
    expect(l).toMatchObject({
      containerNumber: 'PCIU9320936',
      category: 'Clearance — Kigali',
      currency: 'RWF',
      amount: '331,000',
      usd: '227.96',
      usdCents: 22_796,
      paidTo: 'RwandaClear',
      enteredBy: 'Divine M.',
      companyName: 'OLIU LOGISTICS LTD',
      split: null,
    });
    expect(Number(l.perUsd)).toBe(1452);

    const record = await request(app)
      .get(`/api/containers/${w.boxes[1]!.id}/costs`)
      .set('Cookie', w.divine);
    expect(record.status).toBe(200);
    expect(record.body.totals.usd).toBe('227.96');
    expect(record.body.bookingTotals.usd).toBe('227.96');
    expect(record.body.container.booking.fileNumber).toMatch(/^OLIU-\d{4}-0001$/);
  });

  it('one truck invoice for three boxes: typed once, three lines, one per box, remainder on the last', async () => {
    const w = await world();
    const r = await post(w.divine, {
      containerIds: w.boxes.map((b) => b.id),
      categoryId: w.cat['Inland transport'],
      date: '2026-08-14',
      currency: 'RWF',
      totalMinor: 1_909_000,
      paidTo: 'Simba Haulage',
      reference: 'SH-2026-0441',
      method: 'EQUAL',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.lines.map((l: { amountMinor: number }) => l.amountMinor)).toEqual([
      636_333, 636_333, 636_334,
    ]);
    expect(
      r.body.lines.every((l: { split: { method: string } }) => l.split.method === 'EQUAL'),
    ).toBe(true);
    const totals = await request(app)
      .get(`/api/bookings/${w.booking.booking.id}/costs`)
      .set('Cookie', w.divine);
    expect(totals.body.containers.map((c: { usd: string }) => c.usd)).toEqual([
      '438.25',
      '438.25',
      '438.25',
    ]);
    // 1,909,000 / 1452 = 1314.738… → the three USD figures sum to the whole, cent for cent, as entered per box.
    expect(totals.body.totals.usdCents).toBe(43_825 * 3);
    expect(await prisma.costSplit.count()).toBe(1);
  });

  it('correcting one split line changes the booking total, because it is a sum, not a stored figure', async () => {
    const w = await world();
    const r = await post(w.divine, {
      containerIds: w.boxes.map((b) => b.id),
      categoryId: w.cat['Inland transport'],
      date: '2026-08-14',
      currency: 'RWF',
      totalMinor: 1_909_000,
    });
    const line = r.body.lines[2];
    const before = (
      await request(app).get(`/api/bookings/${w.booking.booking.id}/costs`).set('Cookie', w.divine)
    ).body.totals.usdCents;
    const fixed = await request(app)
      .patch(`/api/costs/${line.id}`)
      .set('Cookie', w.divine)
      .send({ amountMinor: 736_334, reason: 'the driver was paid the waiting day too' });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect(fixed.body.amount).toBe('736,334');
    expect(fixed.body.usdCents).toBe(toUsdCents(736_334, 'RWF', '1452'));
    const after = (
      await request(app).get(`/api/bookings/${w.booking.booking.id}/costs`).set('Cookie', w.divine)
    ).body.totals.usdCents;
    expect(after - before).toBe(
      toUsdCents(736_334, 'RWF', '1452') - toUsdCents(636_334, 'RWF', '1452'),
    );
    const trail = await request(app).get('/api/audit?module=costs&limit=200').set('Cookie', w.md);
    const corrected = trail.body.find((e: { action: string }) => e.action === 'cost_corrected');
    expect(corrected.after.reason).toBe('the driver was paid the waiting day too');
    expect(corrected.before.amountMinor).toBe(636_334);
  });

  it('rebuilds PCIU 9084297 from the mockup: six lines, USD 4,750.93, each at the rate of its own date', async () => {
    const w = await world();
    const added = await request(app)
      .post(`/api/bookings/${w.booking.booking.id}/containers`)
      .set('Cookie', w.divine)
      .send({ containers: [{ number: 'PCIU9084297', size: '40FT', lot: '' }] });
    const box = added.body.containers[0].id;
    const lines = [
      ['Shipping line', '2026-08-04', 'USD', 214_000, 'PIL Tanzania', 214_000],
      ['Clearance — Dar', '2026-08-09', 'TZS', 1_850_000, 'DarPort Clearing', 71_017],
      ['ICD / port charges', '2026-08-11', 'TZS', 940_000, 'AZAM ICD', 36_043],
      ['Inland transport', '2026-08-14', 'RWF', 1_900_000, 'Simba Haulage', 130_854],
      ['Tip / facilitation', '2026-08-24', 'TZS', 10_000, '', 383],
      ['Clearance — Kigali', '2026-08-18', 'RWF', 331_000, 'RwandaClear', 22_796],
    ] as const;
    for (const [category, date, currency, totalMinor, paidTo, usdCents] of lines) {
      const r = await post(w.divine, {
        containerIds: [box],
        categoryId: w.cat[category],
        date,
        currency,
        totalMinor,
        paidTo,
      });
      expect(r.status, category).toBe(201);
      expect(r.body.lines[0].usdCents, category).toBe(usdCents);
    }
    const record = await request(app).get(`/api/containers/${box}/costs`).set('Cookie', w.md);
    expect(record.body.lines).toHaveLength(6);
    expect(record.body.totals.usd).toBe('4,750.93');
    expect(record.body.lines.map((l: { perUsd: string }) => Number(l.perUsd))).toEqual([
      1, 2605, 2608, 1452, 1452, 2610,
    ]);
  });
});

describe('the rules', () => {
  it('no rate is an error the person can fix, never a silent 1.000; USD needs none', async () => {
    const w = await world();
    const early = await post(w.divine, {
      containerIds: [w.boxes[0]!.id],
      categoryId: w.cat['Clearance — Kigali'],
      date: '2026-08-01', // before any RWF rate
      currency: 'RWF',
      totalMinor: 1000,
    });
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/No RWF rate on or before 2026-08-01/);
    const ugx = await post(w.divine, {
      containerIds: [w.boxes[0]!.id],
      categoryId: w.cat['Clearance — Kigali'],
      date: '2026-08-20',
      currency: 'UGX',
      totalMinor: 1000,
    });
    expect(ugx.status).toBe(400);
    const usd = await post(w.divine, {
      containerIds: [w.boxes[0]!.id],
      categoryId: w.cat['Shipping line'],
      date: '2026-01-01',
      currency: 'USD',
      totalMinor: 214_000,
    });
    expect(usd.status).toBe(201);
    expect(usd.body.lines[0].usd).toBe('2,140.00');
    expect(await prisma.costLine.count()).toBe(1);
  });

  it('a weight split needs every weight; a manual split must add up; one bill covers one booking', async () => {
    const w = await world();
    const body = {
      containerIds: w.boxes.map((b) => b.id),
      categoryId: w.cat['Inland transport'],
      date: '2026-08-14',
      currency: 'RWF',
      totalMinor: 1_000_000,
    };
    const noWeights = await post(w.divine, { ...body, method: 'WEIGHT' });
    expect(noWeights.status).toBe(400);
    expect(noWeights.body.error).toMatch(/Weight missing on FFAU8028326, PCIU9320936, PIDU4544108/);
    for (const [i, kg] of [20_000, 30_000, 50_000].entries()) {
      const p = await request(app)
        .patch(`/api/containers/${w.boxes[i]!.id}`)
        .set('Cookie', w.divine)
        .send({ weightKg: kg });
      expect(p.status).toBe(200);
    }
    const byWeight = await post(w.divine, { ...body, method: 'WEIGHT' });
    expect(byWeight.status).toBe(201);
    expect(byWeight.body.lines.map((l: { amountMinor: number }) => l.amountMinor)).toEqual([
      200_000, 300_000, 500_000,
    ]);

    const bad = await post(w.divine, {
      ...body,
      method: 'MANUAL',
      manualMinor: [500_000, 400_000, 50_000],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.details[0].path).toBe('manualMinor');
    const good = await post(w.divine, {
      ...body,
      method: 'MANUAL',
      manualMinor: [500_000, 400_000, 100_000],
    });
    expect(good.status).toBe(201);
    expect(good.body.lines.map((l: { amountMinor: number }) => l.amountMinor)).toEqual([
      500_000, 400_000, 100_000,
    ]);

    const other = await request(app)
      .post('/api/bookings')
      .set('Cookie', w.divine)
      .send({
        shippingLineId: w.pil.id,
        reference: 'DAR600210600',
        clientId: w.client.id,
        cargo: 'TANTALITE',
        containers: [{ number: 'GLDU9067500', size: '40FT', lot: '' }],
      });
    const twoBookings = await post(w.divine, {
      ...body,
      containerIds: [w.boxes[0]!.id, other.body.containers[0].id],
    });
    expect(twoBookings.status).toBe(400);
    expect(twoBookings.body.error).toMatch(/one booking/);
    // A withdrawn box takes no cost.
    await request(app)
      .post(`/api/bookings/${other.body.booking.id}/cancel`)
      .set('Cookie', w.divine)
      .send({ reason: 'typed twice' });
    const dead = await post(w.divine, { ...body, containerIds: [other.body.containers[0].id] });
    expect(dead.status).toBe(400);
    // Samuel may not touch OLIU's box weight.
    expect(
      (
        await request(app)
          .patch(`/api/containers/${w.boxes[0]!.id}`)
          .set('Cookie', w.samuel)
          .send({ weightKg: 1 })
      ).status,
    ).toBe(403);
  });

  it("each company's book is its own: JIVAH's lines sit in JIVAH's book, the MD sees both", async () => {
    const w = await world();
    const o = await post(w.divine, {
      containerIds: [w.boxes[0]!.id],
      categoryId: w.cat['Clearance — Kigali'],
      date: '2026-08-18',
      currency: 'RWF',
      totalMinor: 331_000,
    });
    const j = await post(w.samuel, {
      containerIds: [w.boxes[0]!.id],
      categoryId: w.cat['Clearance — Dar'],
      date: '2026-08-09',
      currency: 'TZS',
      totalMinor: 1_850_000,
      paidTo: 'DarPort Clearing',
    });
    expect(j.status, JSON.stringify(j.body)).toBe(201);
    expect(j.body.lines[0].companyName).toBe('JIVAH LOGISTICS LTD');
    // The box is on OLIU's side: the line waits for the MD and counts nowhere until approved.
    expect(j.body.lines[0].status).toBe('PENDING_MD');

    const mine = await request(app).get('/api/costs?month=2026-08').set('Cookie', w.divine);
    expect(mine.body.map((l: { id: string }) => l.id)).toEqual([o.body.lines[0].id]);
    const theirs = await request(app).get('/api/costs?month=2026-08').set('Cookie', w.samuel);
    expect(theirs.body.map((l: { id: string }) => l.id)).toEqual([j.body.lines[0].id]);

    const asDivine = await request(app)
      .get(`/api/containers/${w.boxes[0]!.id}/costs`)
      .set('Cookie', w.divine);
    expect(asDivine.body.lines).toHaveLength(1);
    expect(asDivine.body.totals.usd).toBe('227.96');
    const pending = (await request(app).get('/api/md-queue').set('Cookie', w.md)).body.find(
      (i: { kind: string }) => i.kind === 'COST_OTHER_SIDE',
    );
    expect(pending.summary).toMatchObject({
      numbers: [w.boxes[0]!.number],
      category: 'Clearance — Dar',
    });
    const beforeApproval = await request(app)
      .get(`/api/containers/${w.boxes[0]!.id}/costs`)
      .set('Cookie', w.md);
    expect(beforeApproval.body.lines).toHaveLength(1);
    expect(
      (
        await request(app)
          .post(`/api/md-queue/${pending.id}/resolve`)
          .set('Cookie', w.md)
          .send({ resolution: 'APPROVE' })
      ).status,
    ).toBe(200);
    const asMd = await request(app)
      .get(`/api/containers/${w.boxes[0]!.id}/costs`)
      .set('Cookie', w.md);
    expect(asMd.body.lines).toHaveLength(2);
    expect(asMd.body.totals.usd).toBe('938.13');
    expect(
      asMd.body.totals.perCompany.map((p: { companyName: string; usd: string }) => [
        p.companyName,
        p.usd,
      ]),
    ).toEqual([
      ['OLIU LOGISTICS LTD', '227.96'],
      ['JIVAH LOGISTICS LTD', '710.17'],
    ]);
    const mdAsJivah = await request(app)
      .get(`/api/containers/${w.boxes[0]!.id}/costs`)
      .set('Cookie', w.md)
      .set('X-Company', w.jivah.id);
    expect(mdAsJivah.body.lines).toHaveLength(1);

    // Divine cannot change JIVAH's line; nobody from another account sees the box at all.
    expect(
      (
        await request(app)
          .patch(`/api/costs/${j.body.lines[0].id}`)
          .set('Cookie', w.divine)
          .send({ amountMinor: 1, reason: 'not mine' })
      ).status,
    ).toBe(403);
    await request(app).post('/api/accounts').send(singleSetup());
    const stranger = await login(app, 'owner@transit.test');
    expect(
      (await request(app).get(`/api/containers/${w.boxes[0]!.id}/costs`).set('Cookie', stranger))
        .status,
    ).toBe(404);
    expect((await request(app).get('/api/cost-categories').set('Cookie', stranger)).body).toEqual(
      [],
    );
  });

  it('who may do what: costs by Operations, rates by Finance or the MD, categories and the margin by the MD', async () => {
    const w = await world();
    const body = {
      containerIds: [w.boxes[0]!.id],
      categoryId: w.cat['Shipping line'],
      date: '2026-08-04',
      currency: 'USD',
      totalMinor: 100,
    };
    expect((await post(w.aline, body)).status).toBe(403);
    expect((await post(w.md, body)).status).toBe(400); // the MD must choose a company in the switcher first
    expect(
      (
        await request(app)
          .post('/api/costs')
          .set('Cookie', w.md)
          .set('X-Company', w.oliu.id)
          .send(body)
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .post('/api/rates')
          .set('Cookie', w.divine)
          .send({ currency: 'RWF', date: '2026-09-01', perUsd: '1460' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/rates')
          .set('Cookie', w.aline)
          .send({ currency: 'RWF', date: '2026-09-01', perUsd: '1460' })
      ).status,
    ).toBe(201);
    const replaced = await request(app)
      .post('/api/rates')
      .set('Cookie', w.aline)
      .send({ currency: 'RWF', date: '2026-09-01', perUsd: '1461' });
    expect(replaced.status).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/rates')
          .set('Cookie', w.aline)
          .send({ currency: 'USD', date: '2026-09-01', perUsd: '1' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/rates')
          .set('Cookie', w.aline)
          .send({ currency: 'RWF', date: '2026-09-01', perUsd: '0' })
      ).status,
    ).toBe(400);
    const latest = await request(app).get('/api/rates/latest').set('Cookie', w.divine);
    expect(latest.body.find((r: { currency: string }) => r.currency === 'RWF')).toMatchObject({
      date: '2026-09-01',
      perUsd: '1461',
    });

    expect(
      (
        await request(app)
          .post('/api/cost-categories')
          .set('Cookie', w.divine)
          .send({ name: 'Weighbridge' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/cost-categories')
          .set('Cookie', w.md)
          .send({ name: 'shipping LINE' })
      ).status,
    ).toBe(409);
    const off = await request(app)
      .patch(`/api/cost-categories/${w.cat['Tip / facilitation']}`)
      .set('Cookie', w.md)
      .send({ active: false });
    expect(off.body.active).toBe(false);
    expect(
      (await post(w.divine, { ...body, categoryId: w.cat['Tip / facilitation'] })).status,
    ).toBe(400);

    expect(
      (
        await request(app)
          .patch('/api/settings')
          .set('Cookie', w.aline)
          .send({ marginType: 'PERCENT', marginValue: 1500 })
      ).status,
    ).toBe(403);
    const m = await request(app)
      .patch('/api/settings')
      .set('Cookie', w.md)
      .send({ marginType: 'PERCENT', marginValue: 1500 });
    expect(m.status).toBe(200);
    expect((await request(app).get('/api/settings').set('Cookie', w.divine)).status).toBe(403); // the figures are the MD's screen
    expect((await request(app).get('/api/settings').set('Cookie', w.md)).body).toMatchObject({
      marginType: 'PERCENT',
      marginValue: 1500,
    });
  });

  it('a voided line leaves the totals and stays in the record; a void line cannot be corrected', async () => {
    const w = await world();
    const r = await post(w.divine, {
      containerIds: [w.boxes[0]!.id],
      categoryId: w.cat['Shipping line'],
      date: '2026-08-04',
      currency: 'USD',
      totalMinor: 214_000,
    });
    const id = r.body.lines[0].id;
    expect(
      (await request(app).post(`/api/costs/${id}/void`).set('Cookie', w.divine).send({})).status,
    ).toBe(400);
    const v = await request(app)
      .post(`/api/costs/${id}/void`)
      .set('Cookie', w.divine)
      .send({ reason: 'entered on the wrong box' });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ status: 'VOID', voidReason: 'entered on the wrong box' });
    expect(
      (await request(app).get(`/api/containers/${w.boxes[0]!.id}/costs`).set('Cookie', w.divine))
        .body.totals.usdCents,
    ).toBe(0);
    expect(
      (await request(app).get('/api/costs?month=2026-08').set('Cookie', w.divine)).body,
    ).toHaveLength(0);
    expect(
      (await request(app).get('/api/costs?month=2026-08&all=true').set('Cookie', w.divine)).body,
    ).toHaveLength(1);
    expect(
      (
        await request(app)
          .patch(`/api/costs/${id}`)
          .set('Cookie', w.divine)
          .send({ amountMinor: 1, reason: 'nope' })
      ).status,
    ).toBe(409);
    expect(await prisma.costLine.count()).toBe(1);
    const trail = await request(app).get('/api/audit?module=costs&limit=200').set('Cookie', w.md);
    for (const a of ['category_added', 'rate_entered', 'cost_entered', 'cost_voided'])
      expect(trail.body.map((e: { action: string }) => e.action)).toContain(a);
  });
});
