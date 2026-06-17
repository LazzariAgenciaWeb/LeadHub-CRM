import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getLeadFollowUps, STALE_AFTER_DAYS } from "@/lib/calendar-data";
import { redirect } from "next/navigation";
import Link from "next/link";
import FollowUpsToday from "../dashboard/FollowUpsToday";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function timeSince(d: Date | string | null): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "agora";
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

const PIPELINE_HREF: Record<string, string> = {
  PROSPECCAO: "/crm/prospeccao",
  LEADS: "/crm/leads",
  OPORTUNIDADES: "/crm/oportunidades",
};

const PIPELINE_BADGE: Record<string, { label: string; color: string }> = {
  PROSPECCAO:    { label: "Prospecção",  color: "text-violet-400 bg-violet-500/15" },
  LEADS:         { label: "Lead",        color: "text-indigo-400 bg-indigo-500/15" },
  OPORTUNIDADES: { label: "Oportunidade", color: "text-amber-400 bg-amber-500/15" },
};

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: "💬", instagram: "📸", facebook: "👥",
  google: "🔍", link: "🔗", bdr: "🤖", manual: "✍️",
};

function staleUrgency(days: number): { badge: string; color: string; suggestion: string } {
  if (days <= 7)  return { badge: "Morno",      color: "text-amber-400",  suggestion: "Retome o contato em breve" };
  if (days <= 14) return { badge: "Esfriando",  color: "text-orange-400", suggestion: "Contato urgente necessário" };
  if (days <= 30) return { badge: "Frio",       color: "text-red-400",    suggestion: "Últimas tentativas ou arquivar" };
  return               { badge: "Muito frio",  color: "text-slate-500",  suggestion: "Campanha de reengajamento" };
}

export default async function CRMDashboardPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const userId       = (session.user as any).id as string;
  const role         = (session.user as any).role as string;
  const companyId    = (session.user as any).companyId as string | undefined;
  const isSuperAdmin = role === "SUPER_ADMIN";
  const isManager    = isSuperAdmin || role === "ADMIN";
  const effectiveCo  = isSuperAdmin ? undefined : companyId;
  const where        = effectiveCo ? { companyId: effectiveCo } : {};

  const userSetorIds = isManager
    ? []
    : (await prisma.setorUser.findMany({ where: { userId }, select: { setorId: true } }))
        .map((s) => s.setorId);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const [unansweredLeads, newLeads, followUps] = await Promise.all([
    // Leads/Ops com mensagem não respondida (última msg deles, sem retorno nosso)
    prisma.lead.findMany({
      where: {
        ...where,
        pipeline: { in: ["LEADS", "OPORTUNIDADES"] },
        status: { notIn: ["CLOSED", "LOST"] },
        conversation: {
          is: {
            lastMessageDirection: "INBOUND",
            status: { in: ["OPEN", "PENDING", "IN_PROGRESS"] },
          },
        },
      },
      select: {
        id: true, name: true, phone: true, pipeline: true, pipelineStage: true,
        conversation: {
          select: { lastMessageAt: true, lastMessageBody: true, unreadCount: true },
        },
      },
      orderBy: { conversation: { lastMessageAt: "asc" } },
      take: 30,
    }),

    // Leads novos nos últimos 7 dias
    prisma.lead.findMany({
      where: {
        ...where,
        pipeline: { in: ["PROSPECCAO", "LEADS", "OPORTUNIDADES"] },
        createdAt: { gte: sevenDaysAgo },
      },
      select: {
        id: true, name: true, phone: true, pipeline: true, pipelineStage: true,
        source: true, createdAt: true,
        conversation: {
          select: { lastMessageAt: true, lastMessageDirection: true, lastMessageBody: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),

    // Stale + overdue follow-ups (user-scoped)
    getLeadFollowUps({ companyId: effectiveCo, userId, isManager, userSetorIds }),
  ]);

  const todayNew     = newLeads.filter(l => l.createdAt >= today).length;
  const attentionTotal = unansweredLeads.length + followUps.leadsFollowUp.length + followUps.staleLeads.length;

  function leadHref(l: { id: string; pipeline: string | null }) {
    const base = PIPELINE_HREF[l.pipeline ?? ""] ?? "/crm/leads";
    return `${base}?lead=${l.id}`;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-white font-bold text-xl">CRM</h1>
          <p className="text-slate-500 text-sm mt-0.5">Visão operacional — leads, atenção e follow-ups</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/crm/prospeccao" className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-300 hover:bg-violet-500/25 transition-colors">🔎 Prospecção</Link>
          <Link href="/crm/leads"      className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 transition-colors">🎯 Leads</Link>
          <Link href="/crm/oportunidades" className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-colors">💡 Oportunidades</Link>
        </div>
      </div>

      {/* KPI cards de atenção */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Sem resposta */}
        <div className={`bg-[#0f1623] border rounded-xl p-4 relative overflow-hidden ${unansweredLeads.length > 0 ? "border-red-500/30" : "border-[#1e2d45]"}`}>
          <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-xl ${unansweredLeads.length > 0 ? "bg-red-500" : "bg-slate-700"}`} />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Sem Resposta</span>
            <span className="text-lg">{unansweredLeads.length > 0 ? "🔴" : "✅"}</span>
          </div>
          <div className={`text-2xl font-bold ${unansweredLeads.length > 0 ? "text-red-400" : "text-white"}`}>{unansweredLeads.length}</div>
          <div className="text-[11px] mt-1 text-slate-500">Mensagens não respondidas</div>
        </div>

        {/* Novos hoje */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl bg-emerald-500" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Novos Hoje</span>
            <span className="text-lg">✨</span>
          </div>
          <div className="text-2xl font-bold text-white">{todayNew}</div>
          <div className="text-[11px] mt-1 text-emerald-400">{newLeads.length} nos últimos 7 dias</div>
        </div>

        {/* Esfriando */}
        <div className={`bg-[#0f1623] border rounded-xl p-4 relative overflow-hidden ${followUps.staleLeads.length > 0 ? "border-sky-500/30" : "border-[#1e2d45]"}`}>
          <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-xl ${followUps.staleLeads.length > 0 ? "bg-sky-500" : "bg-slate-700"}`} />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Esfriando</span>
            <span className="text-lg">🧊</span>
          </div>
          <div className={`text-2xl font-bold ${followUps.staleLeads.length > 0 ? "text-sky-400" : "text-white"}`}>{followUps.staleLeads.length}</div>
          <div className="text-[11px] mt-1 text-slate-500">Sem contato há {STALE_AFTER_DAYS}+ dias</div>
        </div>

        {/* Retornos vencidos */}
        <div className={`bg-[#0f1623] border rounded-xl p-4 relative overflow-hidden ${followUps.leadsFollowUp.length > 0 ? "border-amber-500/30" : "border-[#1e2d45]"}`}>
          <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-xl ${followUps.leadsFollowUp.length > 0 ? "bg-amber-500" : "bg-slate-700"}`} />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Retornos</span>
            <span className="text-lg">⏰</span>
          </div>
          <div className={`text-2xl font-bold ${followUps.leadsFollowUp.length > 0 ? "text-amber-400" : "text-white"}`}>{followUps.leadsFollowUp.length}</div>
          <div className="text-[11px] mt-1 text-slate-500">Vencidos ou para hoje</div>
        </div>
      </div>

      {/* Aguardando Resposta */}
      {unansweredLeads.length > 0 && (
        <div className="bg-[#0f1623] border border-red-500/20 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-red-500/10 flex items-center justify-between">
            <h2 className="text-white font-bold text-sm flex items-center gap-2">
              🔴 Aguardando Resposta
              <span className="text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full font-bold">{unansweredLeads.length}</span>
            </h2>
            <span className="text-slate-500 text-xs hidden sm:block">Mensagem recebida sem retorno</span>
          </div>
          <div className="divide-y divide-[#1e2d45]/50">
            {unansweredLeads.map((lead) => {
              const pl = PIPELINE_BADGE[lead.pipeline ?? ""];
              const msgAt = lead.conversation?.lastMessageAt ?? null;
              const elapsed = timeSince(msgAt);
              return (
                <Link key={lead.id} href={leadHref(lead)} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors group">
                  <div className="relative flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-[#1e2d45] flex items-center justify-center text-xs font-bold text-slate-400">
                      {(lead.name ?? lead.phone).slice(0, 2).toUpperCase()}
                    </div>
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-[#0f1623] animate-pulse" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-slate-200 text-[13px] font-medium truncate">{lead.name ?? lead.phone}</span>
                      {pl && <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${pl.color}`}>{pl.label}</span>}
                      {lead.pipelineStage && <span className="text-slate-600 text-[10px] truncate">{lead.pipelineStage}</span>}
                    </div>
                    <p className="text-slate-500 text-[11px] truncate mt-0.5">{lead.conversation?.lastMessageBody ?? "—"}</p>
                  </div>
                  {msgAt && (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 bg-red-500/20 text-red-400 whitespace-nowrap">
                      {elapsed}
                    </span>
                  )}
                  <span className="text-indigo-400 text-[11px] font-medium group-hover:text-indigo-300 flex-shrink-0 hidden sm:block">Responder →</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Leads novos */}
      {newLeads.length > 0 && (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#1e2d45] flex items-center justify-between">
            <h2 className="text-white font-bold text-sm flex items-center gap-2">
              ✨ Novos nos últimos 7 dias
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-bold">{newLeads.length}</span>
            </h2>
            {todayNew > 0 && (
              <span className="text-emerald-400 text-xs font-semibold">{todayNew} hoje</span>
            )}
          </div>
          <div className="divide-y divide-[#1e2d45]/50">
            {newLeads.map((lead) => {
              const pl = PIPELINE_BADGE[lead.pipeline ?? ""];
              const hasUnanswered = lead.conversation?.lastMessageDirection === "INBOUND";
              const msgAt = lead.conversation?.lastMessageAt ?? null;
              return (
                <Link key={lead.id} href={leadHref(lead)} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-slate-200 text-[13px] font-medium truncate">{lead.name ?? lead.phone}</span>
                      {pl && <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${pl.color}`}>{pl.label}</span>}
                      {hasUnanswered && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded text-red-400 bg-red-500/15 flex-shrink-0">💬 Resp. pendente</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {lead.source && <span className="text-slate-600 text-[10px]">{SOURCE_LABEL[lead.source] ?? ""} {lead.source}</span>}
                      {lead.pipelineStage && <span className="text-slate-600 text-[10px]">· {lead.pipelineStage}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-slate-400 text-[11px]">entrou {timeSince(lead.createdAt)}</div>
                    {msgAt && (
                      <div className={`text-[10px] mt-0.5 ${hasUnanswered ? "text-red-400" : "text-slate-600"}`}>
                        {hasUnanswered && "⚠ "}msg {timeSince(msgAt)}
                      </div>
                    )}
                  </div>
                  <span className="text-indigo-400 text-[11px] font-medium group-hover:text-indigo-300 flex-shrink-0 hidden sm:block">Ver →</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Esfriando + Retornos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Esfriando com sugestões de urgência */}
        {followUps.staleLeads.length > 0 && (
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[#1e2d45]">
              <h2 className="text-white font-bold text-sm">🧊 Esfriando — sem contato</h2>
              <p className="text-slate-500 text-[11px] mt-0.5">Ordenados pelo mais frio primeiro</p>
            </div>
            <div className="divide-y divide-[#1e2d45]/50">
              {followUps.staleLeads.map((lead) => {
                const ref = lead.conversation?.lastMessageAt ?? lead.updatedAt;
                const days = Math.max(0, Math.floor((Date.now() - new Date(ref).getTime()) / 86400000));
                const pl   = PIPELINE_BADGE[lead.pipeline ?? ""];
                const urg  = staleUrgency(days);
                return (
                  <Link key={lead.id} href={leadHref(lead)} className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-slate-200 text-[12.5px] font-medium truncate">{lead.name ?? lead.phone}</span>
                        {pl && <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${pl.color}`}>{pl.label}</span>}
                      </div>
                      <div className={`text-[11px] mt-0.5 font-medium ${urg.color}`}>{urg.badge} · {days}d sem contato</div>
                      <div className="text-slate-600 text-[10px] mt-0.5 italic">{urg.suggestion}</div>
                    </div>
                    <span className="text-indigo-400 text-[11px] font-medium group-hover:text-indigo-300 flex-shrink-0 mt-0.5">Ver →</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Retornos vencidos / hoje */}
        {followUps.leadsFollowUp.length > 0 && (
          <div className="bg-[#0f1623] border border-amber-500/20 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-amber-500/10">
              <h2 className="text-white font-bold text-sm">⏰ Retornos — pra hoje</h2>
              <p className="text-slate-500 text-[11px] mt-0.5">Prazo marcado vencido ou para hoje</p>
            </div>
            <div className="divide-y divide-[#1e2d45]/50">
              {followUps.leadsFollowUp.map((lead) => {
                const pl  = PIPELINE_BADGE[lead.pipeline ?? ""];
                const d   = lead.expectedReturnAt ? new Date(lead.expectedReturnAt) : null;
                const now = new Date();
                const isOverdue = d && d < now;
                const timeLabel = d
                  ? isOverdue
                    ? `Atrasado ${Math.ceil((now.getTime() - d.getTime()) / 86400000)}d`
                    : `Hoje ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                  : "sem prazo";
                return (
                  <Link key={lead.id} href={leadHref(lead)} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-slate-200 text-[12.5px] font-medium truncate">{lead.name ?? lead.phone}</span>
                        {pl && <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${pl.color}`}>{pl.label}</span>}
                      </div>
                      <div className={`text-[11px] mt-0.5 font-medium ${isOverdue ? "text-red-400" : "text-amber-400"}`}>{timeLabel}</div>
                    </div>
                    <span className="text-indigo-400 text-[11px] font-medium group-hover:text-indigo-300 flex-shrink-0">Ver →</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Follow-ups com geração de IA */}
      <FollowUpsToday />

      {/* Empty state */}
      {attentionTotal === 0 && newLeads.length === 0 && (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🎉</div>
          <div className="text-white font-semibold text-lg">Tudo em dia!</div>
          <div className="text-slate-500 text-sm mt-1">Nenhum lead precisa de atenção agora.</div>
        </div>
      )}
    </div>
  );
}
