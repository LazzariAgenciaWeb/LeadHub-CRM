-- Torna clickupListId opcional em projetos: um projeto pode viver só no LeadHub
-- (tarefas nativas em ProjectTask + chamados via lista padrão da empresa).
-- Existing rows já têm valor não-nulo — o ALTER só remove a restrição de NOT NULL.

ALTER TABLE "SetorClickupList" ALTER COLUMN "clickupListId" DROP NOT NULL;
