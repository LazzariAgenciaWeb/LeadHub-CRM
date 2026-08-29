-- Responsável pela execução da venda — quem entrega e, portanto, quem
-- bonifica. Diferente do vendedor (sellerName).
ALTER TABLE "Sale" ADD COLUMN "responsibleId" TEXT;
ALTER TABLE "Sale" ADD COLUMN "responsibleName" TEXT;
