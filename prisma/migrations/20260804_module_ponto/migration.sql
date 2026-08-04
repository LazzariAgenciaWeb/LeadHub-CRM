-- Módulo Ponto — controle de jornada GERENCIAL (cartão ponto simples).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.
--
-- Não é REP-P (Portaria MTP 671/2021) — é controle interno + espelho mensal
-- pra contabilidade, com assinatura eletrônica simples do colaborador.
-- Também adiciona a razão PONTO_PONTUAL na gamificação (entrada no horário).

CREATE TYPE "PunchType" AS ENUM ('ENTRADA', 'INTERVALO_INICIO', 'INTERVALO_FIM', 'SAIDA');
CREATE TYPE "PunchSource" AS ENUM ('MANUAL', 'AJUSTE');
CREATE TYPE "TimeOffType" AS ENUM ('ATESTADO', 'FERIAS', 'FERIADO', 'FOLGA');
CREATE TYPE "PunchAdjustStatus" AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO');

ALTER TYPE "ScoreReason" ADD VALUE 'PONTO_PONTUAL';

-- Marcações (batidas). timestamp é sempre o relógio do servidor.
CREATE TABLE "TimePunch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PunchType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "source" "PunchSource" NOT NULL DEFAULT 'MANUAL',
    "ip" TEXT,
    "adjustRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimePunch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TimePunch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimePunch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TimePunch_companyId_timestamp_idx" ON "TimePunch"("companyId", "timestamp");
CREATE INDEX "TimePunch_userId_timestamp_idx" ON "TimePunch"("userId", "timestamp");

-- Jornada esperada por colaborador × dia da semana (0=dom … 6=sáb).
CREATE TABLE "WorkScheduleDay" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startTime" TEXT NOT NULL DEFAULT '09:00',
    "endTime" TEXT NOT NULL DEFAULT '18:00',
    "breakStart" TEXT,
    "breakEnd" TEXT,
    CONSTRAINT "WorkScheduleDay_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkScheduleDay_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkScheduleDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkScheduleDay_userId_dayOfWeek_key" ON "WorkScheduleDay"("userId", "dayOfWeek");
CREATE INDEX "WorkScheduleDay_companyId_idx" ON "WorkScheduleDay"("companyId");

-- Abonos: atestado/férias/feriado/folga. userId NULL = coletivo (empresa toda).
CREATE TABLE "TimeOffEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "TimeOffType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimeOffEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TimeOffEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimeOffEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimeOffEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "TimeOffEntry_companyId_startDate_idx" ON "TimeOffEntry"("companyId", "startDate");
CREATE INDEX "TimeOffEntry_userId_idx" ON "TimeOffEntry"("userId");

-- Solicitação de ajuste (esqueci de bater). punches = lista COMPLETA correta
-- do dia; a aprovação substitui as marcações do dia e invalida a assinatura.
CREATE TABLE "PunchAdjustRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "punches" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PunchAdjustStatus" NOT NULL DEFAULT 'PENDENTE',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PunchAdjustRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PunchAdjustRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PunchAdjustRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PunchAdjustRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "PunchAdjustRequest_companyId_status_idx" ON "PunchAdjustRequest"("companyId", "status");
CREATE INDEX "PunchAdjustRequest_userId_idx" ON "PunchAdjustRequest"("userId");

-- Assinatura eletrônica simples do espelho mensal (quem/quando/IP).
CREATE TABLE "TimesheetSignature" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    CONSTRAINT "TimesheetSignature_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TimesheetSignature_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimesheetSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TimesheetSignature_userId_year_month_key" ON "TimesheetSignature"("userId", "year", "month");
CREATE INDEX "TimesheetSignature_companyId_year_month_idx" ON "TimesheetSignature"("companyId", "year", "month");
