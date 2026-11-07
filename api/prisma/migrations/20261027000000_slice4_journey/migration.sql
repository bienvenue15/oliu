-- Slice 4 — journey stages and the hand-over: the responsible company on each box, its position and timeline,
-- at-risk spells, release and closing to Finance, sister bookings, the delay flag on a cost line, two account figures.
-- Drafted with `prisma migrate diff --from-schema-datamodel <previous schema> --to-schema-datamodel`, then hand-edited.

-- CreateEnum
CREATE TYPE "JourneyKind" AS ENUM ('REACHED', 'UPDATE', 'HELD', 'RETURNED', 'CORRECTED', 'RELEASED', 'FLAGGED', 'CLEARED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "RiskSource" AS ENUM ('ICD', 'MANUAL');

-- AlterTable
ALTER TABLE "AccountSettings" ADD COLUMN     "icdFreeDays" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "trackingHours" INTEGER NOT NULL DEFAULT 12;

-- AlterTable
ALTER TABLE "CostLine" ADD COLUMN     "delayRelated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "parentId" UUID;

-- AlterTable
ALTER TABLE "Container" ADD COLUMN     "arrivedOn" DATE,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" UUID,
ADD COLUMN     "closedOn" DATE,
ADD COLUMN     "departedOn" DATE,
ADD COLUMN     "emptyReturnedOn" DATE,
ADD COLUMN     "holdReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "icdSince" TIMESTAMP(3),
ADD COLUMN     "lastPlace" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "localOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "plMonth" VARCHAR(7) NOT NULL DEFAULT '',
ADD COLUMN     "readyToInvoice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "releasedById" UUID,
ADD COLUMN     "responsibleCompanyId" UUID,
ADD COLUMN     "stageAt" TIMESTAMP(3);

-- Every existing box is on the working list of the company that booked it; then the column is required.
UPDATE "Container" c SET "responsibleCompanyId" = b."companyId" FROM "Booking" b WHERE b."id" = c."bookingId";
ALTER TABLE "Container" ALTER COLUMN "responsibleCompanyId" SET NOT NULL;

-- CreateTable
CREATE TABLE "JourneyEvent" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "containerId" UUID NOT NULL,
    "companyId" UUID,
    "kind" "JourneyKind" NOT NULL,
    "stage" "Stage",
    "place" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "happenedAt" TIMESTAMP(3) NOT NULL,
    "handedToCompanyId" UUID,
    "byId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskPeriod" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "containerId" UUID NOT NULL,
    "source" "RiskSource" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "from" DATE NOT NULL,
    "to" DATE,
    "openedById" UUID,
    "closedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JourneyEvent_containerId_happenedAt_idx" ON "JourneyEvent"("containerId", "happenedAt");

-- CreateIndex
CREATE INDEX "JourneyEvent_accountId_createdAt_idx" ON "JourneyEvent"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskPeriod_containerId_to_idx" ON "RiskPeriod"("containerId", "to");

-- CreateIndex
CREATE INDEX "Container_accountId_responsibleCompanyId_status_stage_idx" ON "Container"("accountId", "responsibleCompanyId", "status", "stage");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyEvent" ADD CONSTRAINT "JourneyEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyEvent" ADD CONSTRAINT "JourneyEvent_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskPeriod" ADD CONSTRAINT "RiskPeriod_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskPeriod" ADD CONSTRAINT "RiskPeriod_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

