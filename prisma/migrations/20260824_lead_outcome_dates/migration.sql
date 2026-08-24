-- Lead.wonAt / Lead.lostAt — datas congeladas do desfecho comercial.
--
-- Por que: até aqui não existia QUANDO uma oportunidade foi ganha. `value` é
-- editável a qualquer momento e `updatedAt` muda a cada toque no lead, então
-- "quanto vendemos em agosto" era impossível de responder — o Kanban só sabia
-- somar a coluna "Fechado" inteira, desde o começo dos tempos.
--
-- O carimbo novo é feito no PATCH /api/leads/[id] na transição de status.
-- Este arquivo cria as colunas e faz o backfill da base existente.
--
-- Idempotente: pode rodar de novo sem estragar nada (o WHERE ... IS NULL
-- protege quem já foi carimbado, inclusive manualmente).

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "wonAt"  TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lostAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Lead_companyId_wonAt_idx"  ON "Lead" ("companyId", "wonAt");
CREATE INDEX IF NOT EXISTS "Lead_companyId_lostAt_idx" ON "Lead" ("companyId", "lostAt");

-- Backfill GANHO. Ordem de preferência da data:
--   1) última Activity STAGE_CHANGED cujo destino é uma etapa marcada GANHO;
--   2) legado — etapas antigas sem `outcome`, casadas pelo nome (mesma heurística
--      do fallback em src/app/api/leads/[id]/route.ts);
--   3) updatedAt, que é o melhor palpite disponível pra lead sem timeline.
UPDATE "Lead" l SET "wonAt" = COALESCE(
  (SELECT MAX(a."createdAt") FROM "Activity" a
     WHERE a."leadId" = l.id AND a."type" = 'STAGE_CHANGED'
       AND EXISTS (SELECT 1 FROM "PipelineStageConfig" p
                    WHERE p."companyId" = l."companyId"
                      AND p."name" = a."meta"->>'to'
                      AND p."outcome" = 'GANHO')),
  (SELECT MAX(a."createdAt") FROM "Activity" a
     WHERE a."leadId" = l.id AND a."type" = 'STAGE_CHANGED'
       AND (a."meta"->>'to') ~* '(fechad|ganho|vendid|vendi)'),
  l."updatedAt"
) WHERE l."status" = 'CLOSED' AND l."wonAt" IS NULL;

-- Backfill PERDIDO, mesma lógica.
UPDATE "Lead" l SET "lostAt" = COALESCE(
  (SELECT MAX(a."createdAt") FROM "Activity" a
     WHERE a."leadId" = l.id AND a."type" = 'STAGE_CHANGED'
       AND EXISTS (SELECT 1 FROM "PipelineStageConfig" p
                    WHERE p."companyId" = l."companyId"
                      AND p."name" = a."meta"->>'to'
                      AND p."outcome" = 'PERDIDO')),
  (SELECT MAX(a."createdAt") FROM "Activity" a
     WHERE a."leadId" = l.id AND a."type" = 'STAGE_CHANGED'
       AND (a."meta"->>'to') ~* '(perdid|perdeu|perda)'),
  l."updatedAt"
) WHERE l."status" = 'LOST' AND l."lostAt" IS NULL;
