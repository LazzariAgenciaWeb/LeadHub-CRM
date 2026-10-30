-- Etapa do projeto = tarefa principal no ClickUp; tarefa da etapa = subtarefa dela.
-- Antes, tarefa criada no GoHub subia (quando subia) solta na raiz da lista, e a
-- etapa era só um rótulo local que você renomeava na mão pra casar com o mês.
ALTER TABLE "ProjectService" ADD COLUMN "clickupTaskId" TEXT;

-- Pai no ClickUp. O sync já pede subtasks=true, mas jogava o `parent` fora — por
-- isso mãe e filhas caíam achatadas na caixa de entrada, sem dizer quem é de quem.
ALTER TABLE "ProjectTaskState" ADD COLUMN "parentTaskId" TEXT;

CREATE INDEX "ProjectService_clickupTaskId_idx" ON "ProjectService"("clickupTaskId");
CREATE INDEX "ProjectTaskState_parentTaskId_idx" ON "ProjectTaskState"("parentTaskId");
