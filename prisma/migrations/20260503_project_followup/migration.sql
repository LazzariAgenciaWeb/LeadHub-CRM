-- Cobranças ao cliente em projetos AGUARDANDO_CLIENTE.
-- Permite registrar contato + próxima previsão de retorno, evitando que
-- projetos fiquem esquecidos no status. Também adiciona penalty pra
-- tarefa atrasada (overdue no ClickUp).

-- Próxima vez que se espera retorno do cliente
ALTER TABLE "SetorClickupList"
  ADD COLUMN IF NOT EXISTS "clientExpectedAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "clientLastContactAt" TIMESTAMP(3);

-- ProjectActivity ganha campos pra suportar follow-ups (com texto + autor)
ALTER TABLE "ProjectActivity"
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "authorId"    TEXT,
  ADD COLUMN IF NOT EXISTS "authorName"  TEXT;

-- Nova razão: tarefa atrasada no ClickUp (cron diário, -3 por projeto/dia)
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'TAREFA_ATRASADA';
