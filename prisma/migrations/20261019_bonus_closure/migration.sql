-- Fechamento da bonificação por competência: encerrado, o mês vira somente
-- leitura. "Pago" nunca trancou nada — a trava de duplicidade é por
-- (origem, colaborador, mês) e não cobre avulso nem impede editar o que já
-- foi pago, então lançamento tardio num mês fechado virava pagamento dobrado.
CREATE TABLE "BonusClosure" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "totalCents" INTEGER NOT NULL DEFAULT 0,
  "qtd" INTEGER NOT NULL DEFAULT 0,
  "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedBy" TEXT,
  "reopenedAt" TIMESTAMP(3),
  "reopenedBy" TEXT,
  CONSTRAINT "BonusClosure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BonusClosure_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BonusClosure_companyId_month_key" ON "BonusClosure"("companyId", "month");
CREATE INDEX "BonusClosure_companyId_closedAt_idx" ON "BonusClosure"("companyId", "closedAt");
