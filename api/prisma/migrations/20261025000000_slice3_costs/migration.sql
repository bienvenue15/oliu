-- Slice 3 — cost entry and the split: categories, daily rates, cost lines, shared-bill splits, the margin figure, weight per box.
-- Generated from schema.prisma.

CREATE TYPE "SplitMethod" AS ENUM ('EQUAL', 'WEIGHT', 'MANUAL');

CREATE TYPE "CostLineStatus" AS ENUM ('ACTIVE', 'VOID');

ALTER TABLE "Container" ADD COLUMN     "weightKg" INTEGER;

CREATE TABLE "AccountSettings" (
    "accountId" UUID NOT NULL,
    "marginType" VARCHAR(10) NOT NULL DEFAULT 'PERCENT',
    "marginValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountSettings_pkey" PRIMARY KEY ("accountId")
);

CREATE TABLE "CostCategory" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CostCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExchangeRate" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "date" DATE NOT NULL,
    "perUsd" DECIMAL(14,3) NOT NULL,
    "enteredById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostSplit" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "method" "SplitMethod" NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostSplit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostLine" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "containerId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "splitId" UUID,
    "date" DATE NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "perUsd" DECIMAL(14,3) NOT NULL,
    "usdCents" BIGINT NOT NULL,
    "paidTo" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" "CostLineStatus" NOT NULL DEFAULT 'ACTIVE',
    "voidReason" TEXT NOT NULL DEFAULT '',
    "enteredById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CostCategory_accountId_name_key" ON "CostCategory"("accountId", "name");

CREATE UNIQUE INDEX "ExchangeRate_accountId_currency_date_key" ON "ExchangeRate"("accountId", "currency", "date");

CREATE INDEX "CostSplit_accountId_companyId_idx" ON "CostSplit"("accountId", "companyId");

CREATE INDEX "CostLine_accountId_companyId_date_idx" ON "CostLine"("accountId", "companyId", "date");

CREATE INDEX "CostLine_containerId_status_idx" ON "CostLine"("containerId", "status");

CREATE INDEX "CostLine_bookingId_idx" ON "CostLine"("bookingId");

ALTER TABLE "AccountSettings" ADD CONSTRAINT "AccountSettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CostCategory" ADD CONSTRAINT "CostCategory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CostSplit" ADD CONSTRAINT "CostSplit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CostLine" ADD CONSTRAINT "CostLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CostLine" ADD CONSTRAINT "CostLine_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CostLine" ADD CONSTRAINT "CostLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CostCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CostLine" ADD CONSTRAINT "CostLine_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "CostSplit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

