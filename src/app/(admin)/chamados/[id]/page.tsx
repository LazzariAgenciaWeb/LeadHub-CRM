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

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      company:       { select: { id: true, name: true } },
      clientCompany: { select: { id: true, name: true, phone: true, email: true } },
      assignee:      { select: { id: true, name: true } },
      setor:         { select: { id: true, name: true } },
      messages:      { orderBy: { createdAt: "asc" } },
      activities:    { orderBy: { createdAt: "asc" } },
    },
  });

  if (!ticket) notFound();
  if (!isSuperAdmin && ticket.companyId !== userCompanyId) notFound();

  // Lookups para edição inline (cliente, atendente, setor)
  const lookupCompanyId = ticket.companyId;
  const [users, setores, clientCompanies] = await Promise.all([
    // Atendentes: qualquer usuário da empresa-agência (ADMIN, SUPER_ADMIN
    // ou CLIENT-agente) + SUPER_ADMINs sem company vinculada (escopo global).
    prisma.user.findMany({
      where: {
        OR: [
          { companyId: lookupCompanyId },
          { role: "SUPER_ADMIN" },
        ],
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
    />
  );
}
