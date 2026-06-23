import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/integrations/instagram/admin/link-webhook-id?accountId=Y&webhookId=Z
//
// Define o igScopedId (id que o webhook usa em entry.id) numa conta já conectada,
// pra casar webhooks sem precisar reconectar. Apenas SUPER_ADMIN.
// Ferramenta interina — connect novos já capturam os dois ids automaticamente.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  const webhookId = url.searchParams.get("webhookId");
  if (!accountId || !webhookId) {
    return NextResponse.json({ error: "accountId e webhookId obrigatórios" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: { id: true, username: true, igUserId: true, igScopedId: true },
  });
  if (!account) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });

  const updated = await prisma.instagramAccount.update({
    where: { id: accountId },
    data: { igScopedId: webhookId },
    select: { id: true, username: true, igUserId: true, igScopedId: true },
  });

  return NextResponse.json({ ok: true, before: account, after: updated });
}
