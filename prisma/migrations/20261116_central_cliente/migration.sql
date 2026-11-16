-- Central do Cliente: aceite do contrato, confirmação do faturamento,
-- serviços vendidos, documentos do cliente e e-mail ligado ao cliente.
-- Tudo aditivo e opcional: venda/e-mail antigos seguem como estavam.

-- Venda (= contrato da esteira)
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "contractDocType" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "contractDocumentId" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "contractSentAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "contractEndedAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "acceptanceType" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "acceptanceUrl" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "acceptedByName" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "acceptedByEmail" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "acceptanceEmailId" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "acceptanceRecordedBy" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "billingConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "billingConfirmedBy" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "billingConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "billingConfirmationUrl" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "billingConfirmationEmailId" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "billingInstructions" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "soldServices" JSONB;

-- Links fixos do cliente
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "driveFolderUrl" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "clickupListUrl" TEXT;

-- E-mail ligado ao cliente
ALTER TABLE "InboxEmail" ADD COLUMN IF NOT EXISTS "clientCompanyId" TEXT;
ALTER TABLE "InboxEmail" ADD COLUMN IF NOT EXISTS "clientLinkSource" TEXT;
ALTER TABLE "InboxEmail" ADD COLUMN IF NOT EXISTS "clientMark" TEXT;
CREATE INDEX IF NOT EXISTS "InboxEmail_clientCompanyId_sentAt_idx" ON "InboxEmail"("clientCompanyId", "sentAt");

-- Documentos do cliente
CREATE TABLE IF NOT EXISTS "ClientDocument" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "clientCompanyId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT,
  "notes" TEXT,
  "storageObjectId" TEXT,
  "saleId" TEXT,
  "documentDate" TIMESTAMP(3),
  "createdById" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClientDocument_storageObjectId_key" ON "ClientDocument"("storageObjectId");
CREATE INDEX IF NOT EXISTS "ClientDocument_clientCompanyId_createdAt_idx" ON "ClientDocument"("clientCompanyId", "createdAt");
CREATE INDEX IF NOT EXISTS "ClientDocument_saleId_idx" ON "ClientDocument"("saleId");
