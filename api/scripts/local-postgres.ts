/**
 * PostgreSQL for development and tests without Docker.
 *
 * This machine's application-control policy blocks the native PostgreSQL binaries, so we run PGlite:
 * real PostgreSQL compiled to WebAssembly, served over the normal wire protocol by
 * @electric-sql/pglite-socket. Prisma, the migrations and the seed talk to it exactly as they talk to
 * the server's PostgreSQL in docker-compose.
 *
 * PGlite serves one session shared by every connection, so the URL carries `connection_limit=1` and
 * `pgbouncer=true` (Prisma then avoids named prepared statements, which would collide between processes).
 *
 * pglite-socket 0.2.14 has two faults that stop a long-lived server dead; `harden` works around both.
 * Re-read this file when the package is upgraded.
 *  1. A client that is dropped (idle timeout, ECONNRESET, a force-killed API) is detached but never
 *     removed from the server's handler set, so every drop burns one connection slot for good. After
 *     `maxConnections` drops every new client is told "Too many connections" and the API answers 500.
 *     This is what ended the slice 1 live test on 23 October 2026 after eight minutes.
 *  2. A query that throws inside the server's queue leaves the queue flagged as processing, so nothing
 *     queued after it ever runs.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { Server as NetServer } from 'node:net';

export interface LocalPostgres {
  url: string;
  db: PGlite;
  server: PGLiteSocketServer;
  stop: () => Promise<void>;
}

export interface LocalPostgresOptions {
  port: number;
  /** Omit for an in-memory database that vanishes with the process. */
  dataDir?: string;
  maxConnections?: number;
  /** Milliseconds after which a silent client is dropped; 0 (the default) never drops one. */
  idleTimeout?: number;
}

export async function startLocalPostgres({
  port,
  dataDir,
  maxConnections = 16,
  idleTimeout = 0,
}: LocalPostgresOptions): Promise<LocalPostgres> {
  const db = await PGlite.create(dataDir ? { dataDir } : {});
  // No idle timeout by default: a vanished client is noticed through its socket closing, and dropping
  // Prisma's long-lived connection would only cost the next request an error.
  const server = new PGLiteSocketServer({
    db,
    port,
    host: '127.0.0.1',
    maxConnections,
    idleTimeout,
  });
  await server.start();
  harden(server);
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`,
    db,
    server,
    stop: async () => {
      await server.stop();
      await db.close();
    },
  };
}

/** The parts of pglite-socket we reach into. Plain properties in 0.2.14; private only to TypeScript. */
interface SocketServerInternals {
  server: NetServer | null;
  handlers: Set<{ isAttached: boolean }>;
  queryQueue: { processing: boolean; queue: unknown[]; processQueue: () => Promise<void> };
}

function harden(socketServer: PGLiteSocketServer): void {
  const s = socketServer as unknown as SocketServerInternals;
  if (!s.server) throw new Error('harden() must run after start()');

  // 1. Forget dropped clients before the library counts connections. The library handles a new
  //    connection in a setImmediate, so this listener runs first.
  s.server.on('connection', () => {
    for (const h of s.handlers) if (!h.isAttached) s.handlers.delete(h);
  });

  // 2. If the loop we started is still flagged as processing after it returned, a query threw and
  //    the library bailed out; clear the flag and carry on with whatever is queued.
  const q = s.queryQueue;
  const run = q.processQueue.bind(q);
  q.processQueue = async function processQueue() {
    const ownsLoop = !q.processing;
    try {
      await run();
    } finally {
      if (ownsLoop && q.processing) {
        q.processing = false;
        if (q.queue.length > 0) void q.processQueue();
      }
    }
  };
}
