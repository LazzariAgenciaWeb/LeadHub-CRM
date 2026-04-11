import { getEffectiveSession } from "@/lib/effective-session";


import { prisma } from "@/lib/prisma";
import Link from "next/link";
import NewCampaignModal from "./NewCampaignModal";

const SOURCE_ICON: Record<string, string> = {
  WHATSAPP: "💬", INSTAGRAM: "📸", FACEBOOK: "👥", GOOGLE: "🔍", LINK: "🔗", OTHER: "📌",
};

export default async function CampanhasPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; status?: string }>;
}) {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const sp = await searchParams;
  const companyId = isSuperAdmin ? (sp.companyId ?? "") : (userCompanyId ?? "");
  const status = sp.status ?? "";

  const where: any = {};
  if (companyId) where.companyId = companyId;
  if (status) where.status = status;

  const [campaigns, companies] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        company: { select: { id: true, name: true } },
        _count: { select: { leads: true, messages: true, keywordRules: true } },
      },
    }),
    isSuperAdmin
      ? prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : [],
  ]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white font-bold text-xl">Campanhas</h1>
          <p className="text-slate-500 text-sm mt-0.5">{campaigns.length} campanha{campaigns.length !== 1 ? "s" : ""}</p>
        </div>
        <NewCampaignModal
          isSuperAdmin={isSuperAdmin}
          companies={companies}
          defaultCompanyId={!isSuperAdmin ? userCompanyId : undefined}
        />
      </div>

      {/* Filters */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 mb-4">
        <form className="flex flex-wrap gap-3">
          <select
            name="status"
            defaultValue={status}
            className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Todos os status</option>
            <option value="ACTIVE">Ativa</option>
            <option value="PAUSED">Pausada</option>
            <option value="FINISHED">Encerrada</option>
          </select>
          {isSuperAdmin && (
            <select
              name="companyId"
              defaultValue={companyId}
              className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">Todas as empresas</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <button type="submit" className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors">
            Filtrar
          </button>
        </form>
      </div>

      {campaigns.length === 0 ? (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">📣</div>
          <div className="text-white font-semibold">Nenhuma campanha encontrada</div>
        </div>
      ) : (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e2d45]">
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Campanha</th>
                {isSuperAdmin && <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Empresa</th>}
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Origem</th>
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Status</th>
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Leads</th>
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Gatilhos</th>
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Criada</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/campanhas/${c.id}`} className="text-white text-[13px] font-semibold hover:text-indigo-300 transition-colors">
                      {c.name}
                    </Link>
                    {c.description && (
                      <div className="text-slate-500 text-[11px] truncate max-w-[180px]">{c.description}</div>
                    )}
                  </td>
                  {isSuperAdmin && (
                    <td className="px-4 py-3 text-slate-400 text-[12.5px]">{c.company.name}</td>
                  )}
                  <td className="px-4 py-3">
                    <span className="text-base">{SOURCE_ICON[c.source]}</span>
                    <span className="text-slate-500 text-[11px] ml-1">{c.source}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      c.status === "ACTIVE" ? "text-green-400 bg-green-500/15"
                      : c.status === "PAUSED" ? "text-yellow-400 bg-yellow-500/15"
                      : "text-slate-400 bg-slate-500/10"
                    }`}>
                      {c.status === "ACTIVE" ? "Ativa" : c.status === "PAUSED" ? "Pausada" : "Encerrada"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white font-semibold text-sm">{c._count.leads}</td>
                  <td className="px-4 py-3">
                    {c._count.keywordRules > 0 ? (
                      <span className="text-indigo-400 text-[11px] font-semibold">⚡ {c._count.keywordRules}</span>
                    ) : (
                      <span className="text-slate-600 text-[11px]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-[11px]">
                    {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
