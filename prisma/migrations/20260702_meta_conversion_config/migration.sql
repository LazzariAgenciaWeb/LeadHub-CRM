-- Meta Conversions API (CAPI) — config por empresa.
-- Guarda o Pixel/Dataset ID + token CAPI (System User) cifrado em AES-256-GCM.
-- Usado pra mandar o evento de venda pro Meta quando o lead entra numa etapa
-- marcada como GANHO (PipelineStageConfig.outcome).

CREATE TABLE "MetaConversionConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pixelId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "testEventCode" TEXT,
    "eventName" TEXT NOT NULL DEFAULT 'Purchase',
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastEventAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaConversionConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaConversionConfig_companyId_key" ON "MetaConversionConfig"("companyId");

ALTER TABLE "MetaConversionConfig" ADD CONSTRAINT "MetaConversionConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
