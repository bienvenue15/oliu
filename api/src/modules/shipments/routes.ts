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
  bookingInput,
  bookingPatch,
  canOpenScreen,
  checkContainerNumber,
  clientInput,
  duplicateResolution,
  ROLE_PERMISSIONS,
  shippingLineInput,
  type Role,
} from '@oliu/shared';
import { byAccount, byCompany, mayTouchCompany, prisma, type Scope, type Tx } from '../../db.ts';
import { audit } from '../../lib/audit.ts';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.ts';
import { parseBody } from '../../lib/validate.ts';
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

type BookingHead = { id: string; reference: string; companyId: string };
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

const bookingSelect = {
  id: true,
  reference: true,
  cargo: true,
  destination: true,
  vessel: true,
  voyage: true,
  status: true,
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
    const [rows, names] = await Promise.all([
      prisma.booking.findMany({
        where: { ...byCompany(s), createdAt: monthRange(q.month) },
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

    const ip = clientIp(req);
    const result = await prisma
      .$transaction(async (tx) => {
        const booking = await tx.booking.create({
          data: {
            accountId: s.accountId,
            companyId,
            shippingLineId: line.id,
            clientId: client.id,
            reference: input.reference,
            cargo: input.cargo,
            destination: input.destination,
            vessel: input.vessel,
            voyage: input.voyage,
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
              reference: booking.reference,
              line: line.name,
              client: client.name,
              cargo: booking.cargo,
              vessel: booking.vessel,
              boxes: input.containers.length,
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
      },
    });
    if (!b) throw notFound('Booking not found');
    const [names, twins] = await Promise.all([
      companyNames(s.accountId),
      twinReferences(b.containers),
    ]);
    const role = s.role as Role;
    res.json({
      ...b,
      companyName: names.get(b.companyId) ?? '',
      containers: b.containers.map((c) => ({
        ...c,
        duplicateOf: c.duplicateOfId
          ? { bookingReference: twins.get(c.duplicateOfId) ?? '' }
          : null,
      })),
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

/** The booking of this account the caller may change, or the right error. */
async function ownBooking(s: Scope, id: string): Promise<BookingHead> {
  const b = await prisma.booking.findFirst({
    where: { id, ...byAccount(s) },
    select: { id: true, reference: true, companyId: true },
  });
  if (!b) throw notFound('Booking not found');
  if (!mayTouchCompany(s, b.companyId))
    throw forbidden('This booking belongs to the other company; you can read it, not change it');
  return b;
}

shipmentsRouter.patch('/bookings/:id', ...canWriteBookings, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const patch = parseBody(bookingPatch, req.body);
    const head = await ownBooking(s, String(req.params.id));
    const before = await prisma.booking.findUniqueOrThrow({
      where: { id: head.id },
      select: { cargo: true, destination: true, vessel: true, voyage: true },
    });
    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({ where: { id: head.id }, data: patch });
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

// ---------------------------------------------------------------- containers

const containersQuery = monthQuery.extend({ q: z.string().trim().max(20).optional() });

const containerSelect = {
  id: true,
  number: true,
  size: true,
  lot: true,
  stage: true,
  status: true,
  duplicateOfId: true,
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
 * Without `q`: the boxes of this company's bookings (the switcher's company for the MD), newest first.
 * With `q`: every box of the account whose number contains it, read-only. That is how the other side
 * finds a box that is not on its own working list yet.
 */
shipmentsRouter.get('/containers', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const q = parseBody(containersQuery, req.query);
    const needle = q.q ? q.q.toUpperCase().replace(/[\s-]/g, '') : '';
    const where: Prisma.ContainerWhereInput = needle
      ? { accountId: s.accountId, number: { contains: needle } }
      : { accountId: s.accountId, booking: { ...byCompany(s), createdAt: monthRange(q.month) } };
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
shipmentsRouter.get('/containers/check', requireAuth, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { number } = parseBody(z.object({ number: z.string().trim().min(1).max(20) }), req.query);
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
});

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
