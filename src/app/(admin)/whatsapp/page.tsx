import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getUserPermissions } from "@/lib/user-permissions";
import WhatsappManager from "./WhatsappManager";

export default async function WhatsappPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; abrir?: string }>;
}) {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const sp = await searchParams;
  const companyId = isSuperAdmin ? (sp.companyId ?? "") : (userCompanyId ?? "");
  const defaultPhone = sp.abrir ?? "";

  // Permissões do usuário logado (filtra instâncias pelo setor)
  const perms = await getUserPermissions(session);

  const msgWhere: any = {};
  if (companyId) msgWhere.companyId = companyId;

  // Instâncias: filtra pelo setor do usuário (se não for admin)
  const instanceWhere: any = companyId ? { companyId } : {};
  if (perms && !perms.isAdmin && perms.instanceIds) {
    instanceWhere.id = { in: perms.instanceIds };
  }

  const instances = await prisma.whatsappInstance.findMany({
    where: instanceWhere,
    select: {
      id: true,
      instanceName: true,
      phone: true,
      status: true,
      company: { select: { id: true, name: true } },
    },
  });

  // Conversas: filtra apenas as instâncias que o usuário pode ver
  if (perms && !perms.isAdmin && perms.instanceIds && perms.instanceIds.length > 0) {
    msgWhere.instanceId = { in: perms.instanceIds };
  } else if (perms && !perms.isAdmin && perms.instanceIds?.length === 0) {
    // Sem nenhuma instância no setor → sem conversas
    msgWhere.id = "NOOP_NO_ACCESS";
  }

  // Fonte da verdade: tabela Conversation (com @@unique([companyId, phone]) — sem duplicatas)
  // Antes usávamos Message.groupBy(['phone', 'companyId']) que duplicava quando o
  // mesmo contato tinha mensagens com o phone armazenado em variações sutis
  // (ex: com/sem @lid resolvido, com/sem código de país).
  const convFilter: any = {};
  if (companyId) convFilter.companyId = companyId;
  // Aplica o mesmo filtro de instância que era usado em msgWhere
  if (msgWhere.instanceId)  convFilter.companyId = convFilter.companyId; // (placeholder)

  const convRecords = await prisma.conversation.findMany({
    where: convFilter,
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 100,
    select: {
      id: true, phone: true, companyId: true,
      status: true, statusUpdatedAt: true, unreadCount: true,
      lastMessageAt: true,
      assigneeId: true,
      assignee: { select: { id: true, name: true } },
      setorId: true,
      setor: { select: { id: true, name: true } },
    },
  });

  // Filtro por instância visível ao usuário (setor) — aplicado na lista de conversas
  let convFiltered = convRecords;
  if (perms && !perms.isAdmin && perms.instanceIds) {
    if (perms.instanceIds.length === 0) {
      convFiltered = [];
    } else {
      // Conversation não tem instanceId; descobre via última mensagem
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

  // Para cada conversation, busca lastMsg (para instanceName/participant), lead, counts e contact em paralelo
  const conversations = await Promise.all(
    convFiltered.map(async (conv) => {
      const [lastMsg, lead, inboundCount, outboundCount, companyContact] = await Promise.all([
        prisma.message.findFirst({
          where: { conversationId: conv.id },
          orderBy: { receivedAt: "desc" },
          select: {
            body: true,
            direction: true,
            receivedAt: true,
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
        prisma.message.count({ where: { conversationId: conv.id, direction: "INBOUND" } }),
        prisma.message.count({ where: { conversationId: conv.id, direction: "OUTBOUND" } }),
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
      ]);
      return {
        phone: conv.phone,
        companyId: conv.companyId,
        lastMsg,
        lead,
        totalMessages: inboundCount + outboundCount,
        inboundCount,
        outboundCount,
        companyContact,
        conversation: {
          id: conv.id,
          status: conv.status,
          statusUpdatedAt: conv.statusUpdatedAt,
          unreadCount: conv.unreadCount,
          assigneeId: conv.assigneeId,
          assignee: conv.assignee,
          setorId: conv.setorId,
          setor: conv.setor,
        },
      };
    })
  );

  const conversationsEnriched = conversations;

  const finalStageConfigs = await prisma.pipelineStageConfig.findMany({
    where: { isFinal: true, ...(companyId ? { companyId } : {}) },
    select: { name: true },
  });
  const finalStageNames = [...new Set(finalStageConfigs.map((s) => s.name))];

  // Setores e atendentes para o modal de transferência.
  // - Se companyId está setado (ADMIN/CLIENT ou SuperAdmin filtrando) → só dessa empresa
  // - Se SuperAdmin sem filtro → busca de todas as empresas que têm conversas visíveis
  //   (o componente filtra por selectedConv.companyId no momento de mostrar)
  const companyIdsScope = companyId
    ? [companyId]
    : Array.from(new Set(conversationsEnriched.map((c) => c.companyId).filter(Boolean)));

  const [setores, atendentes] = companyIdsScope.length > 0
    ? await Promise.all([
        prisma.setor.findMany({
          where: { companyId: { in: companyIdsScope } },
          select: { id: true, name: true, companyId: true },
          orderBy: { name: "asc" },
        }),
        prisma.user.findMany({
          where: { companyId: { in: companyIdsScope } },
          select: { id: true, name: true, email: true, role: true, companyId: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  // Busca assinatura e nome do usuário logado direto do banco (evita JWT stale)
  const currentUser = session?.user as any;
  const userId: string | undefined = currentUser?.id;
  const dbUser = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, whatsappSignature: true },
      })
    : null;

  return (
    <WhatsappManager
      instances={instances as any}
      isSuperAdmin={isSuperAdmin}
      defaultCompanyId={companyId}
      conversations={conversationsEnriched as any}
      defaultPhone={defaultPhone}
      finalStageNames={finalStageNames}
      userSignature={dbUser?.whatsappSignature ?? ""}
      userName={dbUser?.name ?? currentUser?.name ?? ""}
      currentUserId={userId ?? ""}
      availableSetores={setores}
      availableAtendentes={atendentes}
    />
  );
}
