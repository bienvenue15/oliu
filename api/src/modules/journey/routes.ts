/**
 * Journey — stages, positions and the hand-over (roadmap slice 4).
 *
 * "Where is this box, and whose is it now?" A box moves forward through the eight stages; each step is an
 * entry on its timeline with the moment it happened and who said so. Between stages, the person who deals
 * with transport types where the box is every few hours. At the account's hand-over stage (Rusumo for
 * OLIU · JIVAH) the responsible company flips: the box leaves one working list and appears on the other.
 * A box that sits at the ICD past its free days is at risk, and every cost dated inside that spell is
 * delay-related. When Operations is done with a box it is closed to Finance and counts in one P&L month.
 *
 * GET  /api/board                                   the working list by stage: columns, boxes coming, boxes handed over
 * GET  /api/containers/:id/journey                  one box's timeline, spells and what it can do next
 * POST /api/containers/:id/journey                  a stage reached · a position update · held · returned
 * POST /api/containers/:id/journey/correct          a wrong stage put right, with a reason (MD, Operations Manager)
 * POST /api/containers/:id/risk · /risk/clear       flag a box at risk by hand, lift the flag
 * GET  /api/bookings/:id/release                    the boxes of a booking, pre-ticked when their stage says so
 * POST /api/bookings/:id/release                    one sign-off for the ticked boxes
 * GET  /api/releases                                released lately, on this side
 * POST /api/containers/:id/close · /reopen          closed to Finance with its P&L month · reopened by the MD
 * GET  /api/closed?month=                           what closed in a P&L month, with its cost
 */
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  BOARD_COLUMNS,
  closeContainerInput,
  formatMoney,
  journeyInput,
  releaseInput,
  reopenInput,
  riskClearInput,
  riskFlagInput,
  ROAD_STAGES,
  STAGE_INDEX,
  STAGE_LABEL,
  STAGES,
  stageCorrectionInput,
  type Stage,
} from '@oliu/shared';
import {
  byAccount,
  byCompany,
  bySide,
  mayTouchCompany,
  prisma,
  spansAccount,
  type Scope,
} from '../../db.ts';
import { audit } from '../../lib/audit.ts';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.ts';
import { parseBody } from '../../lib/validate.ts';
import {
  clientIp,
  requireAuth,
  requirePermission,
  requireRole,
  requireScreen,
  scopeOf,
} from '../../middleware/auth.ts';
import {
  closeIcdRisk,
  dayOf,
  daysBetween,
  journeySettings,
  openRisk,
  refreshIcdRisk,
} from './risk.ts';

export const journeyRouter = Router();
const MODULE = 'journey';
const canTrack = [requireAuth, requireScreen('journey'), requirePermission('write')];
const canRelease = [requireAuth, requireScreen('rel'), requirePermission('write')];
const canClose = [requireAuth, requireScreen('handoff'), requirePermission('write')];

// ---------------------------------------------------------------- helpers

const idx = (s: Stage) => STAGE_INDEX[s];
const writerCompany = (s: Scope) => s.companyId ?? s.activeCompanyId ?? null;

/** A typed moment: a day, or a day and time; nothing means now. Never in the future. */
function momentOf(text: string | null, now = new Date()): Date {
  if (!text) return now;
  const d = new Date(text.length === 10 ? `${text}T00:00:00.000Z` : `${text.slice(0, 16)}:00.000Z`);
  if (Number.isNaN(d.getTime())) throw badRequest('That date is not real');
  if (d.getTime() > now.getTime() + 3_600_000) throw badRequest('That moment is in the future');
  return d;
}
const asDay = (text: string | null | undefined) =>
  text ? new Date(`${text}T00:00:00.000Z`) : undefined;
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

const boxSelect = {
  id: true,
  accountId: true,
  number: true,
  size: true,
  lot: true,
  weightKg: true,
  stage: true,
  stageAt: true,
  status: true,
  responsibleCompanyId: true,
  lastPlace: true,
  lastSeenAt: true,
  holdReason: true,
  icdSince: true,
  localOnly: true,
  releasedAt: true,
  releasedById: true,
  departedOn: true,
  arrivedOn: true,
  emptyReturnedOn: true,
  closedAt: true,
  closedOn: true,
  closedById: true,
  plMonth: true,
  readyToInvoice: true,
  createdAt: true,
  booking: {
    select: {
      id: true,
      reference: true,
      fileNumber: true,
      companyId: true,
      cargo: true,
      vessel: true,
      parentId: true,
      client: { select: { name: true } },
    },
  },
} satisfies Prisma.ContainerSelect;
type BoxRow = Prisma.ContainerGetPayload<{ select: typeof boxSelect }>;

async function loadBox(s: Scope, id: string): Promise<BoxRow> {
  const c = await prisma.container.findFirst({ where: { id, ...byAccount(s) }, select: boxSelect });
  if (!c) throw notFound('Container not found');
  return c;
}

/** The box may be moved by the company that booked it or the company responsible for it now; the MD anywhere. */
/** One box, one side: only the company responsible for it now moves it. The MD moves any. */
function assertMayMove(s: Scope, box: BoxRow) {
  if (!mayTouchCompany(s, box.responsibleCompanyId))
    throw forbidden("This box is on the other company's side; only that company moves it");
}
/** Reading a box's details is the same right; the other side sees only counts per stage on the board. */
function assertMaySee(s: Scope, box: BoxRow) {
  if (!spansAccount(s) && !mayTouchCompany(s, box.responsibleCompanyId))
    throw forbidden("This box is on the other company's side");
}
function assertLive(box: BoxRow) {
  if (box.status !== 'ACTIVE')
    throw conflict(`This box is ${box.status.toLowerCase()}; it does not move`);
  if (box.closedAt)
    throw conflict('This box is closed to Finance; the Managing Director can reopen it');
}

async function companyNames(accountId: string): Promise<Map<string, string>> {
  const rows = await prisma.company.findMany({
    where: { accountId },
    select: { id: true, legalName: true },
    orderBy: { createdAt: 'asc' },
  });
  return new Map(rows.map((r) => [r.id, r.legalName]));
}
async function userNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

type AccountHead = { package: string; handoverStage: Stage | null };
async function accountOf(accountId: string): Promise<AccountHead> {
  const a = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { package: true, handoverStage: true },
  });
  return { package: a.package, handoverStage: a.handoverStage as Stage | null };
}

/**
 * The company a box goes to at the hand-over: the one named, or the only other company of the account that
 * keeps its own book. With three or more such companies the person must say which.
 */
async function handoverTarget(
  s: Scope,
  box: BoxRow,
  toCompanyId: string | undefined,
): Promise<{ id: string; legalName: string }> {
  const others = await prisma.company.findMany({
    where: {
      accountId: s.accountId,
      kind: { not: 'BRANCH' },
      id: { not: box.responsibleCompanyId },
    },
    select: { id: true, legalName: true },
    orderBy: { createdAt: 'asc' },
  });
  if (toCompanyId) {
    const t = others.find((o) => o.id === toCompanyId);
    if (!t) throw badRequest('That company cannot take the box');
    return t;
  }
  if (others.length === 1) return others[0]!;
  if (others.length === 0) throw conflict('No other company in the account to hand the box to');
  throw badRequest('Say which company takes the box (toCompanyId)');
}

/** Does moving from `from` to `to` cross the hand-over stage forwards? */
const crossesHandover = (a: AccountHead, from: Stage, to: Stage) =>
  a.package === 'GROUP' &&
  !!a.handoverStage &&
  idx(from) < idx(a.handoverStage) &&
  idx(to) >= idx(a.handoverStage);

const laterOf = (a: Date | null, b: Date) => (a && a > b ? a : b);

/** What the screens get: the box with its words and flags, never a raw enum alone. */
function shapeBox(
  c: BoxRow,
  names: Map<string, string>,
  risk: { source: string; reason: string; from: Date } | null,
  settings: { trackingHours: number; icdFreeDays: number },
  now = new Date(),
) {
  const stage = c.stage as Stage;
  const seen = c.lastSeenAt ?? c.stageAt ?? c.createdAt;
  const hoursSinceSeen = Math.floor((now.getTime() - seen.getTime()) / 3_600_000);
  const onRoad = ROAD_STAGES.includes(stage) && !c.closedAt;
  return {
    id: c.id,
    number: c.number,
    size: c.size,
    lot: c.lot,
    weightKg: c.weightKg,
    status: c.status,
    stage,
    stageLabel: STAGE_LABEL[stage],
    column: BOARD_COLUMNS.find((col) => col.stages.includes(stage))?.key ?? 'booked',
    stageAt: c.stageAt,
    place: c.lastPlace,
    lastSeenAt: c.lastSeenAt,
    /** The moment the board counts from: last position, else the stage change, else the booking. */
    seenAt: seen.toISOString(),
    hoursSinceSeen,
    /** On the road and not heard of for longer than the account's tracking hours. */
    updateOverdue: onRoad && hoursSinceSeen >= settings.trackingHours,
    held: c.holdReason !== '',
    holdReason: c.holdReason,
    atRisk: !!risk,
    risk: risk
      ? { source: risk.source, reason: risk.reason, since: risk.from.toISOString().slice(0, 10) }
      : null,
    daysAtIcd: stage === 'ICD' && c.icdSince ? daysBetween(c.icdSince, now) : null,
    icdFreeDays: settings.icdFreeDays,
    localOnly: c.localOnly,
    responsibleCompanyId: c.responsibleCompanyId,
    responsibleCompanyName: names.get(c.responsibleCompanyId) ?? '',
    originCompanyId: c.booking.companyId,
    originCompanyName: names.get(c.booking.companyId) ?? '',
    released: !!c.releasedAt,
    releasedAt: c.releasedAt,
    departedOn: c.departedOn,
    arrivedOn: c.arrivedOn,
    emptyReturnedOn: c.emptyReturnedOn,
    closed: !!c.closedAt,
    closedAt: c.closedAt,
    closedOn: c.closedOn,
    plMonth: c.plMonth,
    readyToInvoice: c.readyToInvoice,
    booking: {
      id: c.booking.id,
      reference: c.booking.reference,
      fileNumber: c.booking.fileNumber,
      cargo: c.booking.cargo,
      vessel: c.booking.vessel,
      client: c.booking.client.name,
      isSister: !!c.booking.parentId,
    },
  };
}

/** Refreshes the ICD spell of every box at the ICD, then returns each box's open spell. */
async function risksFor(boxes: BoxRow[], icdFreeDays: number) {
  const now = new Date();
  for (const b of boxes) if (b.stage === 'ICD') await refreshIcdRisk(prisma, b, icdFreeDays, now);
  const ids = boxes.map((b) => b.id);
  const open = ids.length
    ? await prisma.riskPeriod.findMany({
        where: { containerId: { in: ids }, to: null },
        orderBy: { from: 'asc' },
        select: { containerId: true, source: true, reason: true, from: true },
      })
    : [];
  const byBox = new Map<string, (typeof open)[number]>();
  for (const r of open) if (!byBox.has(r.containerId)) byBox.set(r.containerId, r);
  return byBox;
}

async function shapeBoxes(boxes: BoxRow[], accountId: string) {
  const [names, settings] = await Promise.all([
    companyNames(accountId),
    journeySettings(accountId),
  ]);
  const risks = await risksFor(boxes, settings.icdFreeDays);
  const now = new Date();
  return boxes.map((b) => shapeBox(b, names, risks.get(b.id) ?? null, settings, now));
}

// ---------------------------------------------------------------- the board

const boardQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

/**
 * The working list, by stage. A one-company user sees the boxes their company is responsible for; the MD sees
 * every box, or the switcher's company. `coming`: boxes on the other side that are past the warehouse and will
 * cross to this side. `handedOver`: this company's bookings whose boxes are now on the other side.
 */
journeyRouter.get('/board', requireAuth, requireScreen('cont'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    parseBody(boardQuery, req.query);
    const mine = writerCompany(s);
    const account = await accountOf(s.accountId);
    const live = { ...byAccount(s), status: 'ACTIVE' as const, closedAt: null };
    // What the other side shows of its boxes: a count per stage, to the Operations Manager only, nothing else.
    const seesOtherSide = mine !== null && (s.role === 'OPS_MANAGER' || spansAccount(s));
    const countsByStage = async (where: Prisma.ContainerWhereInput) => {
      const rows = await prisma.container.groupBy({ by: ['stage'], where, _count: { _all: true } });
      return STAGES.filter((st) => rows.some((r) => r.stage === st)).map((st) => ({
        stage: st,
        label: STAGE_LABEL[st],
        count: rows.find((r) => r.stage === st)!._count._all,
      }));
    };
    const [boxes, coming, handedOver] = await Promise.all([
      prisma.container.findMany({
        where: { ...live, ...(mine ? { responsibleCompanyId: mine } : {}) },
        orderBy: [{ stageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: 1000,
        select: boxSelect,
      }),
      // Coming to my side: the other side's boxes from "loaded, on the road" up to the hand-over, as counts.
      seesOtherSide && account.package === 'GROUP' && account.handoverStage
        ? countsByStage({
            ...live,
            responsibleCompanyId: { not: mine! },
            localOnly: false,
            stage: {
              in: STAGES.filter(
                (st) => idx(st) >= idx('TRANSPORT') && idx(st) < idx(account.handoverStage!),
              ),
            },
          })
        : Promise.resolve([]),
      // Handed over: my bookings' boxes now on the other side, as counts.
      seesOtherSide
        ? countsByStage({
            ...live,
            booking: { companyId: mine! },
            responsibleCompanyId: { not: mine! },
          })
        : Promise.resolve([]),
    ]);
    const settings = await journeySettings(s.accountId);
    const shaped = await shapeBoxes(boxes, s.accountId);
    res.json({
      columns: BOARD_COLUMNS.map((col) => ({
        key: col.key,
        label: col.label,
        stages: col.stages,
        count: shaped.filter((b) => b.column === col.key).length,
      })),
      boxes: shaped,
      coming,
      handedOver,
      settings,
      handoverStage: account.handoverStage,
      stages: STAGES.map((st) => ({ key: st, label: STAGE_LABEL[st] })),
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- one box's timeline

journeyRouter.get(
  '/containers/:id/journey',
  requireAuth,
  requireScreen('cont'),
  async (req, res, next) => {
    try {
      const s = scopeOf(req);
      const box = await loadBox(s, String(req.params.id));
      assertMaySee(s, box);
      const [events, periods, names] = await Promise.all([
        prisma.journeyEvent.findMany({
          where: { containerId: box.id },
          orderBy: [{ happenedAt: 'asc' }, { createdAt: 'asc' }],
        }),
        prisma.riskPeriod.findMany({ where: { containerId: box.id }, orderBy: { from: 'asc' } }),
        companyNames(s.accountId),
      ]);
      const people = await userNames([
        ...events.map((e) => e.byId),
        ...periods.flatMap((p) => [p.openedById, p.closedById]),
        box.releasedById,
        box.closedById,
      ]);
      const [shaped] = await shapeBoxes([box], s.accountId);
      const account = await accountOf(s.accountId);
      const cur = box.stage as Stage;
      res.json({
        box: shaped,
        mayMove:
          !box.closedAt && box.status === 'ACTIVE' && mayTouchCompany(s, box.responsibleCompanyId),
        handoverStage: account.handoverStage,
        nextStages: STAGES.filter((st) => idx(st) > idx(cur)).map((st) => ({
          key: st,
          label: STAGE_LABEL[st],
        })),
        events: events.map((e) => ({
          id: e.id,
          kind: e.kind,
          stage: e.stage,
          stageLabel: e.stage ? STAGE_LABEL[e.stage as Stage] : '',
          place: e.place,
          note: e.note,
          happenedAt: e.happenedAt,
          typedAt: e.createdAt,
          by: people.get(e.byId) ?? '—',
          companyName: e.companyId ? (names.get(e.companyId) ?? '') : '',
          handedTo: e.handedToCompanyId ? (names.get(e.handedToCompanyId) ?? '') : '',
        })),
        riskPeriods: periods.map((p) => ({
          id: p.id,
          source: p.source,
          reason: p.reason,
          from: p.from.toISOString().slice(0, 10),
          to: p.to ? p.to.toISOString().slice(0, 10) : null,
          openedBy: p.openedById ? (people.get(p.openedById) ?? '—') : 'the system',
          closedBy: p.closedById ? (people.get(p.closedById) ?? '—') : p.to ? 'the system' : '',
        })),
        releasedBy: box.releasedById ? (people.get(box.releasedById) ?? '—') : '',
        closedBy: box.closedById ? (people.get(box.closedById) ?? '—') : '',
      });
    } catch (e) {
      next(e);
    }
  },
);

/** The dates of the Ocean freight stage, when the entry carries them. */
function oceanDates(input: {
  departedOn?: string | null;
  arrivedOn?: string | null;
  emptyReturnedOn?: string | null;
}) {
  const out: Prisma.ContainerUpdateInput = {};
  if (input.departedOn !== undefined) out.departedOn = asDay(input.departedOn) ?? null;
  if (input.arrivedOn !== undefined) out.arrivedOn = asDay(input.arrivedOn) ?? null;
  if (input.emptyReturnedOn !== undefined)
    out.emptyReturnedOn = asDay(input.emptyReturnedOn) ?? null;
  return out;
}

journeyRouter.post('/containers/:id/journey', ...canTrack, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(journeyInput, req.body);
    const box = await loadBox(s, String(req.params.id));
    assertMayMove(s, box);
    assertLive(box);
    const account = await accountOf(s.accountId);
    const at = momentOf(input.happenedAt);
    const cur = box.stage as Stage;
    const ip = clientIp(req);
    const base = {
      accountId: s.accountId,
      userId: s.userId,
      companyId: writerCompany(s),
      module: MODULE,
      entity: 'container',
      entityId: box.id,
      ip,
    };
    const eventBase = {
      accountId: s.accountId,
      containerId: box.id,
      companyId: writerCompany(s),
      place: input.place,
      note: input.note,
      happenedAt: at,
      byId: s.userId,
    };

    if (input.kind === 'REACHED') {
      const to = input.stage!;
      if (idx(to) < idx(cur))
        throw badRequest(
          `The box is already past ${STAGE_LABEL[to]}; going back is a correction, with a reason`,
        );
      if (to === cur)
        throw badRequest(
          `The box is already at ${STAGE_LABEL[to]}; type a position update instead`,
        );
      const target =
        crossesHandover(account, cur, to) && !box.localOnly
          ? await handoverTarget(s, box, input.toCompanyId)
          : null;
      await prisma.$transaction(async (tx) => {
        if (cur === 'ICD') await closeIcdRisk(tx, box.id, at);
        await tx.container.update({
          where: { id: box.id },
          data: {
            stage: to,
            stageAt: at,
            lastPlace: input.place || STAGE_LABEL[to],
            lastSeenAt: laterOf(box.lastSeenAt, at),
            holdReason: '',
            ...(to === 'ICD' ? { icdSince: at } : {}),
            ...(target ? { responsibleCompanyId: target.id } : {}),
            ...oceanDates(input),
          },
        });
        await tx.journeyEvent.create({
          data: { ...eventBase, kind: 'REACHED', stage: to, handedToCompanyId: target?.id ?? null },
        });
        await audit(
          {
            ...base,
            action: 'stage_reached',
            before: { stage: cur },
            after: { stage: to, place: input.place, happenedAt: at, number: box.number },
          },
          tx,
        );
        if (target)
          await audit(
            {
              ...base,
              action: 'handed_over',
              before: { responsibleCompanyId: box.responsibleCompanyId },
              after: {
                responsibleCompanyId: target.id,
                company: target.legalName,
                stage: to,
                number: box.number,
              },
            },
            tx,
          );
      });
    } else if (input.kind === 'UPDATE') {
      await prisma.$transaction(async (tx) => {
        await tx.container.update({
          where: { id: box.id },
          data: {
            lastPlace: input.place,
            lastSeenAt: laterOf(box.lastSeenAt, at),
            ...oceanDates(input),
          },
        });
        await tx.journeyEvent.create({ data: { ...eventBase, kind: 'UPDATE', stage: cur } });
        await audit(
          {
            ...base,
            action: 'position_updated',
            after: { place: input.place, happenedAt: at, number: box.number },
          },
          tx,
        );
      });
    } else if (input.kind === 'HELD') {
      await prisma.$transaction(async (tx) => {
        await tx.container.update({
          where: { id: box.id },
          data: {
            holdReason: input.note,
            lastPlace: input.place || box.lastPlace,
            lastSeenAt: laterOf(box.lastSeenAt, at),
          },
        });
        await tx.journeyEvent.create({ data: { ...eventBase, kind: 'HELD', stage: cur } });
        await audit(
          {
            ...base,
            action: 'held',
            after: { reason: input.note, place: input.place, number: box.number },
          },
          tx,
        );
      });
    } else if (input.kind === 'HOLD_LIFTED') {
      // The hold is over but the box has not moved yet: the flag goes, the stage and place stay.
      if (box.holdReason === '') throw badRequest('This box is not held');
      await prisma.$transaction(async (tx) => {
        await tx.container.update({
          where: { id: box.id },
          data: {
            holdReason: '',
            lastPlace: input.place || box.lastPlace,
            lastSeenAt: laterOf(box.lastSeenAt, at),
          },
        });
        await tx.journeyEvent.create({ data: { ...eventBase, kind: 'HOLD_LIFTED', stage: cur } });
        await audit(
          {
            ...base,
            action: 'hold_lifted',
            before: { reason: box.holdReason },
            after: { note: input.note, place: input.place, number: box.number },
          },
          tx,
        );
      });
    } else {
      // RETURNED: sent back from the border to the Kigali side. A box past Rusumo is not returned; correct it.
      if (idx(cur) > idx('RUSUMO'))
        throw badRequest('A box past Rusumo is not returned; correct the stage with a reason');
      const flipBack = account.handoverStage ? idx(cur) >= idx(account.handoverStage) : false;
      await prisma.$transaction(async (tx) => {
        await tx.container.update({
          where: { id: box.id },
          data: {
            stage: 'FIELD_RELEASE',
            stageAt: at,
            holdReason: '',
            lastPlace: input.place || 'Returned from Rusumo',
            lastSeenAt: laterOf(box.lastSeenAt, at),
            ...(flipBack ? { responsibleCompanyId: box.booking.companyId } : {}),
          },
        });
        await tx.journeyEvent.create({
          data: {
            ...eventBase,
            kind: 'RETURNED',
            stage: 'FIELD_RELEASE',
            handedToCompanyId: flipBack ? box.booking.companyId : null,
          },
        });
        await audit(
          {
            ...base,
            action: 'returned',
            before: { stage: cur, responsibleCompanyId: box.responsibleCompanyId },
            after: {
              stage: 'FIELD_RELEASE',
              responsibleCompanyId: flipBack ? box.booking.companyId : box.responsibleCompanyId,
              note: input.note,
              number: box.number,
            },
          },
          tx,
        );
      });
    }
    const [shaped] = await shapeBoxes([await loadBox(s, box.id)], s.accountId);
    res.status(201).json(shaped);
  } catch (e) {
    next(e);
  }
});

/** A wrong stage put right, forwards or backwards; the responsible company follows the hand-over rule. */
journeyRouter.post(
  '/containers/:id/journey/correct',
  requireAuth,
  requireScreen('journey'),
  requireRole('MD', 'OPS_MANAGER'),
  async (req, res, next) => {
    try {
      const s = scopeOf(req);
      const input = parseBody(stageCorrectionInput, req.body);
      const box = await loadBox(s, String(req.params.id));
      assertMayMove(s, box);
      assertLive(box);
      const account = await accountOf(s.accountId);
      const cur = box.stage as Stage;
      if (input.stage === cur) throw badRequest(`The box is already at ${STAGE_LABEL[cur]}`);
      const now = new Date();
      let responsibleCompanyId = box.responsibleCompanyId;
      if (account.package === 'GROUP' && account.handoverStage && !box.localOnly) {
        const past = idx(input.stage) >= idx(account.handoverStage);
        if (past && idx(cur) < idx(account.handoverStage)) {
          // The company it went to last time it crossed, if it ever did.
          const last = await prisma.journeyEvent.findFirst({
            where: { containerId: box.id, handedToCompanyId: { not: box.booking.companyId } },
            orderBy: { createdAt: 'desc' },
            select: { handedToCompanyId: true },
          });
          responsibleCompanyId = (
            await handoverTarget(s, box, last?.handedToCompanyId ?? undefined)
          ).id;
        } else if (!past) responsibleCompanyId = box.booking.companyId;
      }
      await prisma.$transaction(async (tx) => {
        if (cur === 'ICD' && input.stage !== 'ICD') await closeIcdRisk(tx, box.id, now);
        await tx.container.update({
          where: { id: box.id },
          data: {
            stage: input.stage,
            stageAt: now,
            responsibleCompanyId,
            ...(input.stage === 'ICD' && cur !== 'ICD' ? { icdSince: now } : {}),
          },
        });
        await tx.journeyEvent.create({
          data: {
            accountId: s.accountId,
            containerId: box.id,
            companyId: writerCompany(s),
            kind: 'CORRECTED',
            stage: input.stage,
            note: input.reason,
            happenedAt: now,
            byId: s.userId,
            handedToCompanyId:
              responsibleCompanyId !== box.responsibleCompanyId ? responsibleCompanyId : null,
          },
        });
        await audit(
          {
            accountId: s.accountId,
            userId: s.userId,
            companyId: writerCompany(s),
            module: MODULE,
            action: 'stage_corrected',
            entity: 'container',
            entityId: box.id,
            before: { stage: cur, responsibleCompanyId: box.responsibleCompanyId },
            after: {
              stage: input.stage,
              responsibleCompanyId,
              reason: input.reason,
              number: box.number,
            },
            ip: clientIp(req),
          },
          tx,
        );
      });
      const [shaped] = await shapeBoxes([await loadBox(s, box.id)], s.accountId);
      res.json(shaped);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------- at risk, by hand

journeyRouter.post('/containers/:id/risk', ...canTrack, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { reason } = parseBody(riskFlagInput, req.body);
    const box = await loadBox(s, String(req.params.id));
    assertMayMove(s, box);
    assertLive(box);
    if (await openRisk(prisma, box.id)) throw conflict('This box is already at risk');
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.riskPeriod.create({
        data: {
          accountId: s.accountId,
          containerId: box.id,
          source: 'MANUAL',
          reason,
          from: dayOf(now),
          openedById: s.userId,
        },
      });
      await tx.journeyEvent.create({
        data: {
          accountId: s.accountId,
          containerId: box.id,
          companyId: writerCompany(s),
          kind: 'FLAGGED',
          stage: box.stage,
          note: reason,
          happenedAt: now,
          byId: s.userId,
        },
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: writerCompany(s),
          module: MODULE,
          action: 'risk_flagged',
          entity: 'container',
          entityId: box.id,
          after: { reason, number: box.number },
          ip: clientIp(req),
        },
        tx,
      );
    });
    const [shaped] = await shapeBoxes([await loadBox(s, box.id)], s.accountId);
    res.status(201).json(shaped);
  } catch (e) {
    next(e);
  }
});

journeyRouter.post('/containers/:id/risk/clear', ...canTrack, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const { note } = parseBody(riskClearInput, req.body);
    const box = await loadBox(s, String(req.params.id));
    assertMayMove(s, box);
    const open = await prisma.riskPeriod.findMany({
      where: { containerId: box.id, to: null },
      select: { id: true, from: true },
    });
    if (open.length === 0) throw conflict('This box is not at risk');
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const p of open)
        await tx.riskPeriod.update({
          where: { id: p.id },
          data: { to: dayOf(now) < p.from ? p.from : dayOf(now), closedById: s.userId },
        });
      await tx.journeyEvent.create({
        data: {
          accountId: s.accountId,
          containerId: box.id,
          companyId: writerCompany(s),
          kind: 'CLEARED',
          stage: box.stage,
          note,
          happenedAt: now,
          byId: s.userId,
        },
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: writerCompany(s),
          module: MODULE,
          action: 'risk_cleared',
          entity: 'container',
          entityId: box.id,
          after: { note, spells: open.length, number: box.number },
          ip: clientIp(req),
        },
        tx,
      );
    });
    const [shaped] = await shapeBoxes([await loadBox(s, box.id)], s.accountId);
    res.json(shaped);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- release

async function releaseView(s: Scope, bookingId: string) {
  const b = await prisma.booking.findFirst({
    where: { id: bookingId, ...byAccount(s) },
    select: {
      id: true,
      reference: true,
      fileNumber: true,
      companyId: true,
      status: true,
      parentId: true,
      shippingLine: { select: { name: true } },
      client: { select: { name: true } },
      sisters: { select: { id: true, reference: true } },
      containers: {
        where: { status: 'ACTIVE', ...bySide(s) },
        orderBy: { createdAt: 'asc' },
        select: boxSelect,
      },
    },
  });
  if (!b) throw notFound('Booking not found');
  // One side, one company: the booking's company, or the side holding some of its boxes, reads the release view.
  if (!spansAccount(s) && !mayTouchCompany(s, b.companyId) && b.containers.length === 0)
    throw forbidden("This booking is on the other company's side");
  const boxes = await shapeBoxes(b.containers, s.accountId);
  const names = await companyNames(s.accountId);
  return {
    booking: {
      id: b.id,
      reference: b.reference,
      fileNumber: b.fileNumber,
      status: b.status,
      companyName: names.get(b.companyId) ?? '',
      line: b.shippingLine.name,
      client: b.client.name,
      isSister: !!b.parentId,
      sisters: b.sisters,
    },
    containers: boxes.map((c) => ({
      ...c,
      /** Pre-ticked only when its own status says it has reached the port. */
      preselected: !c.released && idx(c.stage) >= idx('PORT'),
    })),
    elsewhere: spansAccount(s)
      ? 0
      : await prisma.container.count({
          where: { bookingId: b.id, status: 'ACTIVE', NOT: bySide(s) },
        }),
    mayRelease:
      b.status !== 'CANCELLED' &&
      b.containers.some((c) => mayTouchCompany(s, c.responsibleCompanyId)),
    maySplit: b.status !== 'CANCELLED' && mayTouchCompany(s, b.companyId),
  };
}

journeyRouter.get(
  '/bookings/:id/release',
  requireAuth,
  requireScreen('rel'),
  async (req, res, next) => {
    try {
      res.json(await releaseView(scopeOf(req), String(req.params.id)));
    } catch (e) {
      next(e);
    }
  },
);

/** One sign-off for the ticked boxes. A box whose status says it is not at the port yet is refused, not quietly released. */
journeyRouter.post('/bookings/:id/release', ...canRelease, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(releaseInput, req.body);
    const view = await releaseView(s, String(req.params.id));
    if (!view.mayRelease)
      throw forbidden(
        "This booking is on the other company's side; you can read it, not release it",
      );
    const chosen = input.containerIds.map((id) => view.containers.find((c) => c.id === id));
    if (chosen.some((c) => !c))
      throw badRequest('One of the boxes is not a live container of this booking');
    const boxes = chosen as NonNullable<(typeof chosen)[number]>[];
    for (const c of boxes) {
      if (idx(c.stage) < idx('PORT'))
        throw badRequest(
          `${c.number} is ${c.stageLabel.toLowerCase()}, not at the port; correct its stage first if that is wrong`,
        );
      if (!mayTouchCompany(s, c.responsibleCompanyId))
        throw forbidden(`${c.number} is on the other company's side`);
      if (c.released) throw conflict(`${c.number} is already released`);
      if (c.closed) throw conflict(`${c.number} is closed to Finance`);
    }
    const at = input.releasedOn ? momentOf(input.releasedOn) : new Date();
    const ip = clientIp(req);
    await prisma.$transaction(async (tx) => {
      for (const c of boxes) {
        await tx.container.update({
          where: { id: c.id },
          data: { releasedAt: at, releasedById: s.userId },
        });
        await tx.journeyEvent.create({
          data: {
            accountId: s.accountId,
            containerId: c.id,
            companyId: writerCompany(s),
            kind: 'RELEASED',
            stage: c.stage,
            note: input.note,
            happenedAt: at,
            byId: s.userId,
          },
        });
        await audit(
          {
            accountId: s.accountId,
            userId: s.userId,
            companyId: writerCompany(s),
            module: MODULE,
            action: 'released',
            entity: 'container',
            entityId: c.id,
            after: {
              number: c.number,
              booking: view.booking.reference,
              releasedOn: at,
              note: input.note,
            },
            ip,
          },
          tx,
        );
      }
    });
    res.status(201).json(await releaseView(s, view.booking.id));
  } catch (e) {
    next(e);
  }
});

const releasesQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

/** Released lately on this side: the boxes this company is responsible for. */
journeyRouter.get('/releases', requireAuth, requireScreen('rel'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const q = parseBody(releasesQuery, req.query);
    const rows = await prisma.container.findMany({
      where: {
        ...byAccount(s),
        releasedAt: { not: null },
        ...bySide(s),
      },
      orderBy: { releasedAt: 'desc' },
      take: q.limit,
      select: boxSelect,
    });
    const people = await userNames(rows.map((r) => r.releasedById));
    const shaped = await shapeBoxes(rows, s.accountId);
    res.json(
      shaped.map((c, i) => ({ ...c, releasedBy: people.get(rows[i]!.releasedById ?? '') ?? '—' })),
    );
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- closing to Finance

journeyRouter.post('/containers/:id/close', ...canClose, async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const input = parseBody(closeContainerInput, req.body);
    const box = await loadBox(s, String(req.params.id));
    if (!mayTouchCompany(s, box.responsibleCompanyId))
      throw forbidden('The company responsible for the box closes it');
    assertLive(box);
    const now = new Date();
    const closedOn = input.closedOn ? momentOf(input.closedOn, now) : now;
    const plMonth = input.plMonth ?? monthOf(closedOn);
    const localOnly = idx(box.stage as Stage) <= idx('FIELD_RELEASE');
    await prisma.$transaction(async (tx) => {
      if (box.stage === 'ICD') await closeIcdRisk(tx, box.id, closedOn);
      await tx.container.update({
        where: { id: box.id },
        data: {
          closedAt: now,
          closedOn: dayOf(closedOn),
          closedById: s.userId,
          plMonth,
          readyToInvoice: input.readyToInvoice,
          localOnly: box.localOnly || localOnly,
        },
      });
      await tx.journeyEvent.create({
        data: {
          accountId: s.accountId,
          containerId: box.id,
          companyId: writerCompany(s),
          kind: 'CLOSED',
          stage: box.stage,
          note: input.note,
          happenedAt: closedOn,
          byId: s.userId,
        },
      });
      await audit(
        {
          accountId: s.accountId,
          userId: s.userId,
          companyId: writerCompany(s),
          module: MODULE,
          action: 'container_closed',
          entity: 'container',
          entityId: box.id,
          after: {
            number: box.number,
            closedOn: dayOf(closedOn),
            plMonth,
            readyToInvoice: input.readyToInvoice,
            localOnly: box.localOnly || localOnly,
            note: input.note,
          },
          ip: clientIp(req),
        },
        tx,
      );
    });
    const [shaped] = await shapeBoxes([await loadBox(s, box.id)], s.accountId);
    res.status(201).json(shaped);
  } catch (e) {
    next(e);
  }
});

journeyRouter.post(
  '/containers/:id/reopen',
  requireAuth,
  requireRole('MD'),
  async (req, res, next) => {
    try {
      const s = scopeOf(req);
      const { reason } = parseBody(reopenInput, req.body);
      const box = await loadBox(s, String(req.params.id));
      if (!box.closedAt) throw conflict('This box is not closed');
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.container.update({
          where: { id: box.id },
          data: {
            closedAt: null,
            closedOn: null,
            closedById: null,
            plMonth: '',
            readyToInvoice: false,
          },
        });
        await tx.journeyEvent.create({
          data: {
            accountId: s.accountId,
            containerId: box.id,
            companyId: writerCompany(s),
            kind: 'REOPENED',
            stage: box.stage,
            note: reason,
            happenedAt: now,
            byId: s.userId,
          },
        });
        await audit(
          {
            accountId: s.accountId,
            userId: s.userId,
            module: MODULE,
            action: 'container_reopened',
            entity: 'container',
            entityId: box.id,
            before: { plMonth: box.plMonth, closedOn: box.closedOn },
            after: { reason, number: box.number },
            ip: clientIp(req),
          },
          tx,
        );
      });
      const [shaped] = await shapeBoxes([await loadBox(s, box.id)], s.accountId);
      res.json(shaped);
    } catch (e) {
      next(e);
    }
  },
);

const closedQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

/** What closed in a P&L month, with the cost of each box in the caller's book(s), and the boxes ready to close. */
journeyRouter.get('/closed', requireAuth, requireScreen('handoff'), async (req, res, next) => {
  try {
    const s = scopeOf(req);
    const q = parseBody(closedQuery, req.query);
    const month = q.month ?? monthOf(new Date());
    const mine = writerCompany(s);
    const side = mine ? { responsibleCompanyId: mine } : {};
    const [closed, candidates] = await Promise.all([
      prisma.container.findMany({
        where: { ...byAccount(s), plMonth: month, closedAt: { not: null }, ...side },
        orderBy: { closedAt: 'desc' },
        take: 500,
        select: boxSelect,
      }),
      prisma.container.findMany({
        where: {
          ...byAccount(s),
          status: 'ACTIVE',
          closedAt: null,
          stage: 'OCEAN_FREIGHT',
          ...side,
        },
        orderBy: { stageAt: { sort: 'desc', nulls: 'last' } },
        take: 200,
        select: boxSelect,
      }),
    ]);
    const ids = [...closed, ...candidates].map((c) => c.id);
    const lines = ids.length
      ? await prisma.costLine.findMany({
          where: { containerId: { in: ids }, ...byCompany(s), status: 'ACTIVE' },
          select: { containerId: true, usdCents: true, delayRelated: true },
        })
      : [];
    const cost = new Map<string, { usdCents: number; delayCents: number }>();
    for (const l of lines) {
      const t = cost.get(l.containerId) ?? { usdCents: 0, delayCents: 0 };
      t.usdCents += Number(l.usdCents);
      if (l.delayRelated) t.delayCents += Number(l.usdCents);
      cost.set(l.containerId, t);
    }
    const people = await userNames(closed.map((c) => c.closedById));
    const withCost = (rows: Awaited<ReturnType<typeof shapeBoxes>>, src: BoxRow[]) =>
      rows.map((c, i) => {
        const t = cost.get(c.id) ?? { usdCents: 0, delayCents: 0 };
        return {
          ...c,
          costUsd: formatMoney(t.usdCents, 'USD'),
          costUsdCents: t.usdCents,
          delayUsd: formatMoney(t.delayCents, 'USD'),
          closedBy: src[i]!.closedById ? (people.get(src[i]!.closedById!) ?? '—') : '',
        };
      });
    const closedShaped = withCost(await shapeBoxes(closed, s.accountId), closed);
    res.json({
      month,
      closed: closedShaped,
      candidates: withCost(await shapeBoxes(candidates, s.accountId), candidates),
      totals: {
        boxes: closedShaped.length,
        costUsd: formatMoney(
          closedShaped.reduce((a, c) => a + c.costUsdCents, 0),
          'USD',
        ),
      },
    });
  } catch (e) {
    next(e);
  }
});
