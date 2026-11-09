-- Domínio próprio da Página do Negócio (plano com site próprio).
DO $$ BEGIN
  CREATE TYPE "BioDomainStatus" AS ENUM ('PENDING', 'VERIFYING', 'ACTIVE', 'ERROR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "BioDomain" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "status" "BioDomainStatus" NOT NULL DEFAULT 'PENDING',
  "statusMessage" TEXT,
  "cfHostnameId" TEXT,
  "verifyName" TEXT,
  "verifyValue" TEXT,
  "cnameTarget" TEXT,
  "manual" BOOLEAN NOT NULL DEFAULT false,
  "lastCheckedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BioDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BioDomain_pageId_key" ON "BioDomain"("pageId");
CREATE UNIQUE INDEX IF NOT EXISTS "BioDomain_hostname_key" ON "BioDomain"("hostname");
CREATE INDEX IF NOT EXISTS "BioDomain_status_lastCheckedAt_idx" ON "BioDomain"("status", "lastCheckedAt");

DO $$ BEGIN
  ALTER TABLE "BioDomain" ADD CONSTRAINT "BioDomain_pageId_fkey"
    FOREIGN KEY ("pageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
