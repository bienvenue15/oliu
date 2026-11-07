/**
 * Slice 6 — payments, the roadmap's runs as code:
 *  - a payment is a fixed state: requested, approved (one click; with the approver's code above the threshold),
 *    paid and locked, or rejected; nothing is paid without someone else's approval
 *  - a paid order never changes again, not even by the MD, not even by a direct database update
 *  - the same box + category + beneficiary paid twice is blocked and goes to the MD with both orders
 *  - a beneficiary's account changes only with a second person's code; meanwhile no payment uses it
 *  - a float: an advance paid to a staff member, their cash lines settled; the cash-in-hands figure drops at approval
 *  - office expenses through the same queue; who may: Finance requests and pays, the Operations Manager approves,
 *    the other side's people see nothing of this book
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
/** The newest mail to a mailbox carrying a six-digit code after "if you agree". */
const codeFor = (mailbox: string) =>
  devOutbox()
    .find((m) => m.to === mailbox && /if you agree/.test(m.text))
    ?.text.match(/if you agree: (\d{6})/)?.[1];

async function world() {
  const r = await request(app).post('/api/accounts').send(groupSetup());
  const md = await login(app, 'md@oliu.test');
  const [oliu, jivah] = await prisma.company.findMany({
    where: { accountId: r.body.accountId },
    orderBy: { createdAt: 'asc' },
  });
  const ids: Record<string, string> = {};
  for (const [name, email, role, companyId] of [
    ['Divine M.', 'divine@oliu.test', 'OPS_MANAGER', oliu!.id],
    ['Aline U.', 'aline@oliu.test', 'FINANCE_OFFICER', oliu!.id],
    ['Peace K.', 'peace@oliu.test', 'FIELD_OFFICER', oliu!.id],
    ['Samuel N.', 'samuel@jivah.test', 'OPS_MANAGER', jivah!.id],
  ] as const)
    ids[email] = (await inviteAndActivate(app, md, { name, email, role, companyId })).id;
  const divine = await login(app, 'divine@oliu.test');
  const aline = await login(app, 'aline@oliu.test');
  const peace = await login(app, 'peace@oliu.test');
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
  const cats: Record<string, string> = {};
  for (const [name, isTip] of [
    ['Clearance — Kigali', false],
    ['Border / transit', false],
    ['Office rent', false],
    ['Tip / facilitation', true],
  ] as const) {
    const c = await request(app)
      .post('/api/cost-categories')
      .set('Cookie', md)
      .send({ name, isTip });
    expect(c.status).toBe(201);
    cats[name] = c.body.id;
  }
  await request(app)
    .post('/api/rates')
    .set('Cookie', md)
    .send({ currency: 'RWF', date: '2026-01-01', perUsd: '1452' });
  await request(app)
    .post('/api/rates')
    .set('Cookie', md)
    .send({ currency: 'TZS', date: '2026-01-01', perUsd: '2608' });
  const reason = await request(app)
    .post('/api/tip-reasons')
    .set('Cookie', md)
    .send({ label: 'Checkpoint passage', sortOrder: 0 });
  return {
    md,
    divine,
    aline,
    peace,
    samuel,
    ids,
    oliu: oliu!,
    jivah: jivah!,
    booking: booking.booking as { id: string },
    boxes,
    cats,
    reasonId: reason.body.id as string,
  };
}
type World = Awaited<ReturnType<typeof world>>;

const post = (cookie: string, path: string, body: Record<string, unknown> = {}) =>
  request(app).post(path).set('Cookie', cookie).send(body);
const get = (cookie: string, path: string) => request(app).get(path).set('Cookie', cookie);

/** A cost line typed by Divine on one box, returned as the line's id. */
async function costLine(
  w: World,
  boxIndex: number,
  category: string,
  totalMinor: number,
  paidTo = '',
): Promise<string> {
  const r = await post(w.divine, '/api/costs', {
    containerIds: [w.boxes[boxIndex]!.id],
    categoryId: w.cats[category],
    date: today(),
    currency: 'RWF',
    totalMinor,
    paidTo,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.lines[0].id as string;
}

/** A beneficiary proposed by Aline and verified by Divine with her code. */
async function verifiedBeneficiary(w: World, body: Record<string, unknown>): Promise<string> {
  const b = await post(w.aline, '/api/beneficiaries', {
    accountKind: 'BANK',
    bank: 'Bank of Kigali',
    number: '00012345679032',
    currency: 'RWF',
    ...body,
  });
  expect(b.status, JSON.stringify(b.body)).toBe(201);
  expect(await post(w.divine, `/api/beneficiaries/${b.body.id}/code`)).toMatchObject({
    status: 200,
  });
  const code = codeFor('divine@oliu.test');
  expect(code).toBeTruthy();
  const c = await post(w.divine, `/api/beneficiaries/${b.body.id}/confirm`, { code });
  expect(c.status, JSON.stringify(c.body)).toBe(200);
  expect(c.body).toMatchObject({ status: 'VERIFIED', payable: true, verifiedBy: 'Divine M.' });
  return b.body.id as string;
}

describe('beneficiaries on protected accounts', () => {
  it('a new beneficiary and a change of account both wait for a second person with a code', async () => {
    const w = await world();
    const b = await post(w.aline, '/api/beneficiaries', {
      name: 'RwandaClear Agencies',
      type: 'CLEARING_AGENT',
      accountKind: 'BANK',
      bank: 'Bank of Kigali',
      number: '00012345679032',
      currency: 'RWF',
    });
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ status: 'PENDING', number: '•••• 9032', payable: false });
    // The MD adds one: verified at once, no second person (the owner's rule of 30 Oct).
    const byMd = await post(w.md, '/api/beneficiaries', {
      name: 'Magerwa Agents',
      type: 'CLEARING_AGENT',
      accountKind: 'BANK',
      bank: 'Bank of Kigali',
      number: '00012345671234',
      currency: 'RWF',
    });
    expect(byMd.status).toBe(201);
    expect(byMd.body).toMatchObject({ status: 'VERIFIED', payable: true, verifiedBy: 'Developer' });
    // Aline typed it: she does not verify it; nor may she, she lacks the permission anyway.
    expect((await post(w.aline, `/api/beneficiaries/${b.body.id}/code`)).status).toBe(403);
    // Divine asks for her code, mailed to her own mailbox, and confirms.
    expect((await post(w.divine, `/api/beneficiaries/${b.body.id}/code`)).status).toBe(200);
    const code = codeFor('divine@oliu.test')!;
    expect(
      (await post(w.divine, `/api/beneficiaries/${b.body.id}/confirm`, { code: '000000' })).status,
    ).toBe(code === '000000' ? 200 : 403);
    const ok = await post(w.divine, `/api/beneficiaries/${b.body.id}/confirm`, { code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'VERIFIED', verifiedBy: 'Divine M.', payable: true });
    expect((await post(w.divine, `/api/beneficiaries/${b.body.id}/confirm`, { code })).status).toBe(
      409,
    ); // nothing waiting

    // A change of account: proposed by Divine, so Divine cannot confirm it; the MD can.
    const ch = await post(w.divine, `/api/beneficiaries/${b.body.id}/change`, {
      accountKind: 'BANK',
      bank: 'Equity Bank',
      number: '4012201098834',
      currency: 'RWF',
      reason: 'New account on their letterhead',
    });
    expect(ch.status).toBe(200);
    expect(ch.body).toMatchObject({
      number: '•••• 9032',
      payable: false,
      pending: { bank: 'Equity Bank', number: '•••• 8834', by: 'Divine M.' },
    });
    expect((await post(w.divine, `/api/beneficiaries/${b.body.id}/code`)).status).toBe(403);
    expect((await post(w.md, `/api/beneficiaries/${b.body.id}/code`)).status).toBe(200);
    const done = await post(w.md, `/api/beneficiaries/${b.body.id}/confirm`, {
      code: codeFor('md@oliu.test'),
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({
      bank: 'Equity Bank',
      number: '•••• 8834',
      pending: null,
      payable: true,
    });
    // The trail keeps both numbers whole, forever.
    const row = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'beneficiary_account_changed' },
    });
    expect(row.before).toMatchObject({ number: '00012345679032' });
    expect(row.after).toMatchObject({ number: '4012201098834', proposedBy: 'Divine M.' });

    // The registry masks numbers; a change may be dropped; a beneficiary suspended with a reason.
    const list = await get(w.aline, '/api/beneficiaries');
    expect(list.status).toBe(200);
    expect(list.body.beneficiaries.find((x: { id: string }) => x.id === b.body.id).number).toBe(
      '•••• 8834',
    );
    await post(w.aline, `/api/beneficiaries/${b.body.id}/change`, {
      accountKind: 'MOMO',
      bank: 'MTN MoMo',
      number: '0788412077',
      currency: 'RWF',
      reason: 'typo',
    });
    expect(
      (await post(w.aline, `/api/beneficiaries/${b.body.id}/drop`, { reason: 'typed by mistake' }))
        .body.pending,
    ).toBeNull();
    expect(
      (
        await post(w.divine, `/api/beneficiaries/${b.body.id}/suspend`, {
          reason: 'Contract ended',
        })
      ).body.status,
    ).toBe('SUSPENDED');
    expect(
      (await post(w.divine, `/api/beneficiaries/${b.body.id}/reactivate`, { reason: 'Back' })).body
        .status,
    ).toBe('VERIFIED');
  });
});

describe("the roadmap's runs", () => {
  it('request, one-click approval, the code above the threshold, pay and lock', async () => {
    const w = await world();
    const agent = await verifiedBeneficiary(w, {
      name: 'RwandaClear Agencies',
      type: 'CLEARING_AGENT',
    });
    const big = await costLine(w, 0, 'Clearance — Kigali', 1_250_000, 'RwandaClear'); // ≈ USD 861
    const small = await costLine(w, 0, 'Border / transit', 25_000); // ≈ USD 17

    // Run 1: Aline requests the clearing fee; the order gets a number; its lines are now on it.
    const r = await post(w.aline, '/api/payments', {
      kind: 'COST',
      beneficiaryId: agent,
      costLineIds: [big],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      number: 'OLIU-PR-2026-0001',
      status: 'REQUESTED',
      amount: '1,250,000',
      currency: 'RWF',
      needsCode: true,
      requestedBy: 'Aline U.',
      lines: [{ containerNumber: BOXES[0], category: 'Clearance — Kigali' }],
    });
    expect(r.body.purpose).toContain('Clearance — Kigali — 1 box');
    const r2 = await post(w.aline, '/api/payments', {
      kind: 'COST',
      beneficiaryId: agent,
      costLineIds: [small],
    });
    expect(r2.body).toMatchObject({ number: 'OLIU-PR-2026-0002', needsCode: false });
    expect(
      (
        await post(w.aline, '/api/payments', {
          kind: 'COST',
          beneficiaryId: agent,
          costLineIds: [small],
        })
      ).status,
    ).toBe(409); // already on an order
    // Aline cannot approve (no permission); Divine approves the small one with one click.
    expect((await post(w.aline, `/api/payments/${r2.body.id}/approve`)).status).toBe(403);
    const a2 = await post(w.divine, `/api/payments/${r2.body.id}/approve`);
    expect(a2.status, JSON.stringify(a2.body)).toBe(200);
    expect(a2.body).toMatchObject({
      status: 'APPROVED',
      approvedBy: 'Divine M.',
      approvedWithCode: false,
    });
    // Above the threshold: one click is refused, the code arrives at Divine's mailbox, then it goes through.
    const need = await post(w.divine, `/api/payments/${r.body.id}/approve`);
    expect(need.status).toBe(400);
    expect(need.body.details).toMatchObject({ needsCode: true });
    expect((await post(w.divine, `/api/payments/${r2.body.id}/code`)).status).toBe(409); // already approved
    expect((await post(w.divine, `/api/payments/${r.body.id}/code`)).status).toBe(200);
    const code = codeFor('divine@oliu.test')!;
    expect(
      (
        await post(w.divine, `/api/payments/${r.body.id}/approve`, {
          code: code === '111111' ? '222222' : '111111',
        })
      ).status,
    ).toBe(403);
    const a1 = await post(w.divine, `/api/payments/${r.body.id}/approve`, { code });
    expect(a1.status, JSON.stringify(a1.body)).toBe(200);
    expect(a1.body).toMatchObject({ status: 'APPROVED', approvedWithCode: true });
    expect((await post(w.divine, `/api/payments/${r.body.id}/approve`, { code })).status).toBe(409);

    // Run 2: Aline pays it from a bank account of OLIU, with the transfer reference; the order locks.
    expect(
      (await post(w.aline, `/api/payments/${r.body.id}/pay`, { reference: 'BK-44012' })).status,
    ).toBe(200);
    const list = await get(w.aline, '/api/payments');
    expect(list.status).toBe(200);
    const paid = list.body.done.find((p: { id: string }) => p.id === r.body.id);
    expect(paid).toMatchObject({ status: 'PAID', paidBy: 'Aline U.', paidRef: 'BK-44012' });
    expect(paid.lockedAt).toBeTruthy();
    expect(list.body.totals).toMatchObject({ waiting: 0, toPay: 1, paidThisMonth: 1 });
    // Nothing on it changes again: not by a route, not by the MD, not by a direct update.
    expect(
      (await post(w.aline, `/api/payments/${r.body.id}/pay`, { reference: 'again' })).status,
    ).toBe(409);
    expect(
      (await post(w.md, `/api/payments/${r.body.id}/reject`, { reason: 'changed my mind' })).status,
    ).toBe(409);
    await expect(
      prisma.paymentRequest.update({ where: { id: r.body.id }, data: { paidRef: 'tampered' } }),
    ).rejects.toThrow(/locked/);
    // The container record shows the line as paid, by order number.
    const rec = await get(w.divine, `/api/containers/${w.boxes[0]!.id}/costs`);
    expect(rec.body.lines.find((l: { id: string }) => l.id === big).payment).toEqual({
      number: 'OLIU-PR-2026-0001',
      status: 'PAID',
    });
    // Nothing is paid without an approval: a requested order cannot be paid.
    const r3 = await post(w.aline, '/api/payments', {
      kind: 'COST',
      beneficiaryId: agent,
      costLineIds: [await costLine(w, 1, 'Border / transit', 25_000)],
    });
    expect(
      (await post(w.aline, `/api/payments/${r3.body.id}/pay`, { reference: 'xx' })).status,
    ).toBe(409);
    // Rejected with a reason: the line is free to be requested again.
    const rej = await post(w.divine, `/api/payments/${r3.body.id}/reject`, {
      reason: 'Wrong beneficiary',
    });
    expect(rej.body).toMatchObject({ status: 'REJECTED', rejectReason: 'Wrong beneficiary' });
    expect(
      (await prisma.costLine.findUniqueOrThrow({ where: { id: r3.body.lines[0].id } })).paymentId,
    ).toBeNull();
  });

  it('the same box, fee and payee again is blocked and goes to the MD with both orders', async () => {
    const w = await world();
    const agent = await verifiedBeneficiary(w, { name: 'Magerwa Agents', type: 'CLEARING_AGENT' });
    const first = await costLine(w, 0, 'Clearance — Kigali', 210_000);
    const p1 = await post(w.aline, '/api/payments', {
      kind: 'COST',
      beneficiaryId: agent,
      costLineIds: [first],
    });
    expect(p1.status).toBe(201);
    await post(w.divine, `/api/payments/${p1.body.id}/approve`);
    expect(
      (await post(w.aline, `/api/payments/${p1.body.id}/pay`, { reference: 'MoMo-7718-21' }))
        .status,
    ).toBe(200);

    // Run 3: the fee is typed again on the same box, and requested to the same payee.
    const again = await costLine(w, 0, 'Clearance — Kigali', 210_000);
    const p2 = await post(w.aline, '/api/payments', {
      kind: 'COST',
      beneficiaryId: agent,
      costLineIds: [again],
    });
    expect(p2.status).toBe(201);
    expect(p2.body).toMatchObject({
      status: 'BLOCKED',
      blocked: { existingNumber: 'OLIU-PR-2026-0001' },
    });
    expect((await post(w.divine, `/api/payments/${p2.body.id}/approve`)).status).toBe(409);
    const queue = await get(w.md, '/api/md-queue');
    const item = queue.body.find((i: { kind: string }) => i.kind === 'REPEAT_PAYMENT');
    expect(item.summary).toMatchObject({
      number: 'OLIU-PR-2026-0002',
      existingNumber: 'OLIU-PR-2026-0001',
      box: BOXES[0],
      category: 'Clearance — Kigali',
      beneficiary: 'Magerwa Agents',
    });
    // The MD refuses it: rejected, the line is free; the same box to another payee is not a repeat.
    expect(
      (await post(w.md, `/api/md-queue/${item.id}/resolve`, { resolution: 'REFUSE' })).status,
    ).toBe(400);
    expect(
      (
        await post(w.md, `/api/md-queue/${item.id}/resolve`, {
          resolution: 'REFUSE',
          reason: 'Paid on 21 Aug',
        })
      ).status,
    ).toBe(200);
    expect(
      await prisma.paymentRequest.findUniqueOrThrow({ where: { id: p2.body.id } }),
    ).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'Refused by the MD: Paid on 21 Aug',
    });
    const other = await verifiedBeneficiary(w, {
      name: 'RwandaClear Agencies',
      type: 'CLEARING_AGENT',
    });
    const p3 = await post(w.aline, '/api/payments', {
      kind: 'COST',
      beneficiaryId: other,
      costLineIds: [again],
    });
    expect(p3.body.status).toBe('REQUESTED');
    // …and a genuine repeat the MD allows goes on to approval.
    const third = await costLine(w, 0, 'Clearance — Kigali', 50_000);
    const p4 = await post(w.aline, '/api/payments', {
      kind: 'COST',
      beneficiaryId: agent,
      costLineIds: [third],
    });
    expect(p4.body.status).toBe('BLOCKED');
    const item2 = (await get(w.md, '/api/md-queue')).body.find(
      (i: { entityId: string }) => i.entityId === p4.body.id,
    );
    expect(
      (
        await post(w.md, `/api/md-queue/${item2.id}/resolve`, {
          resolution: 'ALLOW',
          reason: 'Second lot, same box',
        })
      ).status,
    ).toBe(200);
    expect((await post(w.divine, `/api/payments/${p4.body.id}/approve`)).body.status).toBe(
      'APPROVED',
    );
  });

  it("a beneficiary's pending change stops every payment to it until a second person confirms", async () => {
    const w = await world();
    const agent = await verifiedBeneficiary(w, {
      name: 'DarPort Clearing Co',
      type: 'CLEARING_AGENT',
    });
    const line = await costLine(w, 0, 'Border / transit', 25_000);
    const p = await post(w.aline, '/api/payments', {
      kind: 'COST',
      beneficiaryId: agent,
      costLineIds: [line],
    });
    // Run 4: Aline proposes a new account number; approving and paying now wait.
    await post(w.aline, `/api/beneficiaries/${agent}/change`, {
      accountKind: 'BANK',
      bank: 'NMB',
      number: '20110008834',
      currency: 'TZS',
      reason: 'Letter of 21 Aug',
    });
    const a = await post(w.divine, `/api/payments/${p.body.id}/approve`);
    expect(a.status).toBe(409);
    expect(a.body.error).toMatch(/awaits a second approval/);
    expect((await get(w.aline, '/api/payments')).body.open[0].beneficiary.hold).toMatch(
      /second approval/,
    );
    // Divine confirms with her code; the payment goes through on the new account.
    await post(w.divine, `/api/beneficiaries/${agent}/code`);
    expect(
      (
        await post(w.divine, `/api/beneficiaries/${agent}/confirm`, {
          code: codeFor('divine@oliu.test'),
        })
      ).body.number,
    ).toBe('•••• 8834');
    expect((await post(w.divine, `/api/payments/${p.body.id}/approve`)).body.status).toBe(
      'APPROVED',
    );
    // A new beneficiary nobody verified yet can be requested, not approved.
    const fresh = await post(w.aline, '/api/beneficiaries', {
      name: 'Kilimo Trucks',
      type: 'TRANSPORTER',
      accountKind: 'BANK',
      bank: 'CRDB',
      number: '0150004471',
      currency: 'TZS',
    });
    const p2 = await post(w.aline, '/api/payments', {
      kind: 'COST',
      beneficiaryId: fresh.body.id,
      costLineIds: [await costLine(w, 1, 'Border / transit', 25_000)],
    });
    expect(p2.status).toBe(201);
    expect((await post(w.divine, `/api/payments/${p2.body.id}/approve`)).body.error).toMatch(
      /not yet verified/,
    );
  });

  it('a float: the advance is paid, the cash lines are settled, the figure drops at approval', async () => {
    const w = await world();
    const peace = await verifiedBeneficiary(w, {
      name: 'Peace K. (float)',
      type: 'STAFF',
      userId: w.ids['peace@oliu.test'],
      accountKind: 'MOMO',
      bank: 'MTN MoMo',
      number: '0788412077',
    });
    const agent = await verifiedBeneficiary(w, {
      name: 'RwandaClear Agencies',
      type: 'CLEARING_AGENT',
    });
    // Only a staff beneficiary holds a float.
    expect(
      (
        await post(w.aline, '/api/payments', {
          kind: 'FLOAT_ADVANCE',
          beneficiaryId: agent,
          currency: 'RWF',
          amountMinor: 200_000,
        })
      ).status,
    ).toBe(400);
    const adv = await post(w.aline, '/api/payments', {
      kind: 'FLOAT_ADVANCE',
      beneficiaryId: peace,
      currency: 'RWF',
      amountMinor: 200_000,
    });
    expect(adv.status, JSON.stringify(adv.body)).toBe(201);
    expect(adv.body).toMatchObject({
      kind: 'FLOAT_ADVANCE',
      purpose: 'Float advance to Peace K. (float)',
      usd: '137.74',
    });
    await post(w.divine, `/api/payments/${adv.body.id}/approve`);
    expect((await get(w.aline, '/api/payments')).body.floats).toEqual([]); // not paid yet
    await post(w.aline, `/api/payments/${adv.body.id}/pay`, { reference: 'MoMo-0788-01' });
    expect((await get(w.aline, '/api/payments')).body.floats).toEqual([
      expect.objectContaining({
        holder: 'Peace K.',
        currency: 'RWF',
        advanced: '200,000',
        settled: '0',
        inHand: '200,000',
      }),
    ]);

    // Peace pays a tip from the float; Divine requests the settlement; the MD approves it; the figure drops at once.
    const tip = await post(w.peace, '/api/tips', {
      clientId: randomUUID(),
      currency: 'RWF',
      containerIds: [w.boxes[0]!.id],
      reasonId: w.reasonId,
      totalMinor: 20_000,
    });
    expect(tip.status, JSON.stringify(tip.body)).toBe(201);
    const cands = await get(w.divine, `/api/payments/candidates?holderId=${peace}`);
    expect(cands.body).toHaveLength(1);
    expect(cands.body[0]).toMatchObject({ category: 'Tip / facilitation', amount: '20,000' });
    // A line Divine typed is not Peace's cash: refused in a settlement.
    const notHers = await costLine(w, 1, 'Border / transit', 25_000);
    expect(
      (
        await post(w.divine, '/api/payments', {
          kind: 'SETTLEMENT',
          beneficiaryId: peace,
          costLineIds: [notHers],
        })
      ).status,
    ).toBe(400);
    const set = await post(w.divine, '/api/payments', {
      kind: 'SETTLEMENT',
      beneficiaryId: peace,
      costLineIds: [cands.body[0].id],
    });
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    expect(set.body).toMatchObject({ kind: 'SETTLEMENT', status: 'REQUESTED', amount: '20,000' });
    expect((await post(w.divine, `/api/payments/${set.body.id}/approve`)).status).toBe(403); // she requested it
    const ok = await post(w.md, `/api/payments/${set.body.id}/approve`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'PAID', paidRef: 'FLOAT', paidBy: 'Developer' });
    expect((await get(w.aline, '/api/payments')).body.floats[0]).toMatchObject({
      settled: '20,000',
      inHand: '180,000',
    });
  });

  it('an office expense goes through the same queue, and its repeat is blocked too', async () => {
    const w = await world();
    const landlord = await verifiedBeneficiary(w, { name: 'Mzizima Properties', type: 'SUPPLIER' });
    const body = {
      kind: 'EXPENSE',
      beneficiaryId: landlord,
      categoryId: w.cats['Office rent'],
      currency: 'RWF',
      amountMinor: 1_200_000,
      date: '2026-10-01',
      purpose: 'Office rent — Kigali (October)',
    };
    const e = await post(w.aline, '/api/payments', body);
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    expect(e.body).toMatchObject({
      kind: 'EXPENSE',
      category: 'Office rent',
      usd: '826.45',
      needsCode: true,
      lines: [],
    });
    const twice = await post(w.aline, '/api/payments', body);
    expect(twice.body).toMatchObject({
      status: 'BLOCKED',
      blocked: { existingNumber: e.body.number },
    });
    // The MD moves the threshold; the rent now needs one click only.
    expect(
      (
        await request(app)
          .patch('/api/settings')
          .set('Cookie', w.divine)
          .send({ approvalThresholdUsdCents: 100_000 })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch('/api/settings')
          .set('Cookie', w.md)
          .send({ approvalThresholdUsdCents: 100_000 })
      ).status,
    ).toBe(200);
    expect((await post(w.divine, `/api/payments/${e.body.id}/approve`)).body).toMatchObject({
      status: 'APPROVED',
      approvedWithCode: false,
    });
  });

  it('who may: Finance requests and pays, the Operations Manager approves, the other side sees nothing', async () => {
    const w = await world();
    const agent = await verifiedBeneficiary(w, {
      name: 'RwandaClear Agencies',
      type: 'CLEARING_AGENT',
    });
    const p = await post(w.aline, '/api/payments', {
      kind: 'COST',
      beneficiaryId: agent,
      costLineIds: [await costLine(w, 0, 'Border / transit', 25_000)],
    });
    // Peace (Field Officer) has no payments screen at all; Samuel (JIVAH) sees OLIU's book empty and may not touch it.
    expect((await get(w.peace, '/api/payments')).status).toBe(403);
    expect((await get(w.peace, '/api/beneficiaries')).status).toBe(403);
    expect((await get(w.samuel, '/api/payments')).body.open).toEqual([]);
    expect((await post(w.samuel, `/api/payments/${p.body.id}/approve`)).status).toBe(403);
    expect(
      (
        await post(w.samuel, '/api/payments', {
          kind: 'COST',
          beneficiaryId: agent,
          costLineIds: [p.body.lines[0].id],
        })
      ).status,
    ).toBe(403);
    // Divine (approve) cannot pay; Aline (pay) cannot approve; the MD with the switcher does both.
    await post(w.divine, `/api/payments/${p.body.id}/approve`);
    expect(
      (await post(w.divine, `/api/payments/${p.body.id}/pay`, { reference: 'xx' })).status,
    ).toBe(403);
    const paid = await request(app)
      .post(`/api/payments/${p.body.id}/pay`)
      .set('Cookie', w.md)
      .set('X-Company', w.oliu.id)
      .send({ reference: 'TT-88144' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    // The beneficiary registry is the account's: Samuel reads it, and may propose for JIVAH's payees.
    expect((await get(w.samuel, '/api/beneficiaries')).body.beneficiaries).toHaveLength(1);
    // The trail: every step is a row, with who and when.
    const actions = (
      await prisma.auditEvent.findMany({ where: { module: 'payments' }, orderBy: { at: 'asc' } })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'beneficiary_proposed',
        'beneficiary_code_sent',
        'beneficiary_verified',
        'payment_requested',
        'payment_approved',
        'payment_paid_locked',
      ]),
    );
  });
});

describe('the bell', () => {
  it('counts what waits for this person only, scoped like the screens', async () => {
    const w = await world();
    const agent = await verifiedBeneficiary(w, {
      name: 'RwandaClear Agencies',
      type: 'CLEARING_AGENT',
    });
    const p = await post(w.aline, '/api/payments', {
      kind: 'COST',
      beneficiaryId: agent,
      costLineIds: [await costLine(w, 0, 'Border / transit', 25_000)],
    });
    expect(p.status).toBe(201);
    await post(w.aline, '/api/beneficiaries', {
      name: 'Kilimo Trucks',
      type: 'TRANSPORTER',
      accountKind: 'BANK',
      bank: 'CRDB',
      number: '0150004471',
      currency: 'TZS',
    });
    // Divine approves and confirms: both wait for her. Aline requested and proposed: neither waits for her.
    const divine = (await get(w.divine, '/api/alerts')).body;
    expect(divine.items.map((a: { kind: string; count: number }) => [a.kind, a.count])).toEqual(
      expect.arrayContaining([
        ['TO_APPROVE', 1],
        ['BENEFICIARY_TO_CONFIRM', 1],
      ]),
    );
    const aline = (await get(w.aline, '/api/alerts')).body;
    expect(aline.items.map((a: { kind: string }) => a.kind)).not.toContain('TO_APPROVE');
    expect(aline.items.map((a: { kind: string }) => a.kind)).not.toContain(
      'BENEFICIARY_TO_CONFIRM',
    );
    // Once approved, it waits for the one who pays; JIVAH's manager sees nothing of OLIU's book.
    await post(w.divine, `/api/payments/${p.body.id}/approve`);
    expect((await get(w.aline, '/api/alerts')).body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'TO_PAY', count: 1, to: '/app/cashier' }),
      ]),
    );
    // JIVAH's manager sees nothing of OLIU's book; the beneficiary registry is shared, so that one he may confirm.
    const samuel = (await get(w.samuel, '/api/alerts')).body;
    expect(samuel.items.map((a: { kind: string }) => a.kind)).toEqual(['BENEFICIARY_TO_CONFIRM']);
    // A held box on the road counts for whoever may see the board on that side.
    await post(w.divine, `/api/containers/${w.boxes[0]!.id}/journey`, {
      kind: 'REACHED',
      stage: 'TRANSPORT',
    });
    await post(w.divine, `/api/containers/${w.boxes[0]!.id}/journey`, {
      kind: 'HELD',
      place: 'Kayonza',
      note: 'papers missing',
    });
    expect((await get(w.divine, '/api/alerts')).body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'HELD', count: 1 })]),
    );
    // Peace opens the board too, so the held box is hers to see; no payments for her.
    expect(
      (await get(w.peace, '/api/alerts')).body.items.map((a: { kind: string }) => a.kind),
    ).toEqual(['HELD']);
  });
});
