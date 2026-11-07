/**
 * Events — the live stream (server-sent events). A signed-in browser opens GET /api/events once and keeps it
 * open; every write in the account arrives as a small `change` notice (what the audit row says, no data), and the
 * screen refetches what it shows. A heartbeat every 25 seconds keeps proxies from closing the stream.
 *
 * GET /api/events            the stream; text/event-stream
 * GET /api/events/count      how many browsers listen (dev only)
 */
import { Router } from 'express';
import { config } from '../../config.ts';
import { liveCount, subscribe } from '../../lib/events.ts';
import { requireAuth, scopeOf } from '../../middleware/auth.ts';

export const eventsRouter = Router();
const HEARTBEAT_MS = 25_000;

eventsRouter.get('/events', requireAuth, (req, res) => {
  const s = scopeOf(req);
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(
    `retry: 3000\nevent: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`,
  );
  const unsubscribe = subscribe(s.accountId, res);
  const beat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(beat);
      unsubscribe();
    }
  }, HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(beat);
    unsubscribe();
  });
});

if (!config.isProd)
  eventsRouter.get('/events/count', requireAuth, (_req, res) =>
    res.json({ listening: liveCount() }),
  );
