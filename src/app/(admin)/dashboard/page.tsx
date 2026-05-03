import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import CRMCharts from "./CRMCharts";
import UnansweredWidget from "./UnansweredWidget";
import AtendimentoStats from "./AtendimentoStats";
import PerformanceTeaser from "./PerformanceTeaser";
import DashboardGamificacaoTop from "./DashboardGamificacaoTop";

export default async function DashboardPage() {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const companyId = (session?.user as any)?.companyId as string | undefined;

  const where    = isSuperAdmin ? {} : { companyId };
  const linkWhere = isSuperAdmin ? {} : { companyId };

  // Contagens separadas por pipeline
  const [
    prospeccaoCount,
    leadsCount,
    oportunidadesCount,
    campaigns,
    messages,
    totalLinkClicks,
  ] = await Promise.all([
    prisma.lead.count({ where: { ...where, pipeline: "PROSPECCAO" } }),
    prisma.lead.count({ where: { ...where, pipeline: "LEADS" } }),
    prisma.lead.count({ where: { ...where, pipeline: "OPORTUNIDADES" } }),
    prisma.campaign.count({ where: { ...where, status: "ACTIVE" } }),
    prisma.message.count({ where: { ...where, direction: "INBOUND" } }),
    prisma.trackingLink.aggregate({ where: linkWhere, _sum: { clicks: true } }),
  ]);

  // Vendas = oportunidades em etapas finais positivas (não Perdido)
  const wonStages = await prisma.pipelineStageConfig.findMany({
    where: {
      ...(isSuperAdmin ? {} : { companyId }),
      pipeline: "OPORTUNIDADES",
      isFinal: true,
      NOT: [
        { name: { contains: "Perdido" } },
        { name: { contains: "perdido" } },
        { name: { contains: "❌" } },
      ],
    },
    select: { name: true },
  });
  const vendas = wonStages.length > 0
    ? await prisma.lead.count({
        where: { ...where, pipeline: "OPORTUNIDADES", pipelineStage: { in: wonStages.map(s => s.name) } },
      })
    : 0;

  const companies = isSuperAdmin
    ? await prisma.company.count({ where: { status: "ACTIVE" } })
    : null;

  // Série diária 30 dias
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const crmDailyRaw = await prisma.lead.findMany({
    where: {
      ...where,
      pipeline: { in: ["PROSPECCAO", "LEADS", "OPORTUNIDADES"] },
      createdAt: { gte: thirtyDaysAgo },
    },
    select: { createdAt: true, pipeline: true, pipelineStage: true },
    orderBy: { createdAt: "asc" },
  });

  const wonStageNames = new Set(wonStages.map(s => s.name));
  const dayMap: Record<string, { prospeccao: number; leads: number; oportunidades: number; vendas: number }> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo);
    d.setDate(d.getDate() + i);
    const key = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    dayMap[key] = { prospeccao: 0, leads: 0, oportunidades: 0, vendas: 0 };
  }
  for (const row of crmDailyRaw) {
    const key = new Date(row.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    if (!dayMap[key]) continue;
    if (row.pipeline === "PROSPECCAO") dayMap[key].prospeccao++;
    else if (row.pipeline === "LEADS") dayMap[key].leads++;
    else if (row.pipeline === "OPORTUNIDADES") {
      dayMap[key].oportunidades++;
      if (row.pipelineStage && wonStageNames.has(row.pipelineStage)) dayMap[key].vendas++;
    }
  }
  const dailyData = Object.entries(dayMap).map(([date, v]) => ({ date, ...v }));

  // Mensagens agrupadas por contato (última msg por telefone)
  const allRecentMsgs = await prisma.message.findMany({
    where: { ...where, direction: "INBOUND" },
    orderBy: { receivedAt: "desc" },
    take: 60,
    include: {
      instance: { select: { instanceName: true } },
    },
  });
  // Deduplicar por phone mantendo a mais recente
  const seenPhones = new Set<string>();
  const recentMessages = allRecentMsgs.filter((m) => {
    if (seenPhones.has(m.phone)) return false;
    seenPhones.add(m.phone);
    return true;
  }).slice(0, 8);

  // Resolve nomes por phone (mais confiável que message.leadId)
  const recentPhones = recentMessages.map((m) => m.phone);
  const [leadsForMsgs, contactsForMsgs] = await Promise.all([
    prisma.lead.findMany({
      where: { phone: { in: recentPhones }, ...where },
      orderBy: { createdAt: "desc" },
      select: { phone: true, name: true },
    }),
    prisma.companyContact.findMany({
      where: { phone: { in: recentPhones } },
      select: { phone: true, name: true },
    }),
  ]);
  // Mantém apenas o primeiro nome encontrado por phone (mais recente = primeiro do orderBy desc)
  const leadNameByPhone = new Map<string, string>();
  for (const l of leadsForMsgs) {
    if (l.name && !leadNameByPhone.has(l.phone)) leadNameByPhone.set(l.phone, l.name);
  }
  const contactNameByPhone = new Map<string, string>();
  for (const c of contactsForMsgs) {
    if (c.name && !contactNameByPhone.has(c.phone)) contactNameByPhone.set(c.phone, c.name);
  }

  function resolveDisplayName(phone: string): string {
    if (leadNameByPhone.has(phone)) return leadNameByPhone.get(phone)!;
    if (contactNameByPhone.has(phone)) return contactNameByPhone.get(phone)!;
    // Grupo @g.us → mostra só os últimos dígitos
    if (phone.includes("@g.us")) return `Grupo (…${phone.replace("@g.us", "").slice(-6)})`;
    return phone;
  }

  // Top 5 links
  const topLinks = await prisma.trackingLink.findMany({
    where: linkWhere,
    orderBy: { clicks: "desc" },
    take: 5,
    include: {
      campaign: { select: { name: true } },
      _count: { select: { clickEvents: true } },
    },
  });

  // Leads recentes (só pipeline LEADS e OPORTUNIDADES para a tabela)
  const recentLeads = await prisma.lead.findMany({
    where: { ...where, pipeline: { in: ["LEADS", "OPORTUNIDADES"] } },
    orderBy: { createdAt: "desc" },
    take: 6,
    include: { company: { select: { name: true } } },
  });

  // Conversas aguardando resposta (última mensagem é INBOUND)
  // Pega conversas agrupadas por phone+companyId ordenadas pela mais recente
  const phoneGroups = await prisma.message.groupBy({
    by: ["phone", "companyId"],
    where: { ...where },
    _max: { receivedAt: true },
    orderBy: { _max: { receivedAt: "desc" } },
    take: 100,
  });
  // Para cada conversa, pega a última mensagem e verifica se é INBOUND
  const unansweredConvs: Array<{
    phone: string; companyId: string; companyName: string | null;
    leadName: string | null; leadId: string | null;
    pipeline: string | null; pipelineStage: string | null; attendanceStatus: string | null;
    lastMsgBody: string; lastMsgAt: string; instanceName: string | null;
  }> = [];
  for (const g of phoneGroups) {
    if (unansweredConvs.length >= 10) break;
    const isGroup = g.phone.includes("@g.us");
    if (isGroup) continue;

    // Lead buscado por phone (fonte correta do attendanceStatus)
    // A mensagem pode ter leadId=null ou apontar para lead antigo
    const [lastMsg, lead] = await Promise.all([
      prisma.message.findFirst({
        where: { phone: g.phone, companyId: g.companyId },
        orderBy: { receivedAt: "desc" },
        include: {
          instance: { select: { instanceName: true } },
          company: { select: { name: true } },
        },
      }),
      prisma.lead.findFirst({
        where: { phone: g.phone, companyId: g.companyId },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, pipeline: true, pipelineStage: true, attendanceStatus: true },
      }),
    ]);

    if (!lastMsg || lastMsg.direction !== "INBOUND") continue;
    const atStatus = lead?.attendanceStatus;
    const resolved = atStatus === "RESOLVED" || atStatus === "CLOSED";
    if (resolved) continue;

    unansweredConvs.push({
      phone: g.phone,
      companyId: g.companyId,
      companyName: lastMsg.company?.name ?? null,
      leadName: lead?.name ?? null,
      leadId: lead?.id ?? null,
      pipeline: lead?.pipeline ?? null,
      pipelineStage: lead?.pipelineStage ?? null,
      attendanceStatus: atStatus ?? null,
      lastMsgBody: lastMsg.body,
      lastMsgAt: lastMsg.receivedAt.toISOString(),
      instanceName: lastMsg.instance?.instanceName ?? null,
    });
  }

  const pipelineLabel: Record<string, { label: string; color: string }> = {
    PROSPECCAO:    { label: "Prospect",    color: "text-violet-400 bg-violet-500/15" },
    LEADS:         { label: "Lead",        color: "text-indigo-400 bg-indigo-500/15" },
    OPORTUNIDADES: { label: "Oportunidade", color: "text-amber-400 bg-amber-500/15" },
  };

  const sourceLabel: Record<string, string> = {
    whatsapp: "💬", instagram: "📸", facebook: "👥", google: "🔍", link: "🔗", bdr: "🤖", manual: "✍️",
  };

  const totalClicksNum = totalLinkClicks._sum.clicks ?? 0;

  // KPI card helper
  const KPI = ({
    label, value, sub, subColor, barColor, href, icon,
  }: {
    label: string; value: number | string | null; sub: string;
    subColor?: string; barColor: string; href: string; icon: string;
  }) => (
    <Link href={href} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 relative overflow-hidden hover:border-white/20 transition-colors group block">
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${barColor} rounded-t-xl`} />
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</span>
        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-sm group-hover:bg-white/10 transition-colors">{icon}</div>
      </div>
      <div className="text-2xl font-bold text-white">{value ?? "—"}</div>
      <div className={`text-[11px] mt-1 ${subColor ?? "text-slate-500"}`}>{sub}</div>
    </Link>
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-white font-bold text-xl">Olá, {session?.user?.name?.split(" ")[0]} 👋</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {isSuperAdmin ? "Visão geral de todas as empresas" : "Painel da sua empresa"}
        </p>
      </div>

      {/* Conquistas (medalhões) + ranking lateral — primeira coisa que se vê */}
      <DashboardGamificacaoTop />

      {/* Próxima conquista + ações que dão pontos agora */}
      <PerformanceTeaser />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isSuperAdmin && (
          <KPI label="Empresas"    value={companies}         sub="Ativas"          subColor="text-green-400"  barColor="bg-gradient-to-r from-indigo-500 to-purple-600" href="/empresas"         icon="🏢" />
        )}
        <KPI label="Prospectos"   value={prospeccaoCount}   sub="No BDR"          subColor="text-violet-400" barColor="bg-violet-500"   href="/crm/prospeccao"  icon="🔎" />
        <KPI label="Leads"        value={leadsCount}         sub="Em qualificação" subColor="text-blue-400"   barColor="bg-blue-500"     href="/crm/leads"       icon="🎯" />
        <KPI label="Oportunidades" value={oportunidadesCount} sub="Em negociação"  subColor="text-amber-400"  barColor="bg-amber-500"    href="/crm/oportunidades" icon="💡" />
        <KPI label="Vendas"       value={vendas}             sub="Oport. fechadas" subColor="text-green-400"  barColor="bg-green-500"    href="/crm/oportunidades" icon="🏆" />
        <KPI label="Mensagens WA" value={messages}           sub="Recebidas"       subColor="text-cyan-400"   barColor="bg-cyan-500"     href="/whatsapp"        icon="💬" />
        <KPI label="Campanhas"    value={campaigns}          sub="Ativas"          subColor="text-amber-400"  barColor="bg-amber-500"    href="/campanhas"       icon="📣" />
        <KPI label="Cliques"      value={totalClicksNum}     sub="Em todos os links" subColor="text-orange-400" barColor="bg-orange-500" href="/links"           icon="🔗" />
      </div>

      {/* KPIs de Atendimento (Sprint 4) */}
      <AtendimentoStats />

      {/* Conversas aguardando resposta */}
      {unansweredConvs.length > 0 && (
        <UnansweredWidget initialConvs={unansweredConvs} />
      )}

      {/* Funil + Gráfico */}
      <CRMCharts
        funnel={{ prospeccao: prospeccaoCount, leads: leadsCount, oportunidades: oportunidadesCount, vendas }}
        dailyData={dailyData}
      />

      {/* Links + Mensagens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Top Links */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold text-sm">🔗 Links — Top cliques</h2>
            <Link href="/links" className="text-indigo-400 text-xs font-medium hover:underline">Ver todos →</Link>
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
                  <Link key={link.id} href="/links" className="flex items-center gap-3 hover:bg-white/[0.02] rounded-lg px-1 py-0.5 transition-colors">
                    <span className="text-slate-600 text-[11px] w-4 text-right flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-slate-300 text-[12px] font-medium truncate">{link.label ?? link.code}</span>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <span className="text-white text-[12px] font-bold">{link.clicks}</span>
                          {link._count.clickEvents > 0 && (
                            <span className="text-amber-400 text-[10px]">+{link._count.clickEvents} int.</span>
                          )}
                        </div>
                      </div>
                      <div className="h-1 bg-[#1e2d45] rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      {link.campaign && <span className="text-slate-600 text-[10px]">📣 {link.campaign.name}</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Mensagens por contato */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold text-sm">📥 Mensagens recentes</h2>
            <Link href="/whatsapp" className="text-indigo-400 text-xs font-medium hover:underline">Ver todas →</Link>
          </div>
          {recentMessages.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">📭</div>
              <div className="text-slate-500 text-sm">Nenhuma mensagem recebida ainda.</div>
            </div>
          ) : (
            <div className="space-y-1">
              {recentMessages.map((msg) => {
                const displayName = resolveDisplayName(msg.phone);
                const isGroup = msg.phone.includes("@g.us");
                return (
                  <Link
                    key={msg.id}
                    href={isGroup ? "/whatsapp" : `/whatsapp?abrir=${encodeURIComponent(msg.phone)}`}
                    className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center text-xs font-bold text-green-400 flex-shrink-0 mt-0.5">
                      {displayName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300 text-[12px] font-medium truncate">
                          {displayName}
                        </span>
                        <span className="text-slate-600 text-[10px] flex-shrink-0 ml-2">
                          {new Date(msg.receivedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                          {" "}
                          {new Date(msg.receivedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-slate-500 text-[11px] truncate">{msg.body}</p>
                      {msg.instance && <span className="text-slate-700 text-[10px]">via {msg.instance.instanceName}</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Leads/Oportunidades recentes */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-sm">🎯 Leads & Oportunidades recentes</h2>
          <Link href="/crm/leads" className="text-indigo-400 text-xs font-medium hover:underline">Ver CRM →</Link>
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
                  {isSuperAdmin && <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Empresa</th>}
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Origem</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Pipeline</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Etapa</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Entrada</th>
                </tr>
              </thead>
              <tbody>
                {recentLeads.map((lead) => {
                  const pl = pipelineLabel[lead.pipeline ?? ""] ?? { label: lead.pipeline ?? "—", color: "text-slate-400 bg-slate-500/10" };
                  return (
                    <tr key={lead.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                      <td className="py-2.5 px-2">
                        <div className="text-white text-[13px] font-semibold">{lead.name ?? "Sem nome"}</div>
                        <div className="text-slate-500 text-[11px]">{lead.phone}</div>
                      </td>
                      {isSuperAdmin && <td className="py-2.5 px-2 text-slate-400 text-[12.5px]">{lead.company?.name}</td>}
                      <td className="py-2.5 px-2 text-[13px]">{sourceLabel[lead.source ?? ""] ?? lead.source ?? "—"}</td>
                      <td className="py-2.5 px-2">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${pl.color}`}>{pl.label}</span>
                      </td>
                      <td className="py-2.5 px-2 text-slate-400 text-[11px] truncate max-w-[120px]">{lead.pipelineStage ?? "—"}</td>
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
