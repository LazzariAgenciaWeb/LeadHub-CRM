-- Adiciona o novo tier RELATORIOS ao enum PlanTier.
-- Posicionado entre TRIAL e ESSENCIAL (mesma ordem do PlanTier no schema.prisma).
ALTER TYPE "PlanTier" ADD VALUE IF NOT EXISTS 'RELATORIOS' BEFORE 'ESSENCIAL';
