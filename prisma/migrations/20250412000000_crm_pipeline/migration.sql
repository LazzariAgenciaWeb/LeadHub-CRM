-- CRM Pipeline: adiciona campos de pipeline ao Lead, cria LeadComment e PipelineStageConfig

-- Campos novos no Lead
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "pipeline" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "pipelineStage" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "externalId" TEXT;

-- Índices nos novos campos
CREATE INDEX IF NOT EXISTS "Lead_pipeline_companyId_idx" ON "Lead"("pipeline", "companyId");
CREATE INDEX IF NOT EXISTS "Lead_externalId_idx" ON "Lead"("externalId");

-- Tabela de comentários de lead
CREATE TABLE IF NOT EXISTS "LeadComment" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorName" TEXT NOT NULL DEFAULT 'Usuário',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT NOT NULL,
    CONSTRAINT "LeadComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeadComment_leadId_idx" ON "LeadComment"("leadId");

ALTER TABLE "LeadComment"
    ADD CONSTRAINT IF NOT EXISTS "LeadComment_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tabela de configuração de etapas do pipeline
CREATE TABLE IF NOT EXISTS "PipelineStageConfig" (
    "id" TEXT NOT NULL,
    "pipeline" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "companyId" TEXT NOT NULL,
    CONSTRAINT "PipelineStageConfig_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PipelineStageConfig_companyId_pipeline_idx"
    ON "PipelineStageConfig"("companyId", "pipeline");

ALTER TABLE "PipelineStageConfig"
    ADD CONSTRAINT IF NOT EXISTS "PipelineStageConfig_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
