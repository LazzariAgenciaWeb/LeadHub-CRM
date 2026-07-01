-- Cofre: Notas Seguras — blocos de texto grandes criptografados (AES-256-GCM),
-- autônomos (não vinculados a um asset). O conteúdo (contentEncrypted) só é
-- decriptado via /reveal, que exige VaultTrustedSession (2FA por e-mail).
-- SecureNoteAccessLog reaproveita o enum "CredentialAction" já existente.

CREATE TABLE "CompanySecureNote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentEncrypted" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "archivedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CompanySecureNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanySecureNote_companyId_archivedAt_idx" ON "CompanySecureNote"("companyId", "archivedAt");

CREATE TABLE "SecureNoteAccessLog" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "userRole" TEXT,
    "action" "CredentialAction" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecureNoteAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecureNoteAccessLog_noteId_createdAt_idx" ON "SecureNoteAccessLog"("noteId", "createdAt");
CREATE INDEX "SecureNoteAccessLog_companyId_createdAt_idx" ON "SecureNoteAccessLog"("companyId", "createdAt");

ALTER TABLE "CompanySecureNote" ADD CONSTRAINT "CompanySecureNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecureNoteAccessLog" ADD CONSTRAINT "SecureNoteAccessLog_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "CompanySecureNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecureNoteAccessLog" ADD CONSTRAINT "SecureNoteAccessLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
