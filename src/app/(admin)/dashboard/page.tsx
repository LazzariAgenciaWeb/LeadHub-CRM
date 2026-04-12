import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import CRMCharts from "./CRMCharts";

export default async function DashboardPage() {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const companyId = (session?.user as any)?.companyId as string | undefined;

  const where = isSuperAdmin ? {} : { companyId };
  const linkWhere = isSuperAdmin ? {} : { companyId };

  const [leads, campaigns, messages, converted, totalLinkClicks] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.campaign.count({ where: { ...where, status: "ACTIVE" } }),
    prisma.message.count({ where: { ...where, direction: "INBOUND" } }),
    prisma.lead.count({ where: { ...where, status: "CLOSED" } }),
    prisma.trackingLink.aggregate({ where: linkWhere, _sum: { clicks: true } }),
  ]);

  const companies = isSuperAdmin
    ? await prisma.company.count({ where: { status: "ACTIVE" } })
    : null;

  const conversionRate = leads > 0 ? ((converted / leads) * 100).toFixed(1) : "0";

  // Dados CRM — funil e gráfico de linha
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const [prospeccaoCount, leadsCount, oportunidadesCount, crmDailyRaw] = await Promise.all([
    prisma.lead.count({ where: { ...where, pipeline: "PROSPECCAO" } }),
    prisma.lead.count({ where: { ...where, pipeline: "LEADS" } }),
    prisma.lead.count({ where: { ...where, pipeline: "OPORTUNIDADES" } }),
    prisma.lead.findMany({
      where: {
        ...where,
        pipeline: { in: ["PROSPECCAO", "LEADS", "OPORTUNIDADES"] },
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { createdAt: true, pipeline: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Monta série diária dos últimos 30 dias
  const dayMap: Record<string, { prospeccao: number; leads: number; oportunidades: number }> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo);
    d.setDate(d.getDate() + i);
    const key = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    dayMap[key] = { prospeccao: 0, leads: 0, oportunidades: 0 };
  }
  for (const row of crmDailyRaw) {
    const key = new Date(row.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    if (!dayMap[key]) continue;
    if (row.pipeline === "PROSPECCAO") dayMap[key].prospeccao++;
    else if (row.pipeline === "LEADS") dayMap[key].leads++;
    else if (row.pipeline === "OPORTUNIDADES") dayMap[key].oportunidades++;
  }
  const dailyData = Object.entries(dayMap).map(([date, v]) => ({ date, ...v }));

  // Últimos leads
  const recentLeads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 6,
    include: { company: { select: { name: true } } },
  });

  // Top 5 links por cliques
  const topLinks = await prisma.trackingLink.findMany({
    where: linkWhere,
    orderBy: { clicks: "desc" },
    take: 5,
    include: {
      campaign: { select: { name: true } },
      _count: { select: { clickEvents: true } },
    },
  });

  // Últimas mensagens WhatsApp
  const recentMessages = await prisma.message.findMany({
    where: { ...where, direction: "INBOUND" },
    orderBy: { receivedAt: "desc" },
    take: 5,
    include: { instance: { select: { instanceName: true } } },
  });

  const statusLabel: Record<string, { label: string; color: string }> = {
    NEW: { label: "Novo", color: "text-indigo-400 bg-indigo-500/15" },
    CONTACTED: { label: "Em Contato", color: "text-blue-400 bg-blue-500/15" },
    PROPOSAL: { label: "Proposta", color: "text-yellow-400 bg-yellow-500/15" },
    CLOSED: { label: "Fechado", color: "text-green-400 bg-green-500/15" },
    LOST: { label: "Perdido", color: "text-red-400 bg-red-500/10" },
  };

  const sourceLabel: Record<string, string> = {
    whatsapp: "💬 WhatsApp",
    instagram: "📸 Instagram",
    facebook: "👥 Facebook",
    google: "🔍 Google",
    link: "🔗 Link",
  };

  const totalClicksNum = totalLinkClicks._sum.clicks ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-white font-bold text-xl">
          Olá, {session?.user?.name?.split(" ")[0]} 👋
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {isSuperAdmin ? "Visão geral de todas as empresas" : "Painel da sua empresa"}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isSuperAdmin && (
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-t-xl" />
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Empresas</span>
              <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center text-sm">🏢</div>
            </div>
            <div className="text-2xl font-bold text-white">{companies}</div>
            <div className="text-[11px] text-green-400 mt-1">Ativas</div>
          </div>
        )}

        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-t-xl" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Total Leads</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center text-sm">🎯</div>
          </div>
          <div className="text-2xl font-bold text-white">{leads}</div>
          <div className="text-[11px] text-slate-500 mt-1">Todos os tempos</div>
        </div>

        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-green-500 rounded-t-xl" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Convertidos</span>
            <div className="w-8 h-8 rounded-lg bg-green-500/15 flex items-center justify-center text-sm">✅</div>
          </div>
          <div className="text-2xl font-bold text-white">{converted}</div>
          <div className="text-[11px] text-green-400 mt-1">{conversionRate}% de conversão</div>
        </div>

        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-xl" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Mensagens WA</span>
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center text-sm">💬</div>
          </div>
          <div className="text-2xl font-bold text-white">{messages}</div>
          <div className="text-[11px] text-blue-400 mt-1">Recebidas</div>
        </div>

        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-500 rounded-t-xl" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Campanhas</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-sm">📣</div>
          </div>
          <div className="text-2xl font-bold text-white">{campaigns}</div>
          <div className="text-[11px] text-amber-400 mt-1">Ativas</div>
        </div>

        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-orange-500 rounded-t-xl" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Cliques em Links</span>
            <div className="w-8 h-8 rounded-lg bg-orange-500/15 flex items-center justify-center text-sm">🔗</div>
          </div>
          <div className="text-2xl font-bold text-white">{totalClicksNum}</div>
          <div className="text-[11px] text-orange-400 mt-1">Todos os links</div>
        </div>
      </div>

      {/* Funil CRM + Gráfico de linha */}
      <CRMCharts
        funnel={{ prospeccao: prospeccaoCount, leads: leadsCount, oportunidades: oportunidadesCount }}
        dailyData={dailyData}
      />

      {/* Segunda linha: Links + Mensagens recentes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Top Links */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold text-sm">🔗 Links — Top cliques</h2>
            <Link href="/links" className="text-indigo-400 text-xs font-medium hover:underline">
              Ver todos →
            </Link>
          </div>

          {topLinks.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">🔗</div>
              <div className="text-slate-500 text-sm">Nenhum link criado ainda.</div>
              <Link href="/links" className="text-indigo-400 text-xs mt-1 inline-block hover:underline">Criar link →</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {topLinks.map((link, i) => {
                const maxClicks = topLinks[0].clicks || 1;
                const pct = Math.round((link.clicks / maxClicks) * 100);
                return (
                  <div key={link.id} className="flex items-center gap-3">
                    <span className="text-slate-600 text-[11px] w-4 text-right flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-slate-300 text-[12px] font-medium truncate">
                          {link.label ?? link.code}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <span className="text-white text-[12px] font-bold">{link.clicks}</span>
                          {link._count.clickEvents > 0 && (
                            <span className="text-amber-400 text-[10px]">+{link._count.clickEvents} int.</span>
                          )}
                        </div>
                      </div>
                      <div className="h-1 bg-[#1e2d45] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {link.campaign && (
                        <span className="text-slate-600 text-[10px]">📣 {link.campaign.name}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Mensagens recentes */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold text-sm">📥 Mensagens recentes</h2>
            <Link href="/whatsapp?tab=mensagens" className="text-indigo-400 text-xs font-medium hover:underline">
              Ver todas →
            </Link>
          </div>

          {recentMessages.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">📭</div>
              <div className="text-slate-500 text-sm">Nenhuma mensagem recebida ainda.</div>
              <Link href="/whatsapp" className="text-indigo-400 text-xs mt-1 inline-block hover:underline">Configurar WhatsApp →</Link>
            </div>
          ) : (
            <div className="space-y-1">
              {recentMessages.map((msg) => (
                <Link
                  key={msg.id}
                  href="/whatsapp?tab=mensagens"
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors group"
                >
                  <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center text-xs font-bold text-green-400 flex-shrink-0 mt-0.5">
                    {msg.phone.slice(-2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 text-[12px] font-medium">{msg.phone}</span>
                      <span className="text-slate-600 text-[10px] flex-shrink-0 ml-2">
                        {new Date(msg.receivedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-slate-500 text-[11px] truncate">{msg.body}</p>
                    {msg.instance && (
                      <span className="text-slate-700 text-[10px]">via {msg.instance.instanceName}</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Leads */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-sm">Leads Recentes</h2>
          <Link href="/leads" className="text-indigo-400 text-xs font-medium hover:underline">
            Ver todos →
          </Link>
        </div>

        {recentLeads.length === 0 ? (
          <div className="text-center py-10">
            <div className="text-3xl mb-2">🎯</div>
            <div className="text-slate-500 text-sm">Nenhum lead ainda.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e2d45]">
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Nome / Telefone</th>
                  {isSuperAdmin && (
                    <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Empresa</th>
                  )}
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Origem</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Status</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Entrada</th>
                </tr>
              </thead>
              <tbody>
                {recentLeads.map((lead) => {
                  const s = statusLabel[lead.status];
                  return (
                    <tr key={lead.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                      <td className="py-2.5 px-2">
                        <div className="text-white text-[13px] font-semibold">{lead.name ?? "Sem nome"}</div>
                        <div className="text-slate-500 text-[11px]">{lead.phone}</div>
                      </td>
                      {isSuperAdmin && (
                        <td className="py-2.5 px-2 text-slate-400 text-[12.5px]">{lead.company?.name}</td>
                      )}
                      <td className="py-2.5 px-2">
                        <span className="text-[11px]">
                          {sourceLabel[lead.source ?? ""] ?? lead.source ?? "—"}
                        </span>
                      </td>
                      <td className="py-2.5 px-2">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.color}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-slate-500 text-[11px]">
                        {new Date(lead.createdAt).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
