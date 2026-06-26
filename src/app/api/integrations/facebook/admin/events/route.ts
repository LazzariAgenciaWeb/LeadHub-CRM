import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRecentFbWebhookEvents } from "@/lib/instagram-debug";
import { fbTokenCrypto, fbGetPageSubscriptions, fbSubscribePage } from "@/lib/facebook";

// GET /api/integrations/facebook/admin/events[?resubscribe=1]
// Mostra eventos recebidos do webhook do FB + status de assinatura de cada Página.
// Com ?resubscribe=1, reassina todas as páginas (corrige subscribed_apps).
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const resubscribe = new URL(req.url).searchParams.get("resubscribe") === "1";

  const pages = await prisma.facebookPage.findMany({
    select: { pageId: true, name: true, pageAccessTokenEnc: true },
  });
  const subscriptions: any[] = [];
  for (const p of pages) {
    const token = fbTokenCrypto.decrypt(p.pageAccessTokenEnc);
    if (!token) {
      subscriptions.push({ pageId: p.pageId, name: p.name, error: "sem token" });
      continue;
    }
    if (resubscribe) await fbSubscribePage(p.pageId, token).catch(() => {});
    subscriptions.push({ pageId: p.pageId, name: p.name, subscribed: await fbGetPageSubscriptions(p.pageId, token) });
  }

  const events = getRecentFbWebhookEvents();
  return NextResponse.json({ resubscribed: resubscribe, count: events.length, events, subscriptions });
}
