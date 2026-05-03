-- Adiciona razão PRIMEIRO_CONTATO ao enum ScoreReason.
-- Premia o atendente que faz a primeira interação numa conversa que NÃO é
-- atribuída a ele (triagem / "estamos encaminhando"). Pontos menores que
-- a resposta rápida do responsável, mas idempotente por conversa.

ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'PRIMEIRO_CONTATO';
