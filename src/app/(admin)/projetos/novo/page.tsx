import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import NovoProjetoForm from "./NovoProjetoForm";

export default async function NovoProjetoPage() {
  const session = await getEffectiveSession();
  if (!session) return null;

  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return (
      <div className="p-6">
        <p className="text-slate-500 text-sm">Apenas admin pode criar projetos.</p>
      </div>
    );
  }

  const where = role === "SUPER_ADMIN" ? {} : { companyId: userCompanyId };

  const [setores, clientCompanies] = await Promise.all([
    prisma.setor.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    role === "SUPER_ADMIN"
      ? prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : prisma.company.findMany({
          where:   { OR: [{ id: userCompanyId }, { parentCompanyId: userCompanyId }] },
          orderBy: { name: "asc" },
          select:  { id: true, name: true },
        }),
  ]);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-white font-bold text-xl">Novo projeto</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Cole o ID da lista do ClickUp e configure prazo + responsáveis.
        </p>
      </div>
      <NovoProjetoForm setores={setores} clientCompanies={clientCompanies} />
    </div>
  );
}
