-- Agrupamento à mão: emails com o mesmo caseId andam juntos (aparecem um no
-- painel do outro e resolvem juntos), mesmo sem a regra automática ligar.
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

ALTER TABLE "InboxEmail" ADD COLUMN "caseId" TEXT;
CREATE INDEX "InboxEmail_companyId_caseId_idx" ON "InboxEmail"("companyId", "caseId");
