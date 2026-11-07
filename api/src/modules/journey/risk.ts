/**
 * At-risk spells. A box is at risk while a RiskPeriod is open on it: opened by the system when its free days
 * at the ICD run out, or by a person (a breakdown, a hold). A cost dated inside a spell is delay-related.
 *
 * The ICD spell is materialised lazily — whenever the box is read on the board or a cost lands on it — so no
 * background job is needed for a figure that only changes once a day.
 */
import { prisma, type Tx } from '../../db.ts';

export type RiskBox = {
  id: string;
  accountId: string;
  stage: string;
  icdSince: Date | null;
  closedAt: Date | null;
};

/** The calendar day of a moment, as a UTC date (what a DATE column holds). */
export function dayOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const DAY_MS = 86_400_000;
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
export const daysBetween = (from: Date, to: Date) =>
  Math.floor((dayOf(to).getTime() - dayOf(from).getTime()) / DAY_MS);

/**
 * Opens the ICD spell of a box whose free days have run out, once per stay at the ICD. Returns nothing;
 * callers then ask `isAtRisk` or `isDelayRelated`.
 */
export async function refreshIcdRisk(
  tx: Tx | typeof prisma,
  box: RiskBox,
  icdFreeDays: number,
  now = new Date(),
): Promise<void> {
  if (box.stage !== 'ICD' || !box.icdSince || box.closedAt) return;
  const from = addDays(dayOf(box.icdSince), icdFreeDays + 1); // day 0 is the arrival; at risk from day N+1
  if (dayOf(now) < from) return;
  const already = await tx.riskPeriod.findFirst({
    where: { containerId: box.id, source: 'ICD', from: { gte: dayOf(box.icdSince) } },
    select: { id: true },
  });
  if (already) return;
  await tx.riskPeriod.create({
    data: {
      accountId: box.accountId,
      containerId: box.id,
      source: 'ICD',
      reason: `At the ICD for more than ${icdFreeDays} days`,
      from,
    },
  });
}

/** Closes the open ICD spell when the box leaves the ICD; a spell a person opened stays until they clear it. */
export async function closeIcdRisk(tx: Tx, containerId: string, on: Date): Promise<void> {
  const open = await tx.riskPeriod.findMany({
    where: { containerId, source: 'ICD', to: null },
    select: { id: true, from: true },
  });
  for (const p of open) {
    const to = dayOf(on) < p.from ? p.from : dayOf(on);
    await tx.riskPeriod.update({ where: { id: p.id }, data: { to } });
  }
}

/** The open spell of a box, if any. */
export async function openRisk(tx: Tx | typeof prisma, containerId: string) {
  return tx.riskPeriod.findFirst({
    where: { containerId, to: null },
    orderBy: { from: 'asc' },
    select: { id: true, source: true, reason: true, from: true },
  });
}

/** True when `date` (a calendar day) falls inside any spell of the box, open or closed. */
export async function isDelayRelated(
  tx: Tx | typeof prisma,
  containerId: string,
  date: Date,
): Promise<boolean> {
  const d = dayOf(date);
  const hit = await tx.riskPeriod.findFirst({
    where: { containerId, from: { lte: d }, OR: [{ to: null }, { to: { gte: d } }] },
    select: { id: true },
  });
  return !!hit;
}

/** The account's two figures of this slice, with the defaults when the row does not exist yet. */
export async function journeySettings(
  accountId: string,
): Promise<{ icdFreeDays: number; trackingHours: number }> {
  const row = await prisma.accountSettings.findUnique({
    where: { accountId },
    select: { icdFreeDays: true, trackingHours: true },
  });
  return row ?? { icdFreeDays: 4, trackingHours: 12 };
}
