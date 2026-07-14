-- Data de início da tarefa do ClickUp — usada pra preencher startDate ao importar
-- e no sync bidirecional. Aditivo/idempotente.

ALTER TABLE "ProjectTaskState" ADD COLUMN IF NOT EXISTS "startDate" BIGINT;
