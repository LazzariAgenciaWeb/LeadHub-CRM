-- Permissões de módulo no Setor — gate granular pra Sidebar.
-- Antes: Calendário/Projetos/Ranking eram só gateados pelo módulo da empresa
-- (todos viam se a empresa tinha); Campanhas/Links/Cofre eram admin-only.
-- Agora cada setor decide o que enxerga (gateado AINDA pelo módulo da empresa).
-- Default true = compat com comportamento atual; admin restringe na UI.

ALTER TABLE "Setor"
  ADD COLUMN IF NOT EXISTS "canViewCalendario" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canViewMarketing"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canViewCampanhas"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canViewProjetos"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canViewRanking"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canViewLinks"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canViewCofre"      BOOLEAN NOT NULL DEFAULT true;
