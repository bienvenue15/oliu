/**
 * The live stream: a signed-in browser opens /api/events, a write in its account arrives as a `change` notice,
 * a write in another account never does, and a stranger gets 401.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { groupSetup, login, resetDb, singleSetup } from './helpers.ts';

const app = createApp();
let server: http.Server;
let base = '';

beforeAll(async () => {
  await prisma.$connect();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(resetDb);

/** Opens the stream and resolves with the first `change` notice, or rejects after `ms`. */
function nextChange(cookie: string, ms = 3000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/events`, { headers: { cookie } }, (res) => {
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      let buf = '';
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const m = buf.match(/event: change\ndata: (.+)\n\n/);
        if (m) {
          req.destroy();
          resolve(JSON.parse(m[1]!) as Record<string, unknown>);
        }
      });
    });
    req.on('error', (e) => (e.message.includes('socket hang up') ? undefined : reject(e)));
    setTimeout(() => {
      req.destroy();
      reject(new Error('no notice'));
    }, ms);
  });
}

describe('the live stream', () => {
  it('tells an open browser of the account that something changed, and only that account', async () => {
    await request(app).post('/api/accounts').send(groupSetup());
    const md = await login(app, 'md@oliu.test');
    await request(app).post('/api/accounts').send(singleSetup());
    const stranger = await login(app, 'owner@transit.test');

    expect((await request(app).get('/api/events')).status).toBe(401);
    await new Promise((r) => setTimeout(r, 400)); // the logins' own notices have gone by

    // A write in OLIU's account: the MD's stream hears it; the other account's owner does not.
    const heard = nextChange(md);
    const notHeard = nextChange(stranger, 1200).then(
      () => 'heard',
      () => 'silent',
    );
    await new Promise((r) => setTimeout(r, 100)); // the streams are open before the write
    const line = await request(app)
      .post('/api/shipping-lines')
      .set('Cookie', md)
      .send({ name: 'PIL' });
    expect(line.status).toBe(201);
    const notice = await heard;
    expect(notice).toMatchObject({
      module: 'shipments',
      action: 'shipping_line_added',
      entity: 'shipping_line',
      entityId: line.body.id,
    });
    expect(typeof notice.at).toBe('string');
    expect(await notHeard).toBe('silent');
  });
});
