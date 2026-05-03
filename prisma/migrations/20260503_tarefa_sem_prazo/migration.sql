-- Penalidade por tarefa sem data de conclusão no ClickUp
-- Quando o pessoal não preenche due_date nos cards, equipe perde -3/dia
-- até alguém preencher. Idempotente por (projeto, dia).

ALTER TABLE "SetorClickupList"
  ADD COLUMN IF NOT EXISTS "taskNoDueDate" INTEGER NOT NULL DEFAULT 0;

ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'TAREFA_SEM_PRAZO';
