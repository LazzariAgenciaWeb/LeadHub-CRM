import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// GET /api/tasks/me?scope=today|overdue|upcoming|all
// Tarefas do usuário logado. Default: hoje + atrasadas (em aberto).
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const scope = req.nextUrl.searchParams.get("scope") ?? "today";

  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);

  const baseWhere: any = { assigneeId: userId };
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
