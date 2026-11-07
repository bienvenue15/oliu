# events

**Owns:** nothing in the database. The live stream: `GET /api/events` (server-sent events) and the in-process bus
in `src/lib/events.ts`.

**How it works:** every `audit()` call (so every write in the system, since every write has its audit row)
publishes a `change` notice to the open streams of the same account, 150 ms later so the transaction has committed.
A notice is `{ module, action, entity, entityId, companyId, at }` — what the audit row says, never the data. The
browser (`web/composables/useLive.ts`) keeps one stream per tab, and each screen says which modules it shows; on a
matching notice it refetches through the scoped routes it already uses, debounced (one refetch per burst). A
heartbeat every 25 s keeps proxies from closing the stream; the browser reconnects by itself (`retry: 3000`).

**Scoping:** a stream is tied to the session's account; notices of other accounts never reach it. A company-bound
user may hear that the other company wrote something; their refetch returns only what they may see.

**Limits:** one API process holds the subscribers in memory. With several API processes, replace the bus with a
Postgres `LISTEN/NOTIFY` or a small broker; the route and the browser side stay as they are. `GET /api/events/count`
(development only) says how many browsers listen.
