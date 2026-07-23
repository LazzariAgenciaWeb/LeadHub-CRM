-- Renomeia o tier RELATORIOS → ORGANIZATION.
-- RELATORIOS foi criado recentemente e ainda não tem assinaturas reais,
-- então o rename é seguro. ALTER TYPE ... RENAME VALUE preserva quaisquer
-- linhas que já apontem pro valor antigo (viram ORGANIZATION automaticamente).
ALTER TYPE "PlanTier" RENAME VALUE 'RELATORIOS' TO 'ORGANIZATION';
