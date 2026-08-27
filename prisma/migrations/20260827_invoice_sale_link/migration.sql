-- Liga a cobrança à venda pontual que a originou.
-- Recorrente continua vindo por clientServiceId; os dois são mutuamente
-- exclusivos na prática. UNIQUE impede que marcar "Faturado" duas vezes na
-- esteira gere cobrança duplicada.

ALTER TABLE "ClientInvoice" ADD COLUMN IF NOT EXISTS "saleId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ClientInvoice_saleId_key" ON "ClientInvoice"("saleId");

ALTER TABLE "ClientInvoice"
  ADD CONSTRAINT "ClientInvoice_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
