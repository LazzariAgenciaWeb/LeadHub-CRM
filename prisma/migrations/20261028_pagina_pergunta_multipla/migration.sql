-- Página do Negócio: pergunta que aceita mais de uma resposta.
ALTER TABLE "BioQuestion" ADD COLUMN "multiple" BOOLEAN NOT NULL DEFAULT false;
