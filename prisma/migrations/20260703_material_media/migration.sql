-- Imagem/print embutido em ProjectMaterial (base64 + MIME), pro descritivo das
-- tarefas. Servido por endpoint dedicado; nunca carregado inline em listas.

ALTER TABLE "ProjectMaterial" ADD COLUMN "mediaBase64" TEXT;
ALTER TABLE "ProjectMaterial" ADD COLUMN "mediaType" TEXT;
