import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getViewer, projectVisibilityWhere } from "@/lib/visibility";
import Link from "next/link";
import { Plus } from "lucide-react";
import ProjetosViews, { type PV } from "./ProjetosViews";
import { readPref } from "@/lib/projetos-view-pref";
import SyncAllButton from "./SyncAllButton";
import SuperAdminCompanyGate from "@/components/SuperAdminCompanyGate";

export const dynamic = "force-dynamic";

export default async function ProjetosPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) return null;

  const role          = (session.user as any).role as string;
  const userId        = (session.user as any).id as string | undefined;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const isSuperAdmin  = role === "SUPER_ADMIN";

  // Super admin sem impersonar: projetos são por empresa — pede o cliente primeiro.
  if (isSuperAdmin) return <SuperAdminCompanyGate title="Projetos" />;

  const sp = await searchParams;
  const filterCompanyId = isSuperAdmin ? (sp.companyId ?? "") : (userCompanyId ?? "");

  const where: any = isSuperAdmin
    ? (filterCompanyId ? { setor: { companyId: filterCompanyId } } : {})
    : { setor: { companyId: userCompanyId } };

  // Visibilidade aberto/restrito
  const viewer = await getViewer(session);
  const visWhere = projectVisibilityWhere(viewer);
  if (visWhere) where.AND = [...(where.AND ?? []), visWhere];

  const projects = await prisma.setorClickupList.findMany({
    where,
    include: {
      setor:         { select: { id: true, name: true } },
      clientCompany: { select: { id: true, name: true } },
      members:       { include: { user: { select: { id: true, name: true } } } },
      contracts:     { select: { id: true, label: true, status: true, isRecurring: true, billingCycle: true } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });

  // Etapas e tarefas de cada projeto — o que importa é o andamento das TAREFAS
  // (o status do projeto é só a pasta). Campos leves: nada de comentários/anexos.
  const ids = projects.map((p) => p.id);
  const [steps, tasks, pref] = await Promise.all([
    ids.length
      ? prisma.projectService.findMany({
          where:   { projectId: { in: ids } },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select:  { id: true, projectId: true, name: true, order: true, service: { select: { name: true } } },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.projectTask.findMany({
          where:   { projectId: { in: ids }, ignoredAt: null },
          orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
          select: {
            id: true, projectId: true, title: true, status: true, done: true, dueDate: true,
            projectServiceId: true, updatedAt: true, approvalSentAt: true,
            assignee: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
    readPref(userId ?? ""),
  ]);

  const views: PV[] = projects.map((p) => {
    const pt = tasks.filter((t) => t.projectId === p.id);
    const last = Math.max(new Date(p.updatedAt).getTime(), ...pt.map((t) => t.updatedAt.getTime()));
    return {
      id: p.id, name: p.name, type: p.type, status: p.status, clickup: !!p.clickupListId,
      contracts: p.contracts.map((c) => ({ id: c.id, label: c.label, status: c.status, recurring: c.isRecurring, cycle: c.billingCycle })),
      setor: p.setor, client: p.clientCompany,
      dueDate: p.dueDate?.toISOString() ?? null,
      lastActivity: new Date(last).toISOString(),
      memberIds: p.members.map((m) => m.user.id),
      members: p.members.map((m) => m.user.name),
      steps: steps.filter((s) => s.projectId === p.id).map((s) => ({ id: s.id, name: s.name || s.service?.name || "Etapa" })),
      tasks: pt.map((t) => ({
        id: t.id, title: t.title, status: t.status, done: t.done,
        dueDate: t.dueDate?.toISOString() ?? null,
        stepId: t.projectServiceId,
        assigneeId: t.assignee?.id ?? null, assignee: t.assignee?.name ?? null,
        approvalSentAt: t.approvalSentAt?.toISOString() ?? null,
      })),
    };
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white font-bold text-xl">Projetos</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Tarefas vivem no ClickUp; o GoHub controla prazo, equipe e entrega.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SyncAllButton />
          <Link
            href="/projetos/novo"
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" /> Novo projeto
          </Link>
        </div>
      </div>

      <ProjetosViews
        items={views}
        pref={pref}
        currentUserId={userId ?? ""}
      />
    </div>
  );
}
