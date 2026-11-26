-- Integração cPanel por cliente: token de API cifrado + pasta de publicação.
-- Aditivo: nenhuma tabela existente é alterada.
CREATE TABLE IF NOT EXISTS "CpanelIntegration" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL DEFAULT 2083,
  "username" TEXT NOT NULL,
  "tokenEnc" TEXT NOT NULL,
  "publishDir" TEXT NOT NULL DEFAULT 'public_html',
  "siteUrl" TEXT,
  "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastTestedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT,
  "updatedByName" TEXT,
  CONSTRAINT "CpanelIntegration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CpanelIntegration_companyId_key" ON "CpanelIntegration"("companyId");
DO $$ BEGIN
  ALTER TABLE "CpanelIntegration" ADD CONSTRAINT "CpanelIntegration_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
