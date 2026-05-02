import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import TicketsBoard from "./TicketsBoard";

const DEFAULT_STAGES = [
  { id: "d0", name: "Novo",               color: "#6366f1", order: 0, isFinal: false },
  { id: "d1", name: "Em Análise",         color: "#8b5cf6", order: 1, isFinal: false },
  { id: "d2", name: "Aguardando Cliente", color: "#f59e0b", order: 2, isFinal: false },
  { id: "d3", name: "Em Execução",        color: "#3b82f6", order: 3, isFinal: false },
  { id: "d4", name: "Resolvido ✅",       color: "#22c55e", order: 4, isFinal: true  },
  { id: "d5", name: "Fechado",            color: "#64748b", order: 5, isFinal: true  },
];

export default async function ChamadosPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const sp = await searchParams;
  const filterCompanyId = isSuperAdmin ? (sp.companyId ?? "") : (userCompanyId ?? "");

  // Load stages for CHAMADOS
  let stages = await prisma.pipelineStageConfig.findMany({
    where: {
      pipeline: "CHAMADOS",
      ...(filterCompanyId ? { companyId: filterCompanyId } : {}),
    },
    orderBy: { order: "asc" },
  });

  // If SUPER_ADMIN, deduplicate by name
  if (isSuperAdmin && stages.length > 0) {
    const seen = new Set<string>();
    stages = stages.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
  }

  // Fallback to default if none configured
  if (stages.length === 0) {
    stages = DEFAULT_STAGES as any;
  }

  const where: any = {};
  if (filterCompanyId) where.companyId = filterCompanyId;

  const [tickets, companies] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      include: {
        company:       { select: { id: true, name: true } },
        clientCompany: { select: { id: true, name: true } },
        assignee:      { select: { id: true, name: true } },
        setor:         { select: { id: true, name: true } },
        _count:        { select: { messages: true } },
      },
    }),
    isSuperAdmin
      ? prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : [],
  ]);

  const currentUserId = (session?.user as any)?.id as string | undefined;

  const pipelineCompanyId = filterCompanyId || (
    isSuperAdmin ? (await prisma.company.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? "" : ""
  );

  return (
    <TicketsBoard
      tickets={tickets as any}
      stages={stages as any}
      isSuperAdmin={isSuperAdmin}
      companies={companies}
      filterCompanyId={filterCompanyId}
      pipelineCompanyId={pipelineCompanyId}
      currentUserId={currentUserId ?? ""}
    />
  );
}
