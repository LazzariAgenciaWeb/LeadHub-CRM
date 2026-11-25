-- Baixa de cobrança pelo GoHub (tela e MCP): valor recebido (parcial ou total),
-- forma, conta e cancelamento com motivo. Tudo opcional — linha antiga segue
-- valendo (PAGO sem paidCents = pago integral).
ALTER TABLE "ClientInvoice" ADD COLUMN IF NOT EXISTS "paidCents" INTEGER;
ALTER TABLE "ClientInvoice" ADD COLUMN IF NOT EXISTS "lastPaymentAt" TIMESTAMP(3);
ALTER TABLE "ClientInvoice" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
ALTER TABLE "ClientInvoice" ADD COLUMN IF NOT EXISTS "paymentAccount" TEXT;
ALTER TABLE "ClientInvoice" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);
ALTER TABLE "ClientInvoice" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "ClientInvoice" ADD COLUMN IF NOT EXISTS "canceledBy" TEXT;

-- ID externo (ULTRA:931, BLING:123) — busca direta. A unicidade é por agência
-- e a agência mora em Company.parentCompanyId, por isso quem garante é
-- src/lib/invoice-ops.ts (assertExternalIdFree), não um índice único.
CREATE INDEX IF NOT EXISTS "ClientInvoice_externalId_idx" ON "ClientInvoice"("externalId");
