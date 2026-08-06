-- Integração Bling (ERP) — Fase 1: espelho Bling ↔ LeadHub (só a AZZ conecta).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.
--
-- Objetivo:
--   1. Casar/espelhar o cadastro de clientes (Bling contato ↔ sub-empresa da AZZ)
--      pela chave CNPJ/CPF (Company.document) + vínculo forte (Company.blingContactId).
--   2. Trazer boletos (contas a receber) + NF emitidas pro financeiro
--      (ClientInvoice.provider='bling', externalId = id do registro no Bling).

-- ── Company: chaves de casamento com o Bling ────────────────────────────────
ALTER TABLE "Company" ADD COLUMN "document" TEXT;          -- CNPJ/CPF só dígitos
ALTER TABLE "Company" ADD COLUMN "blingContactId" TEXT;    -- id do contato no Bling

CREATE UNIQUE INDEX "Company_blingContactId_key" ON "Company"("blingContactId");
CREATE INDEX "Company_document_idx" ON "Company"("document");

-- ── BlingIntegration: conexão OAuth (singleton por empresa) ─────────────────
CREATE TABLE "BlingIntegration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastError" TEXT,
    "lastClientsSynced" INTEGER NOT NULL DEFAULT 0,
    "lastInvoicesSynced" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "BlingIntegration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BlingIntegration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BlingIntegration_companyId_key" ON "BlingIntegration"("companyId");
CREATE INDEX "BlingIntegration_status_lastSyncAt_idx" ON "BlingIntegration"("status", "lastSyncAt");

-- ── ClientInvoice: lookup/dedup das faturas importadas do Bling ─────────────
CREATE INDEX "ClientInvoice_provider_externalId_idx" ON "ClientInvoice"("provider", "externalId");
-- Índice UNIQUE PARCIAL: garante 1 fatura por registro do Bling (não afeta as
-- faturas manuais, que ficam de fora do filtro provider='bling').
CREATE UNIQUE INDEX "ClientInvoice_bling_external_unique"
    ON "ClientInvoice"("externalId")
    WHERE "provider" = 'bling';
