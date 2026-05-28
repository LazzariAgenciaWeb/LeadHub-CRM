import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getViewer, projectVisibilityWhere } from "@/lib/visibility";
import Link from "next/link";
import { Plus } from "lucide-react";
import ProjetosBoard from "./ProjetosBoard";
import SyncAllButton from "./SyncAllButton";

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

  const sp = await searchParams;
  const filterCompanyId = isSuperAdmin ? (sp.companyId ?? "") : (userCompanyId ?? "");

  const where: any = isSuperAdmin
    ? (filterCompanyId ? { setor: { companyId: filterCompanyId } } : {})
    : { setor: { companyId: userCompanyId } };

  // Visibilidade aberto/restrito
  const viewer = await getViewer(session);
  const visWhere = projectVisibilityWhere(viewer);
  if (visWhere) where.AND = [...(where.AND ?? []), visWhere];

  const [projects, companies] = await Promise.all([
    prisma.setorClickupList.findMany({
      where,
      include: {
        setor:         { select: { id: true, name: true } },
        clientCompany: { select: { id: true, name: true } },
        members:       { include: { user: { select: { id: true, name: true } } } },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    }),
    isSuperAdmin
      ? prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white font-bold text-xl">Projetos</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Tarefas vivem no ClickUp; o LeadHub controla prazo, equipe e entrega.
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

      <ProjetosBoard
        projects={projects as any}
        currentUserId={userId ?? ""}
        isSuperAdmin={isSuperAdmin}
        companies={companies}
        filterCompanyId={filterCompanyId}
      />
    </div>
  );
}
