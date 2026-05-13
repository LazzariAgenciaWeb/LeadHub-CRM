-- Novo tipo de campo personalizado: LINK (URL clicável).
-- IF NOT EXISTS pra ser idempotente caso a migration já tenha rodado parcialmente.
ALTER TYPE "CustomFieldType" ADD VALUE IF NOT EXISTS 'LINK';
