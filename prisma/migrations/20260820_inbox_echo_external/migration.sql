-- Inbox Social — mensagens enviadas fora do LeadHub (echo do webhook).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.
--
-- Objetivo:
--   1. Novo IgMsgSource EXTERNAL: DM enviada pelo app do Instagram / Business
--      Suite chega como webhook com is_echo=true e agora é persistida como OUT.
--   2. Índice (companyId, mid) pra idempotência: o mesmo envio chega por dois
--      caminhos (registro direto no reply/automação + echo do webhook) e o mid
--      deduplica.

ALTER TYPE "IgMsgSource" ADD VALUE 'EXTERNAL';

CREATE INDEX "IgMessage_companyId_mid_idx" ON "IgMessage"("companyId", "mid");
