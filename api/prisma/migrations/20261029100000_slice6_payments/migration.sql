-- Slice 6 (29 Oct 2026): payments. Beneficiaries on protected accounts, payment orders (requested, approved,
-- paid and locked), the PR counter, the approval threshold, and the link from a cost line to its order.
-- CreateEnum
CREATE TYPE "BeneficiaryStatus" AS ENUM ('PENDING', 'VERIFIED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('COST', 'EXPENSE', 'FLOAT_ADVANCE', 'SETTLEMENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('REQUESTED', 'BLOCKED', 'APPROVED', 'PAID', 'REJECTED');

-- AlterTable
ALTER TABLE "AccountSettings" ADD COLUMN     "approvalThresholdUsdCents" INTEGER NOT NULL DEFAULT 50000;

-- AlterTable
ALTER TABLE "CostLine" ADD COLUMN     "paymentId" UUID;

-- CreateTable
CREATE TABLE "Beneficiary" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "userId" UUID,
    "accountKind" VARCHAR(10) NOT NULL,
    "bank" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "currency" VARCHAR(3) NOT NULL,
    "status" "BeneficiaryStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT NOT NULL DEFAULT '',
    "pendingChange" JSONB,
    "pendingById" UUID,
    "pendingAt" TIMESTAMP(3),
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "suspendReason" TEXT NOT NULL DEFAULT '',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Beneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "beneficiaryId" UUID NOT NULL,
    "categoryId" UUID,
    "date" DATE NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "perUsd" DECIMAL(14,3) NOT NULL,
    "usdCents" BIGINT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT NOT NULL DEFAULT '',
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "approvedWithCode" BOOLEAN NOT NULL DEFAULT false,
    "rejectedById" UUID,
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT NOT NULL DEFAULT '',
    "paidById" UUID,
    "paidAt" TIMESTAMP(3),
    "paidRef" TEXT NOT NULL DEFAULT '',
    "paidFromBankId" UUID,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSequence" (
    "companyId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PaymentSequence_pkey" PRIMARY KEY ("companyId","year")
);

-- CreateIndex
CREATE INDEX "Beneficiary_accountId_status_idx" ON "Beneficiary"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Beneficiary_accountId_name_key" ON "Beneficiary"("accountId", "name");

-- CreateIndex
CREATE INDEX "PaymentRequest_accountId_companyId_status_idx" ON "PaymentRequest"("accountId", "companyId", "status");

-- CreateIndex
CREATE INDEX "PaymentRequest_beneficiaryId_status_idx" ON "PaymentRequest"("beneficiaryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_companyId_number_key" ON "PaymentRequest"("companyId", "number");

-- CreateIndex
CREATE INDEX "CostLine_paymentId_idx" ON "CostLine"("paymentId");

-- AddForeignKey
ALTER TABLE "CostLine" ADD CONSTRAINT "CostLine_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beneficiary" ADD CONSTRAINT "Beneficiary_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

