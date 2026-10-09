-- Conta vinculada: usuário da empresa que É o super admin (agir como).
ALTER TABLE "User" ADD COLUMN "linkedSuperAdminId" TEXT;
CREATE INDEX "User_linkedSuperAdminId_idx" ON "User"("linkedSuperAdminId");
