import { getEffectiveSession } from "@/lib/effective-session";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import TicketDetail from "./TicketDetail";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getEffectiveSession();
  const role = (session?.user as any)?.role as string;
  const isSuperAdmin = role === "SUPER_ADMIN";
  // canManage = quem pode editar campos do chamado (etapa, prioridade,
  // atendente, prazo, cliente, sincronizar ClickUp). Inclui:
  //   - SUPER_ADMIN / ADMIN da agência (sempre)
  //   - CLIENT-atendente com permissão canViewTickets (definida via setor)
  // Cliente final sem setor de tickets continua só conseguindo responder/fechar.
  const perms = await getUserPermissions(session);
  const canManage =
    role === "SUPER_ADMIN" || role === "ADMIN" || !!(perms?.canViewTickets);
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const { id } = await params;

  const ticketRaw = await prisma.ticket.findUnique({
    where: { id },
    include: {
      company:       { select: { id: true, name: true } },
      clientCompany: { select: { id: true, name: true, phone: true, email: true } },
      assignee:      { select: { id: true, name: true } },
      setor:         { select: { id: true, name: true } },
      // ATENÇÃO: NUNCA incluir mediaBase64 aqui. Em chamados com 10+ imagens
      // anexadas isso vira MB de base64 no SSR. UI consome `hasMedia` e busca
      // via /api/tickets/messages/[id]/media (browser cacheia).
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id:           true,
          body:         true,
          isInternal:   true,
          authorName:   true,
          authorRole:   true,
          mediaType:    true,
          source:       true,
          createdAt:    true,
          mediaBase64:  true, // só pra derivar hasMedia, removido abaixo
        },
      },
      activities: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!ticketRaw) notFound();
  if (!isSuperAdmin && ticketRaw.companyId !== userCompanyId) notFound();

  // Mapeia messages: remove o base64 e expõe só o flag.
  const ticket = {
    ...ticketRaw,
    messages: ticketRaw.messages.map(({ mediaBase64, ...rest }) => ({
      ...rest,
      hasMedia: !!mediaBase64,
    })),
  };

  // Janela do chamado para filtrar conversa WhatsApp:
  //   openedAt = createdAt
  //   closedAt = última STATUS_CHANGED para RESOLVED/CLOSED (se houver),
  //              senão fallback updatedAt. Só preenchido se o ticket está
  //              em status final — chamado aberto não tem corte superior.
  const isFinalStatus = ticketRaw.status === "RESOLVED" || ticketRaw.status === "CLOSED";
  let closedAt: Date | null = null;
  if (isFinalStatus) {
    const lastClose = [...ticketRaw.activities]
      .reverse()
      .find((a) => {
        if (a.type !== "STATUS_CHANGED") return false;
        const to = (a.meta as any)?.to;
        return to === "RESOLVED" || to === "CLOSED";
      });
    closedAt = lastClose?.createdAt ?? ticketRaw.updatedAt;
  }
  const openedAt = ticketRaw.createdAt;

  // Lookups para edição inline (cliente, atendente, setor)
  const lookupCompanyId = ticket.companyId;
  const [users, setores, clientCompanies] = await Promise.all([
    // Atendentes: usuários da empresa-agência (ADMIN ou CLIENT-atendente).
    // SUPER_ADMIN é dono da plataforma (Lazzari) — não deve aparecer como
    // atendente da agência. Mesmo padrão do fix de gamificação (b6bef12).
    prisma.user.findMany({
      where: {
        companyId: lookupCompanyId,
        role: { not: "SUPER_ADMIN" },
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.setor.findMany({
      where: { companyId: lookupCompanyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.company.findMany({
      where: { parentCompanyId: lookupCompanyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Detecta se a empresa-agência tem WhatsApp habilitado — usado pra mostrar
  // a aba "WhatsApp" no detalhe do chamado quando há telefone vinculado.
  const [whatsappInstanceCount, currentCompany] = await Promise.all([
    prisma.whatsappInstance.count({ where: { companyId: lookupCompanyId } }),
    prisma.company.findUnique({ where: { id: lookupCompanyId }, select: { moduleWhatsapp: true } }),
  ]);
  const whatsappEnabled =
    isSuperAdmin || (currentCompany?.moduleWhatsapp === true && whatsappInstanceCount > 0);

  // Load CHAMADOS stages
  const stagesWhere = isSuperAdmin
    ? { pipeline: "CHAMADOS" as const }
    : { pipeline: "CHAMADOS" as const, companyId: userCompanyId ?? "" };

  let stages = await prisma.pipelineStageConfig.findMany({
    where: stagesWhere,
    orderBy: { order: "asc" },
  });

  // Deduplicate for super admin
  if (isSuperAdmin) {
    const seen = new Set<string>();
    stages = stages.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
  }

  // Fallback default stages if none configured
  if (stages.length === 0) {
    stages = [
      { id: "d0", name: "Novo",               color: "#6366f1", order: 0, isFinal: false, pipeline: "CHAMADOS", companyId: "", createdAt: new Date(), updatedAt: new Date() },
      { id: "d1", name: "Em Análise",         color: "#8b5cf6", order: 1, isFinal: false, pipeline: "CHAMADOS", companyId: "", createdAt: new Date(), updatedAt: new Date() },
      { id: "d2", name: "Aguardando Cliente", color: "#f59e0b", order: 2, isFinal: false, pipeline: "CHAMADOS", companyId: "", createdAt: new Date(), updatedAt: new Date() },
      { id: "d3", name: "Em Execução",        color: "#3b82f6", order: 3, isFinal: false, pipeline: "CHAMADOS", companyId: "", createdAt: new Date(), updatedAt: new Date() },
      { id: "d4", name: "Resolvido ✅",       color: "#22c55e", order: 4, isFinal: true,  pipeline: "CHAMADOS", companyId: "", createdAt: new Date(), updatedAt: new Date() },
      { id: "d5", name: "Fechado",            color: "#64748b", order: 5, isFinal: true,  pipeline: "CHAMADOS", companyId: "", createdAt: new Date(), updatedAt: new Date() },
    ] as any;
  }

  return (
    <TicketDetail
      ticket={ticket as any}
      isSuperAdmin={isSuperAdmin}
      canManage={canManage}
      currentUserName={session?.user?.name ?? "Usuário"}
      stages={stages as any}
      users={users as any}
      setores={setores as any}
      clientCompanies={clientCompanies as any}
      whatsappEnabled={whatsappEnabled}
      whatsappWindow={{
        openedAt: openedAt.toISOString(),
        closedAt: closedAt ? closedAt.toISOString() : null,
      }}
    />
  );
}
