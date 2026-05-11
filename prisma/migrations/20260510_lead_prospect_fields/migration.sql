-- Campos extras para prospects buscados via SerpAPI (Google Maps) +
-- scraper inline do site. Aditivo, nullable — não impacta leads existentes.

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "website"   TEXT,
  ADD COLUMN IF NOT EXISTS "instagram" TEXT,
  ADD COLUMN IF NOT EXISTS "facebook"  TEXT,
  ADD COLUMN IF NOT EXISTS "address"   TEXT,
  ADD COLUMN IF NOT EXISTS "city"      TEXT,
  ADD COLUMN IF NOT EXISTS "segment"   TEXT;

-- Feature flag por empresa para o módulo de Prospecção via SerpAPI +
-- key própria de cada cliente (cada empresa traz a sua key).
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "moduleProspeccao" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "serpapiKey"       TEXT;
