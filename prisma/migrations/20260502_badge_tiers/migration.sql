-- Substitui BadgeLevel (enum BRONZE/PRATA/OURO) por tier (INTEGER 1-6).
-- Permite progressão mais granular com nomes customizados por badge.

-- Drop unique constraint antiga (level)
ALTER TABLE "UserBadge" DROP CONSTRAINT IF EXISTS "UserBadge_userId_badge_level_key";
DROP INDEX IF EXISTS "UserBadge_userId_badge_level_key";

-- Drop coluna antiga
ALTER TABLE "UserBadge" DROP COLUMN IF EXISTS "level";

-- Nova coluna tier (1 = mais fácil, 6 = Highlander/lendário)
ALTER TABLE "UserBadge" ADD COLUMN IF NOT EXISTS "tier" INTEGER NOT NULL DEFAULT 1;

-- Novo unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS "UserBadge_userId_badge_tier_key"
  ON "UserBadge"("userId", "badge", "tier");

-- Drop enum antigo (não há mais coluna que o referencie)
DROP TYPE IF EXISTS "BadgeLevel";
