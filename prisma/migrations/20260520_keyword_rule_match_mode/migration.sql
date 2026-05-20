-- Modo de matching do gatilho da campanha.
-- CONTAINS = comportamento atual (busca parcial, case-insensitive).
-- EXACT    = mensagem inteira (trim+lower) precisa ser igual à expressão.
-- Caso de uso: link curto "lazzariagenciaweb.com" não dispara para mensagens
-- vindas de "lazzariagenciaweb.com.br". Default CONTAINS mantém regras antigas
-- com o comportamento original.

CREATE TYPE "KeywordMatchMode" AS ENUM ('CONTAINS', 'EXACT');

ALTER TABLE "KeywordRule"
  ADD COLUMN IF NOT EXISTS "matchMode" "KeywordMatchMode" NOT NULL DEFAULT 'CONTAINS';
