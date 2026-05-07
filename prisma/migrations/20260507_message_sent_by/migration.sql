-- Identifica qual user enviou cada mensagem OUTBOUND. Visível apenas na UI
-- interna do LeadHub para auditoria e identificação de quem operou. Nullable:
-- mensagens INBOUND, antigas e mensagens automáticas (campanha/sistema)
-- ficam sem sender.
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "sentByUserId" TEXT;

-- ON DELETE SET NULL para preservar histórico de mensagens mesmo se o user
-- for removido (ex.: ex-funcionário). NO ACTION em update.
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_sentByUserId_fkey"
  FOREIGN KEY ("sentByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Message_sentByUserId_idx" ON "Message"("sentByUserId");
