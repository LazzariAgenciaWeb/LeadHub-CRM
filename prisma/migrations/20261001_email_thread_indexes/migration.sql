-- Índices pra montar a conversa (thread) e achar cópias sem varrer a tabela.
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

CREATE INDEX "InboxEmail_companyId_messageId_idx" ON "InboxEmail"("companyId", "messageId");
CREATE INDEX "InboxEmail_companyId_inReplyTo_idx" ON "InboxEmail"("companyId", "inReplyTo");
