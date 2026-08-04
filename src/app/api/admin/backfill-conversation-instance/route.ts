import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";

// POST /api/admin/backfill-conversation-instance
// Preenche Conversation.instanceId (denormalizado) a partir da última mensagem
// de cada conversa que ainda está sem — necessário pra visibilidade por
// instância privada valer nas conversas criadas antes do campo existir.
//
// Idempotente e paginado (processa até `limit` por chamada; repita até done=true).
// Admin only. Escopo: empresa do usuário (SUPER_ADMIN pode passar ?companyId=).
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const perms = await getUserPermissions(session);
  if (!perms?.isAdmin) return NextResponse.json({ error: "Apenas admin" }, { status: 403 });

  const isSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session.user as any)?.companyId as string | undefined;
  const url = new URL(req.url);
  const companyId = isSuperAdmin ? (url.searchParams.get("companyId") || undefined) : userCompanyId;
  const limit = Math.min(2000, Math.max(1, parseInt(url.searchParams.get("limit") ?? "1000", 10) || 1000));

  const convs = await prisma.conversation.findMany({
    where: { instanceId: null, ...(companyId ? { companyId } : {}) },
    select: { id: true },
    take: limit,
  });

  let updated = 0;
  for (const c of convs) {
    const lastMsg = await prisma.message.findFirst({
      where: { conversationId: c.id, instanceId: { not: null } },
      orderBy: { receivedAt: "desc" },
      select: { instanceId: true },
    });
    if (lastMsg?.instanceId) {
      await prisma.conversation.update({
        where: { id: c.id },
        data: { instanceId: lastMsg.instanceId },
      }).catch(() => {/* não crítico */});
      updated++;
    }
  }

  return NextResponse.json({
    processed: convs.length,
    updated,
    done: convs.length < limit, // veio menos que o limite → não há mais nulas
  });
}
