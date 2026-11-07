-- Slice 2 addendum (24 Oct 2026) — a booking has a life of its own:
--   a file number per company, a status (pending · confirmed · cancelled), boxes expected before their numbers
--   are known, the fill-later fields the invoice will print (ETD, ETA, POL, POD, BL), and append-only comments.
-- Generated from schema.prisma, then edited by hand where marked.

-- 1. The status: BOOKED becomes CONFIRMED (hand-edited USING clause).
CREATE TYPE "BookingStatus_new" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');
ALTER TABLE "Booking" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "status" TYPE "BookingStatus_new"
  USING (CASE WHEN "status"::text = 'BOOKED' THEN 'CONFIRMED' ELSE "status"::text END)::"BookingStatus_new";
ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
DROP TYPE "BookingStatus_old";
ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'CONFIRMED';

-- 2. The new columns. fileNumber arrives nullable, is back-filled, then becomes NOT NULL (hand-edited).
ALTER TABLE "Booking" ADD COLUMN     "blNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "cancelReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" DATE,
ADD COLUMN     "eta" DATE,
ADD COLUMN     "etd" DATE,
ADD COLUMN     "expectedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expectedSize" VARCHAR(5) NOT NULL DEFAULT '40FT',
ADD COLUMN     "fileNumber" TEXT,
ADD COLUMN     "pod" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pol" TEXT NOT NULL DEFAULT '';

CREATE TABLE "BookingComment" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FileSequence" (
    "companyId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "FileSequence_pkey" PRIMARY KEY ("companyId","year")
);

-- 3. Existing bookings get their file number in the order they were made (hand-written):
--    the company's code (first word of its legal name), the year, a four-digit sequence; the counters follow.
UPDATE "Booking" b
SET "fileNumber" = x.code || '-' || x.year || '-' || lpad(x.rn::text, 4, '0')
FROM (
  SELECT b2.id,
         upper(regexp_replace(split_part(c."legalName", ' ', 1), '[^A-Za-z0-9]', '', 'g')) AS code,
         to_char(b2."createdAt", 'YYYY') AS year,
         row_number() OVER (PARTITION BY b2."companyId", date_part('year', b2."createdAt") ORDER BY b2."createdAt", b2.id) AS rn
  FROM "Booking" b2 JOIN "Company" c ON c.id = b2."companyId"
) x
WHERE x.id = b.id;

INSERT INTO "FileSequence" ("companyId", "year", "next")
SELECT "companyId", date_part('year', "createdAt")::int, count(*)
FROM "Booking" GROUP BY "companyId", date_part('year', "createdAt");

ALTER TABLE "Booking" ALTER COLUMN "fileNumber" SET NOT NULL;

-- 4. Confirmed bookings made before this migration count as confirmed on the day they were made.
UPDATE "Booking" SET "confirmedAt" = "createdAt"::date WHERE "status" = 'CONFIRMED' AND "confirmedAt" IS NULL;

CREATE INDEX "BookingComment_bookingId_createdAt_idx" ON "BookingComment"("bookingId", "createdAt");

CREATE UNIQUE INDEX "Booking_accountId_fileNumber_key" ON "Booking"("accountId", "fileNumber");

ALTER TABLE "BookingComment" ADD CONSTRAINT "BookingComment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Comments are append-only at database level, like the audit trail (hand-written).
CREATE OR REPLACE FUNCTION booking_comment_refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BookingComment is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_comment_append_only
  BEFORE UPDATE OR DELETE ON "BookingComment"
  FOR EACH ROW EXECUTE FUNCTION booking_comment_refuse_change();
