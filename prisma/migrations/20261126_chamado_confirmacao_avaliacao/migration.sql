-- Chamado: confirmação do cliente (fecha sozinho em 3 dias úteis) e avaliação
-- do atendimento. Empresa: link de avaliação no Google.
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "confirmDueAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "confirmedByName" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "autoClosedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "rating" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "ratingComment" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "ratedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "ratedByName" TEXT;
CREATE INDEX IF NOT EXISTS "Ticket_status_confirmDueAt_idx" ON "Ticket"("status", "confirmDueAt");

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "googleReviewUrl" TEXT;
