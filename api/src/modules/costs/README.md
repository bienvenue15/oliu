# costs

**Owns:** `CostCategory`, `ExchangeRate`, `CostLine`, `CostSplit`, `AccountSettings`. Answers "what did this box
cost" — every figure is a sum over cost lines, never a stored total.

**Routes:** `GET|POST /api/cost-categories` · `PATCH /api/cost-categories/:id` · `GET /api/rates` ·
`GET /api/rates/latest` · `POST /api/rates` · `GET|PATCH /api/settings` · `POST /api/costs` ·
`GET /api/costs?month=&bookingId=&containerId=&all=` · `PATCH /api/costs/:id` · `POST /api/costs/:id/void` ·
`GET /api/containers/:id/costs` · `GET /api/bookings/:id/costs`.

**Events:** `category_added`, `category_updated`, `rate_entered`, `rate_replaced`, `settings_updated`,
`cost_entered`, `cost_corrected`, `cost_voided`.

**Rules:** money is integer minor units (`@oliu/shared` `parseMoney` / `formatMoney`), never floating point ·
a rate is local units per US dollar on a day; a line takes the rate of its own date, or the most recent one before
it, and copies it onto the line (`perUsd`) so `usdCents` can always be rebuilt; no rate at all is an error, never a
silent 1.000 · one bill across several boxes of one booking is typed once and divided EQUAL (remainder to the last
box), WEIGHT (every box needs `weightKg`; remainder to the heaviest) or MANUAL (amounts must add up) ·
a line sits in the book of the company that entered it (`companyId`); a one-company user sees their book, the MD
sees every book with per-company subtotals · a line's amount may be corrected with a reason (USD recomputed at the
stored rate); date and currency never change — void and re-enter · nothing is deleted · categories and the margin
figure are the MD's; rates are typed by the MD or the Finance Officer (`pay` permission).

**Who may enter costs:** roles that open the `csplit` screen with `write`: MD, Operations Manager, Transport
Coordinator. **Who reads the container record:** roles that open `cost`: those three and the Reporting Officer.

**Slice 4 added:** `CostLine.delayRelated` — true when the line's own date falls inside an at-risk spell of the box
(`journey/risk.ts`: `refreshIcdRisk` then `isDelayRelated`, called inside the cost transaction); totals carry
`delayUsdCents` · a cost on a box already closed to Finance is saved and opens an MD-queue item `COST_AFTER_CLOSE` ·
`PATCH /api/settings` also takes `icdFreeDays` and `trackingHours` (any subset of the four fields).

**Later slices add:** tips from the phone (5), cost lines reaching the automatic invoice
and the margin (8).

**Strict sides (28 Oct 2026, the owner's rule):** one box, one side, one company. Only the company responsible for
a box now (`Container.responsibleCompanyId`: the booking's company until the hand-over stage, the partner after) moves
it, reads its journey and its costs, releases it, closes it, tips it; the MD and the Reporting Officer see and do
everything. The other side's Operations Manager sees only **counts per stage** of boxes not on their side (`coming`
from "loaded, on the road" up to the hand-over; `handedOver` for their own bookings' boxes), never numbers or details.
A cost line or a tip typed on a box that is on the other side is saved as `PENDING_MD`, counts nowhere, and opens the
MD-queue item `COST_OTHER_SIDE`; the MD approves (lines become ACTIVE) or refuses with a reason (lines go VOID).
Helpers: `bySide(s)` and `spansAccount(s)` in `db.ts`.

Consequences here: `writeCost` marks a line `PENDING_MD` when the box is on the other side and opens one
`COST_OTHER_SIDE` item per bill (`summary.costLineIds`); `GET /api/costs` lists ACTIVE and PENDING_MD lines by default;
totals and the container record count ACTIVE only; `GET /api/containers/:id/costs` is closed to the other side; the
booking's per-box totals show only the caller's side's boxes (every box for the MD).

**Slice 6 added:** `CostLine.paymentId` — the payment order a line is on (`shapeLine` returns `payment: { number, status }`); `rateFor`, `lineSelect` and `shapeLines` are exported for the payments module; `PATCH /api/settings` also takes `approvalThresholdUsdCents`.
