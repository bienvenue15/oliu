-- Slice 5 — tips: reasons, the tip record behind its cost lines, the tip category flag, the two figures, the purpose of a one-time code.
-- Drafted with `prisma migrate diff --from-schema-datamodel <previous schema> --to-schema-datamodel`, then hand-edited.

-- CreateEnum
CREATE TYPE "TipPayeeType" AS ENUM ('OFFICIAL', 'AGENT', 'DRIVER', 'OTHER');

-- AlterTable
ALTER TABLE "AccountSettings" ADD COLUMN     "tipCapUsdCents" INTEGER NOT NULL DEFAULT 100000,
ADD COLUMN     "tipCeilingUsdCents" INTEGER NOT NULL DEFAULT 5000;

-- AlterTable
ALTER TABLE "CostCategory" ADD COLUMN     "isTip" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CostLine" ADD COLUMN     "tipId" UUID;

-- AlterTable
ALTER TABLE "OtpChallenge" ADD COLUMN     "purpose" VARCHAR(20) NOT NULL DEFAULT 'LOGIN';

-- CreateTable
CREATE TABLE "TipReason" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TipReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tip" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "reasonId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "splitId" UUID,
    "date" DATE NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "usdCents" BIGINT NOT NULL,
    "payeeType" "TipPayeeType",
    "payeeId" TEXT NOT NULL DEFAULT '',
    "checkpoint" TEXT NOT NULL DEFAULT '',
    "stage" "Stage",
    "note" TEXT NOT NULL DEFAULT '',
    "receiptPath" TEXT NOT NULL DEFAULT '',
    "receiptType" TEXT NOT NULL DEFAULT '',
    "mdOverride" BOOLEAN NOT NULL DEFAULT false,
    "paidById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TipReason_accountId_label_key" ON "TipReason"("accountId", "label");

-- CreateIndex
CREATE INDEX "Tip_accountId_companyId_date_idx" ON "Tip"("accountId", "companyId", "date");

-- CreateIndex
CREATE INDEX "Tip_paidById_createdAt_idx" ON "Tip"("paidById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tip_accountId_clientId_key" ON "Tip"("accountId", "clientId");

-- AddForeignKey
ALTER TABLE "CostLine" ADD CONSTRAINT "CostLine_tipId_fkey" FOREIGN KEY ("tipId") REFERENCES "Tip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipReason" ADD CONSTRAINT "TipReason_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tip" ADD CONSTRAINT "Tip_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tip" ADD CONSTRAINT "Tip_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "TipReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The category tips land in: the one the slice 3 seed made, where it exists.
UPDATE "CostCategory" SET "isTip" = true WHERE "name" = 'Tip / facilitation';
