# shipments

**Owns:** `ShippingLine`, `Client`, `Booking`, `Container`, `MdQueueItem`. The container number is the unit of
truth; everything money-related in later slices hangs off a container.

**Routes:** `GET|POST /api/shipping-lines` · `GET|POST /api/clients` · `GET /api/bookings?month=` ·
`POST /api/bookings` · `GET|PATCH /api/bookings/:id` · `POST /api/bookings/:id/containers` ·
`GET /api/containers?q=&month=` · `GET /api/containers/check?number=` · `GET /api/md-queue` ·
`POST /api/md-queue/:id/resolve`.

**Events:** `shipping_line_added`, `client_added`, `booking_created`, `booking_updated`, `container_added`,
`container_duplicate_flagged`, `duplicate_resolved`.

**Rules:** a container number must pass ISO 6346 (`checkContainerNumber` in `@oliu/shared`) before it is
saved · an account holds one ACTIVE record per number (partial unique index `Container_one_active_per_number`);
a second entry is saved as DUPLICATE beside it and opens an MD-queue item, which only the MD resolves (keep
the new, withdraw the new, or correct its number) · a booking belongs to the company that made it; the other
company of the account can read it and find its boxes by number, never change it · a shipping line may
impose a shape on booking numbers (`referencePattern`), and its usual owner codes only produce a note ·
writing needs the `book` screen and the `write` permission (MD, Operations Manager).

**Later slices add:** cost lines per container (3), stages and the hand-over flip (4), the rest of the MD
queue (6), invoices from departed containers (8).
