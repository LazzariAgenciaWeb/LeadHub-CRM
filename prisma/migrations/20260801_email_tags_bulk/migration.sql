-- Tags de email (m2m) — classificação manual da caixa.
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

CREATE TABLE "InboxEmailTag" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxEmailTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxEmailTag_companyId_name_key" ON "InboxEmailTag"("companyId", "name");

ALTER TABLE "InboxEmailTag" ADD CONSTRAINT "InboxEmailTag_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Join table do m2m implícito do Prisma
CREATE TABLE "_InboxEmailTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "_InboxEmailTags_AB_unique" ON "_InboxEmailTags"("A", "B");
CREATE INDEX "_InboxEmailTags_B_index" ON "_InboxEmailTags"("B");

ALTER TABLE "_InboxEmailTags" ADD CONSTRAINT "_InboxEmailTags_A_fkey"
    FOREIGN KEY ("A") REFERENCES "InboxEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_InboxEmailTags" ADD CONSTRAINT "_InboxEmailTags_B_fkey"
    FOREIGN KEY ("B") REFERENCES "InboxEmailTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
