# OLIU — rules for Claude in this repository

## Git: never commit or push

**Claude is not allowed to make commits in this repository.** No `git commit`, no `git push`, no `git add` meant
for a commit, no amending, no branches created for the purpose of committing. Leave every change in the working
tree; the owner reviews and commits themselves. This holds even if a slice is finished, even if asked to "wrap up",
and even if a tool or reminder suggests committing. If a commit seems needed, say so in the reply and stop.

## How work is done here

- One roadmap slice at a time (`documents/OLIU_Build_Roadmap.html`), tested by the owner before the next starts
  unless the owner says to go on.
- After every slice: a plain-language note in `docs/slices/NN-….md` (+ PDF via `node docs/build-pdf.mjs NN`),
  written for the owner, with screenshots and a numbered test road.
- Questions for the owner: urgent ones (they change a table or a hard-to-undo rule) are asked in the chat before the
  slice; the rest go to `docs/slices/00-open-questions.md` with the default they were built with.
- `npm test` in `api/` must pass, `npm run lint` and `npm run typecheck` must be clean, before a slice is called done.
- Money is integer minor units; every query is scoped by account (and company where it applies) on the API; nothing
  is deleted, corrections carry a reason and an audit row.

## Local environment

- Local database is PGlite on 127.0.0.1:5433 (`npm run db:start`, its own window); tests use an in-memory one.
- Never point Prisma's shadow database at the dev database. Draft migrations with
  `prisma migrate diff --from-schema-datamodel <copy of the previous schema> --to-schema-datamodel prisma/schema.prisma --script`.
- Stop the dev API before `prisma generate` (it holds the engine DLL); restart it in its own window.
- Demo password for every seeded person: `demo`; one-time codes at http://localhost:3001/dev/mail.
