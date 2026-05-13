-- Permite "pausar" um link de rastreamento sem deletar.
-- Quando isActive=false, /r/CODE registra o clique mas não redireciona.
ALTER TABLE "TrackingLink"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
