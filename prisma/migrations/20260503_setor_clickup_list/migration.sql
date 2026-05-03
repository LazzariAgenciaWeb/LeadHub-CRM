-- Mapeia setor → múltiplas listas/pastas do ClickUp.
-- Foundation para a feature de Projetos (Fase D): cada setor pode ter
-- N listas configuradas (ex: "Site Cliente A", "Mídia Cliente B"), e cada
-- lista vira um Project que aparece no Kanban de projetos.

CREATE TABLE IF NOT EXISTS "SetorClickupList" (
  "id"               TEXT NOT NULL,
  "setorId"          TEXT NOT NULL,

  "clickupListId"    TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "type"             TEXT,                  -- "SITE" | "MIDIA" | "CAMPANHA" | NULL
  "clientCompanyId"  TEXT,                  -- empresa-cliente (opcional)

  -- Cache de sync (atualizado via cron a partir do ClickUp)
  "taskCount"        INTEGER NOT NULL DEFAULT 0,
  "taskCompleted"    INTEGER NOT NULL DEFAULT 0,
  "taskOverdue"      INTEGER NOT NULL DEFAULT 0,
  "lastSyncedAt"     TIMESTAMP(3),

  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SetorClickupList_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SetorClickupList_setorId_clickupListId_key"
  ON "SetorClickupList"("setorId", "clickupListId");

CREATE INDEX IF NOT EXISTS "SetorClickupList_setorId_idx"
  ON "SetorClickupList"("setorId");

CREATE INDEX IF NOT EXISTS "SetorClickupList_clientCompanyId_idx"
  ON "SetorClickupList"("clientCompanyId");

ALTER TABLE "SetorClickupList"
  ADD CONSTRAINT "SetorClickupList_setorId_fkey"
  FOREIGN KEY ("setorId") REFERENCES "Setor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SetorClickupList"
  ADD CONSTRAINT "SetorClickupList_clientCompanyId_fkey"
  FOREIGN KEY ("clientCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
