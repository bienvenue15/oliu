# api

Express 5 + Prisma + PostgreSQL. Every business rule lives here; the web app only displays.

```
npm run db:start         local PostgreSQL (PGlite) on 127.0.0.1:5433 — keep it running
npm run db:migrate       apply migrations
npm run db:seed          OLIU · JIVAH demo account, twelve people, password demo
npm run dev              API on :3001 with reload; dev inbox at /dev/mail
npm test                 22 tests on a fresh in-memory database (~15 s)
npm run lint · typecheck
```

Layout: `src/config.ts` → `src/app.ts` mounts `src/modules/*` under `/api`; `src/middleware/auth.ts` turns the
session cookie into a Scope; `src/db.ts` holds the scope filters. Each module has its own README.

Why PGlite locally: this machine blocks native PostgreSQL binaries and has no Docker. PGlite is PostgreSQL
compiled to WebAssembly, served over the normal wire protocol, so Prisma, migrations and the seed are the same
as on the server (`docker-compose.yml`). The URL needs `connection_limit=1&pgbouncer=true`.
