# OLIU

Management information system for corridor freight forwarders, built first for
OLIU LOGISTICS LTD (Kigali) and JIVAH LOGISTICS LTD (Dar es Salaam).
Operations, payments, blind reconciliation and invoicing, one container at a time.

The design documents live in [`documents/`](documents/). The build follows the
twelve-slice roadmap in `documents/OLIU_Build_Roadmap.html`; after every slice a
plain-language note (PDF) is written in [`docs/slices/`](docs/slices/).

## Layout

```
shared/   types and validation rules used by both api and web (roles, packages, set-up questions)
api/      Express 5 + Prisma + PostgreSQL — every business rule lives here
web/      Nuxt 3 — the screens; never computes money, never decides who may see what
docs/     slice notes and module READMEs
documents/ analysis, proposal, mockups, roadmap, data model (read-only inputs)
```

## Run it on this machine

Requirements: Node 22 or newer. Docker is optional: without it `npm run db:start`
serves a local PostgreSQL (PGlite, real PostgreSQL compiled to WebAssembly) on port 5433.

```
npm install
npm run db:start      # local PostgreSQL on port 5433 (or: docker compose up db, port 5432)
npm run db:migrate    # create the tables
npm run db:seed       # OLIU · JIVAH demo account with twelve users
npm run dev:api       # http://localhost:3001
npm run dev:web       # http://localhost:3000
```

In development every e-mail the system sends (one-time codes, invitations) is
kept on the machine and readable at `http://localhost:3001/dev/mail`.

## Rules the code keeps

- Every request is checked on the server against the signed-in user's account,
  company and role. The browser is never trusted.
- Every table carries the account it belongs to, and the company where money or a
  container is involved. The data layer applies that filter; a query cannot forget it.
- The container is the unit of truth. Totals are queries, never stored numbers.
- Money is stored as integers in minor units with the rate on the row.
- Audit events, tips and locked payments are append-only.
- A feature is a folder. Switching it off hides its screens and never deletes its rows.
