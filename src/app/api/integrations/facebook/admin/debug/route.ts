import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRecentFbCallbacks } from "@/lib/instagram-debug";
import { facebookConfig } from "@/lib/facebook";

// GET /api/integrations/facebook/admin/debug — diagnóstico do connect do Facebook.
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const traces = getRecentFbCallbacks();
  return NextResponse.json({
    hint: "Conecte de novo e recarregue. traces[0] mostra o passo onde parou.",
    envCheck: {
      hasFbAppId: !!process.env.FACEBOOK_APP_ID,
      hasFbAppSecret: !!process.env.FACEBOOK_APP_SECRET,
      hasConfigId: !!facebookConfig.configId,
      redirectUri: facebookConfig.redirectUri,
      appId: facebookConfig.appId || null,
    },
    count: traces.length,
    traces,
  });
}
