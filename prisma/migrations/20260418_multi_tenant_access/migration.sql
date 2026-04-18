-- Migration: Multi-tenant access control
-- Adiciona controle de acesso ao sistema, módulos e hierarquia de empresas

-- ─── Company: campos de acesso e hierarquia ──────────────────────────────────

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "hasSystemAccess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "moduleWhatsapp"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "moduleCrm"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "moduleTickets"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "parentCompanyId" TEXT;

-- Empresas que já têm usuários com role=CLIENT ganham hasSystemAccess=true automaticamente
UPDATE "Company" c
SET "hasSystemAccess" = true
WHERE EXISTS (
  SELECT 1 FROM "User" u WHERE u."companyId" = c.id
);

-- FK para hierarquia (empresa-pai)
ALTER TABLE "Company"
  ADD CONSTRAINT "Company_parentCompanyId_fkey"
  FOREIGN KEY ("parentCompanyId") REFERENCES "Company"(id)
  ON DELETE SET NULL ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS "Company_parentCompanyId_idx" ON "Company"("parentCompanyId");

-- ─── Lead: campo de visibilidade ─────────────────────────────────────────────

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "isInternal" BOOLEAN NOT NULL DEFAULT false;

-- ─── Ticket: campo de visibilidade ───────────────────────────────────────────

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "isInternal" BOOLEAN NOT NULL DEFAULT false;
