# alerts

**Owns:** nothing stored. `GET /api/alerts` answers "what waits for this person right now" by reading the tables
that own each thing, scoped exactly as the screens are, so the bell never counts what a screen would refuse.

**Items (kind · who · where it points):** `POSITION_OVERDUE`, `AT_RISK`, `HELD` · anyone who opens the board
(`cont`), boxes on their side (`bySide`) · `/app/cont` — `TO_APPROVE` · `queue` + `approve`, orders in my book
requested by someone else · `/app/queue` — `TO_PAY` · `cashier` + `pay`, approved orders in my book ·
`/app/cashier` — `BENEFICIARY_TO_CONFIRM` · `ben` + `beneficiaries`, pending beneficiaries and account changes
proposed by someone else (the registry is the account's, so both sides may confirm) · `/app/ben` —
`MD_RULINGS` · `superq` + `reconcile`, open MD-queue items · `/app/superq`.

**Shape:** `{ total, items: [{ kind, severity: bad|warn|info, count, text, to }] }`, bad first. The ICD risk spell
is materialised on the way (`refreshIcdRisk`), as the board does.

**Web:** `AlertBell.vue` in the top bar (`layouts/app.vue`): the count as a badge, a drop-down list, one line per
kind, each a link; refetched on every live notice (`useLive().onChange('*')`).

**Later:** slice 9 pushes these to the phone and the digest; this is the in-app count the owner asked for on
30 Oct 2026 ("one notification icon for our whole system").
