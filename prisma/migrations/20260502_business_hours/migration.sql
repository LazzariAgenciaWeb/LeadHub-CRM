-- Horário de atendimento por empresa, com configuração por dia da semana e intervalos.
-- Substitui o campo simplificado business_hours:<companyId> na tabela Setting.

CREATE TABLE IF NOT EXISTS "BusinessHoursConfig" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,   -- 0=dom, 1=seg, ..., 6=sab
  "isOpen"    BOOLEAN NOT NULL DEFAULT true,
  "openTime"  TEXT NOT NULL DEFAULT '09:00',   -- "HH:MM"
  "closeTime" TEXT NOT NULL DEFAULT '18:00',   -- "HH:MM"
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BusinessHoursConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessHoursConfig_companyId_dayOfWeek_key"
  ON "BusinessHoursConfig"("companyId", "dayOfWeek");

CREATE INDEX IF NOT EXISTS "BusinessHoursConfig_companyId_idx"
  ON "BusinessHoursConfig"("companyId");

ALTER TABLE "BusinessHoursConfig"
  ADD CONSTRAINT "BusinessHoursConfig_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Intervalos (pausas) dentro de um dia: almoço, reunião, etc.
CREATE TABLE IF NOT EXISTS "BusinessHoursInterval" (
  "id"        TEXT NOT NULL,
  "configId"  TEXT NOT NULL,
  "startTime" TEXT NOT NULL,  -- "HH:MM"
  "endTime"   TEXT NOT NULL,  -- "HH:MM"
  "label"     TEXT,           -- "Almoço", "Reunião", etc. (opcional)

  CONSTRAINT "BusinessHoursInterval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BusinessHoursInterval_configId_idx"
  ON "BusinessHoursInterval"("configId");

ALTER TABLE "BusinessHoursInterval"
  ADD CONSTRAINT "BusinessHoursInterval_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "BusinessHoursConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
