/**
 * The local PostgreSQL (PGlite over a socket) must survive what a development day throws at it:
 * clients the server drops (idle timeout, a force-killed API), and a query that blows up inside the
 * server. Both cases wedge pglite-socket 0.2.14 on its own; scripts/local-postgres.ts guards against them.
 */
import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLocalPostgres, type LocalPostgres } from '../scripts/local-postgres.ts';

const PORT = 5441;
const MAX = 2;
let pg: LocalPostgres;

beforeAll(async () => {
  pg = await startLocalPostgres({ port: PORT, maxConnections: MAX, idleTimeout: 100 });
});
afterAll(async () => {
  await pg.stop();
});

/** Connects, says nothing, and resolves once the server has dropped the connection. */
function connectAndGetDropped(): Promise<void> {
  return new Promise((resolve) => {
    const s = connect(PORT, '127.0.0.1');
    s.on('close', () => resolve());
    s.on('error', () => resolve());
  });
}

/** Connects, sends a startup message and returns the first reply ('R' = authentication, i.e. served). */
function startup(): Promise<string> {
  return new Promise((resolve) => {
    const s = connect(PORT, '127.0.0.1');
    const done = (answer: string) => {
      resolve(answer);
      s.destroy();
    };
    s.on('connect', () => {
      const body = Buffer.concat([
        Buffer.from([0, 3, 0, 0]),
        Buffer.from('user\0postgres\0database\0postgres\0\0'),
      ]);
      const len = Buffer.alloc(4);
      len.writeInt32BE(body.length + 4);
      s.write(Buffer.concat([len, body]));
    });
    s.on('data', (d) => done(d.toString('latin1')));
    s.on('error', (e) => done(`error ${e.message}`));
    s.on('close', () => done('closed without a reply'));
    setTimeout(() => done('no reply'), 3000).unref();
  });
}

const settle = () => new Promise((r) => setTimeout(r, 50));

describe('local PostgreSQL', () => {
  it('frees the slot of every client it drops', async () => {
    for (let i = 0; i < MAX * 3; i++) {
      await connectAndGetDropped();
      await settle();
      const reply = await startup();
      expect(
        reply.startsWith('R'),
        `after ${i + 1} dropped client(s) a fresh client got: ${reply}`,
      ).toBe(true);
      await settle();
    }
  });

  it('keeps serving after a query throws inside the server', async () => {
    const real = pg.db.execProtocolRawStream.bind(pg.db);
    (pg.db as { execProtocolRawStream: unknown }).execProtocolRawStream = async () => {
      (pg.db as { execProtocolRawStream: unknown }).execProtocolRawStream = real;
      throw new Error('simulated failure inside the database');
    };
    const victim = await startup();
    expect(victim.startsWith('R')).toBe(false);
    await settle();
    const next = await startup();
    expect(next.startsWith('R'), `next client got: ${next}`).toBe(true);
  });
});
