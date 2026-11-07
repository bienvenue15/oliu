/** Development helpers, never mounted in production. GET /dev/mail shows every e-mail the system sent. */
import { Router } from 'express';
import { devOutbox } from '../../lib/mail.ts';

export const devRouter = Router();

devRouter.get('/mail', (_req, res) => {
  const items = devOutbox()
    .map(
      (m) =>
        `<article><h3>${esc(m.subject)}</h3><div class="meta">to ${esc(m.to)} · ${m.sentAt.toLocaleString()}</div><pre>${esc(m.text)}</pre></article>`,
    )
    .join('');
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>OLIU dev mail</title>
<style>body{font:14px system-ui;margin:24px;max-width:760px;color:#1c2733}article{border:1px solid #d6dee6;border-radius:10px;padding:12px 16px;margin-bottom:12px;background:#fff}h3{margin:0 0 4px;font-size:15px}.meta{color:#75848f;font-size:12px}pre{white-space:pre-wrap;background:#f4f6f8;padding:10px;border-radius:8px}</style>
<h1>Development inbox</h1><p>Every e-mail the API sent on this machine, newest first. Nothing leaves the computer.</p>${items || '<p>No mail yet.</p>'}`);
});

devRouter.get('/mail.json', (_req, res) => res.json(devOutbox()));

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
