import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getCalendarData } from "@/lib/calendar-data";

// GET /api/calendar/my-day
// Retorna os buckets do "Meu Dia" — mesma fonte usada pela página /calendario.
// Lógica em src/lib/calendar-data.ts.
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "calendario");
  if (!gate.ok) return gate.response;

  const userId      = (session.user as any)?.id as string;
  const userRole    = (session.user as any)?.role as string;
  const sessionCompanyId = (session.user as any)?.companyId as string | undefined;

  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const isManager   = isSuperAdmin || userRole === "ADMIN";

  // Query param opcional: filtrar por outra empresa (só super admin).
  const { searchParams } = new URL(req.url);
  const filterCompanyId = isSuperAdmin
    ? (searchParams.get("companyId") ?? sessionCompanyId)
    : sessionCompanyId;

  const userSetorIds = (await prisma.setorUser.findMany({
    where: { userId },
    select: { setorId: true },
  })).map((s) => s.setorId);

  const data = await getCalendarData({
    companyId: filterCompanyId,
    userId,
    isManager,
    userSetorIds,
  });

  return NextResponse.json(data);
}
