# tips

**Owns:** `TipReason`, `Tip`, `CostLine.tipId`, `CostCategory.isTip`, the two tip figures on `AccountSettings`
(`tipCeilingUsdCents`, `tipCapUsdCents`), `OtpChallenge.purpose = TIP_OVERRIDE`, the receipt photos under
`UPLOAD_DIR` (default `api/uploads`, outside the web root). Answers "what was paid on the spot, by whom, for which box".

**Routes:** `GET|POST /api/tip-reasons` · `PATCH /api/tip-reasons/:id` · `GET /api/tips/setup` · `POST /api/tips` ·
`POST /api/tips/md-code` · `GET /api/tips?month=&mine=&incomplete=` · `PATCH /api/tips/:id` ·
`POST|GET /api/tips/:id/photo` · `POST /api/tips/:id/void`.

**Events (audit):** `reason_added`, `reason_updated`, `tip_paid` (one per cost line, through the costs module, plus
one on the tip), `tip_override`, `tip_cap_warning`, `md_code_requested`, `tip_completed`, `tip_photo_attached`,
`tip_voided`.

**Rules:** a tip is the boxes tapped, a reason and an amount; everything else is optional and follows later ·
its money is cost lines in the account's `isTip` category, one per box, written by `costs.prepareCost` /
`costs.writeCost` — same split (EQUAL), same rate of the day, same delay flag, same MD-queue item on a closed box;
so the container record and the booking total are right without retyping · the book is the payer's company ·
`clientId` comes from the phone; a second POST with the same one returns the first tip (`repeated: true`) instead
of saving twice, which is what makes the offline outbox safe · one tip above `tipCeilingUsdCents`, or a company's
month (live tip lines, by the line's date) going above `tipCapUsdCents`, is refused with `needsMdCode: true` until
the same tip is sent with the MD's six-digit code; the code is mailed to the MD's mailbox on request, is for this
purpose only (`purpose = TIP_OVERRIDE`, a login code never works here and vice versa), works once, expires with
`OTP_MINUTES`, five wrong tries burn it · crossing 80 % of the cap opens one MD-queue item `TIP_CAP_80` per tip that
crossed it · the Field Officer completes and voids only their own tips; the Operations Manager and the MD any tip
in their company's book · a voided tip keeps its row; its lines go VOID with the reason and leave every total,
including the cap · the receipt photo is checked by its first bytes (JPEG, PNG, WebP), at most 6 MB, stored under
`<UPLOAD_DIR>/<accountId>/<tipId>.<ext>` and served only through the scoped GET.

**Who may:** `tip` screen + `write` (MD, Transport Coordinator, Field Officer) pays; `tiplat` + `write` (those
and the Operations Manager) completes, attaches, voids; `tiplat` reads the ledger. Reasons and the figures are the MD's.

**Later slices add (6, built 29 Oct 2026):** floats and settlement — a tip is a cash line of its payer, settled against their float through the payments module (`GET /api/payments/candidates?holderId=`);
blind entry of tips by Finance and the compare (7); the 80 % alert pushed to the MD's phone (9).

**Strict sides (28 Oct 2026, the owner's rule):** one box, one side, one company. Only the company responsible for
a box now (`Container.responsibleCompanyId`: the booking's company until the hand-over stage, the partner after) moves
it, reads its journey and its costs, releases it, closes it, tips it; the MD and the Reporting Officer see and do
everything. The other side's Operations Manager sees only **counts per stage** of boxes not on their side (`coming`
from "loaded, on the road" up to the hand-over; `handedOver` for their own bookings' boxes), never numbers or details.
A cost line or a tip typed on a box that is on the other side is saved as `PENDING_MD`, counts nowhere, and opens the
MD-queue item `COST_OTHER_SIDE`; the MD approves (lines become ACTIVE) or refuses with a reason (lines go VOID).
Helpers: `bySide(s)` and `spansAccount(s)` in `db.ts`.

Consequences here: `/api/tips/setup` lists only boxes on the caller's side; a tip on a box elsewhere is saved with
`pendingMd: true` (its lines PENDING_MD) and waits for the MD; the ledger's totals and the cap count ACTIVE lines only.
