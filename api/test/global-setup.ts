/**
 * Test database: an in-memory PGlite (real PostgreSQL in WebAssembly) served on port 5434 for the
 * whole run, with the migrations applied first. Set TEST_DATABASE_URL to use a running PostgreSQL instead.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export default async function setup() {
  let databaseUrl = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<void>) | undefined;
  if (!databaseUrl) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
    const db = await PGlite.create(); // memory only; gone when the run ends
    const server = new PGLiteSocketServer({ db, port: 5434, host: '127.0.0.1', maxConnections: 8, idleTimeout: 30_000 });
    await server.start();
    databaseUrl = 'postgresql://postgres:postgres@127.0.0.1:5434/postgres?connection_limit=1&pgbouncer=true';
    stop = async () => {
      await server.stop();
      await db.close();
    };
  }
  process.env.DATABASE_URL = databaseUrl;
  // Spawned asynchronously: the in-process database must keep serving while the migration runs.
  await new Promise<void>((ok, fail) => {
    const child = spawn('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`prisma migrate deploy exited with ${code}`))));
    child.on('error', fail);
  });
  return async () => {
    if (stop) await stop();
  };
}
