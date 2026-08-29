-- Flag de bonificação POR SERVIÇO CONTRATADO: o mesmo cliente tem hospedagem
-- (não bonifica) e gestão de mídias (bonifica), então a decisão não pode ser
-- por cliente. Default TRUE preserva o comportamento atual.
--
-- A coluna em Company existiu por algumas horas (primeira versão desta
-- feature, nível errado) — o IF EXISTS limpa quem chegou a recebê-la.
ALTER TABLE "Company" DROP COLUMN IF EXISTS "bonusEligible";
ALTER TABLE "ClientService" ADD COLUMN "bonusEligible" BOOLEAN NOT NULL DEFAULT true;
