-- Flag de bonificação por cliente: conta que não bonifica (permuta, parceria)
-- sai das listas da aba Bonificação. Default TRUE preserva o comportamento
-- atual — tudo que existe hoje continua aparecendo.
ALTER TABLE "Company" ADD COLUMN "bonusEligible" BOOLEAN NOT NULL DEFAULT true;
