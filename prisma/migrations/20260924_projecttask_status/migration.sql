-- Status da tarefa interna: NOVA | EM_PRODUCAO | AGUARDANDO_CLIENTE | APROVADO.
-- Vira a fonte única do andamento — `done`/`completedAt`/`awaitingClient`
-- passam a ser derivados dele no PATCH da tarefa.

ALTER TABLE "ProjectTask" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'NOVA';

-- Backfill coerente com o que já existe hoje, pra nenhuma tarefa nascer
-- com status mentiroso: concluída → APROVADO, aguardando → AGUARDANDO_CLIENTE,
-- o resto que já tem algum andamento → EM_PRODUCAO.
UPDATE "ProjectTask" SET "status" = 'APROVADO'           WHERE "done" = true;
UPDATE "ProjectTask" SET "status" = 'AGUARDANDO_CLIENTE' WHERE "done" = false AND "awaitingClient" = true;
UPDATE "ProjectTask" SET "status" = 'EM_PRODUCAO'
  WHERE "done" = false AND "awaitingClient" = false AND "startDate" IS NOT NULL;
