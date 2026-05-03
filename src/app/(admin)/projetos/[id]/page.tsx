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
    />
  );
}
