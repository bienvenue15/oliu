/**
 * The demo seed is part of the product: the owner tests every slice on it. It must keep building the planned
 * world (docs/slices/00-demo-data.md) as the rules change, so it runs here against the fresh test database.
 */
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.ts';
import { runSeed } from '../prisma/seed.ts';
import { LIVE_REFERENCE, LOT_A, LOT_B, LOT_C } from '../prisma/demo-story.ts';

describe('the demo seed', () => {
  it('builds the planned world through the API, and leaves it alone the second time', async () => {
    const report = await runSeed({ fresh: true, story: true, quiet: true });
    expect(report).toMatchObject({
      bookings: 7,
      containers: 28,
      tips: 12,
      mdQueueOpen: 4,
      beneficiaries: 10,
    });

    const account = await prisma.account.findFirstOrThrow({ where: { name: 'OLIU · JIVAH' } });
    const companies = await prisma.company.findMany({ where: { accountId: account.id } });
    const oliu = companies.find((c) => c.billsClient)!.id;
    const jivah = companies.find((c) => c.kind === 'PARTNER')!.id;

    // The two invoiced lots: every box on the vessel and closed to Finance, ready to invoice.
    const shipped = await prisma.container.findMany({
      where: { number: { in: [...LOT_A, ...LOT_B].map(([n]) => n) } },
      select: { stage: true, closedAt: true, readyToInvoice: true, responsibleCompanyId: true },
    });
    expect(shipped).toHaveLength(18);
    expect(shipped.filter((c) => c.closedAt && c.readyToInvoice)).toHaveLength(17);
    expect(
      shipped.every((c) => c.stage === 'OCEAN_FREIGHT' && c.responsibleCompanyId === jivah),
    ).toBe(true);
    const sister = await prisma.booking.findFirstOrThrow({ where: { reference: 'DAR600210600A' } });
    expect(sister.parentId).not.toBeNull();

    // The live lot: one box per state, on the side the hand-over rule puts it.
    const live = await prisma.container.findMany({
      where: { booking: { reference: LIVE_REFERENCE } },
      orderBy: { createdAt: 'asc' },
      select: {
        number: true,
        stage: true,
        responsibleCompanyId: true,
        holdReason: true,
        riskPeriods: { where: { to: null }, select: { source: true } },
        costLines: { select: { status: true, delayRelated: true } },
      },
    });
    expect(live.map((c) => c.number)).toEqual(LOT_C.map(([n]) => n));
    expect(live.map((c) => c.stage)).toEqual([
      'BOOKED',
      'TRANSPORT',
      'FIELD_RELEASE',
      'FIELD_RELEASE',
      'RUSUMO',
      'CHECKPOINTS',
      'ICD',
      'PORT',
    ]);
    expect(live.map((c) => (c.responsibleCompanyId === oliu ? 'OLIU' : 'JIVAH'))).toEqual([
      'OLIU',
      'OLIU',
      'OLIU',
      'OLIU', // crossed, then returned from Rusumo
      'JIVAH',
      'JIVAH',
      'JIVAH',
      'JIVAH',
    ]);
    expect(live[2]!.holdReason).toContain('RRA');
    expect(live[1]!.riskPeriods).toEqual([{ source: 'MANUAL' }]);
    expect(live[6]!.riskPeriods).toEqual([{ source: 'ICD' }]);
    expect(live[1]!.costLines.some((l) => l.delayRelated)).toBe(true);
    expect(live[6]!.costLines.filter((l) => l.status === 'PENDING_MD')).toHaveLength(1);

    // The MD's queue: a duplicate, a cost on the other side, a cost after closing.
    const queue = await prisma.mdQueueItem.findMany({
      where: { status: 'OPEN' },
      select: { kind: true },
    });
    expect(queue.map((q) => q.kind).sort()).toEqual([
      'COST_AFTER_CLOSE',
      'COST_OTHER_SIDE',
      'DUPLICATE_CONTAINER',
      'REPEAT_PAYMENT',
    ]);

    // Payments (slice 6): the shipped lots paid and locked, the live lot with an order in every state.
    const byStatus = Object.fromEntries(
      (
        await prisma.paymentRequest.groupBy({
          by: ['status'],
          where: { accountId: account.id },
          _count: true,
        })
      ).map((r) => [r.status, r._count]),
    );
    expect(byStatus).toMatchObject({ BLOCKED: 1, REJECTED: 1, REQUESTED: 4, APPROVED: 3 });
    expect(byStatus.PAID).toBeGreaterThanOrEqual(15);
    const paid = await prisma.paymentRequest.findMany({ where: { status: 'PAID' } });
    expect(
      paid.every((p) => p.lockedAt && p.approvedById && p.approvedById !== p.requestedById),
    ).toBe(true);
    expect(paid.filter((p) => p.approvedWithCode).length).toBeGreaterThan(5);
    expect(paid.some((p) => p.kind === 'SETTLEMENT' && p.paidRef === 'FLOAT')).toBe(true);
    const darport = await prisma.beneficiary.findFirstOrThrow({
      where: { name: 'DarPort Clearing Co' },
    });
    expect(darport.pendingChange).not.toBeNull();
    expect(await prisma.beneficiary.count({ where: { status: 'VERIFIED' } })).toBe(10);

    // Tips: one voided, one past the ceiling with the MD's code; every seeded session signed out.
    const tips = await prisma.tip.findMany({
      select: { mdOverride: true, lines: { select: { status: true } } },
    });
    expect(tips.filter((t) => t.mdOverride)).toHaveLength(1);
    expect(tips.filter((t) => t.lines.every((l) => l.status === 'VOID'))).toHaveLength(1);
    expect(await prisma.session.count()).toBe(0);

    // Run again without --fresh: the lists are refreshed, the story is not replayed.
    expect(await runSeed({ quiet: true })).toBeNull();
    expect(await prisma.booking.count()).toBe(7);
  }, 240_000);
});
