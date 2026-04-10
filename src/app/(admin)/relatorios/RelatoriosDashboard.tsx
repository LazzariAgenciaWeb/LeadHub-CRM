"use client";

import { useRouter } from "next/navigation";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface Props {
  days: number;
  isSuperAdmin: boolean;
  kpis: { totalLeads: number; totalClosed: number; convRate: string; growth: string | null; prevCount: number };
  leadsPerDay: { date: string; leads: number }[];
  leadsPerStatus: { name: string; value: number; color: string }[];
  leadsPerCampaign: { name: string; leads: number; closed: number }[];
  leadsPerCompany: { name: string; leads: number; closed: number }[];
}

const PERIOD_OPTIONS = [
  { label: "7 dias", value: 7 },
  { label: "30 dias", value: 30 },
  { label: "90 dias", value: 90 },
];

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs">
      <div className="text-slate-400 mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span style={{ color: p.color || p.fill }}>●</span>
          <span className="text-white font-semibold">{p.value}</span>
          <span className="text-slate-500">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span style={{ color: payload[0].payload.color }}>●</span>
        <span className="text-white font-semibold">{payload[0].value}</span>
        <span className="text-slate-400">{payload[0].name}</span>
      </div>
    </div>
  );
}

export default function RelatoriosDashboard({
  days, isSuperAdmin, kpis, leadsPerDay, leadsPerStatus, leadsPerCampaign, leadsPerCompany,
}: Props) {
  const router = useRouter();

  function setPeriod(d: number) {
    router.push(`/relatorios?days=${d}`);
  }

  const growthColor = kpis.growth === null ? "text-slate-400"
    : parseFloat(kpis.growth) >= 0 ? "text-green-400" : "text-red-400";
  const growthSign = kpis.growth !== null && parseFloat(kpis.growth) >= 0 ? "+" : "";

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-xl">Relatórios</h1>
          <p className="text-slate-500 text-sm mt-0.5">Análise de leads e conversões</p>
        </div>
        <div className="flex gap-1 bg-[#0f1623] border border-[#1e2d45] rounded-lg p-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                days === opt.value
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className={`grid gap-4 ${isSuperAdmin ? "grid-cols-4" : "grid-cols-3"}`}>
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <div className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-2">Total Leads</div>
          <div className="text-3xl font-bold text-white">{kpis.totalLeads}</div>
          {kpis.growth !== null && (
            <div className={`text-xs mt-1 font-medium ${growthColor}`}>
              {growthSign}{kpis.growth}% vs período anterior
            </div>
          )}
          {kpis.growth === null && kpis.prevCount === 0 && (
            <div className="text-slate-600 text-xs mt-1">Primeiro período</div>
          )}
        </div>
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <div className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-2">Fechados</div>
          <div className="text-3xl font-bold text-green-400">{kpis.totalClosed}</div>
          <div className="text-slate-500 text-xs mt-1">{kpis.convRate}% de conversão</div>
        </div>
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <div className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-2">Taxa de Conversão</div>
          <div className="text-3xl font-bold text-indigo-400">{kpis.convRate}%</div>
          <div className="text-slate-500 text-xs mt-1">Novos → Fechados</div>
        </div>
        {isSuperAdmin && (
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
            <div className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-2">Empresas ativas</div>
            <div className="text-3xl font-bold text-white">{leadsPerCompany.length}</div>
            <div className="text-slate-500 text-xs mt-1">com leads no período</div>
          </div>
        )}
      </div>

      {/* Leads por dia */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <h2 className="text-white font-bold text-sm mb-4">📈 Leads por Dia</h2>
        {kpis.totalLeads === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">Nenhum lead no período selecionado</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={leadsPerDay} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="leadsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#475569", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval={days <= 7 ? 0 : days <= 30 ? 4 : 9}
              />
              <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="leads"
                name="leads"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#leadsGradient)"
                dot={false}
                activeDot={{ r: 4, fill: "#6366f1" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Leads por status + por campanha */}
      <div className="grid grid-cols-2 gap-4">
        {/* Status donut */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <h2 className="text-white font-bold text-sm mb-4">🎯 Leads por Status</h2>
          {kpis.totalLeads === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">Sem dados</div>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie
                    data={leadsPerStatus.filter(s => s.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {leadsPerStatus.filter(s => s.value > 0).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {leadsPerStatus.map((s) => (
                  <div key={s.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="text-slate-400 text-xs">{s.name}</span>
                    </div>
                    <span className="text-white text-xs font-bold">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Leads por campanha */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <h2 className="text-white font-bold text-sm mb-4">📣 Leads por Campanha</h2>
          {leadsPerCampaign.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">Sem dados</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={leadsPerCampaign} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={90}
                  tickFormatter={(v) => v.length > 14 ? v.slice(0, 14) + "…" : v}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="leads" name="leads" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={12} />
                <Bar dataKey="closed" name="fechados" fill="#22c55e" radius={[0, 4, 4, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Leads por empresa (SUPER_ADMIN only) */}
      {isSuperAdmin && leadsPerCompany.length > 0 && (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <h2 className="text-white font-bold text-sm mb-4">🏢 Leads por Empresa</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={leadsPerCompany} margin={{ top: 4, right: 16, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(v) => <span className="text-slate-400 text-xs">{v}</span>}
                iconType="circle"
                iconSize={8}
              />
              <Bar dataKey="leads" name="leads" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={28} />
              <Bar dataKey="closed" name="fechados" fill="#22c55e" radius={[4, 4, 0, 0]} barSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
