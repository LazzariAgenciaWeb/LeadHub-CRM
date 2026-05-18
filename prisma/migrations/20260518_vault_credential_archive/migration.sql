-- Arquivamento (soft-delete) de credenciais do Cofre.
-- CLIENT não apaga credencial — arquiva. Admin/SUPER_ADMIN veem arquivadas,
-- podem restaurar ou apagar de vez. Aditivo e nullable: credenciais antigas
-- ficam com archivedAt = NULL (ativas), comportamento inalterado.

ALTER TABLE "CompanyCredential" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "CompanyCredential" ADD COLUMN IF NOT EXISTS "archivedById" TEXT;
ALTER TABLE "CompanyCredential" ADD COLUMN IF NOT EXISTS "archivedByName" TEXT;

CREATE INDEX IF NOT EXISTS "CompanyCredential_assetId_archivedAt_idx" ON "CompanyCredential"("assetId", "archivedAt");

-- Novos valores do enum de auditoria do cofre.
ALTER TYPE "CredentialAction" ADD VALUE IF NOT EXISTS 'ARCHIVE';
ALTER TYPE "CredentialAction" ADD VALUE IF NOT EXISTS 'RESTORE';
