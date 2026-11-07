# journey

**Owns:** the journey fields on `Container` (`responsibleCompanyId`, `stage`/`stageAt`, `lastPlace`/`lastSeenAt`,
`holdReason`, `icdSince`, `localOnly`, release, ocean dates, closing to Finance), `JourneyEvent` (the timeline),
`RiskPeriod` (at-risk spells). Answers "where is this box, whose is it now, is it late".

**Routes:** `GET /api/board` · `GET|POST /api/containers/:id/journey` · `POST /api/containers/:id/journey/correct` ·
`POST /api/containers/:id/risk` · `POST /api/containers/:id/risk/clear` · `GET|POST /api/bookings/:id/release` ·
`GET /api/releases` · `POST /api/containers/:id/close` · `POST /api/containers/:id/reopen` · `GET /api/closed?month=`.

**Events (audit):** `stage_reached`, `handed_over`, `position_updated`, `held`, `hold_lifted`, `returned`, `stage_corrected`,
`risk_flagged`, `risk_cleared`, `released`, `container_closed`, `container_reopened`.

**Rules:** the eight stages of the analysis, in order (`STAGES` in `@oliu/shared`); the board shows six columns
(`BOARD_COLUMNS`) · a box only moves forward; a stage may be skipped; going back is a correction with a reason, by the
MD or an Operations Manager · every entry carries `happenedAt` (as typed, never in the future) and `createdAt` (when
typed); `lastSeenAt` never goes backwards · the **hand-over**: on a GROUP account, when a box crosses the account's
`handoverStage` going forward it flips to the other company that keeps its own book (named by `toCompanyId` when there
are several); `RETURNED` from Rusumo and a backwards correction flip it back; a single company never flips · `HELD` keeps the box
where it is with a reason; `HOLD_LIFTED` clears the reason without moving it (the next stage also clears it) ·
a box may be moved by the company that booked it or the company responsible for it (`assertMayMove`); the MD anywhere ·
**the working list** = the boxes a company is responsible for; `coming` on the board = the other side's boxes past the
warehouse and before the hand-over; `handedOver` = this company's bookings now on the other side ·
**at risk:** an ICD spell opens by itself from the day after `icdFreeDays` run out (materialised lazily by
`refreshIcdRisk` on the board and on cost entry, once per stay) and closes when the box leaves the ICD; a MANUAL spell
is opened and cleared by a person; a cost dated inside any spell is delay-related (the costs module asks `isDelayRelated`) ·
**tracking:** on `ROAD_STAGES` a box not heard of for `trackingHours` is `updateOverdue` on the board ·
**release:** a box is pre-ticked when its stage is at or past PORT; a box below PORT is refused, not quietly released;
the booking's company or the responsible company signs · **closing to Finance:** the responsible company's Operations
Manager (or the MD) closes a live box with a `plMonth` (defaults to the month of `closedOn`); a box closed at or
before the warehouse is marked `localOnly`; a closed box takes no more journey entries; only the MD reopens.

**Who may:** `journey` screen + `write` (MD, Operations Manager, Transport Coordinator) moves boxes and flags risk;
`rel` + `write` releases; `handoff` + `write` (MD, Operations Manager) closes; `cont` reads the board (every role).

**Later slices add:** transport legs behind a stage (own slice after import), the checkpoint log with its 8-hour
window, tips tagged to a stop (5), the automatic "costs covered" gate on closing (6, 8), the digest of overdue
positions (9).

**Strict sides (28 Oct 2026, the owner's rule):** one box, one side, one company. Only the company responsible for
a box now (`Container.responsibleCompanyId`: the booking's company until the hand-over stage, the partner after) moves
it, reads its journey and its costs, releases it, closes it, tips it; the MD and the Reporting Officer see and do
everything. The other side's Operations Manager sees only **counts per stage** of boxes not on their side (`coming`
from "loaded, on the road" up to the hand-over; `handedOver` for their own bookings' boxes), never numbers or details.
A cost line or a tip typed on a box that is on the other side is saved as `PENDING_MD`, counts nowhere, and opens the
MD-queue item `COST_OTHER_SIDE`; the MD approves (lines become ACTIVE) or refuses with a reason (lines go VOID).
Helpers: `bySide(s)` and `spansAccount(s)` in `db.ts`.
