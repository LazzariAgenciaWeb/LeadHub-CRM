import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRecentIgCallbacks } from "@/lib/instagram-debug";
import { instagramConfig } from "@/lib/instagram-oauth";

// GET /api/integrations/instagram/admin/debug
//
// Mostra os últimos callbacks de OAuth do Instagram (em que passo pararam e por
// quê). Apenas SUPER_ADMIN. Buffer em memória — reseta a cada deploy.
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const traces = getRecentIgCallbacks();
  return NextResponse.json({
    hint: "Conecte de novo e recarregue aqui. O item mais recente (topo) mostra o passo onde parou.",
    envCheck: {
      hasAppId: !!process.env.INSTAGRAM_APP_ID,
      hasAppSecret: !!process.env.INSTAGRAM_APP_SECRET,
      hasVerifyToken: !!process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
      baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? null,
      // redirect_uri EXATO que nosso código envia — compare byte-a-byte com o
      // cadastrado no painel do Meta.
      redirectUri: instagramConfig.redirectUri,
    },
    count: traces.length,
    traces,
  });
}
