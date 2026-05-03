-- Fase D: Projetos
-- Estende SetorClickupList com campos de gestão de projeto (status, prazo,
-- entrega, descrição, membros). Cada lista do ClickUp atrelada a um setor
-- vira um Project — task source vem do ClickUp via cron.

CREATE TYPE IF NOT EXISTS "ProjectStatus" AS ENUM (
  'PLANEJAMENTO',
  'EM_ANDAMENTO',
  'PAUSADO',
  'ENTREGUE',
  'CANCELADO'
);

ALTER TABLE "SetorClickupList"
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "status"      "ProjectStatus" NOT NULL DEFAULT 'PLANEJAMENTO',
  ADD COLUMN IF NOT EXISTS "startDate"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dueDate"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "SetorClickupList_status_idx"
  ON "SetorClickupList"("status");

CREATE INDEX IF NOT EXISTS "SetorClickupList_dueDate_idx"
  ON "SetorClickupList"("dueDate");

-- Pivot: membros do projeto (usuários que tocam o projeto)
CREATE TABLE IF NOT EXISTS "ProjectMember" (
  "projectId" TEXT NOT NULL,   -- id de SetorClickupList
  "userId"    TEXT NOT NULL,
  "role"      TEXT NOT NULL DEFAULT 'MEMBER',  -- "LEAD" | "MEMBER"
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId", "userId")
);

CREATE INDEX IF NOT EXISTS "ProjectMember_projectId_idx" ON "ProjectMember"("projectId");
CREATE INDEX IF NOT EXISTS "ProjectMember_userId_idx"    ON "ProjectMember"("userId");

ALTER TABLE "ProjectMember"
  ADD CONSTRAINT "ProjectMember_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "SetorClickupList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectMember"
  ADD CONSTRAINT "ProjectMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Razões novas de pontuação
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'PROJETO_ENTREGUE';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'PROJETO_ENTREGUE_NO_PRAZO';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'PROJETO_ATRASADO';

-- Badge novo: Entregador
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'ENTREGADOR';
