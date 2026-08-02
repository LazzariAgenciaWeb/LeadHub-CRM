-- Anexos de emails: só metadados (nome/tipo/tamanho/parte MIME). O conteúdo
-- é baixado sob demanda direto do servidor IMAP — nada de peso no banco.
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

CREATE TABLE "InboxEmailAttachment" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "size" INTEGER NOT NULL DEFAULT 0,
    "partId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxEmailAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InboxEmailAttachment_emailId_idx" ON "InboxEmailAttachment"("emailId");

ALTER TABLE "InboxEmailAttachment" ADD CONSTRAINT "InboxEmailAttachment_emailId_fkey"
    FOREIGN KEY ("emailId") REFERENCES "InboxEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;
