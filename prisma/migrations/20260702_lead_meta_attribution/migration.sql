-- Sinais de atribuição do Meta no Lead (melhoram o match do Conversions API).
-- Preenchidos pela landing com Pixel (via webhook) ou pelo shortlink /r/CODE.
-- fbc/fbp/ip/user-agent vão puros no evento; presença deles → action_source=website.

ALTER TABLE "Lead" ADD COLUMN "fbc" TEXT;
ALTER TABLE "Lead" ADD COLUMN "fbp" TEXT;
ALTER TABLE "Lead" ADD COLUMN "eventSourceUrl" TEXT;
ALTER TABLE "Lead" ADD COLUMN "clientIp" TEXT;
ALTER TABLE "Lead" ADD COLUMN "clientUserAgent" TEXT;
