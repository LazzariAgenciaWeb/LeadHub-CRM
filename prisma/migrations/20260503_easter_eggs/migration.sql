-- Easter egg badges — escondidas pra não-admin até desbloquearem
-- (admin sempre vê todas pra saber o que o time pode descobrir).

ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'CORUJA';
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'MADRUGADOR';
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'SORTUDO';
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'FENIX';
