import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function EmpresasPage() {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "SUPER_ADMIN") redirect("/dashboard");

  const companies = await prisma.company.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { leads: true, campaigns: true, whatsappInstances: true },
      },
    },
  });

  const statusBadge = (status: string) =>
    status === "ACTIVE"
      ? "text-green-400 bg-green-500/12 border border-green-500/20"
      : "text-slate-400 bg-slate-500/10 border border-slate-500/20";

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white font-bold text-xl">Empresas</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {companies.length} empresa{companies.length !== 1 ? "s" : ""} cadastrada{companies.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/empresas/nova"
          className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
        >
          + Nova Empresa
        </Link>
      </div>

      {companies.length === 0 ? (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🏢</div>
          <div className="text-white font-semibold mb-1">Nenhuma empresa cadastrada</div>
          <div className="text-slate-500 text-sm mb-4">Cadastre sua primeira empresa para começar</div>
          <Link
            href="/empresas/nova"
            className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
          >
            + Nova Empresa
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {companies.map((company) => (
            <div
              key={company.id}
              className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 hover:border-indigo-500/50 transition-colors group"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-white font-bold text-[15px]">{company.name}</h2>
                  <p className="text-slate-500 text-xs mt-0.5">{company.segment ?? "Sem segmento"}</p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusBadge(company.status)}`}>
                  {company.status === "ACTIVE" ? "Ativo" : "Inativo"}
                </span>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-[#161f30] rounded-lg p-2.5 text-center">
                  <div className="text-white font-bold text-lg">{company._count.leads}</div>
                  <div className="text-slate-500 text-[10px]">Leads</div>
                </div>
                <div className="bg-[#161f30] rounded-lg p-2.5 text-center">
                  <div className="text-white font-bold text-lg">{company._count.campaigns}</div>
                  <div className="text-slate-500 text-[10px]">Campanhas</div>
                </div>
                <div className="bg-[#161f30] rounded-lg p-2.5 text-center">
                  <div className={`font-bold text-lg ${company._count.whatsappInstances > 0 ? "text-green-400" : "text-slate-500"}`}>
                    {company._count.whatsappInstances > 0 ? "✓" : "—"}
                  </div>
                  <div className="text-slate-500 text-[10px]">WhatsApp</div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-3 border-t border-[#1e2d45]">
                <Link
                  href={`/empresas/${company.id}`}
                  className="flex-1 text-center text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-xs font-semibold py-1.5 rounded-lg transition-colors"
                >
                  Ver Detalhes
                </Link>
                <Link
                  href={`/api/admin/impersonate/${company.id}`}
                  className="flex-1 text-center text-white bg-gradient-to-r from-indigo-500 to-purple-600 text-xs font-semibold py-1.5 rounded-lg hover:opacity-90 transition-opacity"
                >
                  👁 Acessar Painel →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
