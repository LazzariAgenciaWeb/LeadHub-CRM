-- Adiciona status AGUARDANDO_CLIENTE — quando o projeto depende de retorno
-- do cliente, todas as penalidades de prazo (PRAZO_PRORROGADO,
-- TAREFA_SEM_PRAZO) são pausadas até voltar pra outro status.

ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'AGUARDANDO_CLIENTE';
