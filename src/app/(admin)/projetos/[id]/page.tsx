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

  return (
    <ProjectDetail
      project={project as any}
      availableUsers={setorUsers.map((su) => su.user)}
    />
  );
}
