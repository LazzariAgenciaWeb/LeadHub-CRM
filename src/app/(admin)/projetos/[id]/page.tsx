import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import ProjectDetail from "./ProjectDetail";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return null;

  const { id } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    include: {
      setor:         { select: { id: true, name: true, companyId: true } },
      clientCompany: { select: { id: true, name: true } },
      members:       { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (!project) notFound();

  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return (
      <div className="p-6">
        <p className="text-slate-500 text-sm">Sem permissão pra ver este projeto.</p>
      </div>
    );
  }

  // Lista de usuários do setor (pra adicionar como membro)
  const setorUsers = await prisma.setorUser.findMany({
    where:   { setorId: project.setor.id },
    include: { user: { select: { id: true, name: true } } },
  });

  // Últimas atividades de tarefas do ClickUp (histórico)
  const activities = await prisma.projectActivity.findMany({
    where:   { projectId: project.id },
    orderBy: { createdAt: "desc" },
    take:    30,
  });

  // Chamados agrupados neste projeto.
  const chamados = await prisma.ticket.findMany({
    where:   { projetoId: project.id },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    select: {
      id: true, title: true, status: true, priority: true, dueDate: true,
      clickupTaskId: true,
      assignee: { select: { id: true, name: true } },
    },
  });

  // Tarefas internas do LeadHub (fora do ClickUp).
  const internalTasksRaw = await prisma.projectTask.findMany({
    where:   { projectId: project.id },
    orderBy: [{ done: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    include: { assignee: { select: { id: true, name: true } } },
  });
  const internalTasks = internalTasksRaw.map((t) => ({
    id:           t.id,
    title:        t.title,
    description:  t.description,
    done:         t.done,
    priority:     t.priority as string,
    dueDate:      t.dueDate ? t.dueDate.toISOString() : null,
    assigneeName: t.assignee?.name ?? null,
  }));

  // Tarefas abertas (snapshot do último sync). Atrasadas primeiro, depois por
  // dueDate ascendente; tarefas sem prazo caem no final. Dedup: tasks que já
  // são de um chamado deste projeto aparecem na seção de Chamados, não aqui.
  const chamadoTaskIds = new Set(chamados.map((c) => c.clickupTaskId).filter(Boolean) as string[]);
  const openTasksRaw = (await prisma.projectTaskState.findMany({
    where: { projectId: project.id, isCompleted: false },
  })).filter((t) => !chamadoTaskIds.has(t.taskId));
  const openTasks = openTasksRaw
    .map((t) => ({
      id:         t.id,
      taskId:     t.taskId,
      name:       t.name,
      statusName: t.statusName,
      dueDate:    t.dueDate ? Number(t.dueDate) : null,
    }))
    .sort((a, b) => {
      if (a.dueDate === null && b.dueDate === null) return a.name.localeCompare(b.name);
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate - b.dueDate;
    });

  // Empresas disponíveis pra vincular como cliente do projeto
  const clientCompanies = role === "SUPER_ADMIN"
    ? await prisma.company.findMany({
        orderBy: { name: "asc" },
        select:  { id: true, name: true },
      })
    : await prisma.company.findMany({
        where: {
          OR: [
            { id: userCompanyId },
            { parentCompanyId: userCompanyId },
          ],
        },
        orderBy: { name: "asc" },
        select:  { id: true, name: true },
      });

  return (
    <ProjectDetail
      project={project as any}
      availableUsers={setorUsers.map((su) => su.user)}
      activities={activities}
      clientCompanies={clientCompanies}
      openTasks={openTasks}
      internalTasks={internalTasks}
      chamados={chamados.map((c) => ({
        id:           c.id,
        title:        c.title,
        status:       c.status,
        priority:     c.priority as string,
        dueDate:      c.dueDate ? c.dueDate.toISOString() : null,
        assigneeName: c.assignee?.name ?? null,
      }))}
    />
  );
}
