/**
 * The Express application. `createApp()` is used by the server and by the tests alike.
 * Modules mount under /api/<module>; nothing else is reachable.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config.ts';
import { logger } from './lib/logger.ts';
import { HttpError } from './lib/errors.ts';
import { attachSession } from './middleware/auth.ts';
import { identityRouter } from './modules/identity/routes.ts';
import { accountsRouter } from './modules/accounts/routes.ts';
import { auditRouter } from './modules/audit/routes.ts';
import { devRouter } from './modules/dev/routes.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));
  if (!config.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(attachSession);

  app.get('/api/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));
  app.use('/api/auth', identityRouter);
  app.use('/api', accountsRouter);
  app.use('/api/audit', auditRouter);
  if (!config.isProd) app.use('/dev', devRouter);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details ?? undefined });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    logger.error({ err }, 'unhandled error');
    res.status(500).json({ error: 'Something went wrong on our side' });
  });
  return app;
}
