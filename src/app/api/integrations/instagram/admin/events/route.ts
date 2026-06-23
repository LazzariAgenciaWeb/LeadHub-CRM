import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRecentIgWebhookEvents } from "@/lib/instagram-debug";

// GET /api/integrations/instagram/admin/events
//
// Mostra os últimos eventos recebidos no webhook do Instagram (comentários/DMs).
// Apenas SUPER_ADMIN. Buffer em memória — reseta a cada deploy.
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const events = getRecentIgWebhookEvents();
  return NextResponse.json({
    hint: "Comente num post da conta conectada e recarregue. O item do topo é o evento mais recente.",
    count: events.length,
    events,
  });
}
