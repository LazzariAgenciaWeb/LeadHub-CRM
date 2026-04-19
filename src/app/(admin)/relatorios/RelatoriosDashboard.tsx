"use client";

import { useRouter } from "next/navigation";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  days: number;
  isSuperAdmin: boolean;
  kpis: { totalLeads: number; totalClosed: number; convRate: string; growth: string | null; prevCount: number };
  crmPerDay: { date: string; prospeccao: number; leads: number; oportunidades: number }[];
  funnelCounts: { prospeccao: number; leads: number; oportunidades: number; fechados: number };
  leadsPerStatus: { name: string; value: number; color: string }[];
  leadsPerCampaign: { name: string; leads: number; closed: number }[];
  leadsPerCompany: { name: string; leads: number; closed: number }[];
  trackingLinks: { label: string; clicks: number; leads: number; internal: number; destType: string; campaign: string | null }[];
  linkKpis: { totalClicks: number; totalLeads: number; totalInternal: number };
  linkClicksByDay: { date: string; internos: number; byLink: { label: string; count: number }[] }[];
  msgPerDay: { date: string; inbound: number; outbound: number }[];
  whatsappKpis: { inbound: number; outbound: number; total: number };
  ticketKpis: { open: number; inProgress: number; resolved: number; closed: number; total: number };
  ticketsPerDay: { date: string; abertos: number; resolvidos: number }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { label: "7 dias", value: 7 },
  { label: "30 dias", value: 30 },
  { label: "90 dias", value: 90 },
];

function fmt(n: number) { return n.toLocaleString("pt-BR"); }

// ── Tooltip Components ────────────────────────────────────────────────────────

function BaseTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#161f30] border border-[#1e2d45] rounded-xl px-3 py-2.5 text-xs shadow-xl">
      <div className="text-slate-400 mb-1.5 font-medium">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.fill }} />
          <span className="text-slate-400">{p.name}</span>
          <span className="text-white font-bold ml-auto pl-4">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#161f30] border border-[#1e2d45] rounded-xl px-3 py-2 text-xs shadow-xl">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ background: payload[0].payload.color }} />
        <span className="text-slate-400">{payload[0].name}</span>
        <span className="text-white font-bold ml-2">{fmt(payload[0].value)}</span>
      </div>
    </div>
  );
}

function LinkDayTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload as { date: string; internos: number; byLink: { label: string; count: number }[] };
  return (
    <div className="bg-[#161f30] border border-[#1e2d45] rounded-xl p-3 text-xs shadow-xl max-w-[240px]">
      <div className="text-slate-400 font-medium mb-2">{label}</div>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
        <span className="text-slate-400">Cliques internos</span>
        <span className="text-white font-bold ml-auto">{fmt(data.internos)}</span>
      </div>
      {data.byLink.length > 0 && (
        <div className="border-t border-[#1e2d45] pt-2 space-y-1.5">
          <div className="text-slate-600 text-[10px] uppercase tracking-wide mb-1">Por link</div>
          {data.byLink.slice(0, 6).map((l) => (
            <div key={l.label} className="flex items-center gap-2">
              <span className="text-slate-400 truncate flex-1" style={{ maxWidth: 160 }}>{l.label}</span>
              <span className="text-amber-300 font-semibold flex-shrink-0">{l.count}</span>
            </div>
          ))}
          {data.byLink.length > 6 && (
            <div className="text-slate-600 text-[10px]">+{data.byLink.length - 6} outros</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-lg flex-shrink-0">{icon}</div>
      <div>
        <h2 className="text-white font-bold text-sm">{title}</h2>
        {sub && <p className="text-slate-500 text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── KPI Mini Card ─────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, subColor = "text-slate-500", accent,
}: {
  label: string; value: string | number; sub: string; subColor?: string; accent: string;
}) {
  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${accent} rounded-t-xl`} />
      <div className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-2">{label}</div>
      <div className="text-2xl font-bold text-white">{typeof value === "number" ? fmt(value) : value}</div>
      <div className={`text-[11px] mt-1 ${subColor}`}>{sub}</div>
    </div>
  );
}

// ── Funnel Bar ────────────────────────────────────────────────────────────────

function FunnelRow({
  label, count, total, color, pct,
}: { label: string; count: number; total: number; color: string; pct?: string }) {
  const width = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-slate-400 text-xs">{label}</span>
        <div className="flex items-center gap-3">
          {pct && <span className="text-slate-600 text-[11px]">{pct}</span>}
          <span className="text-white text-xs font-bold w-12 text-right">{fmt(count)}</span>
        </div>
      </div>
      <div className="h-2 bg-[#1e2d45] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RelatoriosDashboard({
  days, isSuperAdmin, kpis, crmPerDay, funnelCounts, leadsPerStatus,
  leadsPerCampaign, leadsPerCompany, trackingLinks, linkKpis, linkClicksByDay,
  msgPerDay, whatsappKpis, ticketKpis, ticketsPerDay,
}: Props) {
  const router = useRouter();

  const growthColor = kpis.growth === null ? "text-slate-400"
    : parseFloat(kpis.growth) >= 0 ? "text-green-400" : "text-red-400";
  const growthSign = kpis.growth !== null && parseFloat(kpis.growth) >= 0 ? "+" : "";

  const fMax = funnelCounts.prospeccao + funnelCounts.leads + funnelCounts.oportunidades;
  const funnelTotal = fMax || 1;

  const hasCrm  = crmPerDay.some(d => d.prospeccao + d.leads + d.oportunidades > 0);
  const hasLink = linkClicksByDay.some(d => d.internos > 0);
  const hasMsg  = msgPerDay.some(d => d.inbound + d.outbound > 0);
  const hasTicket = ticketsPerDay.some(d => d.abertos > 0);

  const tickInterval = days <= 7 ? 0 : days <= 30 ? 4 : 9;

  return (
    <div className="p-6 space-y-8 max-w-[1400px]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-xl">📊 Relatórios</h1>
          <p className="text-slate-500 text-sm mt-0.5">Visão completa do período selecionado</p>
        </div>
        <div className="flex gap-1 bg-[#0f1623] border border-[#1e2d45] rounded-lg p-1">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => router.push(`/relatorios?days=${opt.value}`)}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                days === opt.value ? "bg-indigo-600 text-white shadow-lg" : "text-slate-400 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard
          label="Leads no Período"
          value={kpis.totalLeads}
          sub={kpis.growth !== null ? `${growthSign}${kpis.growth}% vs anterior` : "Primeiro período"}
          subColor={growthColor}
          accent="bg-gradient-to-r from-indigo-500 to-purple-600"
        />
        <KpiCard
          label="Fechados"
          value={kpis.totalClosed}
          sub={`${kpis.convRate}% de conversão`}
          subColor="text-green-400"
          accent="bg-green-500"
        />
        <KpiCard
          label="Mensagens WA"
          value={whatsappKpis.total}
          sub={`${fmt(whatsappKpis.inbound)} recebidas · ${fmt(whatsappKpis.outbound)} enviadas`}
          accent="bg-cyan-500"
        />
        <KpiCard
          label="Chamados"
          value={ticketKpis.total}
          sub={`${ticketKpis.open} abertos · ${ticketKpis.resolved} resolvidos`}
          accent="bg-orange-500"
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SEÇÃO 1 — CRM
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <SectionHeader icon="🎯" title="CRM — Pipeline por Dia" sub="Novos registros por tipo de pipeline no período" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Gráfico CRM por dia */}
          <div className="lg:col-span-2 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              {[
                { color: "bg-violet-500", label: "Prospectos" },
                { color: "bg-indigo-500", label: "Leads" },
                { color: "bg-amber-500",  label: "Oportunidades" },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
                  <span className="text-slate-400 text-xs">{l.label}</span>
                </div>
              ))}
            </div>
            {!hasCrm ? (
              <div className="text-center py-14 text-slate-600 text-sm">Nenhum lead no período</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={crmPerDay} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    {[
                      { id: "gProsp", color: "#8b5cf6" },
                      { id: "gLeads", color: "#6366f1" },
                      { id: "gOp",    color: "#f59e0b" },
                    ].map(g => (
                      <linearGradient key={g.id} id={g.id} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={g.color} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={g.color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval={tickInterval} />
                  <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<BaseTooltip />} />
                  <Area type="monotone" dataKey="prospeccao"    name="Prospectos"    stroke="#8b5cf6" strokeWidth={2} fill="url(#gProsp)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="leads"         name="Leads"         stroke="#6366f1" strokeWidth={2} fill="url(#gLeads)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="oportunidades" name="Oportunidades" stroke="#f59e0b" strokeWidth={2} fill="url(#gOp)"    dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Funil de conversão */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
            <div className="text-white font-semibold text-xs mb-4">🔽 Funil de Conversão (total)</div>
            <div className="space-y-4">
              <FunnelRow
                label="Prospecção"
                count={funnelCounts.prospeccao}
                total={funnelTotal}
                color="bg-violet-500"
              />
              <FunnelRow
                label="Leads"
                count={funnelCounts.leads}
                total={funnelTotal}
                color="bg-indigo-500"
                pct={funnelCounts.prospeccao > 0
                  ? `${((funnelCounts.leads / (funnelCounts.prospeccao + funnelCounts.leads + funnelCounts.oportunidades)) * 100).toFixed(0)}%`
                  : undefined}
              />
              <FunnelRow
                label="Oportunidades"
                count={funnelCounts.oportunidades}
                total={funnelTotal}
                color="bg-amber-500"
                pct={funnelCounts.leads > 0
                  ? `${((funnelCounts.oportunidades / funnelCounts.leads) * 100).toFixed(0)}% de leads`
                  : undefined}
              />
              <FunnelRow
                label="Fechados"
                count={funnelCounts.fechados}
                total={funnelTotal}
                color="bg-green-500"
                pct={funnelCounts.oportunidades > 0
                  ? `${((funnelCounts.fechados / funnelCounts.oportunidades) * 100).toFixed(0)}% de oprt.`
                  : undefined}
              />
            </div>
          </div>
        </div>

        {/* Leads por status + por campanha */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Status Pie */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
            <div className="text-white font-semibold text-xs mb-4">🎯 Leads por Status</div>
            {kpis.totalLeads === 0 ? (
              <div className="text-center py-8 text-slate-600 text-sm">Sem dados</div>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={150} height={150}>
                  <PieChart>
                    <Pie
                      data={leadsPerStatus.filter(s => s.value > 0)}
                      cx="50%" cy="50%"
                      innerRadius={42} outerRadius={65}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {leadsPerStatus.filter(s => s.value > 0).map((e, i) => (
                        <Cell key={i} fill={e.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {leadsPerStatus.map(s => (
                    <div key={s.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                        <span className="text-slate-400 text-xs">{s.name}</span>
                      </div>
                      <span className="text-white text-xs font-bold">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Por campanha */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
            <div className="text-white font-semibold text-xs mb-4">📣 Leads por Campanha</div>
            {leadsPerCampaign.length === 0 ? (
              <div className="text-center py-8 text-slate-600 text-sm">Sem dados</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={leadsPerCampaign} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis
                    type="category" dataKey="name"
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    tickLine={false} axisLine={false} width={90}
                    tickFormatter={v => v.length > 14 ? v.slice(0, 14) + "…" : v}
                  />
                  <Tooltip content={<BaseTooltip />} />
                  <Bar dataKey="leads"  name="leads"    fill="#6366f1" radius={[0, 4, 4, 0]} barSize={10} />
                  <Bar dataKey="closed" name="fechados" fill="#22c55e" radius={[0, 4, 4, 0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Leads por empresa (SUPER_ADMIN) */}
        {isSuperAdmin && leadsPerCompany.length > 0 && (
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
            <div className="text-white font-semibold text-xs mb-4">🏢 Leads por Empresa</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={leadsPerCompany} margin={{ top: 4, right: 16, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<BaseTooltip />} />
                <Legend formatter={v => <span className="text-slate-400 text-xs">{v}</span>} iconType="circle" iconSize={8} />
                <Bar dataKey="leads"  name="leads"    fill="#6366f1" radius={[4, 4, 0, 0]} barSize={28} />
                <Bar dataKey="closed" name="fechados" fill="#22c55e" radius={[4, 4, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SEÇÃO 2 — LINKS
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <SectionHeader icon="🔗" title="Links de Rastreamento" sub="Cliques internos (pixel) por dia e totais de cada link" />

        {/* KPI row de links */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-white">{fmt(linkKpis.totalClicks)}</div>
            <div className="text-slate-400 text-xs mt-1">👆 Cliques externos</div>
            <div className="text-slate-600 text-[10px] mt-0.5">pessoas que acessaram o link</div>
          </div>
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-amber-400">{fmt(linkKpis.totalInternal)}</div>
            <div className="text-slate-400 text-xs mt-1">🔎 Cliques internos</div>
            <div className="text-slate-600 text-[10px] mt-0.5">rastreados por pixel no site</div>
          </div>
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-green-400">{fmt(linkKpis.totalLeads)}</div>
            <div className="text-slate-400 text-xs mt-1">🎯 Leads gerados</div>
            <div className="text-slate-600 text-[10px] mt-0.5">via links rastreados</div>
          </div>
        </div>

        {/* Gráfico cliques internos por dia */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-white font-semibold text-xs">Cliques Internos por Dia</div>
            <div className="text-slate-600 text-[10px]">Passe o mouse para ver quais links foram clicados</div>
          </div>
          {!hasLink ? (
            <div className="text-center py-14 text-slate-600 text-sm">Nenhum clique interno no período</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={linkClicksByDay} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval={tickInterval} />
                <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<LinkDayTooltip />} cursor={{ fill: "rgba(245,158,11,0.06)" }} />
                <Bar dataKey="internos" name="internos" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Tabela de links */}
        {trackingLinks.length > 0 && (
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
            <div className="text-white font-semibold text-xs mb-4">Top Links</div>
            <div className="space-y-3">
              {trackingLinks.map((link, i) => {
                const maxClicks = Math.max(1, trackingLinks[0].clicks);
                const pct = Math.round((link.clicks / maxClicks) * 100);
                const conv = link.clicks > 0 ? ((link.leads / link.clicks) * 100).toFixed(1) : "0";
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-slate-600 text-[11px] w-4 text-right flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-slate-300 text-[12px] font-medium truncate">
                          {link.destType === "whatsapp" ? "💬" : "🌐"} {link.label}
                        </span>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-4 text-[11px]">
                          <span className="text-slate-400">👆 <strong className="text-white">{fmt(link.clicks)}</strong></span>
                          <span className="text-slate-400">🔎 <strong className="text-amber-400">{fmt(link.internal)}</strong></span>
                          <span className="text-slate-400">🎯 <strong className="text-green-400">{conv}%</strong></span>
                        </div>
                      </div>
                      <div className="h-1 bg-[#1e2d45] rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      {link.campaign && <div className="text-slate-600 text-[10px] mt-0.5">📣 {link.campaign}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-6 mt-4 pt-3 border-t border-[#1e2d45] text-[10px] text-slate-600">
              <span>👆 cliques externos (visitaram o link)</span>
              <span>🔎 cliques internos (pixel no site)</span>
              <span>🎯 % conversão externa → lead</span>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SEÇÃO 3 — WHATSAPP
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <SectionHeader icon="💬" title="WhatsApp — Volume de Mensagens" sub="Mensagens recebidas vs enviadas por dia no período" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Gráfico por dia */}
          <div className="lg:col-span-2 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
            <div className="flex items-center gap-4 mb-4">
              {[
                { color: "bg-green-500",  label: "Recebidas" },
                { color: "bg-blue-500",   label: "Enviadas" },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
                  <span className="text-slate-400 text-xs">{l.label}</span>
                </div>
              ))}
            </div>
            {!hasMsg ? (
              <div className="text-center py-14 text-slate-600 text-sm">Nenhuma mensagem no período</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={msgPerDay} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="gIn"  x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval={tickInterval} />
                  <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<BaseTooltip />} />
                  <Area type="monotone" dataKey="inbound"  name="Recebidas" stroke="#22c55e" strokeWidth={2} fill="url(#gIn)"  dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="outbound" name="Enviadas"  stroke="#3b82f6" strokeWidth={2} fill="url(#gOut)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Stats WA */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
            <div className="text-white font-semibold text-xs mb-4">Resumo WhatsApp</div>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400 text-xs">Total no período</span>
                  <span className="text-white font-bold text-sm">{fmt(whatsappKpis.total)}</span>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { label: "Recebidas", value: whatsappKpis.inbound,  color: "bg-green-500", text: "text-green-400" },
                  { label: "Enviadas",  value: whatsappKpis.outbound, color: "bg-blue-500",  text: "text-blue-400" },
                ].map(row => {
                  const pctW = whatsappKpis.total > 0 ? Math.round((row.value / whatsappKpis.total) * 100) : 0;
                  return (
                    <div key={row.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">{row.label}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] ${row.text} font-semibold`}>{pctW}%</span>
                          <span className="text-white font-bold">{fmt(row.value)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-[#1e2d45] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${row.color}`} style={{ width: `${pctW}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {whatsappKpis.total > 0 && (
                <div className="pt-3 border-t border-[#1e2d45]">
                  <div className="text-slate-500 text-[11px]">
                    Ratio recebidas/enviadas
                  </div>
                  <div className="text-white font-bold text-lg mt-0.5">
                    {whatsappKpis.outbound > 0
                      ? (whatsappKpis.inbound / whatsappKpis.outbound).toFixed(2)
                      : "∞"
                    }
                    <span className="text-slate-500 text-xs font-normal ml-1">:1</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SEÇÃO 4 — CHAMADOS
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <SectionHeader icon="🎫" title="Chamados" sub="Chamados criados por dia e status atual" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Gráfico por dia */}
          <div className="lg:col-span-2 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
            <div className="flex items-center gap-4 mb-4">
              {[
                { color: "bg-red-500",   label: "Abertos" },
                { color: "bg-green-500", label: "Resolvidos" },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
                  <span className="text-slate-400 text-xs">{l.label}</span>
                </div>
              ))}
            </div>
            {!hasTicket ? (
              <div className="text-center py-14 text-slate-600 text-sm">Nenhum chamado no período</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ticketsPerDay} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval={tickInterval} />
                  <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<BaseTooltip />} />
                  <Bar dataKey="abertos"    name="Abertos"    fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="resolvidos" name="Resolvidos" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Status chamados */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
            <div className="text-white font-semibold text-xs mb-4">Status Atual (todos)</div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: "Total",         value: ticketKpis.total,      color: "text-white" },
                { label: "Abertos",       value: ticketKpis.open,       color: "text-indigo-400" },
                { label: "Em Andamento",  value: ticketKpis.inProgress,  color: "text-blue-400" },
                { label: "Resolvidos",    value: ticketKpis.resolved,    color: "text-green-400" },
              ].map(item => (
                <div key={item.label} className="bg-[#161f30] rounded-lg p-3 text-center">
                  <div className={`text-xl font-bold ${item.color}`}>{item.value}</div>
                  <div className="text-slate-500 text-[10px] mt-0.5">{item.label}</div>
                </div>
              ))}
            </div>
            {ticketKpis.total > 0 && (
              <div className="space-y-2 pt-3 border-t border-[#1e2d45]">
                {[
                  { label: "Abertos",      value: ticketKpis.open,       color: "bg-indigo-500" },
                  { label: "Em Andamento", value: ticketKpis.inProgress,  color: "bg-blue-500" },
                  { label: "Resolvidos",   value: ticketKpis.resolved,    color: "bg-green-500" },
                  { label: "Fechados",     value: ticketKpis.closed,      color: "bg-slate-500" },
                ].map(row => (
                  <div key={row.label}>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-slate-400">{row.label}</span>
                      <span className="text-white font-semibold">{row.value}</span>
                    </div>
                    <div className="h-1.5 bg-[#1e2d45] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${row.color}`}
                        style={{ width: `${ticketKpis.total > 0 ? Math.round((row.value / ticketKpis.total) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
