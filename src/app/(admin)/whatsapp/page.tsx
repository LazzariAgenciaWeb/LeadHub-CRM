import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getUserPermissions } from "@/lib/user-permissions";
import { hasModule } from "@/lib/permissions";
import { getTeamNumbers } from "@/lib/whatsapp";
import { getHiddenInstanceIds, conversationVisibilityAnd } from "@/lib/whatsapp-visibility";
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
      label: true,
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

  // Visibilidade: esconde conversas de instâncias privadas de outro dono e as
  // bloqueadas (syncBlocked). Vale pra todos, inclusive admins.
  const hiddenInstanceIds = await getHiddenInstanceIds(session);
  convFilter.AND = [
    ...(convFilter.AND ?? []),
    ...conversationVisibilityAnd({ hiddenIds: hiddenInstanceIds }),
  ];

  // Carga inicial enxuta (50) — o enriquecimento por conversa (lastMsg, lead,
  // counts, contact) custa ~5 queries cada, então 50 abre rápido. O resto vem
  // por "carregar mais" (scroll → /api/conversations/list) e a busca por
  // nome/telefone cobre o histórico inteiro via /api/conversations/search.
  const PAGE_SIZE = 50;
  const convRecords = await prisma.conversation.findMany({
    where: convFilter,
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: PAGE_SIZE,
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

  // Página crua veio cheia → provavelmente há mais conversas pra "carregar mais"
  const initialHasMore = convRecords.length === PAGE_SIZE;

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
      const [lastMsg, lead, companyContact, lastOutbound] = await Promise.all([
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
        // Última mensagem NOSSA (OUTBOUND) — usada pra saber se quem falou por
        // último foi o agente de IA (rawPayload.autoAgent) e ninguém humano
        // respondeu depois. Alimenta o filtro "IA" (precisa assumir/finalizar).
        prisma.message.findFirst({
          where: { conversationId: conv.id, direction: "OUTBOUND" },
          orderBy: { receivedAt: "desc" },
          select: { rawPayload: true },
        }),
      ]);
      const lastOutboundByAI = !!((lastOutbound?.rawPayload as any)?.autoAgent);
      return {
        phone: conv.phone,
        companyId: conv.companyId,
        lastMsg,
        lead,
        companyContact,
        lastOutboundByAI,
        conversation: {
          id: conv.id,
          status: conv.status,
          statusUpdatedAt: conv.statusUpdatedAt,
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

  const conversationsEnriched = conversations;

  const finalStageConfigs = await prisma.pipelineStageConfig.findMany({
    where: { isFinal: true, ...(companyId ? { companyId } : {}) },
    select: { name: true },
  });
  const finalStageNames = [...new Set(finalStageConfigs.map((s) => s.name))];

  // Etapas completas dos pipelines — usado pra mover o lead de etapa direto
  // da conversa (barra de ações, incl. modo Visão). Filtra por empresa quando
  // há companyId; client-side o componente filtra de novo por conversa.
  const pipelineStages = await prisma.pipelineStageConfig.findMany({
    where: { ...(companyId ? { companyId } : {}) },
    select: { pipeline: true, name: true, color: true, order: true, isFinal: true, companyId: true },
    orderBy: [{ pipeline: "asc" }, { order: "asc" }],
  });

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
        select: { name: true, whatsappSignature: true, whatsappSignatureDefault: true },
      })
    : null;

  // Números da equipe (celulares nossos que não são instâncias) — usados para
  // reconhecer, em grupos, mensagens desses números como OUTBOUND (nosso lado).
  const teamNumbers = companyId ? await getTeamNumbers(companyId) : [];

  // Modo de atendimento da empresa do usuário (VISAO = read-only, sem envio
  // pelo painel). SUPER_ADMIN sempre opera em ATENDE pois é admin do sistema
  // (não-cliente). Quando o user logado é de uma empresa-cliente em VISAO, o
  // formulário de envio é escondido.
  const modoAtendimento: "VISAO" | "ATENDE" = isSuperAdmin
    ? "ATENDE"
    : userCompanyId
      ? ((await prisma.company.findUnique({
          where: { id: userCompanyId },
          select: { modoAtendimento: true },
        }))?.modoAtendimento ?? "ATENDE")
      : "ATENDE";

  return (
    <WhatsappManager
      instances={instances as any}
      isSuperAdmin={isSuperAdmin}
      defaultCompanyId={companyId}
      conversations={conversationsEnriched as any}
      initialHasMore={initialHasMore}
      defaultPhone={defaultPhone}
      finalStageNames={finalStageNames}
      pipelineStages={pipelineStages}
      userSignature={dbUser?.whatsappSignature ?? ""}
      userSignatureDefault={dbUser?.whatsappSignatureDefault ?? true}
      userName={dbUser?.name ?? currentUser?.name ?? ""}
      hasCrmModule={hasModule(session, "crm")}
      hasTicketsModule={hasModule(session, "tickets")}
      currentUserId={userId ?? ""}
      canManageGamification={isSuperAdmin || !!perms?.isAdmin || !!(session?.user as any)?.permissions?.canManageUsers}
      availableSetores={setores}
      availableAtendentes={atendentes}
      modoAtendimento={modoAtendimento}
      teamNumbers={teamNumbers}
    />
  );
}
