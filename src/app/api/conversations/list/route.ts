import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
import { getHiddenInstanceIds, conversationVisibilityAnd } from "@/lib/whatsapp-visibility";

// GET /api/conversations/list?skip=50&take=50&companyId=...
// Paginação "carregar mais" da listagem inicial de conversas. Espelha o
// carregamento do server component em whatsapp/page.tsx (mesmo escopo de
// empresa, mesmo filtro de instância por setor, mesmo enriquecimento), mas
// com skip/take para puxar as próximas páginas conforme o usuário rola a lista.
//
// hasMore = a página crua veio cheia (== take) → provavelmente há mais.
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const userRole = (session.user as any)?.role;
  const userCompanyId = (session.user as any)?.companyId as string | undefined;
  const isSuperAdmin = userRole === "SUPER_ADMIN";

  const { searchParams } = new URL(req.url);
  const skip = Math.max(0, parseInt(searchParams.get("skip") ?? "0", 10) || 0);
  const take = Math.min(100, Math.max(1, parseInt(searchParams.get("take") ?? "50", 10) || 50));

  const queryCompanyId = searchParams.get("companyId") ?? "";
  const companyId = isSuperAdmin ? queryCompanyId : (userCompanyId ?? "");

  const perms = await getUserPermissions(session);

  const convFilter: any = {};
  if (companyId) convFilter.companyId = companyId;

  // Visibilidade: instância privada + bloqueio. ?blocked=1 lista SÓ as
  // bloqueadas (tela de gerenciar/desbloquear).
  const blockedMode = searchParams.get("blocked") === "1" ? "only" : "exclude";
  const hiddenInstanceIds = await getHiddenInstanceIds(session);
  convFilter.AND = [
    ...(convFilter.AND ?? []),
    ...conversationVisibilityAnd({ hiddenIds: hiddenInstanceIds, blocked: blockedMode }),
  ];

  const convRecords = await prisma.conversation.findMany({
    where: convFilter,
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    skip,
    take,
    select: {
      id: true, phone: true, companyId: true,
      status: true, statusUpdatedAt: true, unreadCount: true,
      lastMessageAt: true,
      assigneeId: true,
      assignee: { select: { id: true, name: true } },
      setorId: true,
      setor: { select: { id: true, name: true } },
      excludeFromGamification: true,
      aiMode: true,
    },
  });

  // hasMore baseado na página CRUA (antes do filtro de instância) — é o que
  // determina se vale a pena pedir a próxima página ao server.
  const hasMore = convRecords.length === take;

  // Filtro por instância visível ao usuário (setor). Conversation não guarda
  // instanceId; descobrimos via mensagens (mesma lógica do page.tsx).
  let convFiltered = convRecords;
  if (perms && !perms.isAdmin && perms.instanceIds) {
    if (perms.instanceIds.length === 0) {
      convFiltered = [];
    } else {
      const allowedConvIds = new Set(
        (await prisma.message.findMany({
          where: {
            conversationId: { in: convRecords.map((c) => c.id) },
            instanceId: { in: perms.instanceIds },
          },
          select: { conversationId: true },
          distinct: ["conversationId"],
        })).map((m) => m.conversationId).filter((id): id is string => id !== null)
      );
      convFiltered = convRecords.filter((c) => allowedConvIds.has(c.id));
    }
  }

  // Enriquece no mesmo formato da listagem inicial / busca.
  const conversations = await Promise.all(
    convFiltered.map(async (conv) => {
      const [lastMsg, lead, companyContact, lastOutbound] = await Promise.all([
        prisma.message.findFirst({
          where: { conversationId: conv.id },
          orderBy: { receivedAt: "desc" },
          select: {
            body: true, direction: true, receivedAt: true,
            participantPhone: true,
            instance: { select: { instanceName: true } },
          },
        }),
        prisma.lead.findFirst({
          where: { OR: [{ conversationId: conv.id }, { phone: conv.phone, companyId: conv.companyId }] },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, name: true, status: true, notes: true,
            pipeline: true, pipelineStage: true,
            attendanceStatus: true, expectedReturnAt: true,
          },
        }),
        prisma.companyContact.findFirst({
          where: {
            phone: conv.phone,
            OR: [
              { companyId: conv.companyId },
              { company: { parentCompanyId: conv.companyId } },
            ],
          },
          select: {
            id: true, name: true, role: true, hasAccess: true,
            company: { select: { id: true, name: true } },
          },
        }),
        prisma.message.findFirst({
          where: { conversationId: conv.id, direction: "OUTBOUND" },
          orderBy: { receivedAt: "desc" },
          select: { rawPayload: true },
        }),
      ]);
      return {
        phone: conv.phone,
        companyId: conv.companyId,
        lastMsg,
        lead: lead ? {
          ...lead,
          expectedReturnAt: lead.expectedReturnAt ? lead.expectedReturnAt.toISOString() : null,
        } : null,
        companyContact,
        lastOutboundByAI: !!((lastOutbound?.rawPayload as any)?.autoAgent),
        conversation: {
          id: conv.id,
          status: conv.status,
          statusUpdatedAt: conv.statusUpdatedAt?.toISOString(),
          unreadCount: conv.unreadCount,
          assigneeId: conv.assigneeId,
          assignee: conv.assignee,
          setorId: conv.setorId,
          setor: conv.setor,
          excludeFromGamification: conv.excludeFromGamification,
          aiMode: conv.aiMode,
        },
      };
    })
  );

  return NextResponse.json({ conversations, hasMore });
}
