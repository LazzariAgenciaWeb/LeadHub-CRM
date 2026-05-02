-- Adiciona type em ConversationNote pra diferenciar visualmente
--   STANDARD  → âmbar (nota manual)
--   SCHEDULED → roxo  (auto-gerado ao agendar retorno)
--   SYSTEM    → cinza (eventos automáticos)
ALTER TABLE "ConversationNote"
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'STANDARD';
