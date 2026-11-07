# audit

**Owns:** nothing to write — every module appends through `lib/audit.ts`. This module only reads.

**Route:** `GET /api/audit?module=&entity=&entityId=&limit=&before=` — newest first, cursor by id.

**Rules:** the table refuses UPDATE and DELETE by trigger (see the slice 1 migration) · visible to roles that may
open the `aud` screen (MD, Reporting Officer, Operations Manager) · a one-company user sees their company's rows
and account-level rows · secrets are stripped before a row is written (`redact`).

**Strict sides (28 Oct 2026):** a company-bound person reads only their company's rows (`companyId = theirs`);
account-wide rows (settings, categories, lines, clients, set-up) are the MD's and the Reporting Officer's. Sign-in
rows now carry the person's company so they appear in that company's trail.
