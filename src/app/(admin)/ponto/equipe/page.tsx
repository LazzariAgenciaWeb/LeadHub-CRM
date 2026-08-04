import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { dayKeyInTZ, monthRangeUTC, parseYm } from "@/lib/ponto";
import { loadTeamEspelhos } from "@/lib/ponto-data";
import EquipeClient from "./EquipeClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PontoEquipePage(props: { searchParams: Promise<{ ym?: string }> }) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const role = (session.user as any).role as string;
  const companyId = (session.user as any).companyId as string | undefined;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") redirect("/ponto");
  if (!companyId) redirect("/ponto");

  const { ym } = await props.searchParams;
  const { year, month } = parseYm(ym);
  const range = monthRangeUTC(year, month);

  const [team, adjustments, timeOffs] = await Promise.all([
    loadTeamEspelhos(companyId, year, month),
    prisma.punchAdjustRequest.findMany({
      where: { companyId },
      include: { user: { select: { name: true } }, reviewedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.timeOffEntry.findMany({
      where: { companyId, startDate: { lt: range.lt }, endDate: { gte: range.gte } },
      include: { user: { select: { name: true } } },
      orderBy: { startDate: "asc" },
    }),
  ]);

  return (
    <EquipeClient
      year={year}
      month={month}
      todayKey={dayKeyInTZ(new Date())}
      members={team.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        totals: m.espelho.totals,
        signedAt: m.signedAt ? m.signedAt.toISOString() : null,
        hasSchedule: m.hasSchedule,
      }))}
      adjustments={adjustments.map((a) => ({
        id: a.id,
        userName: a.user.name,
        dayKey: dayKeyInTZ(a.date),
        punches: a.punches as { type: string; time: string }[],
        reason: a.reason,
        status: a.status,
        reviewNote: a.reviewNote,
        reviewedByName: a.reviewedBy?.name ?? null,
      }))}
      timeOffs={timeOffs.map((t) => ({
        id: t.id,
        userName: t.user?.name ?? null,
        type: t.type,
        startKey: dayKeyInTZ(t.startDate),
        endKey: dayKeyInTZ(t.endDate),
        description: t.description,
      }))}
    />
  );
}
