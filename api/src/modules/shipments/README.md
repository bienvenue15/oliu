# shipments

**Owns:** `ShippingLine`, `Client`, `Booking`, `BookingComment`, `FileSequence`, `Container`, `MdQueueItem`.
The container number is the unit of truth; everything money-related in later slices hangs off a container.

**Routes:** `GET|POST /api/shipping-lines` · `GET|POST /api/clients` · `GET /api/bookings?month=` ·
`POST /api/bookings` · `GET|PATCH /api/bookings/:id` · `POST /api/bookings/:id/confirm | cancel` ·
`GET|POST /api/bookings/:id/comments` · `POST /api/bookings/:id/containers` ·
`GET /api/containers?q=&month=` · `GET /api/containers/check?number=` · `GET /api/md-queue` ·
`POST /api/md-queue/:id/resolve`.

**Events:** `shipping_line_added`, `client_added`, `booking_created`, `booking_updated`, `booking_confirmed`,
`booking_cancelled`, `booking_commented`, `container_added`, `container_duplicate_flagged`, `duplicate_resolved`.

**A booking's life:** created PENDING or CONFIRMED with either container numbers or an agreed count
(`expectedCount × expectedSize`); numbers follow; the file number `CODE-YYYY-NNNN` is assigned per company and
year by `nextFileNumber()` in one atomic statement and never changes; CANCELLED keeps a reason, withdraws the
boxes (numbers free again), closes their duplicate cases, and is read-only afterwards except for comments.
Comments are append-only by trigger.

**Rules:** a container number must pass ISO 6346 (`checkContainerNumber` in `@oliu/shared`) before it is
saved · an account holds one ACTIVE record per number (partial unique index `Container_one_active_per_number`);
a second entry is saved as DUPLICATE beside it and opens an MD-queue item, which only the MD resolves (keep
the new, withdraw the new, or correct its number) · a booking belongs to the company that made it; the other
company of the account can read it and find its boxes by number, never change it · a shipping line may
impose a shape on booking numbers (`referencePattern`), and its usual owner codes only produce a note ·
writing needs the `book` screen and the `write` permission (MD, Operations Manager).

**Later slices add:** cost lines per container (3), stages and the hand-over flip (4), the rest of the MD
queue (6), invoices from departed containers (8).

**Slice 4 changed:** a new box gets `responsibleCompanyId` = its booking's company; `GET /api/containers` without `q`
is the **working list** — the boxes the caller's company is responsible for (the switcher's company for the MD),
`handed=1` lists this company's bookings' boxes now on another company's list, `q` still finds any box of the account
read-only · `PATCH /api/containers/:id` (lot, weight) is open to the booking's company or the responsible company ·
`POST /api/bookings/:id/sister` opens a sister booking (`Booking.parentId`) and moves the waiting boxes and their
cost lines to it (`sister_booking_opened`, `container_moved_to_sister`). The journey itself lives in `journey/`.

**Strict sides (28 Oct 2026, the owner's rule):** one box, one side, one company. Only the company responsible for
a box now (`Container.responsibleCompanyId`: the booking's company until the hand-over stage, the partner after) moves
it, reads its journey and its costs, releases it, closes it, tips it; the MD and the Reporting Officer see and do
everything. The other side's Operations Manager sees only **counts per stage** of boxes not on their side (`coming`
from "loaded, on the road" up to the hand-over; `handedOver` for their own bookings' boxes), never numbers or details.
A cost line or a tip typed on a box that is on the other side is saved as `PENDING_MD`, counts nowhere, and opens the
MD-queue item `COST_OTHER_SIDE`; the MD approves (lines become ACTIVE) or refuses with a reason (lines go VOID).
Helpers: `bySide(s)` and `spansAccount(s)` in `db.ts`.

Consequences here: `GET /api/bookings` lists my company's bookings **and** the bookings with a live box on my side (the other side's bookings after the hand-over, so the Cost & split, Release and Handoff screens can pick them); `GET /api/containers` (with or without `q`) returns only boxes on the caller's side; `handed=1` is
gone (the board carries the counts); `GET /api/bookings/:id` is readable by the booking's company and by the side that
holds some of its boxes, lists only the boxes on the caller's side and gives `elsewhere` (count per stage) for the
rest; the sister booking moves only boxes on the caller's side; `PATCH /api/containers/:id` is the responsible side's.
`POST /md-queue/:id/resolve` takes `APPROVE` / `REFUSE` (+ `reason`) for `COST_OTHER_SIDE` items.

**Bookings belong to the company that bills the client (28 Oct 2026):** `bookingCompany(s)` refuses `POST /api/bookings`,
`POST /api/shipping-lines` and `POST /api/clients` for a company that does not bill (JIVAH), even for the MD with that
company in the switcher; a branch follows its parent. `/api/auth/me` returns `booksForClients` and drops the `book`
screen from the menus of such a company's people (`menusForRole(role, booksForClients)` in `@oliu/shared`).
