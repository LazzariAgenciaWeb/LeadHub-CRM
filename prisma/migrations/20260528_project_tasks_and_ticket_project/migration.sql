-- Agrupamento de chamados em projetos + tarefas nativas do LeadHub no projeto.
--
-- 1) Ticket ganha projetoId (FK opcional pra SetorClickupList). Permite agrupar
--    chamados num projeto; quando o projeto tem ClickUp, a task do chamado vive
--    na lista do projeto.
-- 2) Nova tabela ProjectTask: tarefas internas do projeto que NÃO vivem no
--    ClickUp (LeadHub funciona sozinho).

-- Ticket.projetoId
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "projetoId" TEXT;

CREATE INDEX IF NOT EXISTS "Ticket_projetoId_idx" ON "Ticket" ("projetoId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Ticket_projetoId_fkey'
  ) THEN
    ALTER TABLE "Ticket"
      ADD CONSTRAINT "Ticket_projetoId_fkey"
      FOREIGN KEY ("projetoId") REFERENCES "SetorClickupList" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ProjectTask
CREATE TABLE IF NOT EXISTS "ProjectTask" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "description" TEXT,
  "done"        BOOLEAN NOT NULL DEFAULT false,
  "priority"    "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
  "dueDate"     TIMESTAMP(3),
  "assigneeId"  TEXT,
  "createdById" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectTask_projectId_done_idx" ON "ProjectTask" ("projectId", "done");
CREATE INDEX IF NOT EXISTS "ProjectTask_assigneeId_idx" ON "ProjectTask" ("assigneeId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ProjectTask_projectId_fkey') THEN
    ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "SetorClickupList" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ProjectTask_assigneeId_fkey') THEN
    ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_assigneeId_fkey"
      FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ProjectTask_createdById_fkey') THEN
    ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
