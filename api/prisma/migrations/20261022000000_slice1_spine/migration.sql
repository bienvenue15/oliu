-- Slice 1 — the spine: accounts, companies, bank accounts, feature switches, people, sessions, audit.
-- Generated from schema.prisma, then one hand-written addition at the end: the append-only trigger on AuditEvent.

CREATE TYPE "Package" AS ENUM ('SINGLE', 'GROUP');
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'READ_ONLY', 'SUSPENDED');
CREATE TYPE "CompanyKind" AS ENUM ('MAIN', 'BRANCH', 'PARTNER');
CREATE TYPE "Role" AS ENUM ('MD', 'OPS_MANAGER', 'FINANCE_OFFICER', 'TRANSPORT_COORDINATOR', 'FIELD_OFFICER', 'REPORTING_OFFICER');
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "TokenPurpose" AS ENUM ('SET_PASSWORD', 'RESET_PASSWORD');
CREATE TYPE "Stage" AS ENUM ('BOOKED', 'TRANSPORT', 'FIELD_RELEASE', 'RUSUMO', 'CHECKPOINTS', 'ICD', 'PORT', 'OCEAN_FREIGHT');

CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "package" "Package" NOT NULL,
    "handoverStage" "Stage",
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "country" VARCHAR(2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "tin" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "kind" "CompanyKind" NOT NULL,
    "parentId" UUID,
    "billsClient" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankAccount" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "bank" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "swift" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pendingChange" JSONB,
    "pendingBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeatureSwitch" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "companyId" UUID,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "FeatureSwitch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "companyId" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT,
    "otpMailbox" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OtpChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActionToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActionToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "accountId" UUID NOT NULL,
    "userId" UUID,
    "companyId" UUID,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Company_accountId_idx" ON "Company"("accountId");
CREATE INDEX "BankAccount_accountId_companyId_idx" ON "BankAccount"("accountId", "companyId");
CREATE UNIQUE INDEX "FeatureSwitch_accountId_companyId_feature_key" ON "FeatureSwitch"("accountId", "companyId", "feature");
CREATE UNIQUE INDEX "User_accountId_email_key" ON "User"("accountId", "email");
CREATE INDEX "User_accountId_companyId_idx" ON "User"("accountId", "companyId");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE UNIQUE INDEX "ActionToken_tokenHash_key" ON "ActionToken"("tokenHash");
CREATE INDEX "AuditEvent_accountId_at_idx" ON "AuditEvent"("accountId", "at");
CREATE INDEX "AuditEvent_accountId_entity_entityId_idx" ON "AuditEvent"("accountId", "entity", "entityId");

ALTER TABLE "Company" ADD CONSTRAINT "Company_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Company" ADD CONSTRAINT "Company_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeatureSwitch" ADD CONSTRAINT "FeatureSwitch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActionToken" ADD CONSTRAINT "ActionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The audit trail is append-only at database level: nobody, including the MD, can edit or delete history.
CREATE OR REPLACE FUNCTION audit_refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_refuse_change();
