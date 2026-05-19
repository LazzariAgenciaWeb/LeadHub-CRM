import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { startOfTodayInSystemTZ, endOfTodayInSystemTZ } from "@/lib/datetime";

// GET /api/tasks/me?scope=today|overdue|upcoming|all
// Tarefas do usuário logado. Default: hoje + atrasadas (em aberto).
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const scope = req.nextUrl.searchParams.get("scope") ?? "today";

  // Janela "hoje" ancorada no TZ do sistema (BRT). setHours UTC puxava
  // o fim de ontem como se fosse hoje.
  const now = new Date();
  const startOfDay = startOfTodayInSystemTZ(now);
  const endOfDay   = endOfTodayInSystemTZ(now);

  // Painel mostra MINHAS tarefas + as SEM RESPONSÁVEL da empresa (qualquer
  // um pode pegar). Sinais quentes (AUTO_LINK_OPEN: "cliente abriu o link")
  // nascem sem responsável — antes ficavam invisíveis e o painel mentia
  // "tudo em dia". Mesma lógica do "Meu Dia": meu + sem dono = minha fila.
  const baseWhere: any = { OR: [{ assigneeId: userId }, { assigneeId: null }] };
  if (role !== "SUPER_ADMIN" && userCompanyId) baseWhere.companyId = userCompanyId;

  let where: any;
  if (scope === "today") where = { ...baseWhere, done: false, dueAt: { lte: endOfDay } };
  else if (scope === "overdue") where = { ...baseWhere, done: false, dueAt: { lt: startOfDay } };
  else if (scope === "upcoming") where = { ...baseWhere, done: false, dueAt: { gt: endOfDay } };
  else where = baseWhere; // "all"

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ done: "asc" }, { dueAt: "asc" }],
    take: 100,
    include: {
      lead: { select: { id: true, name: true, phone: true, pipeline: true } },
    },
  });
  return NextResponse.json(tasks);
}
