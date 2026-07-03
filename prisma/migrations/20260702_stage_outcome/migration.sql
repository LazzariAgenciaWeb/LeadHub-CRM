-- Resultado comercial configurável por etapa de pipeline.
-- GANHO  = etapa que representa venda fechada. Dispara o evento de conversão
--          pro Meta (Conversions API, fase 1) e conta como venda na gamificação
--          em QUALQUER pipeline (inclusive clientes que só têm LEADS).
-- PERDIDO = etapa de perda.
-- NEUTRO  = etapa normal/aberta (default).
-- Marcar GANHO/PERDIDO implica isFinal=true (garantido na camada de API).
--
-- Sem backfill de GANHO de propósito: cada cliente tem a pipeline dele e o
-- SUPER_ADMIN marca explicitamente qual etapa é o gatilho de conversão. Assim
-- ninguém dispara venda por engano numa etapa que só "encerra" o fluxo.

CREATE TYPE "StageOutcome" AS ENUM ('NEUTRO', 'GANHO', 'PERDIDO');

ALTER TABLE "PipelineStageConfig"
  ADD COLUMN "outcome" "StageOutcome" NOT NULL DEFAULT 'NEUTRO';
