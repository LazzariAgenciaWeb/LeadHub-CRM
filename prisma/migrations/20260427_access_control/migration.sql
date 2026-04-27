-- Adicionar role ADMIN ao enum UserRole
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMIN';

-- Adicionar módulo IA à empresa
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "moduleAI" BOOLEAN NOT NULL DEFAULT false;

-- Adicionar novas permissões ao Setor
ALTER TABLE "Setor" ADD COLUMN IF NOT EXISTS "canUseAI"           BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Setor" ADD COLUMN IF NOT EXISTS "canViewInbox"       BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Setor" ADD COLUMN IF NOT EXISTS "canSendMessages"    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Setor" ADD COLUMN IF NOT EXISTS "canViewCompanies"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Setor" ADD COLUMN IF NOT EXISTS "canCreateCompanies" BOOLEAN NOT NULL DEFAULT false;
