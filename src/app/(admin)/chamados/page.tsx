import { getEffectiveSession } from "@/lib/effective-session";


import { prisma } from "@/lib/prisma";
import Link from "next/link";

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  OPEN: { label: "Aberto", color: "text-indigo-400 bg-indigo-500/15", dot: "bg-indigo-400" },
  IN_PROGRESS: { label: "Em Andamento", color: "text-blue-400 bg-blue-500/15", dot: "bg-blue-400" },
  RESOLVED: { label: "Resolvido", color: "text-green-400 bg-green-500/15", dot: "bg-green-400" },
  CLOSED: { label: "Fechado", color: "text-slate-500 bg-slate-500/10", dot: "bg-slate-500" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  LOW: { label: "Baixa", color: "text-slate-400" },
  MEDIUM: { label: "Média", color: "text-yellow-400" },
  HIGH: { label: "Alta", color: "text-orange-400" },
  URGENT: { label: "Urgente", color: "text-red-400" },
};

const PRIORITY_ICON: Record<string, string> = {
  LOW: "🟢",
  MEDIUM: "🟡",
  HIGH: "🟠",
  URGENT: "🔴",
};

export default async function ChamadosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; companyId?: string }>;
}) {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const sp = await searchParams;
  const statusFilter = sp.status ?? "";
  const companyId = isSuperAdmin ? (sp.companyId ?? "") : (userCompanyId ?? "");

  const where: any = {};
  if (companyId) where.companyId = companyId;
  if (statusFilter) where.status = statusFilter;

  const [tickets, companies, statusCounts] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        company: { select: { id: true, name: true } },
        _count: { select: { messages: true } },
      },
    }),
    isSuperAdmin
      ? prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : [],
    prisma.ticket.groupBy({
      by: ["status"],
      where: companyId ? { companyId } : {},
      _count: true,
    }),
  ]);

  const countMap: Record<string, number> = {};
  for (const s of statusCounts) countMap[s.status] = s._count;
  const total = Object.values(countMap).reduce((a, b) => a + b, 0);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white font-bold text-xl">Chamados</h1>
          <p className="text-slate-500 text-sm mt-0.5">{total} chamado{total !== 1 ? "s" : ""} no total</p>
        </div>
        <Link
          href="/chamados/novo"
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
        >
          + Novo Chamado
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <Link
            key={key}
            href={`/chamados?status=${key}${companyId ? `&companyId=${companyId}` : ""}`}
            className={`rounded-xl p-4 border border-[#1e2d45] bg-[#0f1623] hover:border-white/10 transition-all ${statusFilter === key ? "ring-1 ring-indigo-500" : ""}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
              <span className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold">{cfg.label}</span>
            </div>
            <div className="text-2xl font-bold text-white">{countMap[key] ?? 0}</div>
          </Link>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 mb-4 flex flex-wrap gap-3">
        <form className="flex gap-3 flex-wrap">
          <select
            name="status"
            defaultValue={statusFilter}
            className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Todos os status</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
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
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            Filtrar
          </button>
          {(statusFilter || (isSuperAdmin && companyId)) && (
            <Link
              href="/chamados"
              className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 text-sm hover:text-white transition-colors"
            >
              Limpar
            </Link>
          )}
        </form>
      </div>

      {/* Tickets list */}
      {tickets.length === 0 ? (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🎫</div>
          <div className="text-white font-semibold mb-1">Nenhum chamado encontrado</div>
          <div className="text-slate-500 text-sm mb-4">Abra um chamado para solicitar suporte.</div>
          <Link
            href="/chamados/novo"
            className="inline-flex px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            + Novo Chamado
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((ticket) => {
            const s = STATUS_CONFIG[ticket.status];
            const p = PRIORITY_CONFIG[ticket.priority];
            return (
              <Link
                key={ticket.id}
                href={`/chamados/${ticket.id}`}
                className="flex items-center gap-4 bg-[#0f1623] border border-[#1e2d45] rounded-xl px-5 py-4 hover:border-white/10 transition-all group"
              >
                {/* Priority icon */}
                <span className="text-lg flex-shrink-0">{PRIORITY_ICON[ticket.priority]}</span>

                {/* Title + company */}
                <div className="flex-1 min-w-0">
                  <div className="text-white font-semibold text-sm group-hover:text-indigo-300 transition-colors truncate">
                    {ticket.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {isSuperAdmin && ticket.company && (
                      <span className="text-slate-500 text-[11px]">{ticket.company.name}</span>
                    )}
                    {ticket.category && (
                      <span className="text-slate-600 text-[11px] bg-white/5 px-1.5 py-0.5 rounded">
                        {ticket.category}
                      </span>
                    )}
                  </div>
                </div>

                {/* Priority */}
                <span className={`text-[11px] font-semibold flex-shrink-0 ${p.color}`}>
                  {p.label}
                </span>

                {/* Messages count */}
                <span className="text-slate-500 text-[11px] flex-shrink-0">
                  💬 {ticket._count.messages}
                </span>

                {/* Status */}
                <span className={`flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full ${s.color}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${s.dot}`} />
                  {s.label}
                </span>

                {/* Date */}
                <span className="text-slate-600 text-[11px] flex-shrink-0">
                  {new Date(ticket.createdAt).toLocaleDateString("pt-BR")}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
