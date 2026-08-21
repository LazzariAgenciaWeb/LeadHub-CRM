-- Eventos em destaque no bloco de marketing (listagem/relatório).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.
--
-- Um evento pode ser destaque sem ser conversão: "acesso a página" entra no
-- relatório como volume, não como conversão.

ALTER TABLE "MarketingEventConfig" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
