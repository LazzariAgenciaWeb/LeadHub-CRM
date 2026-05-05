-- "Mestres do Ofício" — gamificação de chamados próprios.
-- ALQUIMISTA — atualizações/comentários no próprio chamado
-- SNIPER     — resolveu antes do dueDate
-- TROVAO     — criado e resolvido no MESMO DIA

ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'ALQUIMISTA';
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'SNIPER';
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'TROVAO';

ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'TICKET_ATUALIZADO';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'TICKET_NO_PRAZO';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'TICKET_RESOLVIDO_MESMO_DIA';
