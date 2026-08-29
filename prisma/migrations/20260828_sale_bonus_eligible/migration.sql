-- Mesma flag do ClientService, agora na venda pontual: serviço entregue que
-- não comissiona ninguém sai da lista de pontuais da aba Bonificação.
ALTER TABLE "Sale" ADD COLUMN "bonusEligible" BOOLEAN NOT NULL DEFAULT true;
