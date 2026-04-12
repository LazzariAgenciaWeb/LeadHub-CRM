"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import Link from "next/link";

interface DayData {
  date: string;
  prospeccao: number;
  leads: number;
  oportunidades: number;
  vendas: number;
}

interface FunnelData {
  prospeccao: number;
  leads: number;
  oportunidades: number;
  vendas: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0c1220] border border-[#1e2d45] rounded-xl px-4 py-3 shadow-xl text-xs">
      <p className="text-slate-400 font-semibold mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-slate-300">{p.name}:</span>
          <span className="text-white font-bold">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function CRMCharts({ funnel, dailyData }: { funnel: FunnelData; dailyData: DayData[] }) {
  const funnelSteps = [
    {
      label: "Prospecção", icon: "🔎", value: funnel.prospeccao,
      color: "#8b5cf6", bg: "bg-violet-500/10", border: "border-violet-500/30", text: "text-violet-400",
      href: "/crm/prospeccao", pct: 0, width: "100%",
    },
    {
      label: "Leads", icon: "🎯", value: funnel.leads,
      color: "#3b82f6", bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-400",
      href: "/crm/leads",
      pct: funnel.prospeccao > 0 ? Math.round((funnel.leads / funnel.prospeccao) * 100) : 0,
      width: funnel.prospeccao > 0 ? `${Math.max(30, Math.round((funnel.leads / funnel.prospeccao) * 100))}%` : "75%",
    },
    {
      label: "Oportunidades", icon: "💡", value: funnel.oportunidades,
      color: "#f59e0b", bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400",
      href: "/crm/oportunidades",
      pct: funnel.leads > 0 ? Math.round((funnel.oportunidades / funnel.leads) * 100) : 0,
      width: funnel.prospeccao > 0 ? `${Math.max(20, Math.round((funnel.oportunidades / funnel.prospeccao) * 100))}%` : "50%",
    },
    {
      label: "Vendas", icon: "🏆", value: funnel.vendas,
      color: "#22c55e", bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-400",
      href: "/crm/oportunidades",
      pct: funnel.oportunidades > 0 ? Math.round((funnel.vendas / funnel.oportunidades) * 100) : 0,
      width: funnel.prospeccao > 0 ? `${Math.max(10, Math.round((funnel.vendas / funnel.prospeccao) * 100))}%` : "30%",
    },
  ];

  const taxaGeral = funnel.prospeccao > 0
    ? ((funnel.vendas / funnel.prospeccao) * 100).toFixed(1)
    : "0";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Funil */}
      <div className="lg:col-span-2 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-white font-bold text-sm">🫧 Funil CRM</h2>
            <p className="text-slate-500 text-xs mt-0.5">{funnel.prospeccao} prospects totais</p>
          </div>
          <Link href="/crm/prospeccao" className="text-indigo-400 text-xs hover:underline">Ver CRM →</Link>
        </div>

        <div className="flex flex-col items-center gap-1">
          {funnelSteps.map((step, i) => (
            <div key={step.label} className="w-full flex flex-col items-center">
              <Link
                href={step.href}
                style={{ width: step.width }}
                className={`flex items-center justify-between px-4 py-2.5 rounded-xl border ${step.bg} ${step.border} hover:opacity-80 transition-opacity`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{step.icon}</span>
                  <span className={`text-xs font-semibold ${step.text}`}>{step.label}</span>
                </div>
                <div className="text-right">
                  <div className="text-white font-bold text-base leading-tight">{step.value}</div>
                  {i > 0 && <div className="text-slate-600 text-[10px]">{step.pct}% conv.</div>}
                </div>
              </Link>
              {i < funnelSteps.length - 1 && (
                <div className="flex flex-col items-center my-0.5">
                  <div className="w-px h-2 bg-[#1e2d45]" />
                  <div className="text-[#2a3a55] text-[10px]">▼</div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-[#1e2d45] flex items-center justify-between">
          <span className="text-slate-500 text-xs">Taxa geral (prospect → venda)</span>
          <span className="text-green-400 font-bold text-sm">{taxaGeral}%</span>
        </div>
      </div>

      {/* Gráfico */}
      <div className="lg:col-span-3 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <div className="mb-4">
          <h2 className="text-white font-bold text-sm">📈 Entradas por dia — últimos 30 dias</h2>
          <p className="text-slate-500 text-xs mt-0.5">Novos contatos por pipeline</p>
        </div>
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={dailyData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: "11px", color: "#94a3b8", paddingTop: "12px" }} iconType="circle" iconSize={8} />
            <Line type="monotone" dataKey="prospeccao" name="Prospecção" stroke="#8b5cf6" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            <Line type="monotone" dataKey="leads"      name="Leads"      stroke="#06b6d4" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            <Line type="monotone" dataKey="oportunidades" name="Oportunidades" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            <Line type="monotone" dataKey="vendas"     name="Vendas"     stroke="#22c55e" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
