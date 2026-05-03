-- Histórico de atividades em tarefas do ClickUp por projeto + scoring por tarefa.
-- Cada sync compara o estado das tarefas com o snapshot armazenado e gera
-- ProjectActivity (TASK_CREATED|TASK_UPDATED|TASK_COMPLETED) + pontos.

-- Snapshot do estado atual das tarefas — pra detectar mudanças no próximo sync
CREATE TABLE IF NOT EXISTS "ProjectTaskState" (
  "id"           TEXT NOT NULL,
  "projectId"    TEXT NOT NULL,
  "taskId"       TEXT NOT NULL,           -- ID da task no ClickUp
  "name"         TEXT NOT NULL,
  "statusName"   TEXT,
  "isCompleted"  BOOLEAN NOT NULL DEFAULT false,
  "dateUpdated"  BIGINT,                  -- epoch ms do ClickUp
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectTaskState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectTaskState_projectId_taskId_key"
  ON "ProjectTaskState"("projectId", "taskId");

CREATE INDEX IF NOT EXISTS "ProjectTaskState_projectId_idx" ON "ProjectTaskState"("projectId");

ALTER TABLE "ProjectTaskState"
  ADD CONSTRAINT "ProjectTaskState_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "SetorClickupList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Log de eventos detectados — exibido no detail do projeto
CREATE TABLE IF NOT EXISTS "ProjectActivity" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "type"        TEXT NOT NULL,            -- "TASK_CREATED" | "TASK_UPDATED" | "TASK_COMPLETED"
  "taskName"    TEXT NOT NULL,
  "taskId"      TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectActivity_projectId_createdAt_idx"
  ON "ProjectActivity"("projectId", "createdAt");

ALTER TABLE "ProjectActivity"
  ADD CONSTRAINT "ProjectActivity_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "SetorClickupList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Razões de pontuação por atividade em tarefa
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'TAREFA_CRIADA';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'TAREFA_ATUALIZADA';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'TAREFA_CONCLUIDA';

-- Badges novas pra projetos
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'CONSTRUTOR';
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'ENGAJADO';
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'GERADOR';
