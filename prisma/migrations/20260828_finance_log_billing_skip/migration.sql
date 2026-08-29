-- Trilha de auditoria do financeiro + "ignorar" por competência na fila.
CREATE TABLE "BillingSkip" (
  "id" TEXT NOT NULL,
  "clientServiceId" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "reason" TEXT,
  "userName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingSkip_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingSkip_clientServiceId_fkey" FOREIGN KEY ("clientServiceId")
    REFERENCES "ClientService"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BillingSkip_clientServiceId_month_key" ON "BillingSkip"("clientServiceId", "month");
CREATE INDEX "BillingSkip_month_idx" ON "BillingSkip"("month");

-- Sem FKs de propósito: apagar a cobrança não pode apagar o registro de que
-- ela existiu.
CREATE TABLE "FinanceLog" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "clientCompanyId" TEXT,
  "entity" TEXT NOT NULL,
  "entityId" TEXT,
  "action" TEXT NOT NULL,
  "description" TEXT,
  "meta" JSONB,
  "userName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FinanceLog_companyId_createdAt_idx" ON "FinanceLog"("companyId", "createdAt");
CREATE INDEX "FinanceLog_clientCompanyId_createdAt_idx" ON "FinanceLog"("clientCompanyId", "createdAt");
CREATE INDEX "FinanceLog_entity_entityId_idx" ON "FinanceLog"("entity", "entityId");
