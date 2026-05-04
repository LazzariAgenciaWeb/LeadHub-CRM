-- Badges de colaboração / ajuda mútua entre atendentes.
-- EXERCITO  — responde quando o cliente está esperando outra pessoa
-- LIDER     — encaminha conversa pra colega adequado
-- GUARDIAO  — primeiro a responder em conversa nova sem responsável

ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'EXERCITO';
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'LIDER';
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'GUARDIAO';

ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'AJUDA_EXERCITO';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'ENCAMINHAMENTO';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'PRIMEIRA_RESPOSTA';
