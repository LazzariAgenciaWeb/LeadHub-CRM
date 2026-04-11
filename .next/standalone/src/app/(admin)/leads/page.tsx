import { getEffectiveSession } from "@/lib/effective-session";


import { prisma } from "@/lib/prisma";
import Link from "next/link";
import LeadsTable from "./LeadsTable";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; companyId?: string; campaignId?: string; page?: string }>;
}) {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const sp = await searchParams;
  const status = sp.status ?? "";
  const search = sp.search ?? "";
  const companyId = isSuperAdmin ? (sp.companyId ?? "") : (userCompanyId ?? "");
  const campaignId = sp.campaignId ?? "";
  const page = parseInt(sp.page ?? "1");
  const limit = 50;

  const where: any = {};
  if (companyId) where.companyId = companyId;
  if (status) where.status = status;
  if (campaignId) where.campaignId = campaignId;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { phone: { contains: search } },
      { email: { contains: search } },
    ];
  }

  const [leads, total, companies, campaigns] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        company: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
      },
    }),
    prisma.lead.count({ where }),
    isSuperAdmin ? prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    prisma.campaign.findMany({
      where: companyId ? { companyId } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Contagem por status para KPIs
  const statusCounts = await prisma.lead.groupBy({
    by: ["status"],
    where: companyId ? { companyId } : {},
    _count: true,
  });

  const countMap: Record<string, number> = {};
  for (const s of statusCounts) countMap[s.status] = s._count;

  const statusConfig = [
    { key: "NEW", label: "Novos", color: "indigo", icon: "🎯" },
    { key: "CONTACTED", label: "Em Contato", color: "blue", icon: "📞" },
    { key: "PROPOSAL", label: "Proposta", color: "yellow", icon: "📋" },
    { key: "CLOSED", label: "Fechados", color: "green", icon: "✅" },
    { key: "LOST", label: "Perdidos", color: "red", icon: "❌" },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white font-bold text-xl">Leads</h1>
          <p className="text-slate-500 text-sm mt-0.5">{total} lead{total !== 1 ? "s" : ""} encontrado{total !== 1 ? "s" : ""}</p>
        </div>
        <Link
          href="/pipeline"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-500/15 text-indigo-400 text-sm font-medium hover:bg-indigo-500/25 transition-colors"
        >
          📊 Ver Pipeline
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {statusConfig.map((s) => {
          const colorMap: Record<string, string> = {
            indigo: "border-indigo-500/30 bg-indigo-500/5",
            blue: "border-blue-500/30 bg-blue-500/5",
            yellow: "border-yellow-500/30 bg-yellow-500/5",
            green: "border-green-500/30 bg-green-500/5",
            red: "border-red-500/30 bg-red-500/5",
          };
          const textMap: Record<string, string> = {
            indigo: "text-indigo-400",
            blue: "text-blue-400",
            yellow: "text-yellow-400",
            green: "text-green-400",
            red: "text-red-400",
          };
          return (
            <Link
              key={s.key}
              href={`/leads?status=${s.key}${companyId ? `&companyId=${companyId}` : ""}`}
              className={`rounded-xl p-4 border cursor-pointer transition-all hover:scale-[1.02] ${colorMap[s.color]} ${status === s.key ? "ring-1 ring-" + s.color + "-500" : ""}`}
            >
              <div className="text-xl mb-1">{s.icon}</div>
              <div className={`text-2xl font-bold ${textMap[s.color]}`}>{countMap[s.key] ?? 0}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{s.label}</div>
            </Link>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 mb-4">
        <form className="flex flex-wrap gap-3">
          <input
            type="text"
            name="search"
            defaultValue={search}
            placeholder="Buscar por nome, telefone ou e-mail..."
            className="flex-1 min-w-[200px] bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
          <select
            name="status"
            defaultValue={status}
            className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Todos os status</option>
            <option value="NEW">Novo</option>
            <option value="CONTACTED">Em Contato</option>
            <option value="PROPOSAL">Proposta</option>
            <option value="CLOSED">Fechado</option>
            <option value="LOST">Perdido</option>
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
          <select
            name="campaignId"
            defaultValue={campaignId}
            className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Todas as campanhas</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            Filtrar
          </button>
          {(status || search || campaignId || (isSuperAdmin && companyId)) && (
            <Link
              href="/leads"
              className="px-4 py-2 rounded-lg bg-[#161f30] text-slate-400 text-sm font-medium hover:text-white transition-colors border border-[#1e2d45]"
            >
              Limpar
            </Link>
          )}
        </form>
      </div>

      {/* Table */}
      <LeadsTable
        leads={leads as any}
        isSuperAdmin={isSuperAdmin}
        total={total}
        page={page}
        limit={limit}
      />
    </div>
  );
}
