import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendPushToUser, isPushConfigured } from "@/lib/push";

// POST /api/push/test  → dispara push de teste pro próprio user
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (!isPushConfigured()) {
    return NextResponse.json({ error: "Web Push não configurado (faltam VAPID keys no servidor)" }, { status: 503 });
  }

  const userId = (session.user as any).id as string;
  await sendPushToUser(userId, {
    title: "🎉 LeadHub conectado",
    body: "As notificações estão funcionando neste navegador.",
    url: "/dashboard",
    tag: "test",
  });
  return NextResponse.json({ ok: true });
}
