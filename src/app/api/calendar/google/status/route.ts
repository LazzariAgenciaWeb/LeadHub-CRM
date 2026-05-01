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
    },
  });

  if (!conn) return NextResponse.json({ connected: false });
  return NextResponse.json({ connected: true, ...conn });
}
