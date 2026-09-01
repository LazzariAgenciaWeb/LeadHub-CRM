import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// GET /api/calendar/google/status
//
// Retorna o estado da conexão Google Calendar do usuário atual.
export async function GET(_req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any)?.id as string;
  const conn = await prisma.userGoogleConnection.findUnique({
    where: { userId_service: { userId, service: "calendar" } },
    select: {
      googleEmail: true,
      googleName: true,
      status: true,
      lastSyncAt: true,
      lastError: true,
      createdAt: true,
      scopes: true,
    },
  });

  if (!conn) return NextResponse.json({ connected: false });
  // `canWrite`: conexões antigas só pediram calendar.readonly — sem
  // calendar.events o agente não cria evento e a tela precisa pedir reconexão.
  const { scopes, ...rest } = conn;
  const canWrite = scopes.some(
    (s) => s.includes("auth/calendar.events") || s === "https://www.googleapis.com/auth/calendar"
  );
  return NextResponse.json({ connected: true, canWrite, ...rest });
}
