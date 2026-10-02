-- Venda da esteira ligada ao PROJETO que a entrega: o detalhe do que fazer
-- vive no projeto (tarefas, prazo, material) e a esteira acompanha o
-- andamento até a entrega liberar a bonificação.
ALTER TABLE "Sale" ADD COLUMN "projectId" TEXT;
CREATE INDEX IF NOT EXISTS "Sale_projectId_idx" ON "Sale"("projectId");
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "SetorClickupList"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
