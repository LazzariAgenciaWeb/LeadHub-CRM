import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// GET /api/dashboard/atendimento
// Retorna KPIs de atendimento das últimas 24h (e contagens absolutas).
export async function GET(_req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole      = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const isSuperAdmin  = userRole === "SUPER_ADMIN";

  const where = isSuperAdmin ? {} : { companyId: userCompanyId ?? "__none__" };
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Contagens de status (snapshot atual)
  const statusCounts = await prisma.conversation.groupBy({
    by: ["status"],
    where,
    _count: true,
  });
  const statusMap: Record<string, number> = {};
  for (const row of statusCounts) statusMap[row.status] = row._count;

  // Conversas finalizadas nas últimas 24h
  const closedToday = await prisma.conversation.count({
    where: { ...where, status: "CLOSED", closedAt: { gte: since24h } },
  });

  // Tempo médio de primeira resposta (de TODAS conversas com firstResponseAt nos últimos 30 dias)
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const responded = await prisma.conversation.findMany({
    where: { ...where, firstResponseAt: { not: null }, createdAt: { gte: since30d } },
    select: { createdAt: true, firstResponseAt: true },
    take: 500,
  });
  let avgResponseMin: number | null = null;
  if (responded.length > 0) {
    const totalMs = responded.reduce(
      (s, c) => s + (c.firstResponseAt!.getTime() - c.createdAt.getTime()),
      0
    );
    avgResponseMin = Math.round(totalMs / responded.length / 60000);
  }

  return NextResponse.json({
    open:             statusMap.OPEN ?? 0,
    pending:          statusMap.PENDING ?? 0,
    inProgress:       statusMap.IN_PROGRESS ?? 0,
    waitingCustomer:  statusMap.WAITING_CUSTOMER ?? 0,
    closed:           statusMap.CLOSED ?? 0,
    closedLast24h:    closedToday,
    avgResponseMin,
    sampleSize:       responded.length,
  });
}
