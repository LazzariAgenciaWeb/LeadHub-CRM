-- Setores: controle de acesso interno por departamento

-- Tabela de setores
CREATE TABLE IF NOT EXISTS "Setor" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "name"             TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "canManageUsers"   BOOLEAN NOT NULL DEFAULT false,
  "canViewLeads"     BOOLEAN NOT NULL DEFAULT true,
  "canCreateLeads"   BOOLEAN NOT NULL DEFAULT false,
  "canViewTickets"   BOOLEAN NOT NULL DEFAULT true,
  "canCreateTickets" BOOLEAN NOT NULL DEFAULT true,
  "canViewConfig"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Setor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Setor_companyId_idx" ON "Setor"("companyId");

-- Pivot usuário ↔ setor
CREATE TABLE IF NOT EXISTS "SetorUser" (
  "setorId" TEXT NOT NULL,
  "userId"  TEXT NOT NULL,
  CONSTRAINT "SetorUser_pkey" PRIMARY KEY ("setorId", "userId"),
  CONSTRAINT "SetorUser_setorId_fkey" FOREIGN KEY ("setorId") REFERENCES "Setor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SetorUser_userId_fkey"  FOREIGN KEY ("userId")  REFERENCES "User"("id")  ON DELETE CASCADE ON UPDATE CASCADE
);

-- Pivot setor ↔ instância WhatsApp
CREATE TABLE IF NOT EXISTS "SetorInstance" (
  "setorId"    TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  CONSTRAINT "SetorInstance_pkey" PRIMARY KEY ("setorId", "instanceId"),
  CONSTRAINT "SetorInstance_setorId_fkey"    FOREIGN KEY ("setorId")    REFERENCES "Setor"("id")            ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SetorInstance_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Campo setorId em Ticket
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "setorId" TEXT;
ALTER TABLE "Ticket" ADD CONSTRAINT IF NOT EXISTS "Ticket_setorId_fkey"
  FOREIGN KEY ("setorId") REFERENCES "Setor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Ticket_setorId_idx" ON "Ticket"("setorId");

-- Assinatura WhatsApp no usuário
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "whatsappSignature" TEXT;
