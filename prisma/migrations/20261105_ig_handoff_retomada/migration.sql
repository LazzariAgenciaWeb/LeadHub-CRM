-- Direct do Instagram: distinguir pausa do agente (handoff) de pausa por
-- humano. Sem isso, um handoff errado do agente (objeção lida como "não é
-- lead") deixava a conversa parada pra sempre, mesmo o contato continuando a
-- falar. aiResumedAt garante UMA retomada por conversa.
ALTER TABLE "IgConversation" ADD COLUMN "aiPausedBy" TEXT;
ALTER TABLE "IgConversation" ADD COLUMN "aiResumedAt" TIMESTAMP(3);
