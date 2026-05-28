-- Visibilidade aberto/restrito em chamados e projetos.
-- OPEN (default) = comportamento atual (toda a empresa vê).
-- RESTRICTED = só setor do item + membros (projeto) + pessoas extras (accessUsers)
--              + assignee/criador (chamado). ADMIN/SUPER_ADMIN sempre veem.

ALTER TABLE "Ticket"           ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE "SetorClickupList" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'OPEN';

-- Pessoas extras autorizadas (chamado)
CREATE TABLE IF NOT EXISTS "TicketAccessUser" (
  "ticketId" TEXT NOT NULL,
  "userId"   TEXT NOT NULL,
  CONSTRAINT "TicketAccessUser_pkey" PRIMARY KEY ("ticketId", "userId")
);
CREATE INDEX IF NOT EXISTS "TicketAccessUser_userId_idx" ON "TicketAccessUser" ("userId");

-- Pessoas extras autorizadas (projeto)
CREATE TABLE IF NOT EXISTS "ProjectAccessUser" (
  "projectId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  CONSTRAINT "ProjectAccessUser_pkey" PRIMARY KEY ("projectId", "userId")
);
CREATE INDEX IF NOT EXISTS "ProjectAccessUser_userId_idx" ON "ProjectAccessUser" ("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'TicketAccessUser_ticketId_fkey') THEN
    ALTER TABLE "TicketAccessUser" ADD CONSTRAINT "TicketAccessUser_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'TicketAccessUser_userId_fkey') THEN
    ALTER TABLE "TicketAccessUser" ADD CONSTRAINT "TicketAccessUser_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ProjectAccessUser_projectId_fkey') THEN
    ALTER TABLE "ProjectAccessUser" ADD CONSTRAINT "ProjectAccessUser_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "SetorClickupList" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ProjectAccessUser_userId_fkey') THEN
    ALTER TABLE "ProjectAccessUser" ADD CONSTRAINT "ProjectAccessUser_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
