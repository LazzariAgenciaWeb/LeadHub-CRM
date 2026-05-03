-- Nova badge PONTUAL + 2 razões de pontuação:
-- DIA_SEM_ATRASO (+15): cron diário ao fim do expediente, se 0 atrasos
-- PRAZO_PRORROGADO (-5): empurrar dueDate/scheduledReturnAt depois de vencido

ALTER TYPE "BadgeType" ADD VALUE IF NOT EXISTS 'PONTUAL';

ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'DIA_SEM_ATRASO';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'PRAZO_PRORROGADO';
