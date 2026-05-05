-- 3 badges pra atendimento em grupos do WhatsApp.
-- DIPLOMATA — primeira resposta num grupo novo (variedade)
-- PRECISO   — resposta rápida em grupo (≤5min úteis após cliente)
-- NETWORK   — dia em que atendeu 3+ grupos diferentes

ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'DIPLOMATA';
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'PRECISO';
ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'NETWORK';

ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'ATENDIMENTO_GRUPO_NOVO';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'RESPOSTA_RAPIDA_GRUPO';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'DIA_NETWORK';
