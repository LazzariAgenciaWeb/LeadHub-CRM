-- Permite admin marcar conversas (geralmente grupos internos do time) pra
-- não gerar pontos de gamificação. Default false = todo grupo/conversa
-- pontua normal.
ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "excludeFromGamification" BOOLEAN NOT NULL DEFAULT false;
