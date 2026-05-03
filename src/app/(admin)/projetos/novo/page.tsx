import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import NovoProjetoForm from "./NovoProjetoForm";

export default async function NovoProjetoPage() {
  const session = await getEffectiveSession();
  if (!session) return null;

  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  // Sem companyId não dá pra criar projeto. Caso contrário, qualquer usuário
  // logado da empresa pode criar projetos pros setores da empresa.
  if (!userCompanyId && role !== "SUPER_ADMIN") {
    return (
      <div className="p-6">
        <p className="text-slate-500 text-sm">Você precisa estar vinculado a uma empresa pra criar projetos.</p>
      </div>
    );
  }

  const where = role === "SUPER_ADMIN" ? {} : { companyId: userCompanyId };

  const [setoresWithUsers, clientCompanies] = await Promise.all([
    prisma.setor.findMany({
      where,
      orderBy: { name: "asc" },
      select: {
        id:    true,
        name:  true,
        users: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    }),
    role === "SUPER_ADMIN"
      ? prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : prisma.company.findMany({
          where:   { OR: [{ id: userCompanyId }, { parentCompanyId: userCompanyId }] },
          orderBy: { name: "asc" },
          select:  { id: true, name: true },
        }),
  ]);

  // Lista de setor com usuários flatten — pra mostrar no multi-select
  const setores = setoresWithUsers.map((s) => ({
    id:    s.id,
    name:  s.name,
    users: s.users.map((su) => ({ id: su.user.id, name: su.user.name })),
  }));

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
