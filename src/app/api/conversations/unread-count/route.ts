import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getUserPermissions } from "@/lib/user-permissions";
import { hasModule } from "@/lib/permissions";
import { getHiddenInstanceIds, conversationVisibilityAnd } from "@/lib/whatsapp-visibility";

// GET /api/conversations/unread-count
// Conta conversas "sem resposta" (aguardando atendimento) pra alimentar o
// badge no menu WhatsApp. "Sem resposta" = status OPEN ou PENDING, que na
// máquina de estados significa "cliente mandou, bola está com a gente".
//
// Escopo:
//   - Admin/SuperAdmin: todas as conversas da empresa
//   - Atendente (CLIENT): só conversas das instâncias dos setores dele
//
// Retorna { count } sempre — nunca quebra o carregamento do menu.
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ count: 0 });

  // Sem módulo WhatsApp → não há badge
  if (!hasModule(session, "whatsapp")) return NextResponse.json({ count: 0 });

  const userRole = (session.user as any)?.role;
  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const companyId = (session.user as any)?.companyId as string | undefined;

  // SuperAdmin sem impersonar não tem empresa fixa → não mostra badge global
  // (evita contar conversas de todas as empresas).
  if (isSuperAdmin && !companyId) return NextResponse.json({ count: 0 });
  if (!companyId) return NextResponse.json({ count: 0 });

  const baseWhere: any = {
    companyId,
    status: { in: ["OPEN", "PENDING"] },
  };

  try {
    const perms = await getUserPermissions(session);

    // Atendente com setores restritos: escopa por instâncias visíveis.
    // Conversation não tem instanceId; descobre via mensagens das instâncias
    // permitidas. Limita a busca pra não varrer toda a base.
    if (perms && !perms.isAdmin && perms.instanceIds) {
      if (perms.instanceIds.length === 0) return NextResponse.json({ count: 0 });
      const convIds = await prisma.message.findMany({
        where:    { companyId, instanceId: { in: perms.instanceIds } },
        select:   { conversationId: true },
        distinct: ["conversationId"],
        take:     2000,
      });
      const ids = convIds.map((m) => m.conversationId).filter((id): id is string => !!id);
      if (ids.length === 0) return NextResponse.json({ count: 0 });
      baseWhere.id = { in: ids };
    }

    // Não conta conversas de instância privada de outro dono nem bloqueadas.
    const hiddenInstanceIds = await getHiddenInstanceIds(session);
    baseWhere.AND = [
      ...(baseWhere.AND ?? []),
      ...conversationVisibilityAnd({ hiddenIds: hiddenInstanceIds }),
    ];

    const count = await prisma.conversation.count({ where: baseWhere });
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
