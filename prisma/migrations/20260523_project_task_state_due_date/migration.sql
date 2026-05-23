-- Persiste o due_date de cada tarefa do ClickUp no snapshot ProjectTaskState.
-- Hoje só os agregados (taskOverdue/taskNoDueDate) são gravados em SetorClickupList;
-- esta coluna permite listar as tarefas abertas direto do DB (sem chamar ClickUp).
-- Preenchida no próximo sync (cron diário ou botão Sincronizar).

ALTER TABLE "ProjectTaskState" ADD COLUMN IF NOT EXISTS "dueDate" BIGINT;
