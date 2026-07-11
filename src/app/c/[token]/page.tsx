import { prisma } from "@/lib/prisma";
import { readChecklist } from "@/lib/checklist";
import ClientProjectPanel from "@/components/client-panel/ClientProjectPanel";

export const dynamic = "force-dynamic";

export default async function ClientePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const project = await prisma.setorClickupList.findUnique({
    where: { publicToken: token },
    select: {
      name: true, description: true,
      clientCompany: { select: { name: true } },
      internalTasks: {
        orderBy: [{ createdAt: "asc" }],
        select: { id: true, title: true, description: true, stage: true, checklist: true, done: true, startDate: true, dueDate: true },
      },
      materials: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, kind: true, taskId: true, title: true, docHtml: true, url: true, ata: true, stage: true },
      },
    },
  });

  if (!project) {
    return (
      <div style={{ minHeight: "100vh", background: "#06070C", color: "#727A8C", display: "grid", placeItems: "center", fontFamily: "system-ui,sans-serif", fontSize: 14 }}>
        Link inválido ou expirado.
      </div>
    );
  }

  const tasks = project.internalTasks.map((t) => ({
    id: t.id, title: t.title, description: t.description, stage: t.stage,
    checklist: readChecklist(t.checklist), done: t.done, startDate: t.startDate, dueDate: t.dueDate,
  }));

  return (
    <ClientProjectPanel
      name={project.name}
      description={project.description}
      clientName={project.clientCompany?.name ?? null}
      tasks={tasks}
      materials={project.materials}
    />
  );
}
