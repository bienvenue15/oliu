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
    const { startLocalPostgres } = await import('../scripts/local-postgres.ts');
    const pg = await startLocalPostgres({ port: 5434 }); // memory only; gone when the run ends
    databaseUrl = pg.url;
    stop = pg.stop;
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
    child.on('exit', (code) =>
      code === 0 ? ok() : fail(new Error(`prisma migrate deploy exited with ${code}`)),
    );
    child.on('error', fail);
  });
  return async () => {
    if (stop) await stop();
  };
}
