-- Adiciona coluna participantName na tabela Message
-- Armazena o pushName da Evolution API para participantes de grupos
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "participantName" TEXT;
