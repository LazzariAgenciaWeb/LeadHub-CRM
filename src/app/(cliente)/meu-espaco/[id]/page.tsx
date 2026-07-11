import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { readChecklist, readComments } from "@/lib/checklist";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import ClientProjectPanel from "@/components/client-panel/ClientProjectPanel";

export const dynamic = "force-dynamic";

export default async function MeuEspacoProjetoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getEffectiveSession();
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;

  if (!companyId || role === "SUPER_ADMIN") redirect("/dashboard");

  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    select: {
      name: true, description: true, clientCompanyId: true,
      clientCompany: { select: { name: true } },
      internalTasks: {
        orderBy: [{ createdAt: "asc" }],
        select: { id: true, title: true, description: true, stage: true, checklist: true, comments: true, done: true, startDate: true, dueDate: true },
      },
      materials: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, kind: true, taskId: true, title: true, docHtml: true, url: true, ata: true, stage: true },
      },
    },
  });

  // Escopo de segurança: só o próprio cliente (dono) vê o projeto.
  if (!project || project.clientCompanyId !== companyId) notFound();

  const tasks = project.internalTasks.map((t) => ({
    id: t.id, title: t.title, description: t.description, stage: t.stage,
    checklist: readChecklist(t.checklist), comments: readComments(t.comments), done: t.done, startDate: t.startDate, dueDate: t.dueDate,
  }));

  return (
    <div>
      <Link href="/meu-espaco" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#AFB6C6", textDecoration: "none", marginBottom: 6 }}>
        ← Meus serviços
      </Link>
      <ClientProjectPanel
        name={project.name}
        description={project.description}
        clientName={project.clientCompany?.name ?? null}
        tasks={tasks}
        materials={project.materials}
        embedded
      />
    </div>
  );
}
