/**
 * Local PostgreSQL for development: `npm run db:start`, keep the window open, stop with Ctrl+C.
 * Data lives in api/.pg (ignored by git). See local-postgres.ts for why PGlite and what it guards.
 */
import { resolve } from 'node:path';
import { startLocalPostgres } from './local-postgres.ts';

const dataDir = resolve(import.meta.dirname, '..', '.pg');
const port = Number(process.env.PG_PORT ?? 5433);

const pg = await startLocalPostgres({ port, dataDir });

console.log(`PostgreSQL (PGlite) ready on 127.0.0.1:${port} · data in ${dataDir}`);
console.log(`DATABASE_URL=${pg.url}`);

// A client that dies mid-connection (a force-killed API) must not take the server with it.
process.on('uncaughtException', (e) => console.error('kept running after:', e.message));
process.on('unhandledRejection', (e) =>
  console.error('kept running after:', e instanceof Error ? e.message : e),
);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
