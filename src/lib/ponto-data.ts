/**
 * Loaders de dados do Módulo Ponto — usados pelos server components
 * (/ponto, /ponto/equipe e o espelho imprimível) pra montar o espelho
 * direto do Prisma, sem passar por API.
 */

import { prisma } from "@/lib/prisma";
import { buildEspelho, monthRangeUTC, type Espelho } from "@/lib/ponto";

export type SignatureInfo = { signedAt: Date; ip: string | null } | null;

/** Espelho de um colaborador num mês + assinatura (se houver). */
export async function loadEspelho(
  userId: string,
  companyId: string,
  year: number,
  month: number,
): Promise<{ espelho: Espelho; signature: SignatureInfo }> {
  const range = monthRangeUTC(year, month);
  const [punches, schedule, timeOffs, signature] = await Promise.all([
    prisma.timePunch.findMany({
      where: { userId, timestamp: { gte: range.gte, lt: range.lt } },
      orderBy: { timestamp: "asc" },
    }),
    prisma.workScheduleDay.findMany({ where: { userId } }),
    prisma.timeOffEntry.findMany({
      where: {
        companyId,
        startDate: { lt: range.lt },
        endDate: { gte: range.gte },
        OR: [{ userId }, { userId: null }],
      },
    }),
    prisma.timesheetSignature.findUnique({
      where: { userId_year_month: { userId, year, month } },
    }),
  ]);

  return {
    espelho: buildEspelho({ year, month, punches, schedule, timeOffs }),
    signature: signature ? { signedAt: signature.signedAt, ip: signature.ip } : null,
  };
}

export type TeamMemberRow = {
  id: string;
  name: string;
  email: string;
  espelho: Espelho;
  signedAt: Date | null;
  hasSchedule: boolean;
};

/**
 * Espelhos de TODA a equipe num mês, com poucas queries (busca tudo da
 * empresa e agrupa em JS). Exclui SUPER_ADMIN — dono da plataforma não é
 * colaborador da empresa-cliente (regra do AGENTS.md).
 */
export async function loadTeamEspelhos(
  companyId: string,
  year: number,
  month: number,
): Promise<TeamMemberRow[]> {
  const range = monthRangeUTC(year, month);
  const [users, punches, schedules, timeOffs, signatures] = await Promise.all([
    prisma.user.findMany({
      where: { companyId, role: { not: "SUPER_ADMIN" } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.timePunch.findMany({
      where: { companyId, timestamp: { gte: range.gte, lt: range.lt } },
      orderBy: { timestamp: "asc" },
    }),
    prisma.workScheduleDay.findMany({ where: { companyId } }),
    prisma.timeOffEntry.findMany({
      where: { companyId, startDate: { lt: range.lt }, endDate: { gte: range.gte } },
    }),
    prisma.timesheetSignature.findMany({ where: { companyId, year, month } }),
  ]);

  const punchesBy = groupBy(punches, (p) => p.userId);
  const schedBy = groupBy(schedules, (s) => s.userId);
  const sigBy = new Map(signatures.map((s) => [s.userId, s]));

  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    espelho: buildEspelho({
      year,
      month,
      punches: punchesBy.get(u.id) ?? [],
      schedule: schedBy.get(u.id) ?? [],
      // Coletivos (userId null) valem pra todo mundo
      timeOffs: timeOffs.filter((t) => t.userId === u.id || t.userId === null),
    }),
    signedAt: sigBy.get(u.id)?.signedAt ?? null,
    hasSchedule: (schedBy.get(u.id) ?? []).length > 0,
  }));
}

function groupBy<T>(list: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of list) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}
