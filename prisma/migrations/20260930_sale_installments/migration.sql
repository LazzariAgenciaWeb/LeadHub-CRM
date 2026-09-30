-- Venda parcelada: uma cobrança POR PARCELA. O vínculo venda→cobrança deixa
-- de ser 1:1 (projeto de R$ 18 mil em 12x precisa de 12 linhas, cada uma com
-- vencimento e baixa próprios).
DROP INDEX IF EXISTS "ClientInvoice_saleId_key";
CREATE INDEX IF NOT EXISTS "ClientInvoice_saleId_idx" ON "ClientInvoice"("saleId");

-- Posição da parcela e total combinado. Nulos = cobrança única.
ALTER TABLE "ClientInvoice" ADD COLUMN IF NOT EXISTS "installment" INTEGER;
ALTER TABLE "ClientInvoice" ADD COLUMN IF NOT EXISTS "installments" INTEGER;
