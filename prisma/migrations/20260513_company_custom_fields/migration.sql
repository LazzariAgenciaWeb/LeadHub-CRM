-- Campos personalizados de Empresa.
-- Mesma estrutura de CustomFieldDef (Lead), mas o alvo é Company.
-- Definição pertence ao "tenant" (a agência) e aplica-se a ela mesma + sub-empresas.

CREATE TABLE "CompanyCustomFieldDef" (
  "id"             TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "type"           "CustomFieldType" NOT NULL DEFAULT 'TEXT',
  "options"        JSONB,
  "order"          INTEGER NOT NULL DEFAULT 0,
  "ownerCompanyId" TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyCustomFieldDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyCustomFieldDef_ownerCompanyId_key_key"
  ON "CompanyCustomFieldDef"("ownerCompanyId", "key");
CREATE INDEX "CompanyCustomFieldDef_ownerCompanyId_order_idx"
  ON "CompanyCustomFieldDef"("ownerCompanyId", "order");

ALTER TABLE "CompanyCustomFieldDef"
  ADD CONSTRAINT "CompanyCustomFieldDef_ownerCompanyId_fkey"
  FOREIGN KEY ("ownerCompanyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CompanyCustomValue" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "fieldId"   TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyCustomValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyCustomValue_companyId_fieldId_key"
  ON "CompanyCustomValue"("companyId", "fieldId");
CREATE INDEX "CompanyCustomValue_fieldId_idx"
  ON "CompanyCustomValue"("fieldId");

ALTER TABLE "CompanyCustomValue"
  ADD CONSTRAINT "CompanyCustomValue_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyCustomValue"
  ADD CONSTRAINT "CompanyCustomValue_fieldId_fkey"
  FOREIGN KEY ("fieldId") REFERENCES "CompanyCustomFieldDef"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
