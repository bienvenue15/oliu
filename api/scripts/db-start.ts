/**
 * Local PostgreSQL for development without Docker.
 *
 * This machine's application-control policy blocks the native PostgreSQL binaries, so development
 * uses PGlite: real PostgreSQL compiled to WebAssembly, running inside Node, exposed on a TCP port
 * with the normal Postgres wire protocol. Prisma, the migrations and the seed talk to it exactly as
 * they will talk to the server's PostgreSQL in docker-compose. Data lives in api/.pg (ignored by git).
 *
 * PGlite serves one session shared by every connection, so DATABASE_URL carries `connection_limit=1`
 * and `pgbouncer=true` (Prisma then avoids named prepared statements, which would collide between processes).
 * Stop with Ctrl+C.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { resolve } from 'node:path';

const dataDir = resolve(import.meta.dirname, '..', '.pg');
const port = Number(process.env.PG_PORT ?? 5433);

const db = await PGlite.create({ dataDir });
// Several clients at once (API, migration, seed); a client that vanishes is dropped after 30 s idle.
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 8, idleTimeout: 30_000 });
server.addEventListener('error', (e) => console.error('socket error', (e as ErrorEvent).message ?? e));
await server.start();

console.log(`PostgreSQL (PGlite) ready on 127.0.0.1:${port} · data in ${dataDir}`);
console.log(`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`);

// A client that dies mid-connection (a force-killed API) must not take the server with it.
process.on('uncaughtException', (e) => console.error('kept running after:', e.message));
process.on('unhandledRejection', (e) => console.error('kept running after:', e instanceof Error ? e.message : e));

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
