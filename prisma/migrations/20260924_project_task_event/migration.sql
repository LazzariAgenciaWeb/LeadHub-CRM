-- Linha do tempo da tarefa de projeto — base do relatório mensal de transparência.
-- Grava o evento cru (o que mudou, de quê pra quê, por quem, quando) em vez de
-- métrica pronta: a definição de "alteração solicitada" ainda não está fechada,
-- e mudá-la depois não pode custar histórico.

CREATE TABLE IF NOT EXISTS "ProjectTaskEvent" (
  "id"         TEXT NOT NULL,
  "taskId"     TEXT NOT NULL,
  "projectId"  TEXT NOT NULL,
  "type"       TEXT NOT NULL,
  "fromText"   TEXT,
  "toText"     TEXT,
  "authorId"   TEXT,
  "authorName" TEXT,
  "byClient"   BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectTaskEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectTaskEvent_projectId_createdAt_idx" ON "ProjectTaskEvent" ("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectTaskEvent_taskId_createdAt_idx"    ON "ProjectTaskEvent" ("taskId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ProjectTaskEvent_taskId_fkey') THEN
    ALTER TABLE "ProjectTaskEvent" ADD CONSTRAINT "ProjectTaskEvent_taskId_fkey"
      FOREIGN KEY ("taskId") REFERENCES "ProjectTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ProjectTaskEvent_projectId_fkey') THEN
    ALTER TABLE "ProjectTaskEvent" ADD CONSTRAINT "ProjectTaskEvent_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "SetorClickupList" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Semente retroativa: o que dá pra reconstruir com honestidade do que já existe.
-- Abertura de toda tarefa e conclusão das já aprovadas. Não inventamos
-- transições intermediárias que nunca foram registradas.
INSERT INTO "ProjectTaskEvent" ("id", "taskId", "projectId", "type", "toText", "createdAt")
SELECT md5(random()::text || t.id || 'c'), t.id, t."projectId", 'CREATED', t.title, t."createdAt"
FROM "ProjectTask" t
WHERE NOT EXISTS (SELECT 1 FROM "ProjectTaskEvent" e WHERE e."taskId" = t.id AND e."type" = 'CREATED');

INSERT INTO "ProjectTaskEvent" ("id", "taskId", "projectId", "type", "toText", "createdAt")
SELECT md5(random()::text || t.id || 'd'), t.id, t."projectId", 'STATUS', 'APROVADO', t."completedAt"
FROM "ProjectTask" t
WHERE t."completedAt" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ProjectTaskEvent" e WHERE e."taskId" = t.id AND e."type" = 'STATUS' AND e."toText" = 'APROVADO');
