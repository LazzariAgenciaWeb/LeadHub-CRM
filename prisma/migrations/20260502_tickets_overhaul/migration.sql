-- Reformulação dos chamados:
--   - type ("SUPPORT" | "INTERNAL") — diferencia chamado de cliente vs tarefa interna
--   - dueDate — prazo previsto (obrigatório no API novo, nullable no DB pra retrocompat)
--   - clientCompanyId — empresa-cliente do chamado (separado de companyId, que é a agência)
--   - assigneeId — atendente responsável (igual padrão Conversation)
--   - mediaBase64/mediaType em TicketMessage — anexos de imagem inline
--   - source/externalId em TicketMessage — pra dedup em sync bidirecional ClickUp

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "type"             TEXT NOT NULL DEFAULT 'SUPPORT',
  ADD COLUMN IF NOT EXISTS "dueDate"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "clientCompanyId"  TEXT,
  ADD COLUMN IF NOT EXISTS "assigneeId"       TEXT;

CREATE INDEX IF NOT EXISTS "Ticket_assigneeId_idx"       ON "Ticket"("assigneeId");
CREATE INDEX IF NOT EXISTS "Ticket_clientCompanyId_idx"  ON "Ticket"("clientCompanyId");
CREATE INDEX IF NOT EXISTS "Ticket_dueDate_idx"          ON "Ticket"("dueDate");

ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_clientCompanyId_fkey"
  FOREIGN KEY ("clientCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TicketMessage"
  ADD COLUMN IF NOT EXISTS "mediaBase64" TEXT,
  ADD COLUMN IF NOT EXISTS "mediaType"   TEXT,
  ADD COLUMN IF NOT EXISTS "source"      TEXT NOT NULL DEFAULT 'LEADHUB',
  ADD COLUMN IF NOT EXISTS "externalId"  TEXT;

CREATE INDEX IF NOT EXISTS "TicketMessage_externalId_idx" ON "TicketMessage"("externalId");
