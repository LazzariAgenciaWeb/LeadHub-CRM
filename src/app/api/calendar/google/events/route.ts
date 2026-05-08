import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { listPrimaryEvents } from "@/lib/google-calendar";
import { assertModule } from "@/lib/billing";
import { startOfTodayInSystemTZ, endOfTodayInSystemTZ } from "@/lib/datetime";

// GET /api/calendar/google/events?from=ISO&to=ISO
//
// Retorna eventos do calendário primário do usuário no intervalo informado.
// Se não houver from/to, default = de agora até final do dia.
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "calendario");
  if (!gate.ok) return gate.response;

  const userId = (session.user as any)?.id as string;
  const conn = await prisma.userGoogleConnection.findUnique({
    where: { userId_service: { userId, service: "calendar" } },
    select: { id: true, status: true },
  });

  if (!conn) return NextResponse.json({ connected: false, events: [] });
  if (conn.status !== "ACTIVE") {
    return NextResponse.json({ connected: false, status: conn.status, events: [] });
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam   = url.searchParams.get("to");

  // Janela default ancorada no TZ do sistema (BRT). Servidor em UTC dava
  // "00:00 UTC" = "21:00 BRT do dia anterior" e puxava eventos de ontem à noite.
  const now = new Date();
  const todayStart = startOfTodayInSystemTZ(now);
  const todayEnd   = endOfTodayInSystemTZ(now);

  const timeMin = fromParam ? new Date(fromParam) : todayStart;
  const timeMax = toParam   ? new Date(toParam)   : todayEnd;

  try {
    const events = await listPrimaryEvents(conn.id, timeMin, timeMax);
    return NextResponse.json({ connected: true, events });
  } catch (e: any) {
    return NextResponse.json(
      { connected: true, error: e?.message ?? "Erro ao buscar eventos", events: [] },
      { status: 500 },
    );
  }
}
