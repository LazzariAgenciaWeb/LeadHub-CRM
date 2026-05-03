import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Plus } from "lucide-react";
import ProjetosBoard from "./ProjetosBoard";

export const dynamic = "force-dynamic";

export default async function ProjetosPage() {
  const session = await getEffectiveSession();
  if (!session) return null;

  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const where = role === "SUPER_ADMIN"
    ? {}
    : { setor: { companyId: userCompanyId } };

  const projects = await prisma.setorClickupList.findMany({
    where,
    include: {
      setor:         { select: { id: true, name: true } },
      clientCompany: { select: { id: true, name: true } },
      members:       { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white font-bold text-xl">Projetos</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Tarefas vivem no ClickUp; o LeadHub controla prazo, equipe e entrega.
          </p>
        </div>
        <Link
          href="/projetos/novo"
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" /> Novo projeto
        </Link>
      </div>

      <ProjetosBoard projects={projects as any} />
    </div>
  );
}
