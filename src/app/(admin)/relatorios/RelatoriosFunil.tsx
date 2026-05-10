"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";

export interface StageStat {
  pipeline: string;
  stageName: string;
  color: string;
  order: number;
  isFinal: boolean;
  count: number;
  /** Soma de Lead.value pra leads nesta etapa */
  totalValue: number;
}

export interface FunnelData {
  stagesByPipeline: Record<string, StageStat[]>;
  pipelines: { key: string; label: string; icon: string }[];
  stageChangeStats: {
    /** mediana em dias (apenas mudanças "pra frente" no pipeline) */
    medianDays: number | null;
    sampleSize: number;
  };
  rangeDays: number;
}

const PIPELINE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  PROSPECCAO:    { label: "Prospecção",    icon: "🔎", color: "#8b5cf6" },
  LEADS:         { label: "Leads",         icon: "🎯", color: "#6366f1" },
  OPORTUNIDADES: { label: "Oportunidades", icon: "💡", color: "#f59e0b" },
};

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });
}

export default function RelatoriosFunil({ data }: { data: FunnelData }) {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-white font-bold text-xl">📊 Funil de Vendas</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Distribuição dos leads por etapa, conversão e valor projetado.
        </p>
      </div>

      {/* Resumo executivo */}
      <FunnelSummary data={data} />

      {/* Funil por pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {data.pipelines.map((p) => {
          const stages = data.stagesByPipeline[p.key] ?? [];
          return <FunnelPipelineCard key={p.key} pipeline={p} stages={stages} />;
        })}
      </div>
    </div>
  );
}

function FunnelSummary({ data }: { data: FunnelData }) {
  const totals = useMemo(() => {
    const all = Object.values(data.stagesByPipeline).flat();
    const totalLeads = all.reduce((s, x) => s + x.count, 0);
    const totalValue = all.reduce((s, x) => s + x.totalValue, 0);

    const oportunidades = data.stagesByPipeline["OPORTUNIDADES"] ?? [];
    const wonStages = oportunidades.filter((s) => s.isFinal && !/perd|descart/i.test(s.stageName));
    const lostStages = oportunidades.filter((s) => s.isFinal && /perd|descart/i.test(s.stageName));
    const wonCount = wonStages.reduce((s, x) => s + x.count, 0);
    const lostCount = lostStages.reduce((s, x) => s + x.count, 0);
    const wonValue = wonStages.reduce((s, x) => s + x.totalValue, 0);
    const closedTotal = wonCount + lostCount;
    const winRate = closedTotal > 0 ? Math.round((wonCount / closedTotal) * 100) : null;

    const oppOpen = oportunidades.filter((s) => !s.isFinal);
    const pipelineValue = oppOpen.reduce((s, x) => s + x.totalValue, 0);

    return { totalLeads, totalValue, wonCount, lostCount, wonValue, winRate, pipelineValue };
  }, [data]);

  const Card = ({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) => (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ backgroundColor: color }} />
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-white mt-2">{value}</div>
      {sub && <div className="text-[11px] mt-1 text-slate-500">{sub}</div>}
    </div>
  );

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <Card label="Leads no funil" value={String(totals.totalLeads)} color="#6366f1" />
      <Card label="Pipeline aberta" value={formatBRL(totals.pipelineValue)} sub="Em Oportunidades" color="#f59e0b" />
      <Card label="Vendas fechadas" value={formatBRL(totals.wonValue)} sub={`${totals.wonCount} oportunidade(s)`} color="#22c55e" />
      <Card
        label="Win rate"
        value={totals.winRate != null ? `${totals.winRate}%` : "—"}
        sub={`${totals.wonCount} ganhas / ${totals.lostCount} perdidas`}
        color="#22c55e"
      />
      <Card
        label="Tempo médio (dias)"
        value={data.stageChangeStats.medianDays != null ? String(data.stageChangeStats.medianDays) : "—"}
        sub={`Baseado em ${data.stageChangeStats.sampleSize} mudanças (${data.rangeDays}d)`}
        color="#06b6d4"
      />
    </div>
  );
}

function FunnelPipelineCard({
  pipeline,
  stages,
}: {
  pipeline: { key: string; label: string; icon: string };
  stages: StageStat[];
}) {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const max = Math.max(...ordered.map((s) => s.count), 1);
  const totalLeads = ordered.reduce((s, x) => s + x.count, 0);

  // Conversão acumulada — quanto sobreviveu da primeira etapa até cada uma.
  const firstCount = ordered[0]?.count ?? 0;

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-bold text-sm flex items-center gap-2">
          <span>{pipeline.icon}</span> {pipeline.label}
        </h2>
        <span className="text-slate-500 text-xs">{totalLeads} leads</span>
      </div>

      {ordered.length === 0 ? (
        <div className="text-center py-8 text-slate-600 text-sm italic">Sem etapas configuradas.</div>
      ) : (
        <>
          {/* Funil simples — barras horizontais */}
          <ul className="space-y-2 mb-4">
            {ordered.map((s) => {
              const widthPct = (s.count / max) * 100;
              const convPct = firstCount > 0 ? Math.round((s.count / firstCount) * 100) : 0;
              return (
                <li key={s.stageName} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="text-slate-300 text-xs truncate" title={s.stageName}>{s.stageName}</span>
                      {s.isFinal && (
                        <span className="text-[8px] uppercase font-bold text-slate-600 bg-white/5 px-1 py-px rounded flex-shrink-0">final</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-white text-xs font-bold">{s.count}</span>
                      {firstCount > 0 && <span className="text-slate-600 text-[10px]">{convPct}%</span>}
                    </div>
                  </div>
                  <div className="h-1.5 bg-[#1e2d45] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${widthPct}%`, backgroundColor: s.color }}
                    />
                  </div>
                  {s.totalValue > 0 && (
                    <div className="text-[10px] text-green-400 ml-4">{formatBRL(s.totalValue)}</div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Bar chart compacto pra leitura "scannable" rápida */}
          <div className="h-32 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ordered.map((s) => ({ name: s.stageName, count: s.count, color: s.color }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} interval={0} angle={-15} textAnchor="end" height={40} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} width={20} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0a0f1a", border: "1px solid #1e2d45", borderRadius: "8px", fontSize: 11 }}
                  cursor={{ fill: "#1e2d4540" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {ordered.map((s, i) => (
                    <Cell key={i} fill={s.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
