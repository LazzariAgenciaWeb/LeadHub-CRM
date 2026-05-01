-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('DOMAIN', 'HOSTING', 'WEBSITE', 'EMAIL_ACCOUNT', 'DATABASE', 'DNS_PROVIDER', 'REPOSITORY', 'SOCIAL_ACCOUNT', 'ANALYTICS', 'CLOUD_SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CredentialAction" AS ENUM ('REVEAL', 'COPY', 'SHARE', 'EDIT', 'CREATE', 'DELETE');

-- CreateTable
CREATE TABLE "CompanyAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "host" TEXT,
    "identifier" TEXT,
    "provider" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CompanyAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyCredential" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "username" TEXT,
    "passwordEncrypted" TEXT,
    "url" TEXT,
    "totpSecret" TEXT,
    "notes" TEXT,
    "lastRotatedAt" TIMESTAMP(3),
    "sharedWithClient" BOOLEAN NOT NULL DEFAULT false,
    "sharedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CompanyCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialAccessLog" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "userRole" TEXT,
    "action" "CredentialAction" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyAsset_companyId_type_idx" ON "CompanyAsset"("companyId", "type");

-- CreateIndex
CREATE INDEX "CompanyAsset_companyId_expiresAt_idx" ON "CompanyAsset"("companyId", "expiresAt");

-- CreateIndex
CREATE INDEX "CompanyCredential_assetId_idx" ON "CompanyCredential"("assetId");

-- CreateIndex
CREATE INDEX "CredentialAccessLog_credentialId_createdAt_idx" ON "CredentialAccessLog"("credentialId", "createdAt");

-- CreateIndex
CREATE INDEX "CredentialAccessLog_companyId_createdAt_idx" ON "CredentialAccessLog"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "CompanyAsset" ADD CONSTRAINT "CompanyAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCredential" ADD CONSTRAINT "CompanyCredential_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CompanyAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialAccessLog" ADD CONSTRAINT "CredentialAccessLog_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "CompanyCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialAccessLog" ADD CONSTRAINT "CredentialAccessLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
