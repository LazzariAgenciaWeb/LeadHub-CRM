-- Adiciona campos de agendamento de retorno à Conversation
-- scheduledReturnAt: data/hora do retorno agendado (quando status=SCHEDULED)
-- returnNote: nota/motivo do agendamento
ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "scheduledReturnAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "returnNote"        TEXT;
