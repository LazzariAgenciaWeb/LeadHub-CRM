-- Escopos do follow-up: campanha (gatilho) e pedido manual do atendente.
ALTER TABLE "Assistant" ADD COLUMN "followUpScopeTrigger" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Assistant" ADD COLUMN "followUpScopeRequested" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Conversation" ADD COLUMN "followUpRequestedAt" TIMESTAMP(3);
-- O escopo amplo deixa de ser padrão: ninguém escolheu conscientemente.
ALTER TABLE "Assistant" ALTER COLUMN "followUpIncludeHuman" SET DEFAULT false;
