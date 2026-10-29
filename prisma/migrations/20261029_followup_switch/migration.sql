-- Chave geral do follow-up + marco de quando foi ligado.
-- Desligado por padrão e TAMBÉM para quem já existia: ligar o follow-up
-- passa a ser decisão consciente (o incidente foi exatamente o contrário —
-- a opção já vinha armada e o agente escreveu pra base dos últimos 7 dias).
ALTER TABLE "Assistant" ADD COLUMN "followUpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Assistant" ADD COLUMN "followUpArmedAt" TIMESTAMP(3);
