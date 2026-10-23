-- Slice 2 — booking and container: shipping lines, clients, bookings, containers, the MD queue.
-- Generated from schema.prisma, then one hand-written addition at the end: one ACTIVE record per container number per account.

CREATE TYPE "BookingStatus" AS ENUM ('BOOKED');

CREATE TYPE "ContainerStatus" AS ENUM ('ACTIVE', 'DUPLICATE', 'WITHDRAWN');

CREATE TYPE "QueueStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "ShippingLine" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "usualPrefixes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "referenceHint" TEXT NOT NULL DEFAULT '',
    "referencePattern" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL DEFAULT '',
    "tin" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "country" VARCHAR(2) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "shippingLineId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "destination" TEXT NOT NULL DEFAULT '',
    "vessel" TEXT NOT NULL DEFAULT '',
    "voyage" TEXT NOT NULL DEFAULT '',
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Container" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "number" VARCHAR(11) NOT NULL,
    "size" VARCHAR(5) NOT NULL,
    "lot" TEXT NOT NULL DEFAULT '',
    "stage" "Stage" NOT NULL DEFAULT 'BOOKED',
    "status" "ContainerStatus" NOT NULL DEFAULT 'ACTIVE',
    "duplicateOfId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Container_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MdQueueItem" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "companyId" UUID,
    "kind" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "summary" JSONB NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MdQueueItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShippingLine_accountId_name_key" ON "ShippingLine"("accountId", "name");

CREATE UNIQUE INDEX "Client_accountId_name_key" ON "Client"("accountId", "name");

CREATE INDEX "Booking_accountId_companyId_createdAt_idx" ON "Booking"("accountId", "companyId", "createdAt");

CREATE UNIQUE INDEX "Booking_accountId_reference_key" ON "Booking"("accountId", "reference");

CREATE INDEX "Container_accountId_number_idx" ON "Container"("accountId", "number");

CREATE INDEX "Container_bookingId_idx" ON "Container"("bookingId");

CREATE INDEX "MdQueueItem_accountId_status_createdAt_idx" ON "MdQueueItem"("accountId", "status", "createdAt");

ALTER TABLE "ShippingLine" ADD CONSTRAINT "ShippingLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Client" ADD CONSTRAINT "Client_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_shippingLineId_fkey" FOREIGN KEY ("shippingLineId") REFERENCES "ShippingLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Container" ADD CONSTRAINT "Container_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Container" ADD CONSTRAINT "Container_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MdQueueItem" ADD CONSTRAINT "MdQueueItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- An account never holds two live records of one container number; a DUPLICATE waits beside the ACTIVE one for the MD.
CREATE UNIQUE INDEX "Container_one_active_per_number" ON "Container"("accountId", "number") WHERE "status" = 'ACTIVE';
