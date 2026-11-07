/**
 * Shipments — booking and container (roadmap slice 2).
 *
 * The container number is the unit of truth. A number is checked (ISO 6346) before it is saved, and an
 * account never holds two ACTIVE records of one number: the second entry is saved as a DUPLICATE beside
 * the first and goes to the MD, who rules. Nothing here is money, stages or legs.
 *
 * GET  /api/shipping-lines · POST /api/shipping-lines   the carriers and the shape of their booking numbers
 * GET  /api/clients        · POST /api/clients          who is shipped for
 * GET  /api/bookings?month=YYYY-MM                       this company's bookings (the MD: the switcher's company)
 * POST /api/bookings                                     a booking with its boxes
 * GET  /api/bookings/:id · PATCH /api/bookings/:id       readable anywhere in the account; fill-later fields by its company
 * POST /api/bookings/:id/confirm | cancel                the line confirmed it · withdrawn with a reason, boxes freed
 * GET|POST /api/bookings/:id/comments                    append-only notes on a booking
 * POST /api/bookings/:id/containers                      more boxes on a booking
 * GET  /api/containers?q=&month=                         the boxes; q looks a number up across the whole account, read-only
 * GET  /api/containers/check?number=                     is this number well formed, and is it already in the account
 * GET  /api/md-queue · POST /api/md-queue/:id/resolve    duplicates waiting for the MD (the stub of the slice 6 queue)
 */
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  addContainersInput,
  bookingCancelInput,
  bookingCommentInput,
  bookingInput,
  bookingPatch,
  canOpenScreen,
  type BookingPatch,
  checkContainerNumber,
  clientInput,
  containerPatch,
  duplicateResolution,
  ROLE_PERMISSIONS,
  shippingLineInput,
  sisterBookingInput,
  STAGE_LABEL,
  STAGES,
  type Role,
} from '@oliu/shared';
import {
  byAccount,
  bySide,
  mayTouchCompany,
  prisma,
  spansAccount,
  type Scope,
  type Tx,
} from '../../db.ts';
import { audit } from '../../lib/audit.ts';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.ts';
import { parseBody } from '../../lib/validate.ts';
import { resolveRepeatPayment } from '../payments/routes.ts';
import {
  clientIp,
  requireAuth,
  requirePermission,
  requireScreen,
  scopeOf,
} from '../../middleware/auth.ts';

export const shipmentsRouter = Router();
const MODULE = 'shipments';
const canWriteBookings = [requireAuth, requireScreen('book'), requirePermission('write')];

// ---------------------------------------------------------------- helpers

/** The company a new record belongs to: the user's own, or the switcher's company for an all-company user. */
function writingCompany(s: Scope): string {
  const id = s.companyId ?? s.activeCompanyId;
  if (!id) throw badRequest('Choose a company in the switcher first');
  return id;
}

/**
 * The company a booking, a shipping line or a client is made for: the one that bills the client (OLIU in
 * OLIU · JIVAH), or a branch of it. The partner company deals with boxes after the hand-over, never with bookings.
 */
async function bookingCompany(s: Scope): Promise<string | null> {
  const id = s.companyId ?? s.activeCompanyId;
  // The MD without a company in the switcher may keep lines and clients (they are the account's); a booking
  // itself still needs a company, which POST /bookings asks for.
  if (!id && spansAccount(s)) return null;
  if (!id) throw badRequest('Choose a company in the switcher first');
  const c = await prisma.company.findFirst({
    where: { id, accountId: s.accountId },
    select: { billsClient: true, kind: true, parent: { select: { billsClient: true } } },
  });
  if (!c) throw badRequest('Choose a company in the switcher first');
  if (!c.billsClient && !(c.kind === 'BRANCH' && c.parent?.billsClient))
    throw forbidden(
      'Bookings, shipping lines and clients are made by the company that bills the client',
    );
  return id;
}

const monthQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM')
    .optional(),
});

/** [first day, first day of the next month) in UTC, or undefined for "any time". */
function monthRange(month?: string) {
  if (!month) return undefined;
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

async function companyNames(accountId: string): Promise<Map<string, string>> {
  const rows = await prisma.company.findMany({
    where: { accountId },
    select: { id: true, legalName: true },
  });
  return new Map(rows.map((c) => [c.id, c.legalName]));
}

/** A box whose owner code is not one the line usually uses is saved, with a note for the person typing. */
function prefixNotes(line: { name: string; usualPrefixes: string[] }, numbers: string[]): string[] {
  if (line.usualPrefixes.length === 0) return [];
  return numbers
    .filter((n) => !line.usualPrefixes.includes(n.slice(0, 4)))
    .map(
      (n) =>
        `${n}: owner code ${n.slice(0, 4)} is not one ${line.name} usually uses (${line.usualPrefixes.join(', ')}); saved anyway`,
    );
}

/** Two people typing the same new number at the same moment: the partial unique index refuses the second. */
function sameMoment(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw conflict(
      'Someone saved one of these boxes at the same moment; check the list and try again',
    );
  }
  throw e;
}

type BookingHead = { id: string; reference: string; companyId: string; status?: string };
type PlacedContainer = {
  id: string;
  number: string;
  size: string;
  lot: string;
  status: string;
  duplicateOfId: string | null;
};

/**
 * Saves one box on a booking. If the account already holds an ACTIVE record of that number, this one is
 * saved as a DUPLICATE beside it and an MD-queue item is opened; nothing is silently accepted or refused.
 */
async function placeContainer(
  tx: Tx,
  s: Scope,
  ip: string,
  booking: BookingHead,
  c: { number: string; size: string; lot: string },
): Promise<{ container: PlacedContainer; twinReference: string | null }> {
  const twin = await tx.container.findFirst({
    where: { accountId: s.accountId, number: c.number, status: 'ACTIVE' },
    select: { id: true, booking: { select: { reference: true } } },
  });
  const container = await tx.container.create({
    data: {
      accountId: s.accountId,
      bookingId: booking.id,
      number: c.number,
      size: c.size,
      lot: c.lot,
      status: twin ? 'DUPLICATE' : 'ACTIVE',
      duplicateOfId: twin?.id ?? null,
      // On the working list of the company that booked it, until the hand-over stage flips it (slice 4).
      responsibleCompanyId: booking.companyId,
      createdById: s.userId,
    },
    select: { id: true, number: true, size: true, lot: true, status: true, duplicateOfId: true },
  });
  const base = {
    accountId: s.accountId,
    userId: s.userId,
    companyId: booking.companyId,
    module: MODULE,
    entity: 'container',
    entityId: container.id,
    ip,
  };
  if (!twin) {
    await audit(
      {
        ...base,
        action: 'container_added',
        after: { number: c.number, size: c.size, lot: c.lot, booking: booking.reference },
      },
      tx,
    );
    return { container, twinReference: null };
  }
  const item = await tx.mdQueueItem.create({
    data: {
      accountId: s.accountId,
      companyId: booking.companyId,
      kind: 'DUPLICATE_CONTAINER',
      entity: 'container',
      entityId: container.id,
      summary: {
        number: c.number,
        newBooking: booking.reference,
        existingBooking: twin.booking.reference,
        existingContainerId: twin.id,
      },
      createdById: s.userId,
    },
  });
  await audit(
    {
      ...base,
      action: 'container_duplicate_flagged',
      after: {
        number: c.number,
        booking: booking.reference,
        existingBooking: twin.booking.reference,
        queueItem: item.id,
      },
    },
    tx,
  );
  return { container, twinReference: twin.booking.reference };
}

// ---------------------------------------------------------------- shipping lines and clients

shipmentsRouter.get('/shipping-lines', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    res.json(
      await prisma.shippingLine.findMany({
        where: { ...byAccount(s), active: true },
        orderBy: { name: 'asc' },
      }),
    );
  } catch (e) {
    next(e);
  }
});

shipmentsRouter.post('/shipping-lines', ...canWriteBookings, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    await bookingCompany(s);
    const input = parseBody(shippingLineInput, req.body);
    const dup = await prisma.shippingLine.findFirst({
      where: { ...byAccount(s), name: { equals: input.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (dup) throw conflict('That shipping line is already in the list');
    const line = await prisma.$transaction(async (tx) => {
      const l = await tx.shippingLine.create({ data: { accountId: s.accountId, ...input } });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          module: MODULE,
          action: 'shipping_line_added',
          entity: 'shipping_line',
          entityId: l.id,
          after: input,
          ip: clientIp(req),
        },
        tx,
      );
      return l;
    });
    res.status(201).json(line);
  } catch (e) {
    next(e);
  }
});

shipmentsRouter.get('/clients', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    res.json(await prisma.client.findMany({ where: byAccount(s), orderBy: { name: 'asc' } }));
  } catch (e) {
    next(e);
  }
});

shipmentsRouter.post('/clients', ...canWriteBookings, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    await bookingCompany(s);
    const input = parseBody(clientInput, req.body);
    const dup = await prisma.client.findFirst({
      where: { ...byAccount(s), name: { equals: input.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (dup) throw conflict('That client is already in the list');
    const client = await prisma.$transaction(async (tx) => {
      const c = await tx.client.create({ data: { accountId: s.accountId, ...input } });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          module: MODULE,
          action: 'client_added',
          entity: 'client',
          entityId: c.id,
          after: input,
          ip: clientIp(req),
        },
        tx,
      );
      return c;
    });
    res.status(201).json(client);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- bookings

/** OLIU-2026-0042: the company's code, the year, a four-digit sequence. The code is the first word of the legal name. */
function companyCode(legalName: string): string {
  const first = legalName.trim().split(/\s+/)[0] ?? '';
  return (
    first
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 6) || 'FILE'
  );
}

/** Bumps the company's counter for the year in one atomic statement, so two bookings at the same moment never share a number. */
async function nextFileNumber(tx: Tx, company: { id: string; legalName: string }): Promise<string> {
  const year = new Date().getUTCFullYear();
  const rows = await tx.$queryRaw<{ next: number }[]>`
    INSERT INTO "FileSequence" ("companyId", "year", "next") VALUES (${company.id}::uuid, ${year}, 1)
    ON CONFLICT ("companyId", "year") DO UPDATE SET "next" = "FileSequence"."next" + 1
    RETURNING "next"`;
  return `${companyCode(company.legalName)}-${year}-${String(rows[0]!.next).padStart(4, '0')}`;
}

/** Date fields arrive as YYYY-MM-DD or null; Prisma wants Date or null. */
const asDate = (d: string | null | undefined) =>
  d === undefined ? undefined : d ? new Date(d) : null;

function patchData(p: BookingPatch) {
  const { etd, eta, ...rest } = p;
  return { ...rest, etd: asDate(etd), eta: asDate(eta) };
}

const bookingSelect = {
  id: true,
  fileNumber: true,
  reference: true,
  cargo: true,
  destination: true,
  vessel: true,
  voyage: true,
  pol: true,
  pod: true,
  etd: true,
  eta: true,
  blNumber: true,
  expectedCount: true,
  expectedSize: true,
  status: true,
  confirmedAt: true,
  cancelledAt: true,
  cancelReason: true,
  companyId: true,
  createdAt: true,
  shippingLine: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
  containers: { select: { status: true } },
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

function shapeBooking(b: BookingRow, names: Map<string, string>) {
  const { containers, ...rest } = b;
  return {
    ...rest,
    companyName: names.get(b.companyId) ?? '',
    containerCount: containers.filter((c) => c.status !== 'WITHDRAWN').length,
    duplicateCount: containers.filter((c) => c.status === 'DUPLICATE').length,
  };
}

shipmentsRouter.get('/bookings', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const q = parseBody(monthQuery, req.query);
    // My bookings, and the bookings whose boxes are on my side now (the other side's, after the hand-over):
    // those are the ones I enter costs on, release and close.
    const mine = s.companyId ?? s.activeCompanyId;
    const [rows, names] = await Promise.all([
      prisma.booking.findMany({
        where: {
          ...byAccount(s),
          ...(mine
            ? {
                OR: [
                  { companyId: mine },
                  { containers: { some: { responsibleCompanyId: mine, status: 'ACTIVE' } } },
                ],
              }
            : {}),
          createdAt: monthRange(q.month),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: bookingSelect,
      }),
      companyNames(s.accountId),
    ]);
    res.json(rows.map((b) => shapeBooking(b, names)));
  } catch (e) {
    next(e);
  }
});

shipmentsRouter.post('/bookings', ...canWriteBookings, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    await bookingCompany(s);
    const companyId = writingCompany(s);
    const input = parseBody(bookingInput, req.body);
    const [line, client] = await Promise.all([
      prisma.shippingLine.findFirst({
        where: { id: input.shippingLineId, ...byAccount(s), active: true },
      }),
      prisma.client.findFirst({
        where: { id: input.clientId, ...byAccount(s) },
        select: { id: true, name: true },
      }),
    ]);
    if (!line) throw badRequest('Pick a shipping line from the list');
    if (!client) throw badRequest('Pick a client from the list');
    if (line.referencePattern && !new RegExp(line.referencePattern).test(input.reference)) {
      throw badRequest('Check the highlighted fields', [
        {
          path: 'reference',
          message: `${line.name} booking numbers look like: ${line.referenceHint || line.referencePattern}`,
        },
      ]);
    }
    const taken = await prisma.booking.findUnique({
      where: { accountId_reference: { accountId: s.accountId, reference: input.reference } },
      select: { id: true },
    });
    if (taken)
      throw conflict(
        `Booking ${input.reference} already exists; open it from the Containers list to add boxes`,
      );

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { id: true, legalName: true },
    });
    const ip = clientIp(req);
    const result = await prisma
      .$transaction(async (tx) => {
        // The line and client ids were verified above and are set from those rows, not from the body.
        const {
          containers,
          status,
          confirmedOn,
          etd,
          eta,
          shippingLineId: _line,
          clientId: _client,
          ...fields
        } = input;
        const booking = await tx.booking.create({
          data: {
            accountId: s.accountId,
            companyId,
            fileNumber: await nextFileNumber(tx, company),
            shippingLineId: line.id,
            clientId: client.id,
            ...fields,
            etd: asDate(etd),
            eta: asDate(eta),
            status,
            confirmedAt: status === 'CONFIRMED' ? (asDate(confirmedOn) ?? new Date()) : null,
            createdById: s.userId,
          },
        });
        await audit(
          {
            accountId: s.accountId,
            userId: s.userId,
            companyId,
            module: MODULE,
            action: 'booking_created',
            entity: 'booking',
            entityId: booking.id,
            after: {
              fileNumber: booking.fileNumber,
              reference: booking.reference,
              line: line.name,
              client: client.name,
              cargo: booking.cargo,
              vessel: booking.vessel,
              status: booking.status,
              boxes: containers.length,
              expected: booking.expectedCount,
            },
            ip,
          },
          tx,
        );
        const placed = [];
        for (const c of input.containers) placed.push(await placeContainer(tx, s, ip, booking, c));
        return { booking, placed };
      })
      .catch(sameMoment);
    res.status(201).json({
      booking: result.booking,
      containers: result.placed.map((p) => p.container),
      duplicates: result.placed
        .filter((p) => p.twinReference)
        .map((p) => ({ number: p.container.number, existingBooking: p.twinReference })),
      notes: prefixNotes(
        line,
        input.containers.map((c) => c.number),
      ),
    });
  } catch (e) {
    next(e);
  }
});

/** A booking with its boxes, readable by anyone in the account; `mayEdit` says whether this caller may change it. */
shipmentsRouter.get('/bookings/:id', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const b = await prisma.booking.findFirst({
      where: { id: String(req.params.id), ...byAccount(s) },
      include: {
        shippingLine: { select: { id: true, name: true, usualPrefixes: true } },
        client: { select: { id: true, name: true, legalName: true } },
        containers: { orderBy: { createdAt: 'asc' } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!b) throw notFound('Booking not found');
    // One side, one company: the booking's company and the side holding some of its boxes may read it.
    const onMySide = b.containers.filter((c) => mayTouchCompany(s, c.responsibleCompanyId));
    if (!spansAccount(s) && !mayTouchCompany(s, b.companyId) && onMySide.length === 0)
      throw forbidden("This booking is on the other company's side");
    const elsewhere = spansAccount(s)
      ? []
      : STAGES.filter((st) =>
          b.containers.some(
            (c) =>
              c.status === 'ACTIVE' &&
              c.stage === st &&
              !mayTouchCompany(s, c.responsibleCompanyId),
          ),
        ).map((st) => ({
          stage: st,
          label: STAGE_LABEL[st],
          count: b.containers.filter(
            (c) =>
              c.status === 'ACTIVE' &&
              c.stage === st &&
              !mayTouchCompany(s, c.responsibleCompanyId),
          ).length,
        }));
    const shown = spansAccount(s)
      ? b.containers
      : b.containers.filter(
          (c) => c.status !== 'ACTIVE' || mayTouchCompany(s, c.responsibleCompanyId),
        );
    const [names, twins, authors] = await Promise.all([
      companyNames(s.accountId),
      twinReferences(shown),
      userNames([...b.comments.map((c) => c.userId), b.createdById]),
    ]);
    const role = s.role as Role;
    res.json({
      ...b,
      companyName: names.get(b.companyId) ?? '',
      createdBy: authors.get(b.createdById) ?? '—',
      comments: b.comments.map((c) => ({ ...c, userName: authors.get(c.userId) ?? '—' })),
      containers: shown.map((c) => ({
        ...c,
        responsibleCompanyName: names.get(c.responsibleCompanyId) ?? '',
        duplicateOf: c.duplicateOfId
          ? { bookingReference: twins.get(c.duplicateOfId) ?? '' }
          : null,
      })),
      /** Boxes of this booking on the other side: how many, at which stage; nothing else. */
      elsewhere,
      mayEdit:
        ROLE_PERMISSIONS[role].includes('write') &&
        canOpenScreen(role, 'book') &&
        mayTouchCompany(s, b.companyId),
    });
  } catch (e) {
    next(e);
  }
});

/** For DUPLICATE rows: the booking reference of the ACTIVE record each one collided with. */
async function twinReferences(
  containers: { duplicateOfId: string | null }[],
): Promise<Map<string, string>> {
  const ids = [...new Set(containers.map((c) => c.duplicateOfId).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.container.findMany({
    where: { id: { in: ids } },
    select: { id: true, booking: { select: { reference: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.booking.reference]));
}

/** Names for a set of user ids, for comments and "made by". */
async function userNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** The booking of this account the caller may change, or the right error. A cancelled booking is closed to changes. */
async function ownBooking(s: Scope, id: string, allowCancelled = false): Promise<BookingHead> {
  const b = await prisma.booking.findFirst({
    where: { id, ...byAccount(s) },
    select: { id: true, reference: true, companyId: true, status: true },
  });
  if (!b) throw notFound('Booking not found');
  if (!mayTouchCompany(s, b.companyId))
    throw forbidden('This booking belongs to the other company; you can read it, not change it');
  if (b.status === 'CANCELLED' && !allowCancelled)
    throw conflict(`Booking ${b.reference} is cancelled; it can be read, not changed`);
  return b;
}

shipmentsRouter.patch('/bookings/:id', ...canWriteBookings, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const patch = parseBody(bookingPatch, req.body);
    const head = await ownBooking(s, String(req.params.id));
    const before = await prisma.booking.findUniqueOrThrow({
      where: { id: head.id },
      select: {
        cargo: true,
        destination: true,
        vessel: true,
        voyage: true,
        pol: true,
        pod: true,
        etd: true,
        eta: true,
        blNumber: true,
        expectedCount: true,
        expectedSize: true,
      },
    });
    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({ where: { id: head.id }, data: patchData(patch) });
      const changed = Object.fromEntries(
        Object.keys(patch).map((k) => [k, before[k as keyof typeof before]]),
      );
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: head.companyId,
          module: MODULE,
          action: 'booking_updated',
          entity: 'booking',
          entityId: head.id,
          before: changed,
          after: patch,
          ip: clientIp(req),
        },
        tx,
      );
      return b;
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

/** The line has confirmed a pending booking. */
shipmentsRouter.post('/bookings/:id/confirm', ...canWriteBookings, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { confirmedOn } = parseBody(
      z.object({
        confirmedOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
      req.body ?? {},
    );
    const head = await ownBooking(s, String(req.params.id));
    if (head.status !== 'PENDING') throw conflict(`Booking ${head.reference} is already confirmed`);
    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: head.id },
        data: { status: 'CONFIRMED', confirmedAt: asDate(confirmedOn) ?? new Date() },
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: head.companyId,
          module: MODULE,
          action: 'booking_confirmed',
          entity: 'booking',
          entityId: head.id,
          before: { status: 'PENDING' },
          after: { status: 'CONFIRMED', confirmedAt: b.confirmedAt },
          ip: clientIp(req),
        },
        tx,
      );
      return b;
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

/**
 * Cancel a booking with a reason. Nothing is deleted: the booking stays in the record as CANCELLED, its boxes
 * are withdrawn (their numbers are free again), and any duplicate case waiting on them is closed.
 */
shipmentsRouter.post('/bookings/:id/cancel', ...canWriteBookings, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { reason } = parseBody(bookingCancelInput, req.body);
    const head = await ownBooking(s, String(req.params.id));
    const ip = clientIp(req);
    const updated = await prisma.$transaction(async (tx) => {
      const boxes = await tx.container.findMany({
        where: { bookingId: head.id, status: { not: 'WITHDRAWN' } },
        select: { id: true, number: true, status: true },
      });
      await tx.container.updateMany({
        where: { id: { in: boxes.map((b) => b.id) } },
        data: { status: 'WITHDRAWN' },
      });
      await tx.mdQueueItem.updateMany({
        where: { accountId: s.accountId, status: 'OPEN', entityId: { in: boxes.map((b) => b.id) } },
        data: {
          status: 'RESOLVED',
          resolution: 'BOOKING_CANCELLED',
          resolvedById: s.userId,
          resolvedAt: new Date(),
        },
      });
      const b = await tx.booking.update({
        where: { id: head.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: head.companyId,
          module: MODULE,
          action: 'booking_cancelled',
          entity: 'booking',
          entityId: head.id,
          before: { status: head.status, boxes: boxes.map((x) => x.number) },
          after: { status: 'CANCELLED', reason },
          ip,
        },
        tx,
      );
      return b;
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

/** Comments: readable wherever the booking is readable; written by the company that made it. */
shipmentsRouter.get('/bookings/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const b = await prisma.booking.findFirst({
      where: { id: String(req.params.id), ...byAccount(s) },
      select: {
        companyId: true,
        comments: { orderBy: { createdAt: 'asc' } },
        containers: { where: { status: 'ACTIVE', ...bySide(s) }, select: { id: true } },
      },
    });
    if (!b) throw notFound('Booking not found');
    if (!spansAccount(s) && !mayTouchCompany(s, b.companyId) && b.containers.length === 0)
      throw forbidden("This booking is on the other company's side");
    const names = await userNames(b.comments.map((c) => c.userId));
    res.json(b.comments.map((c) => ({ ...c, userName: names.get(c.userId) ?? '—' })));
  } catch (e) {
    next(e);
  }
});

shipmentsRouter.post('/bookings/:id/comments', ...canWriteBookings, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { text } = parseBody(bookingCommentInput, req.body);
    const head = await ownBooking(s, String(req.params.id), true);
    const comment = await prisma.$transaction(async (tx) => {
      const c = await tx.bookingComment.create({
        data: { accountId: s.accountId, bookingId: head.id, userId: s.userId, text },
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: head.companyId,
          module: MODULE,
          action: 'booking_commented',
          entity: 'booking',
          entityId: head.id,
          after: { comment: c.id },
          ip: clientIp(req),
        },
        tx,
      );
      return c;
    });
    res.status(201).json({ ...comment, userName: req.user?.name ?? '—' });
  } catch (e) {
    next(e);
  }
});

shipmentsRouter.post('/bookings/:id/containers', ...canWriteBookings, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(addContainersInput, req.body);
    const head = await ownBooking(s, String(req.params.id));
    const line = await prisma.booking.findUniqueOrThrow({
      where: { id: head.id },
      select: { shippingLine: { select: { name: true, usualPrefixes: true } } },
    });
    const numbers = input.containers.map((c) => c.number);
    const already = await prisma.container.findMany({
      where: { bookingId: head.id, number: { in: numbers }, status: { not: 'WITHDRAWN' } },
      select: { number: true },
    });
    if (already.length > 0)
      throw badRequest(`Already on this booking: ${already.map((a) => a.number).join(', ')}`);
    const ip = clientIp(req);
    const placed = await prisma
      .$transaction(async (tx) => {
        const out = [];
        for (const c of input.containers) out.push(await placeContainer(tx, s, ip, head, c));
        return out;
      })
      .catch(sameMoment);
    res.status(201).json({
      containers: placed.map((p) => p.container),
      duplicates: placed
        .filter((p) => p.twinReference)
        .map((p) => ({ number: p.container.number, existingBooking: p.twinReference })),
      notes: prefixNotes(line.shippingLine, numbers),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Some boxes released, others waiting: the line gives a sister number (the first plus a suffix) and the
 * waiting boxes move to it, with their cost lines, so released and waiting boxes never mix on one number.
 */
shipmentsRouter.post('/bookings/:id/sister', ...canWriteBookings, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(sisterBookingInput, req.body);
    const parent = await prisma.booking.findFirst({
      where: { id: String(req.params.id), ...byAccount(s) },
      include: {
        shippingLine: {
          select: { id: true, name: true, referencePattern: true, referenceHint: true },
        },
        company: { select: { id: true, legalName: true } },
      },
    });
    if (!parent) throw notFound('Booking not found');
    if (!mayTouchCompany(s, parent.companyId))
      throw forbidden('This booking belongs to the other company; you can read it, not split it');
    if (parent.status === 'CANCELLED') throw conflict('This booking is cancelled');
    if (input.reference === parent.reference)
      throw badRequest('The sister number must differ from the first');
    const line = parent.shippingLine;
    if (line.referencePattern && !new RegExp(line.referencePattern).test(input.reference))
      throw badRequest('Check the highlighted fields', [
        {
          path: 'reference',
          message: `${line.name} booking numbers look like: ${line.referenceHint || line.referencePattern}`,
        },
      ]);
    const taken = await prisma.booking.findUnique({
      where: { accountId_reference: { accountId: s.accountId, reference: input.reference } },
      select: { id: true },
    });
    if (taken) throw conflict(`Booking ${input.reference} already exists`);
    const boxes = await prisma.container.findMany({
      where: {
        id: { in: input.containerIds },
        bookingId: parent.id,
        status: 'ACTIVE',
        ...bySide(s),
      },
      select: { id: true, number: true, releasedAt: true, closedAt: true },
    });
    if (boxes.length !== new Set(input.containerIds).size)
      throw badRequest('One of the boxes is not a live container of this booking on your side');
    const stuck = boxes.find((b) => b.releasedAt || b.closedAt);
    if (stuck) throw conflict(`${stuck.number} is released or closed; only waiting boxes move`);
    const ip = clientIp(req);
    const ids = boxes.map((x) => x.id);
    const sister = await prisma.$transaction(async (tx) => {
      const fileNumber = await nextFileNumber(tx, parent.company);
      const b = await tx.booking.create({
        data: {
          accountId: s.accountId,
          companyId: parent.companyId,
          shippingLineId: parent.shippingLineId,
          clientId: parent.clientId,
          fileNumber,
          reference: input.reference,
          cargo: parent.cargo,
          destination: parent.destination,
          pol: parent.pol,
          pod: parent.pod,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          parentId: parent.id,
          createdById: s.userId,
        },
      });
      await tx.container.updateMany({ where: { id: { in: ids } }, data: { bookingId: b.id } });
      await tx.costLine.updateMany({
        where: { containerId: { in: ids } },
        data: { bookingId: b.id },
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: parent.companyId,
          module: MODULE,
          action: 'sister_booking_opened',
          entity: 'booking',
          entityId: b.id,
          after: {
            reference: input.reference,
            fileNumber,
            parent: parent.reference,
            boxes: boxes.map((x) => x.number),
          },
          ip,
        },
        tx,
      );
      for (const x of boxes)
        await audit(
          {
            accountId: s.accountId,
            userId: s.userId,
            companyId: parent.companyId,
            module: MODULE,
            action: 'container_moved_to_sister',
            entity: 'container',
            entityId: x.id,
            before: { booking: parent.reference },
            after: { booking: input.reference, number: x.number },
            ip,
          },
          tx,
        );
      return b;
    });
    res.status(201).json({
      id: sister.id,
      reference: sister.reference,
      fileNumber: sister.fileNumber,
      moved: boxes.map((x) => x.number),
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- containers

const containersQuery = monthQuery.extend({ q: z.string().trim().max(20).optional() });

const containerSelect = {
  id: true,
  number: true,
  size: true,
  lot: true,
  stage: true,
  stageAt: true,
  status: true,
  duplicateOfId: true,
  responsibleCompanyId: true,
  lastPlace: true,
  lastSeenAt: true,
  holdReason: true,
  closedAt: true,
  createdAt: true,
  booking: {
    select: {
      id: true,
      reference: true,
      cargo: true,
      vessel: true,
      companyId: true,
      client: { select: { name: true } },
      shippingLine: { select: { name: true } },
    },
  },
} satisfies Prisma.ContainerSelect;

/**
 * Without `q`: this company's working list — the boxes it is responsible for (the switcher's company for the
 * MD), newest first; a box leaves it at the hand-over stage. With `handed`: the boxes of this company's
 * bookings that another company is now responsible for, read-only. With `q`: every box of the account whose
 * number contains it, read-only. That is how the other side finds a box that is not on its own list yet.
 */
shipmentsRouter.get('/containers', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const q = parseBody(containersQuery, req.query);
    const needle = q.q ? q.q.toUpperCase().replace(/[\s-]/g, '') : '';
    // One side, one company: a box is found only by the side it is on (the MD finds any).
    const where: Prisma.ContainerWhereInput = needle
      ? { accountId: s.accountId, number: { contains: needle }, ...bySide(s) }
      : { accountId: s.accountId, ...bySide(s), booking: { createdAt: monthRange(q.month) } };
    const [rows, names] = await Promise.all([
      prisma.container.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: containerSelect,
      }),
      companyNames(s.accountId),
    ]);
    const twins = await twinReferences(rows);
    res.json(
      rows.map((c) => ({
        ...c,
        responsibleCompanyName: names.get(c.responsibleCompanyId) ?? '',
        duplicateOf: c.duplicateOfId
          ? { bookingReference: twins.get(c.duplicateOfId) ?? '' }
          : null,
        booking: {
          ...c.booking,
          companyName: names.get(c.booking.companyId) ?? '',
          client: c.booking.client.name,
          line: c.booking.shippingLine.name,
        },
      })),
    );
  } catch (e) {
    next(e);
  }
});

/** Is this number well formed, and does the account already hold it? Lets the form say so before saving. */
/** Lot and weight may be corrected on a box by its booking's company; the number only through the MD's ruling. */
shipmentsRouter.patch('/containers/:id', ...canWriteBookings, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const patch = parseBody(containerPatch, req.body);
    const c = await prisma.container.findFirst({
      where: { id: String(req.params.id), ...byAccount(s) },
      select: {
        id: true,
        number: true,
        lot: true,
        weightKg: true,
        responsibleCompanyId: true,
        booking: { select: { companyId: true } },
      },
    });
    if (!c) throw notFound('Container not found');
    if (!mayTouchCompany(s, c.responsibleCompanyId))
      throw forbidden("This box is on the other company's side");
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.container.update({ where: { id: c.id }, data: patch });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: c.booking.companyId,
          module: MODULE,
          action: 'container_updated',
          entity: 'container',
          entityId: c.id,
          before: { lot: c.lot, weightKg: c.weightKg },
          after: patch,
          ip: clientIp(req),
        },
        tx,
      );
      return u;
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

shipmentsRouter.get(
  '/containers/check',
  requireAuth,
  requireScreen('book'),
  async (req, res, next) => {
    try {
      const s = scopeOf(req);
      await bookingCompany(s);
      const { number } = parseBody(
        z.object({ number: z.string().trim().min(1).max(20) }),
        req.query,
      );
      const check = checkContainerNumber(number);
      if (!check.ok) {
        res.json({ ...check, existing: null });
        return;
      }
      const twin = await prisma.container.findFirst({
        where: { accountId: s.accountId, number: check.number, status: 'ACTIVE' },
        select: { booking: { select: { reference: true, companyId: true } } },
      });
      const names = twin ? await companyNames(s.accountId) : null;
      res.json({
        ...check,
        existing: twin
          ? {
              bookingReference: twin.booking.reference,
              companyName: names?.get(twin.booking.companyId) ?? '',
            }
          : null,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------- the MD queue (duplicates only, for now)

const queueQuery = z.object({ status: z.enum(['OPEN', 'RESOLVED']).default('OPEN') });

const sideSelect = {
  id: true,
  number: true,
  size: true,
  lot: true,
  status: true,
  createdById: true,
  createdAt: true,
  booking: {
    select: {
      id: true,
      reference: true,
      cargo: true,
      vessel: true,
      companyId: true,
      client: { select: { name: true } },
    },
  },
} satisfies Prisma.ContainerSelect;

/** The two entries of a duplicate, side by side, so the MD rules with everything in view. */
shipmentsRouter.get(
  '/md-queue',
  requireAuth,
  requirePermission('reconcile'),
  async (req, res, next) => {
    try {
      const s = scopeOf(req);
      const q = parseBody(queueQuery, req.query);
      const items = await prisma.mdQueueItem.findMany({
        where: { ...byAccount(s), status: q.status },
        orderBy: { createdAt: q.status === 'OPEN' ? 'asc' : 'desc' },
        take: 200,
      });
      const ids = items
        .flatMap((i) => [
          i.entityId,
          (i.summary as { existingContainerId?: string }).existingContainerId ?? '',
        ])
        .filter(Boolean);
      const [boxes, names, people] = await Promise.all([
        prisma.container.findMany({ where: { id: { in: ids } }, select: sideSelect }),
        companyNames(s.accountId),
        prisma.user.findMany({
          where: { accountId: s.accountId },
          select: { id: true, name: true },
        }),
      ]);
      const who = new Map(people.map((p) => [p.id, p.name]));
      const side = (id: string | undefined) => {
        const c = boxes.find((b) => b.id === id);
        return c
          ? {
              ...c,
              createdBy: who.get(c.createdById) ?? '—',
              booking: {
                ...c.booking,
                companyName: names.get(c.booking.companyId) ?? '',
                client: c.booking.client.name,
              },
            }
          : null;
      };
      res.json(
        items.map((i) => ({
          ...i,
          resolvedBy: i.resolvedById ? (who.get(i.resolvedById) ?? '—') : null,
          newBox: side(i.entityId),
          existingBox: side((i.summary as { existingContainerId?: string }).existingContainerId),
        })),
      );
    } catch (e) {
      next(e);
    }
  },
);

shipmentsRouter.post(
  '/md-queue/:id/resolve',
  requireAuth,
  requirePermission('reconcile'),
  async (req, res, next) => {
    try {
      const s = scopeOf(req);
      const input = parseBody(duplicateResolution, req.body);
      const item = await prisma.mdQueueItem.findFirst({
        where: { id: String(req.params.id), ...byAccount(s) },
      });
      if (!item) throw notFound('Nothing waiting under that number');
      if (item.status !== 'OPEN') throw conflict('Already ruled on');
      // A payment that repeats a paid one (slice 6): the MD lets it through as genuine, or refuses it.
      if (item.kind === 'REPEAT_PAYMENT') {
        res.json(await resolveRepeatPayment(s, item, input, clientIp(req)));
        return;
      }
      // A cost or tip typed on a box that was on the other company's side: it counts, or it is voided.
      if (item.kind === 'COST_OTHER_SIDE') {
        if (input.resolution !== 'APPROVE' && input.resolution !== 'REFUSE')
          throw badRequest('Approve it or refuse it');
        if (input.resolution === 'REFUSE' && !input.reason)
          throw badRequest('Say why it is refused');
        const lineIds = (item.summary as { costLineIds?: string[] }).costLineIds ?? [];
        const ruled = await prisma.$transaction(async (tx) => {
          await tx.costLine.updateMany({
            where: { id: { in: lineIds }, status: 'PENDING_MD' },
            data:
              input.resolution === 'APPROVE'
                ? { status: 'ACTIVE' }
                : { status: 'VOID', voidReason: `Refused by the MD: ${input.reason}` },
          });
          const u = await tx.mdQueueItem.update({
            where: { id: item.id },
            data: {
              status: 'RESOLVED',
              resolution: input.resolution,
              resolvedById: s.userId,
              resolvedAt: new Date(),
            },
          });
          await audit(
            {
              accountId: s.accountId,
              userId: s.userId,
              companyId: item.companyId,
              module: MODULE,
              action:
                input.resolution === 'APPROVE'
                  ? 'other_side_cost_approved'
                  : 'other_side_cost_refused',
              entity: 'cost_line',
              entityId: lineIds[0] ?? null,
              after: { lines: lineIds.length, reason: input.reason ?? '', summary: item.summary },
              ip: clientIp(req),
            },
            tx,
          );
          return u;
        });
        res.json(ruled);
        return;
      }
      // Items that only inform the MD (slice 4: a cost on a box already closed to Finance) are noted, not ruled on.
      if (item.kind !== 'DUPLICATE_CONTAINER') {
        if (input.resolution !== 'NOTED') throw badRequest('This item is only noted');
        const noted = await prisma.$transaction(async (tx) => {
          const u = await tx.mdQueueItem.update({
            where: { id: item.id },
            data: {
              status: 'RESOLVED',
              resolution: 'NOTED',
              resolvedById: s.userId,
              resolvedAt: new Date(),
            },
          });
          await audit(
            {
              accountId: s.accountId,
              userId: s.userId,
              companyId: item.companyId,
              module: MODULE,
              action: 'queue_item_noted',
              entity: item.entity,
              entityId: item.entityId,
              after: { kind: item.kind, summary: item.summary },
              ip: clientIp(req),
            },
            tx,
          );
          return u;
        });
        res.json(noted);
        return;
      }
      if (input.resolution === 'NOTED') throw badRequest('A duplicate needs a ruling, not a note');
      if (item.kind !== 'DUPLICATE_CONTAINER') throw badRequest('Not a duplicate container');
      if (input.resolution === 'CORRECT_NUMBER' && !input.number)
        throw badRequest('Give the corrected number');

      const ip = clientIp(req);
      const resolved = await prisma
        .$transaction(async (tx) => {
          const fresh = await tx.container.findUniqueOrThrow({ where: { id: item.entityId } });
          if (fresh.status !== 'DUPLICATE') throw conflict('This entry was already changed');
          const twin = fresh.duplicateOfId
            ? await tx.container.findUnique({
                where: { id: fresh.duplicateOfId },
                select: { id: true, status: true },
              })
            : null;
          const before = { number: fresh.number, status: fresh.status };
          let after: Record<string, unknown>;
          if (input.resolution === 'WITHDRAW_NEW') {
            await tx.container.update({ where: { id: fresh.id }, data: { status: 'WITHDRAWN' } });
            after = { status: 'WITHDRAWN' };
          } else if (input.resolution === 'KEEP_NEW') {
            if (twin?.status === 'ACTIVE')
              await tx.container.update({ where: { id: twin.id }, data: { status: 'WITHDRAWN' } });
            await tx.container.update({
              where: { id: fresh.id },
              data: { status: 'ACTIVE', duplicateOfId: null },
            });
            after = { status: 'ACTIVE', withdrew: twin?.id ?? null };
          } else {
            const taken = await tx.container.findFirst({
              where: { accountId: s.accountId, number: input.number!, status: 'ACTIVE' },
              select: { booking: { select: { reference: true } } },
            });
            if (taken)
              throw badRequest(
                `${input.number} is also taken, by booking ${taken.booking.reference}`,
              );
            await tx.container.update({
              where: { id: fresh.id },
              data: { number: input.number!, status: 'ACTIVE', duplicateOfId: null },
            });
            after = { number: input.number, status: 'ACTIVE' };
          }
          const done = await tx.mdQueueItem.update({
            where: { id: item.id },
            data: {
              status: 'RESOLVED',
              resolution: input.resolution + (input.number ? ` ${input.number}` : ''),
              resolvedById: s.userId,
              resolvedAt: new Date(),
            },
          });
          await audit(
            {
              accountId: s.accountId,
              userId: s.userId,
              companyId: item.companyId,
              module: MODULE,
              action: 'duplicate_resolved',
              entity: 'container',
              entityId: fresh.id,
              before,
              after: { ...after, resolution: input.resolution },
              ip,
            },
            tx,
          );
          return done;
        })
        .catch(sameMoment);
      res.json(resolved);
    } catch (e) {
      next(e);
    }
  },
);
