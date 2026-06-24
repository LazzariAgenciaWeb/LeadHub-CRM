import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { subscribeAccountWebhooks, getSubscribedApps, tokenCrypto } from "@/lib/instagram-oauth";

// GET /api/integrations/instagram/admin/subscribe?accountId=Y
//
// Assina uma conta IG já conectada aos webhooks (subscribed_apps) e retorna o
// estado atual. Apenas SUPER_ADMIN. Resolve o caso de contas conectadas antes
// de o connect passar a assinar automaticamente.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: { id: true, username: true, accessTokenEnc: true },
  });
  if (!account) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });

  const token = tokenCrypto.decrypt(account.accessTokenEnc);
  if (!token) return NextResponse.json({ error: "Conta sem token" }, { status: 400 });

  const subscribeResult = await subscribeAccountWebhooks(token);
  const currentStatus = await getSubscribedApps(token);

  return NextResponse.json({
    account: { id: account.id, username: account.username },
    subscribeResult,
    currentStatus,
  });
}
