-- Tarefa "ignorada" na Caixa de entrada: veio do ClickUp mas não interessa a
-- este projeto. Sai da fila sem ser apagada — dá pra restaurar depois.
-- null = ativa. Preenchido = ignorada (a data serve pra ordenar a lista).

ALTER TABLE "ProjectTask" ADD COLUMN IF NOT EXISTS "ignoredAt" TIMESTAMP(3);
