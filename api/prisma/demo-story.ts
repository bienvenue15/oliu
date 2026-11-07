/**
 * The demo story — the OLIU · JIVAH account as it stands on the day it is seeded.
 *
 * Everything here is typed through the API in-process, signed in as the person who would type it, so file
 * numbers, audit rows, hand-overs, at-risk spells and the MD's rulings are the real thing, not rows inserted by
 * hand. Dates are relative to the day of seeding so the picture stays fresh whenever it is rebuilt.
 * The plan in plain language: docs/slices/00-demo-data.md.
 *
 *   Lot A   DAR600233400   Space Mining, 12 real boxes, KOTA SETIA   shipped, released, on vessel, closed, billed
 *   Lot B   DAR600210600   Transvera, 6 real boxes, same vessel      5 closed · 1 rolled to sister DAR600210600A, on vessel
 *   Lot C   DAR600258700   Space Mining, 8 boxes, live               one box in every state the screens know
 *   D       HLCUKGL2608514 Transvera                                 cancelled, with a reason
 *   E       259114882      Transvera                                 pending, 4 boxes expected, no numbers yet
 *   F       CMDU4471023    Space Mining                              one box typed twice → the MD's duplicate ruling
 */
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { checkContainerNumber, containerCheckDigit } from '@oliu/shared';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { logger } from '../src/lib/logger.ts';
import { devOutbox } from '../src/lib/mail.ts';

export const DEMO_PASSWORD = 'demo';

// ---------------------------------------------------------------- dates, relative to the day of seeding

const DAY_MS = 86_400_000;
const now = new Date();
const T0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
/** The calendar day n days from today (n ≤ 0 for the past), as the forms type it. */
const day = (n: number) => new Date(T0 + n * DAY_MS).toISOString().slice(0, 10);
/** A moment on that day; never "today with a time", which could still be in the future. */
const at = (n: number, hhmm: string) => `${day(n)}T${hhmm}`;
const hh = (h: number) => `${String(h).padStart(2, '0')}:${String((h * 7) % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------- the people and the boxes

const OLIU_MAIL = 'oliulogistics.rw';
const JIVAH_MAIL = 'jivahlogistics.co.tz';
export const PEOPLE = {
  janvier: { email: `developer@${OLIU_MAIL}`, mailbox: `management@${OLIU_MAIL}` },
  belise: { email: `belise.s@${OLIU_MAIL}`, mailbox: `ops@${OLIU_MAIL}` },
  liliose: { email: `liliose.k@${OLIU_MAIL}`, mailbox: `finance@${OLIU_MAIL}` },
  jean: { email: `jean.k@${OLIU_MAIL}`, mailbox: `transport@${OLIU_MAIL}` },
  eudes: { email: `eudes.n@${OLIU_MAIL}`, mailbox: `ops@${OLIU_MAIL}` },
  samuel: { email: `samuel.n@${JIVAH_MAIL}`, mailbox: `ops@${JIVAH_MAIL}` },
  joseph: { email: `joseph.m@${JIVAH_MAIL}`, mailbox: `transport@${JIVAH_MAIL}` },
  amina: { email: `amina.h@${JIVAH_MAIL}`, mailbox: `ops@${JIVAH_MAIL}` },
  baraka: { email: `baraka.j@${JIVAH_MAIL}`, mailbox: `ops@${JIVAH_MAIL}` },
} as const;

/** A valid ISO 6346 number from an owner code and six digits; the check digit is computed, never guessed. */
const box = (ownerAndSerial: string) => ownerAndSerial + containerCheckDigit(ownerAndSerial);

/** The twelve boxes of invoice KGLDAR03102026 (Space Mining, 3 Oct 2026), as printed. */
export const LOT_A = [
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
/** The six boxes of invoice KGLDAR04102026 (Transvera, 4 Oct 2026). */
export const LOT_B = [
  ['PCIU0016178', 'SFN/LIS/002/RH/SEP-26'],
  ['PCIU1809371', 'SFN/LIS/001/RH/SEP-26'],
  ['PCIU1619134', 'SFN/LIS/004/RH/SEP-26'],
  ['PIDU2026877', 'SFN/LIS/003/RH/SEP-26'],
  ['PCIU2892210', 'SFN/LIS/006/RH/SEP-26'],
  ['GCXU5178913', 'SFN/LIS/005/RH/SEP-26'],
] as const;
/** The live lot: numbers made for the demo (valid check digits), one box per state. */
export const LOT_C = [
  [box('PCIU203311'), 'SM/AB/2026-10A-001', null], // booked, numbers known, not loaded
  [box('PIDU311002'), 'SM/AB/2026-10A-002', 25_400], // on the road, overdue, truck broke down
  [box('FFAU801455'), 'SM/AB/2026-10A-003', 26_100], // held at Magerwa
  [box('GLDU906912'), 'SM/AB/2026-10A-004', 24_800], // crossed, then returned from Rusumo
  [box('HPCU474820'), 'SM/AB/2026-10A-005', 24_000], // crossed yesterday, fresh position
  [box('PCIU915606'), 'SM/AB/2026-10A-006', 26_500], // in transit, Tanzania, overdue
  [box('GCXU510733'), 'SM/AB/2026-10A-007', 25_200], // at the ICD past its free days
  [box('PIDU454619'), 'SM/AB/2026-10A-008', 27_300], // at the port, waiting for release
] as const;
export const LOT_F_OWN_BOX = box('CMAU310977');
export const LIVE_REFERENCE = 'DAR600258700';

// ---------------------------------------------------------------- a small typist: sign in, call, fail loudly

type App = ReturnType<typeof createApp>;
type Actor = { name: string; cookie: string };
type Method = 'get' | 'post' | 'patch';

class Typist {
  constructor(private readonly app: App) {}

  async signIn(who: { email: string; mailbox: string }): Promise<Actor> {
    const r1 = await request(this.app)
      .post('/api/auth/login')
      .send({ email: who.email, password: DEMO_PASSWORD });
    if (r1.status !== 200) throw new Error(`login ${who.email}: ${r1.status} ${r1.text}`);
    const mail = devOutbox().find(
      (m) => m.to === who.mailbox && m.subject.startsWith('OLIU one-time code'),
    );
    const code = mail?.text.match(/: (\d{6})/)?.[1];
    if (!code) throw new Error(`no one-time code mailed to ${who.mailbox}`);
    const r2 = await request(this.app)
      .post('/api/auth/otp')
      .send({ challengeId: r1.body.challengeId, code });
    const cookie = r2.headers['set-cookie']?.[0]?.split(';')[0];
    if (r2.status !== 200 || !cookie) throw new Error(`otp ${who.email}: ${r2.status} ${r2.text}`);
    return { name: who.email.split('@')[0]!, cookie };
  }

  /** One call as one person; a company id sets the MD's switcher. Any refusal stops the seed with its words. */
  async call<T = unknown>(
    who: Actor,
    method: Method,
    path: string,
    body?: Record<string, unknown>,
    company?: string,
  ): Promise<T> {
    let req = request(this.app)[method](path).set('Cookie', who.cookie);
    if (company) req = req.set('X-Company', company);
    const res = await (body === undefined ? req : req.send(body));
    if (res.status >= 400)
      throw new Error(`${who.name}: ${method.toUpperCase()} ${path} → ${res.status} ${res.text}`);
    return res.body as T;
  }

  /** The MD's six-digit code for a tip past the ceiling, read from the outbox as the MD would read it. */
  mdCode(): string {
    const mail = devOutbox().find((m) => m.subject.includes('asks your code for a tip'));
    const code = mail?.text.match(/Your code, if you agree: (\d{6})/)?.[1];
    if (!code) throw new Error("the MD's code was not mailed");
    return code;
  }
}

// ---------------------------------------------------------------- the story

export interface StoryReport {
  bookings: number;
  containers: number;
  costLines: number;
  tips: number;
  journeyEvents: number;
  mdQueueOpen: number;
  beneficiaries: number;
  payments: number;
}

type Placed = { id: string; number: string };
type Lot = readonly (readonly [string, string] | readonly [string, string, number | null])[];

/**
 * Plays the whole story on the demo account. Needs the account, its people and the reference data (lines,
 * clients, categories, reasons) in place; writes nothing by hand.
 */
export async function playDemoStory(opts: { quiet?: boolean } = {}): Promise<StoryReport> {
  for (const [n] of [...LOT_A, ...LOT_B, ...LOT_C, [LOT_F_OWN_BOX, '']]) {
    const c = checkContainerNumber(n);
    if (!c.ok) throw new Error(`demo box ${n}: ${c.reason}`);
  }
  logger.level = 'silent'; // the request log is noise here; --verbose prints the story's own lines instead
  const app = createApp();
  const t = new Typist(app);
  const say = (s: string) => {
    if (!opts.quiet) console.log(`  ${s}`);
  };

  const account = await prisma.account.findFirstOrThrow({ where: { name: 'OLIU · JIVAH' } });

  const janvier = await t.signIn(PEOPLE.janvier);
  const belise = await t.signIn(PEOPLE.belise);
  const liliose = await t.signIn(PEOPLE.liliose);
  const jean = await t.signIn(PEOPLE.jean);
  const eudes = await t.signIn(PEOPLE.eudes);
  const samuel = await t.signIn(PEOPLE.samuel);
  const joseph = await t.signIn(PEOPLE.joseph);
  const amina = await t.signIn(PEOPLE.amina);
  const baraka = await t.signIn(PEOPLE.baraka);
  say('nine people signed in');

  // ---- reference lists, by id
  const lines = new Map<string, string>(
    (await t.call<{ id: string; name: string }[]>(janvier, 'get', '/api/shipping-lines')).map(
      (l) => [l.name, l.id],
    ),
  );
  const clients = new Map<string, string>(
    (await t.call<{ id: string; name: string }[]>(janvier, 'get', '/api/clients')).map((c) => [
      c.name,
      c.id,
    ]),
  );
  const cat = new Map<string, string>(
    (await t.call<{ id: string; name: string }[]>(janvier, 'get', '/api/cost-categories')).map(
      (c) => [c.name, c.id],
    ),
  );
  const reason = new Map<string, string>(
    (await t.call<{ id: string; label: string }[]>(janvier, 'get', '/api/tip-reasons')).map((r) => [
      r.label,
      r.id,
    ]),
  );
  const need = (m: Map<string, string>, k: string) => {
    const v = m.get(k);
    if (!v) throw new Error(`reference data missing: ${k}`);
    return v;
  };

  // ---- the day's rates: Liliose types one a week, plus the four August days of the mockup record
  for (let w = 9; w >= 0; w--) {
    await t.call(liliose, 'post', '/api/rates', {
      currency: 'RWF',
      date: day(-7 * w),
      perUsd: String(1452 - w),
    });
    await t.call(liliose, 'post', '/api/rates', {
      currency: 'TZS',
      date: day(-7 * w),
      perUsd: String(2608 - w),
    });
  }
  for (const [currency, date, perUsd] of [
    ['TZS', '2026-08-09', '2605'],
    ['TZS', '2026-08-11', '2608'],
    ['RWF', '2026-08-14', '1452'],
    ['TZS', '2026-08-24', '2610'],
  ])
    await t.call(liliose, 'post', '/api/rates', { currency, date, perUsd });
  say('rates typed: ten weeks of RWF and TZS, and the four August days');

  // ---- helpers that read like the screens
  const PIL = need(lines, 'PIL');
  const cost = (who: Actor, body: Record<string, unknown>) =>
    t.call(who, 'post', '/api/costs', { method: 'EQUAL', ...body });
  const move = (
    who: Actor,
    c: Placed,
    stage: string,
    happenedAt: string | null,
    place = '',
    extra: Record<string, unknown> = {},
  ) =>
    t.call(who, 'post', `/api/containers/${c.id}/journey`, {
      kind: 'REACHED',
      stage,
      place,
      happenedAt,
      ...extra,
    });
  const position = (who: Actor, c: Placed, place: string, happenedAt: string | null) =>
    t.call(who, 'post', `/api/containers/${c.id}/journey`, { kind: 'UPDATE', place, happenedAt });
  /** The phone makes the clientId before saving; here it is made for it. */
  function tip<T = unknown>(who: Actor, body: Record<string, unknown>) {
    return t.call<T>(who, 'post', '/api/tips', { clientId: randomUUID(), ...body });
  }
  const weigh = (c: Placed, weightKg: number | null) =>
    t.call(belise, 'patch', `/api/containers/${c.id}`, { weightKg });
  function chunk<X>(xs: X[], n: number): X[][] {
    const out: X[][] = [];
    for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
    return out;
  }
  const ids = (cs: Placed[]) => cs.map((c) => c.id);
  type BookingAnswer = { booking: { id: string; fileNumber: string }; containers: Placed[] };

  // ---- lots A and B: shipped on KOTA SETIA, the two October invoices
  async function shippedLot(p: {
    reference: string;
    client: string;
    cargo: string;
    destination: string;
    pod: string;
    lot: Lot;
    loadedDay: number;
    invoice: string;
    rolled?: number;
  }): Promise<BookingAnswer> {
    const b = await t.call<BookingAnswer>(belise, 'post', '/api/bookings', {
      shippingLineId: PIL,
      reference: p.reference,
      clientId: need(clients, p.client),
      cargo: p.cargo,
      status: 'CONFIRMED',
      confirmedOn: day(p.loadedDay - 4),
      destination: p.destination,
      vessel: 'KOTA SETIA',
      voyage: '0126E',
      pol: 'Dar es Salaam',
      pod: p.pod,
      etd: day(-11),
      eta: day(24),
      blNumber: p.reference,
      containers: p.lot.map(([number, lot]) => ({ number, size: '40FT', lot })),
    });
    const boxes = b.containers;
    for (const [i, c] of boxes.entries()) await weigh(c, 24_600 + ((i * 731) % 2_900));
    const L = p.loadedDay;

    // Kigali side, OLIU's book: clearance for the lot, one truck invoice per three boxes, the border fees.
    await cost(belise, {
      containerIds: ids(boxes),
      categoryId: need(cat, 'Clearance — Kigali'),
      date: day(L - 1),
      currency: 'RWF',
      totalMinor: 331_000 * boxes.length,
      paidTo: 'RwandaClear',
      reference: `RC-2026-${p.reference.slice(-4)}`,
      note: 'Export clearance, whole lot',
    });
    for (const [i, truck] of chunk(boxes, 3).entries())
      await cost(belise, {
        containerIds: ids(truck),
        categoryId: need(cat, 'Inland transport'),
        date: day(L),
        currency: 'RWF',
        totalMinor: 1_909_000,
        paidTo: 'Simba Haulage',
        reference: `SH-${p.reference.slice(-3)}-${i + 1}`,
        note: `Truck ${i + 1}, Kigali–Dar`,
      });
    await cost(jean, {
      containerIds: ids(boxes),
      categoryId: need(cat, 'Border / transit'),
      date: day(L + 2),
      currency: 'RWF',
      totalMinor: 25_000 * boxes.length,
      paidTo: 'Rusumo OSBP',
      note: 'Road toll and parking at the border',
    });
    await tip(eudes, {
      containerIds: [boxes[2]!.id],
      reasonId: need(reason, 'Checkpoint passage'),
      currency: 'RWF',
      totalMinor: 10_000,
      date: day(L + 1),
      payeeType: 'OFFICIAL',
      payeeId: '0788 203 114',
      checkpoint: 'Kayonza',
    });

    // The journey: Jean to the border, Joseph in Tanzania, Samuel at the port and the closing.
    for (const [i, c] of boxes.entries()) {
      const h = 6 + (i % 6);
      await move(jean, c, 'TRANSPORT', at(L, hh(h)), 'Loaded, Kigali');
      await move(jean, c, 'FIELD_RELEASE', at(L + 1, hh(h + 1)), 'Magerwa, Kigali');
      await position(jean, c, 'Kayonza', at(L + 2, hh(h)));
      await move(jean, c, 'RUSUMO', at(L + 2, hh(h + 8)), 'Rusumo OSBP');
      await move(joseph, c, 'CHECKPOINTS', at(L + 3, hh(h)), 'Nzega');
      await position(joseph, c, 'Morogoro', at(L + 4, hh(h + 2)));
      await move(joseph, c, 'ICD', at(L + 6, hh(h)), 'AZAM ICD, Dar es Salaam');
    }
    // Dar side, JIVAH's book, while the boxes sit at the ICD: clearance, handling, then the storage of the delay.
    await cost(samuel, {
      containerIds: ids(boxes),
      categoryId: need(cat, 'Clearance — Dar'),
      date: day(L + 8),
      currency: 'TZS',
      totalMinor: 1_250_000 * boxes.length,
      paidTo: 'DarPort Clearing',
      reference: `DPC/${p.reference.slice(-5)}`,
    });
    await cost(samuel, {
      containerIds: ids(boxes),
      categoryId: need(cat, 'ICD / port charges'),
      date: day(L + 9),
      currency: 'TZS',
      totalMinor: 640_000 * boxes.length,
      paidTo: 'AZAM ICD',
      note: 'Handling and lift-on',
    });
    await cost(samuel, {
      containerIds: ids(boxes),
      categoryId: need(cat, 'Storage / demurrage'),
      date: day(L + 13),
      currency: 'TZS',
      totalMinor: 180_000 * boxes.length,
      paidTo: 'AZAM ICD',
      note: 'Storage past the free days, waiting for the vessel',
    });
    await tip(amina, {
      containerIds: [boxes[boxes.length - 1]!.id],
      reasonId: need(reason, 'Weighing / iminzani'),
      currency: 'TZS',
      totalMinor: 10_000,
      date: day(L + 3),
      payeeType: 'OFFICIAL',
      payeeId: 'Nzega weighbridge',
      checkpoint: 'Nzega',
    });
    await tip(baraka, {
      containerIds: ids(boxes.slice(0, 2)),
      reasonId: need(reason, 'Expediting'),
      currency: 'TZS',
      totalMinor: 15_000,
      date: day(L + 10),
      payeeType: 'AGENT',
      payeeId: 'Hamisi K.',
      checkpoint: 'AZAM ICD',
    });
    for (const [i, c] of boxes.entries())
      await move(joseph, c, 'PORT', at(L + 16, hh(7 + (i % 5))), 'TPA, Dar es Salaam port');

    const sailing = boxes.filter((_, i) => i !== p.rolled);
    await cost(samuel, {
      containerIds: ids(sailing),
      categoryId: need(cat, 'Shipping line'),
      date: day(L + 18),
      currency: 'USD',
      totalMinor: 185_000 * sailing.length,
      paidTo: 'PIL Tanzania',
      reference: `PIL/INV/${p.reference}`,
      note: 'Ocean freight to ' + p.pod,
    });
    await t.call(samuel, 'post', `/api/bookings/${b.booking.id}/release`, {
      containerIds: ids(sailing),
      releasedOn: day(-14),
      note: 'PIL accepted the boxes for KOTA SETIA',
    });
    for (const c of sailing)
      await move(joseph, c, 'OCEAN_FREIGHT', at(-11, '18:40'), 'KOTA SETIA', {
        departedOn: day(-11),
      });
    for (const c of sailing)
      await t.call(samuel, 'post', `/api/containers/${c.id}/close`, {
        closedOn: day(-9),
        readyToInvoice: true,
        note: `Billed on ${p.invoice}`,
      });
    await t.call(belise, 'post', `/api/bookings/${b.booking.id}/comments`, {
      text: `Invoice ${p.invoice} raised for the ${sailing.length} boxes on KOTA SETIA.`,
    });
    return b;
  }

  const lotA = await shippedLot({
    reference: 'DAR600233400',
    client: 'Space Mining',
    cargo: 'TANTALITE',
    destination: 'Ningbo, China',
    pod: 'Ningbo',
    lot: LOT_A,
    loadedDay: -36,
    invoice: 'KGLDAR03102026',
  });
  say(`lot A ${lotA.booking.fileNumber} DAR600233400: 12 boxes shipped and closed`);

  const lotB = await shippedLot({
    reference: 'DAR600210600',
    client: 'Transvera',
    cargo: 'CASSITERITE',
    destination: 'Shanghai, China',
    pod: 'Shanghai',
    lot: LOT_B,
    loadedDay: -35,
    invoice: 'KGLDAR04102026',
    rolled: 5,
  });
  // PIL rolled the last box to the next sailing. It is on JIVAH's side, so the MD opens the sister booking.
  const rolled = lotB.containers[5]!;
  const sister = await t.call<{ id: string; fileNumber: string; reference: string }>(
    janvier,
    'post',
    `/api/bookings/${lotB.booking.id}/sister`,
    { reference: 'DAR600210600A', containerIds: [rolled.id] },
  );
  await t.call(belise, 'patch', `/api/bookings/${sister.id}`, {
    vessel: 'KOTA NABIL',
    voyage: '0131E',
    etd: day(-1),
    eta: day(34),
  });
  await cost(samuel, {
    containerIds: [rolled.id],
    categoryId: need(cat, 'Shipping line'),
    date: day(-2),
    currency: 'USD',
    totalMinor: 185_000,
    paidTo: 'PIL Tanzania',
    reference: 'PIL/INV/DAR600210600A',
  });
  await t.call(samuel, 'post', `/api/bookings/${sister.id}/release`, {
    containerIds: [rolled.id],
    releasedOn: day(-3),
    note: 'Rolled by PIL; accepted for KOTA NABIL',
  });
  await move(joseph, rolled, 'OCEAN_FREIGHT', at(-1, '17:30'), 'KOTA NABIL', {
    departedOn: day(-1),
  });
  // A bill that arrived after the boxes were closed: it lands, and the MD hears of it.
  await cost(samuel, {
    containerIds: [lotB.containers[1]!.id],
    categoryId: need(cat, 'Storage / demurrage'),
    date: day(-12),
    currency: 'TZS',
    totalMinor: 120_000,
    paidTo: 'AZAM ICD',
    note: 'Late storage invoice, received after closing',
  });
  await t.call(belise, 'post', `/api/bookings/${lotB.booking.id}/comments`, {
    text: `PIL rolled ${rolled.number} to KOTA NABIL; the MD opened sister booking ${sister.reference} (${sister.fileNumber}).`,
  });
  say(
    `lot B ${lotB.booking.fileNumber} DAR600210600: 5 boxes closed, 1 rolled to ${sister.fileNumber}`,
  );

  // ---- lot C: the live lot, one box per state
  const lotC = await t.call<BookingAnswer>(belise, 'post', '/api/bookings', {
    shippingLineId: PIL,
    reference: LIVE_REFERENCE,
    clientId: need(clients, 'Space Mining'),
    cargo: 'TANTALITE',
    status: 'CONFIRMED',
    confirmedOn: day(-16),
    destination: 'Ningbo, China',
    pol: 'Dar es Salaam',
    pod: 'Ningbo',
    etd: day(17),
    containers: LOT_C.map(([number, lot]) => ({ number, size: '40FT', lot })),
  });
  const C = lotC.containers;
  for (const [i, c] of C.entries()) {
    const kg = LOT_C[i]![2];
    if (kg !== null) await weigh(c, kg);
  }
  await t.call(belise, 'post', `/api/bookings/${lotC.booking.id}/comments`, {
    text: 'PIL confirmed 8 × 40FT; the vessel is named at the port.',
  });

  // OLIU's book, typed while the boxes are on OLIU's side: the three ways to divide one bill.
  await cost(belise, {
    containerIds: ids(C.slice(1)),
    categoryId: need(cat, 'Clearance — Kigali'),
    date: day(-14),
    currency: 'RWF',
    totalMinor: 331_000 * 7,
    paidTo: 'RwandaClear',
    reference: 'RC-2026-1187',
    note: 'Export clearance, seven boxes',
  });
  await cost(belise, {
    containerIds: ids([C[6]!, C[7]!]),
    categoryId: need(cat, 'Inland transport'),
    date: day(-13),
    currency: 'RWF',
    totalMinor: 1_300_000,
    paidTo: 'Simba Haulage',
    reference: 'SH-587-1',
    note: 'Truck 1, Kigali–Dar',
  });
  await cost(belise, {
    containerIds: ids([C[4]!, C[5]!]),
    categoryId: need(cat, 'Inland transport'),
    date: day(-5),
    currency: 'RWF',
    totalMinor: 1_272_000,
    paidTo: 'Simba Haulage',
    reference: 'SH-587-2',
    note: 'Truck 2, divided by weight',
    method: 'WEIGHT',
  });
  await cost(belise, {
    containerIds: ids([C[1]!, C[2]!, C[3]!]),
    categoryId: need(cat, 'Inland transport'),
    date: day(-4),
    currency: 'RWF',
    totalMinor: 1_909_000,
    paidTo: 'Simba Haulage',
    reference: 'SH-587-3',
    note: 'Truck 3, divided by hand',
    method: 'MANUAL',
    manualMinor: [636_000, 636_000, 637_000],
  });
  await cost(jean, {
    containerIds: ids([C[6]!, C[7]!]),
    categoryId: need(cat, 'Border / transit'),
    date: day(-10),
    currency: 'RWF',
    totalMinor: 50_000,
    paidTo: 'Rusumo OSBP',
    note: 'Road toll and parking',
  });
  // OLIU's tips, paid before the boxes crossed.
  await tip(eudes, {
    containerIds: [C[1]!.id],
    reasonId: need(reason, 'Checkpoint passage'),
    currency: 'RWF',
    totalMinor: 20_000,
    date: day(-1),
    payeeType: 'OFFICIAL',
    payeeId: '0788 412 077',
    checkpoint: 'Kayonza',
    note: 'Night checkpoint',
  });
  await tip(eudes, {
    containerIds: ids([C[1]!, C[2]!]),
    reasonId: need(reason, 'Weighing / iminzani'),
    currency: 'RWF',
    totalMinor: 15_000,
    date: day(-2),
  });
  const twice = await tip<{ id: string }>(eudes, {
    containerIds: ids([C[1]!, C[2]!]),
    reasonId: need(reason, 'Weighing / iminzani'),
    currency: 'RWF',
    totalMinor: 15_000,
    date: day(-2),
  });
  await t.call(belise, 'post', `/api/tips/${twice.id}/void`, { reason: 'Typed twice' });
  await t.call(jean, 'post', '/api/tips/md-code', { amount: 'RWF 90,000', reason: 'Expediting' });
  await tip(jean, {
    containerIds: [C[4]!.id],
    reasonId: need(reason, 'Expediting'),
    currency: 'RWF',
    totalMinor: 90_000,
    date: day(-1),
    payeeType: 'AGENT',
    payeeId: 'Rusumo clearing agent',
    checkpoint: 'Rusumo',
    note: 'Weekend crossing',
    mdCode: t.mdCode(),
  });

  // The journeys, box by box.
  // The first box stays booked: numbers known, nothing loaded yet.
  const [c2, c3, c4, c5, c6, c7, c8] = [1, 2, 3, 4, 5, 6, 7].map((i) => C[i]!) as [
    Placed,
    Placed,
    Placed,
    Placed,
    Placed,
    Placed,
    Placed,
  ];
  await move(jean, c2, 'TRANSPORT', at(-2, '06:10'), 'Loaded, Kigali');
  await position(jean, c2, 'Kayonza', at(-1, '00:20'));
  await move(jean, c3, 'TRANSPORT', at(-3, '07:05'), 'Loaded, Kigali');
  await move(jean, c3, 'FIELD_RELEASE', at(-2, '09:30'), 'Magerwa, Kigali');
  await t.call(jean, 'post', `/api/containers/${c3.id}/journey`, {
    kind: 'HELD',
    place: 'Magerwa, Kigali',
    note: 'Awaiting the RRA exit stamp',
    happenedAt: null, // said just now, so the board's "overdue" mark singles out the breakdown box
  });
  await move(jean, c4, 'TRANSPORT', at(-4, '07:00'), 'Loaded, Kigali');
  await move(jean, c4, 'FIELD_RELEASE', at(-3, '10:15'), 'Magerwa, Kigali');
  await move(jean, c4, 'RUSUMO', at(-2, '09:00'), 'Rusumo OSBP');
  await t.call(joseph, 'post', `/api/containers/${c4.id}/journey`, {
    kind: 'RETURNED',
    place: 'Rusumo OSBP',
    note: 'Seal number differs from the T1; sent back to Magerwa',
    happenedAt: at(-2, '15:00'),
  });
  await move(jean, c5, 'TRANSPORT', at(-3, '06:45'), 'Loaded, Kigali');
  await move(jean, c5, 'FIELD_RELEASE', at(-2, '08:50'), 'Magerwa, Kigali');
  await move(jean, c5, 'RUSUMO', at(-1, '11:00'), 'Rusumo OSBP');
  await position(joseph, c5, 'Nzega', null);
  await move(jean, c6, 'TRANSPORT', at(-5, '06:30'), 'Loaded, Kigali');
  await move(jean, c6, 'FIELD_RELEASE', at(-4, '09:00'), 'Magerwa, Kigali');
  await move(jean, c6, 'RUSUMO', at(-3, '14:20'), 'Rusumo OSBP');
  await move(joseph, c6, 'CHECKPOINTS', at(-2, '08:00'), 'Nzega');
  await position(joseph, c6, 'Morogoro', at(-1, '00:40'));
  for (const [c, start] of [
    [c7, -12],
    [c8, -13],
  ] as const) {
    await move(jean, c, 'TRANSPORT', at(start, '06:20'), 'Loaded, Kigali');
    await move(jean, c, 'FIELD_RELEASE', at(start + 1, '09:10'), 'Magerwa, Kigali');
    await move(jean, c, 'RUSUMO', at(start + 2, '15:30'), 'Rusumo OSBP');
    await move(joseph, c, 'CHECKPOINTS', at(start + 3, '07:40'), 'Nzega');
    await move(joseph, c, 'ICD', at(start + 4, '11:00'), 'AZAM ICD, Dar es Salaam');
  }
  // A breakdown on the road, flagged by hand; the tow bill is the cost of the delay.
  await t.call(jean, 'post', `/api/containers/${c2.id}/risk`, {
    reason: 'Truck breakdown at Kayonza; replacement truck sent',
  });
  await cost(belise, {
    containerIds: [c2.id],
    categoryId: need(cat, 'Inland transport'),
    date: day(0),
    currency: 'RWF',
    totalMinor: 350_000,
    paidTo: 'Simba Haulage',
    note: 'Tow and replacement truck',
  });
  // JIVAH's book on the boxes that crossed.
  await cost(samuel, {
    containerIds: ids([c7, c8]),
    categoryId: need(cat, 'Clearance — Dar'),
    date: day(-6),
    currency: 'TZS',
    totalMinor: 2_500_000,
    paidTo: 'DarPort Clearing',
    reference: 'DPC/58700',
  });
  await cost(samuel, {
    containerIds: [c7.id],
    categoryId: need(cat, 'Storage / demurrage'),
    date: day(-2),
    currency: 'TZS',
    totalMinor: 60_000,
    paidTo: 'AZAM ICD',
    note: 'Storage past the free days',
  });
  await move(joseph, c8, 'PORT', at(-2, '10:30'), 'TPA, Dar es Salaam port');
  await cost(samuel, {
    containerIds: [c8.id],
    categoryId: need(cat, 'ICD / port charges'),
    date: day(-5),
    currency: 'TZS',
    totalMinor: 640_000,
    paidTo: 'AZAM ICD',
    note: 'Handling and lift-on',
  });
  // A bill Belise paid for a box that is on JIVAH's side now: it waits for the MD.
  await cost(belise, {
    containerIds: [c7.id],
    categoryId: need(cat, 'Documents & permits'),
    date: day(-7),
    currency: 'RWF',
    totalMinor: 85_000,
    paidTo: 'RRA',
    note: 'T1 amendment',
  });
  // JIVAH's tips.
  await tip(amina, {
    containerIds: [c5.id],
    reasonId: need(reason, 'Expediting'),
    currency: 'TZS',
    totalMinor: 30_000,
    date: day(0),
    checkpoint: 'Nzega',
  });
  await tip(baraka, {
    containerIds: [c7.id],
    reasonId: need(reason, 'Goodwill'),
    currency: 'TZS',
    totalMinor: 20_000,
    date: day(-4),
    payeeType: 'AGENT',
    payeeId: 'Hamisi K.',
    checkpoint: 'AZAM ICD',
  });
  say(`lot C ${lotC.booking.fileNumber} ${LIVE_REFERENCE}: 8 boxes, one in every state`);

  // ---- D cancelled · E pending · F a duplicate
  const d = await t.call<BookingAnswer>(belise, 'post', '/api/bookings', {
    shippingLineId: need(lines, 'Hapag-Lloyd'),
    reference: 'HLCUKGL2608514',
    clientId: need(clients, 'Transvera'),
    cargo: 'CASSITERITE',
    status: 'PENDING',
    expectedCount: 2,
    destination: 'Shanghai, China',
  });
  await t.call(belise, 'post', `/api/bookings/${d.booking.id}/cancel`, {
    reason: 'Client postponed the lot to December',
  });
  await t.call(belise, 'post', `/api/bookings/${d.booking.id}/comments`, {
    text: 'Transvera asked to roll to the December sailing; Hapag-Lloyd released the space.',
  });
  const e = await t.call<BookingAnswer>(belise, 'post', '/api/bookings', {
    shippingLineId: need(lines, 'Maersk'),
    reference: '259114882',
    clientId: need(clients, 'Transvera'),
    cargo: 'CASSITERITE',
    status: 'PENDING',
    expectedCount: 4,
    destination: 'Shanghai, China',
    pol: 'Dar es Salaam',
    pod: 'Shanghai',
    etd: day(17),
  });
  await t.call(belise, 'post', `/api/bookings/${e.booking.id}/comments`, {
    text: 'Maersk to confirm space on the next sailing; numbers come at pickup.',
  });
  const f = await t.call<BookingAnswer & { duplicates: unknown[] }>(
    belise,
    'post',
    '/api/bookings',
    {
      shippingLineId: need(lines, 'CMA CGM'),
      reference: 'CMDU4471023',
      clientId: need(clients, 'Space Mining'),
      cargo: 'TANTALITE',
      destination: 'Ningbo, China',
      containers: [
        { number: LOT_F_OWN_BOX, size: '40FT', lot: 'SM/AB/2026-10B-001' },
        { number: LOT_C[0]![0], size: '40FT', lot: 'SM/AB/2026-10B-002' },
      ],
    },
  );
  await t.call(belise, 'post', `/api/bookings/${f.booking.id}/comments`, {
    text: `Typed from the confirmation e-mail; the second number is already on ${LIVE_REFERENCE} and went to the MD.`,
  });
  say(
    `D cancelled · E pending (${e.booking.fileNumber}) · F ${f.booking.fileNumber} with a duplicate box`,
  );

  // ---- slice 6: who gets paid, the two lots paid and locked, the live queue, the floats
  const userId = async (email: string) =>
    (
      await prisma.user.findFirstOrThrow({
        where: { accountId: account.id, email },
        select: { id: true },
      })
    ).id;
  /** The six-digit code just mailed to a mailbox, read as its owner would. */
  const codeFor = (mailbox: string) => {
    const mail = devOutbox().find((m) => m.to === mailbox && /if you agree/.test(m.text));
    const code = mail?.text.match(/if you agree: (\d{6})/)?.[1];
    if (!code) throw new Error(`no code mailed to ${mailbox}`);
    return code;
  };
  type Ben = { id: string; name: string };
  /** Proposed by one person, verified by another with the code from their own mailbox. */
  async function beneficiary(
    proposer: Actor,
    confirmer: { who: Actor; mailbox: string },
    body: Record<string, unknown>,
  ): Promise<Ben> {
    const b = await t.call<Ben>(proposer, 'post', '/api/beneficiaries', body);
    await t.call(confirmer.who, 'post', `/api/beneficiaries/${b.id}/code`);
    await t.call(confirmer.who, 'post', `/api/beneficiaries/${b.id}/confirm`, {
      code: codeFor(confirmer.mailbox),
    });
    return b;
  }
  const byBelise = { who: belise, mailbox: PEOPLE.belise.mailbox };
  const byJanvier = { who: janvier, mailbox: PEOPLE.janvier.mailbox };
  const bank = (bank: string, number: string, currency: string) => ({
    accountKind: 'BANK',
    bank,
    number,
    currency,
  });
  const momo = (network: string, number: string, currency: string) => ({
    accountKind: 'MOMO',
    bank: network,
    number,
    currency,
  });
  const B = {
    rwandaClear: await beneficiary(liliose, byBelise, {
      name: 'RwandaClear Agencies',
      type: 'CLEARING_AGENT',
      ...bank('Bank of Kigali', '00012345679032', 'RWF'),
    }),
    simba: await beneficiary(liliose, byBelise, {
      name: 'Simba Haulage',
      type: 'TRANSPORTER',
      ...bank('Equity Bank', '4012201094471', 'RWF'),
    }),
    osbp: await beneficiary(liliose, byBelise, {
      name: 'Rusumo OSBP — RRA',
      type: 'OFFICIAL',
      ...bank('Bank of Kigali', '00010000011235', 'RWF'),
    }),
    rent: await beneficiary(liliose, byBelise, {
      name: 'Kigali Heights Properties',
      type: 'SUPPLIER',
      ...bank('I&M Bank', '0069367002210', 'RWF'),
    }),
    eudes: await beneficiary(belise, byJanvier, {
      name: 'Ntakanyurumwanzi Eudes (float)',
      type: 'STAFF',
      userId: await userId(PEOPLE.eudes.email),
      ...momo('MTN MoMo', '0788412077', 'RWF'),
    }),
    jean: await beneficiary(belise, byJanvier, {
      name: 'Kariyo Jean Damascene (float)',
      type: 'STAFF',
      userId: await userId(PEOPLE.jean.email),
      ...momo('MTN MoMo', '0788555001', 'RWF'),
    }),
    pil: await beneficiary(samuel, byJanvier, {
      name: 'PIL Tanzania Ltd',
      type: 'SHIPPING_LINE',
      ...bank('Citibank', '2210008834', 'USD'),
    }),
    darport: await beneficiary(samuel, byJanvier, {
      name: 'DarPort Clearing Co',
      type: 'CLEARING_AGENT',
      ...bank('NMB', '20110005560', 'TZS'),
    }),
    azam: await beneficiary(samuel, byJanvier, {
      name: 'AZAM ICD',
      type: 'SUPPLIER',
      ...bank('CRDB', '0150003301', 'TZS'),
    }),
    amina: await beneficiary(samuel, byJanvier, {
      name: 'Amina Hassan (float)',
      type: 'STAFF',
      userId: await userId(PEOPLE.amina.email),
      ...momo('M-Pesa', '0754201177', 'TZS'),
    }),
  };
  say('10 beneficiaries, each verified by a second person with their code');

  type Order = { id: string; number: string; status: string; needsCode: boolean };
  type Cand = {
    id: string;
    bookingId: string;
    category: string;
    paidTo: string;
    reference: string;
    note: string;
  };
  const candidates = (who: Actor, bookingId?: string) =>
    t.call<Cand[]>(
      who,
      'get',
      `/api/payments/candidates${bookingId ? `?bookingId=${bookingId}` : ''}`,
    );
  const pick = (cs: Cand[], f: Partial<Cand>) =>
    cs
      .filter((c) => (Object.keys(f) as (keyof Cand)[]).every((k) => c[k] === f[k]))
      .map((c) => c.id);
  const order = (who: Actor, body: Record<string, unknown>) =>
    t.call<Order>(who, 'post', '/api/payments', body);
  /** One click, or the approver's code when the order is above the threshold. */
  async function approve(by: { who: Actor; mailbox: string }, o: Order) {
    if (!o.needsCode) return t.call<Order>(by.who, 'post', `/api/payments/${o.id}/approve`, {});
    await t.call(by.who, 'post', `/api/payments/${o.id}/code`);
    return t.call<Order>(by.who, 'post', `/api/payments/${o.id}/approve`, {
      code: codeFor(by.mailbox),
    });
  }
  const pay = (who: Actor, o: Order, reference: string) =>
    t.call<Order>(who, 'post', `/api/payments/${o.id}/pay`, { reference });
  /** Requested by one person, approved by another, paid by a third: the whole chain, locked at the end. */
  const settle = async (
    requester: Actor,
    approver: { who: Actor; mailbox: string },
    payer: Actor,
    body: Record<string, unknown>,
    reference: string,
  ) => pay(payer, await approve(approver, await order(requester, body)), reference);
  /** The lines of the shipped lots, grouped as the bills were: one order per booking, category and payee. */
  function groups(cs: Cand[]) {
    const m = new Map<string, Cand[]>();
    for (const c of cs) {
      const k = `${c.bookingId}|${c.category}|${c.paidTo}`;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return m;
  }

  // The two invoiced lots: every bill requested by Liliose, approved by Belise (her code above the threshold),
  // paid by Liliose and locked; JIVAH's side requested by Samuel, approved and paid by the MD, Charles being suspended.
  const payeeOf: Record<string, Ben> = {
    RwandaClear: B.rwandaClear,
    'Simba Haulage': B.simba,
    'Rusumo OSBP': B.osbp,
    'PIL Tanzania': B.pil,
    'DarPort Clearing': B.darport,
    'AZAM ICD': B.azam,
  };
  let ref = 44010;
  for (const side of [
    {
      cands: await candidates(liliose),
      requester: liliose,
      approver: byBelise,
      payer: liliose,
      prefix: 'BK-',
    },
    {
      cands: await candidates(samuel),
      requester: samuel,
      approver: byJanvier,
      payer: janvier,
      prefix: 'NMB-',
    },
  ]) {
    for (const [key, cs] of groups(side.cands.filter((c) => c.bookingId !== lotC.booking.id))) {
      const ben = payeeOf[key.split('|')[2]!];
      if (!ben) continue;
      await settle(
        side.requester,
        side.approver,
        side.payer,
        { kind: 'COST', beneficiaryId: ben.id, costLineIds: cs.map((c) => c.id) },
        `${side.prefix}${ref++}`,
      );
    }
  }
  say('the two shipped lots: every bill paid and locked, in both books');

  // The live lot, OLIU's book.
  const liveC = await candidates(liliose, lotC.booking.id);
  // Kigali clearance: requested, approved with Belise's code, paid — the container record says "paid".
  await settle(
    liliose,
    byBelise,
    liliose,
    {
      kind: 'COST',
      beneficiaryId: B.rwandaClear.id,
      costLineIds: pick(liveC, { category: 'Clearance — Kigali' }),
    },
    'BK-44027',
  );
  // A re-clearance typed on two of the same boxes, to the same payee: the request is blocked, for the MD.
  await cost(belise, {
    containerIds: ids([c2, c3]),
    categoryId: need(cat, 'Clearance — Kigali'),
    date: day(-3),
    currency: 'RWF',
    totalMinor: 120_000,
    paidTo: 'RwandaClear',
    note: 'Re-clearance after the T1 amendment',
  });
  const repeat = await order(liliose, {
    kind: 'COST',
    beneficiaryId: B.rwandaClear.id,
    costLineIds: pick(await candidates(liliose, lotC.booking.id), {
      category: 'Clearance — Kigali',
    }),
  });
  if (repeat.status !== 'BLOCKED') throw new Error('the repeated clearance was not blocked');
  // Truck 1: approved with the code, waiting for Liliose to pay. Truck 2, requested by Belise: waits for the MD.
  await approve(
    byBelise,
    await order(liliose, {
      kind: 'COST',
      beneficiaryId: B.simba.id,
      costLineIds: pick(liveC, { reference: 'SH-587-1' }),
    }),
  );
  await order(belise, {
    kind: 'COST',
    beneficiaryId: B.simba.id,
    costLineIds: pick(liveC, { reference: 'SH-587-2' }),
  });
  // Jean's border fees on the crossed boxes: one click for Belise, waiting.
  await order(liliose, {
    kind: 'COST',
    beneficiaryId: B.osbp.id,
    costLineIds: pick(liveC, { category: 'Border / transit' }),
  });
  // The tow bill: rejected, with the reason; its line is free again.
  const tow = await order(liliose, {
    kind: 'COST',
    beneficiaryId: B.simba.id,
    costLineIds: pick(liveC, { note: 'Tow and replacement truck' }),
  });
  await t.call(belise, 'post', `/api/payments/${tow.id}/reject`, {
    reason: 'The tow is on Simba Haulage under the contract; await their credit note',
  });
  // The office rent, through the same queue: approved, to pay.
  await approve(
    byBelise,
    await order(liliose, {
      kind: 'EXPENSE',
      beneficiaryId: B.rent.id,
      categoryId: need(cat, 'Office expenses'),
      currency: 'RWF',
      amountMinor: 1_200_000,
      date: day(-2),
      purpose: 'Office rent — Kigali (October)',
    }),
  );
  // Floats: Eudes's advance paid, his two live tips settled by the MD; Jean's advance paid, his tip still waits.
  await settle(
    liliose,
    byBelise,
    liliose,
    { kind: 'FLOAT_ADVANCE', beneficiaryId: B.eudes.id, currency: 'RWF', amountMinor: 200_000 },
    'MoMo-0788-01',
  );
  const eudesCash = await t.call<Cand[]>(
    belise,
    'get',
    `/api/payments/candidates?holderId=${B.eudes.id}`,
  );
  await approve(
    byJanvier,
    await order(belise, {
      kind: 'SETTLEMENT',
      beneficiaryId: B.eudes.id,
      costLineIds: eudesCash.map((c) => c.id),
    }),
  );
  await settle(
    liliose,
    byBelise,
    liliose,
    { kind: 'FLOAT_ADVANCE', beneficiaryId: B.jean.id, currency: 'RWF', amountMinor: 150_000 },
    'MoMo-0788-02',
  );

  // The live lot, JIVAH's book: Samuel requests, the MD approves.
  const liveJ = await candidates(samuel, lotC.booking.id);
  await approve(
    byJanvier,
    await order(samuel, {
      kind: 'COST',
      beneficiaryId: B.darport.id,
      costLineIds: pick(liveJ, { category: 'Clearance — Dar' }),
    }),
  );
  // …then Samuel proposes DarPort's new account: the approved order waits for a second pair of eyes before it is paid.
  await t.call(samuel, 'post', `/api/beneficiaries/${B.darport.id}/change`, {
    ...bank('NMB', '20110008834', 'TZS'),
    reason: 'New account on their letter of 21 October',
  });
  for (const category of ['Storage / demurrage', 'ICD / port charges'])
    await order(samuel, {
      kind: 'COST',
      beneficiaryId: B.azam.id,
      costLineIds: pick(liveJ, { category }),
    });
  await settle(
    samuel,
    byJanvier,
    janvier,
    { kind: 'FLOAT_ADVANCE', beneficiaryId: B.amina.id, currency: 'TZS', amountMinor: 100_000 },
    'M-Pesa-0754-01',
  );
  say(
    'the live lot: one order in every state, a repeat blocked, two floats, one account change pending',
  );

  for (const who of [janvier, belise, liliose, jean, eudes, samuel, joseph, amina, baraka])
    await t.call(who, 'post', '/api/auth/logout');

  const [
    bookings,
    containers,
    costLines,
    tips,
    journeyEvents,
    mdQueueOpen,
    beneficiaries,
    payments,
  ] = await Promise.all([
    prisma.booking.count({ where: { accountId: account.id } }),
    prisma.container.count({ where: { accountId: account.id } }),
    prisma.costLine.count({ where: { accountId: account.id } }),
    prisma.tip.count({ where: { accountId: account.id } }),
    prisma.journeyEvent.count({ where: { accountId: account.id } }),
    prisma.mdQueueItem.count({ where: { accountId: account.id, status: 'OPEN' } }),
    prisma.beneficiary.count({ where: { accountId: account.id } }),
    prisma.paymentRequest.count({ where: { accountId: account.id } }),
  ]);
  return {
    bookings,
    containers,
    costLines,
    tips,
    journeyEvents,
    mdQueueOpen,
    beneficiaries,
    payments,
  };
}
