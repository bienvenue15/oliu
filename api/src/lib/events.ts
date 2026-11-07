/**
 * Live notices — "something changed in your account", pushed to open browsers so screens refetch instead of
 * being refreshed by hand. In-process (one API process); a notice carries only what the audit row already says
 * (module, action, entity, id, company), never the data itself: every browser refetches through the scoped routes.
 */
import type { Response } from 'express';

export interface LiveNotice {
  module: string;
  action: string;
  entity: string;
  entityId: string | null;
  companyId: string | null;
  at: string;
}

interface Subscriber {
  accountId: string;
  res: Response;
}

const subscribers = new Set<Subscriber>();
/** Writes commit a few milliseconds after their audit row; the notice waits a little so a refetch sees the commit. */
const SETTLE_MS = 150;

export function subscribe(accountId: string, res: Response): () => void {
  const sub = { accountId, res };
  subscribers.add(sub);
  return () => subscribers.delete(sub);
}

export function publish(accountId: string, notice: Omit<LiveNotice, 'at'>): void {
  const payload = `event: change\ndata: ${JSON.stringify({ ...notice, at: new Date().toISOString() })}\n\n`;
  setTimeout(() => {
    for (const s of subscribers) {
      if (s.accountId !== accountId) continue;
      try {
        s.res.write(payload);
      } catch {
        subscribers.delete(s);
      }
    }
  }, SETTLE_MS);
}

/** How many browsers are listening; for the health route and tests. */
export const liveCount = () => subscribers.size;
