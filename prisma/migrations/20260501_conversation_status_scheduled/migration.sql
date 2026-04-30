-- Adiciona valor SCHEDULED ao enum ConversationStatus
-- Status para conversas com retorno agendado (standby até a data de retorno)
ALTER TYPE "ConversationStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
