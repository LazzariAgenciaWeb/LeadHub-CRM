-- Dependência entre tarefas de projeto (só aviso; não trava nem vai pro ClickUp).
ALTER TABLE "ProjectTask" ADD COLUMN IF NOT EXISTS "dependsOnIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
