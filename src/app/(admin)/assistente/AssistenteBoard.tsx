"use client";

import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Conv {
  phone: string;
  contactName: string | null;
  instanceName: string | null;
  firstMessageAt: string;
  lastMessageAt: string;
  lastDirection: "INBOUND" | "OUTBOUND";
  responseTimeMinutes: number | null;
  totalMessages: number;
  inboundCount: number;
  outboundCount: number;
  isAnswered: boolean;
  isGroup: boolean;
  lastMessagePreview: string;
}

interface DayData {
  dateKey: string;
  label: string;
  total: number;
  respondidas: number;
  pendentes: number;
  avgResponseMin: number;
}

interface InstanceStat {
  name: string;
  total: number;
  respondidas: number;
  taxaResposta: number;
}

interface PendingLead {
  id: string;
  name: string | null;
  phone: string;
  expectedReturnAt: string | null;
  pipeline: string | null;
  pipelineStage: string | null;
  attendanceStatus: string | null;
}

interface StalledOpp {
  id: string;
  name: string | null;
  phone: string;
  pipelineStage: string | null;
  updatedAt: string;
  expectedReturnAt: string | null;
  attendanceStatus: string | null;
}

interface OpenTicket {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

interface AiResult {
  rating: string;
  ratingEmoji: string;
  ratingColor: string;
  highlights: string[];
  attention: string[];
  actions: string[];
  generatedAt: string;
}

interface Props {
  dailyGraph: DayData[];
  yesterdayConvs: Conv[];
  instanceStats: InstanceStat[];
  pendingLeads: PendingLead[];
  stalledOpps: StalledOpp[];
  openTickets: OpenTicket[];
  companyId: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(isoStr: string): string {
  const d = new Date(isoStr);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDate(isoStr: string): string {
  const d = new Date(isoStr);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function timeSince(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rem = mins % 60;
    return rem > 0 ? `${hours}h ${rem}min` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days} dia${days !== 1 ? "s" : ""}`;
}

function fmtResponseTime(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function priorityColor(priority: string): string {
  switch (priority) {
    case "URGENT": return "text-red-400";
    case "HIGH":   return "text-orange-400";
    case "MEDIUM": return "text-yellow-400";
    default:       return "text-slate-400";
  }
}

function priorityLabel(priority: string): string {
  switch (priority) {
    case "URGENT": return "Urgente";
    case "HIGH":   return "Alta";
    case "MEDIUM": return "Média";
    default:       return "Baixa";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "OPEN":        return "Aberto";
    case "IN_PROGRESS": return "Em andamento";
    case "RESOLVED":    return "Resolvido";
    case "CLOSED":      return "Fechado";
    default:            return status;
  }
}

// ── Custom Tooltip ─────────────────────────────────────────────────────────────

interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  data?: DayData[];
}

function CustomBarTooltip({ active, payload, label, data }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const day = data?.find((d) => d.label === label);
  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3 text-xs shadow-xl">
      <p className="text-white font-semibold mb-1">{label}</p>
      <p className="text-slate-300">Total: <span className="text-white">{day?.total ?? 0}</span></p>
      <p className="text-green-400">Respondidas: <span className="text-white">{day?.respondidas ?? 0}</span></p>
      <p className="text-red-400">Pendentes: <span className="text-white">{day?.pendentes ?? 0}</span></p>
      {day && day.avgResponseMin > 0 && (
        <p className="text-slate-400 mt-1">
          Tempo médio: <span className="text-white">{fmtResponseTime(day.avgResponseMin)}</span>
        </p>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AssistenteBoard({
  dailyGraph,
  yesterdayConvs,
  instanceStats,
  pendingLeads,
  stalledOpps,
  openTickets,
  companyId,
}: Props) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = yesterdayDate.toISOString().slice(0, 10);

  const [selectedDateKey, setSelectedDateKey] = useState<string>(yesterdayKey);
  const [selectedDayConvs, setSelectedDayConvs] = useState<Conv[] | null>(null);
  const [loadingDayConvs, setLoadingDayConvs] = useState(false);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Load cached AI result from localStorage on mount
  useEffect(() => {
    try {
      const key = `ai_atendimento_${companyId}_${todayKey}`;
      const cached = localStorage.getItem(key);
      if (cached) {
        setAiResult(JSON.parse(cached));
      }
    } catch {
      // ignore
    }
  }, [companyId, todayKey]);

  // currentConvs: yesterday = server-rendered data, other days = fetched
  const currentConvs: Conv[] =
    selectedDateKey === yesterdayKey
      ? yesterdayConvs
      : (selectedDayConvs ?? []);

  // ── Bar click: load conversations for that day ─────────────────────────────
  async function handleBarClick(data: DayData) {
    const { dateKey } = data;
    setSelectedDateKey(dateKey);
    if (dateKey === yesterdayKey) {
      setSelectedDayConvs(null);
      return;
    }
    setLoadingDayConvs(true);
    setSelectedDayConvs(null);
    try {
      const params = new URLSearchParams({ date: dateKey });
      if (companyId) params.set("companyId", companyId);
      const res = await fetch(`/api/atendimento/conversas?${params.toString()}`);
      if (res.ok) {
        const convs = await res.json() as Conv[];
        setSelectedDayConvs(convs);
      }
    } catch {
      // ignore
    } finally {
      setLoadingDayConvs(false);
    }
  }

  // ── AI generation ──────────────────────────────────────────────────────────
  async function handleGenerateAI(reanalyze = false) {
    if (aiLoading) return;
    if (aiResult && !reanalyze) return;

    setAiLoading(true);
    setAiError(null);

    const ydayGraph = dailyGraph.find((d) => d.dateKey === yesterdayKey);
    const total = ydayGraph?.total ?? 0;
    const respondidas = ydayGraph?.respondidas ?? 0;
    const pendentes = ydayGraph?.pendentes ?? 0;
    const taxaResposta = total > 0 ? Math.round((respondidas / total) * 100) : 0;
    const avgResponseMin = ydayGraph?.avgResponseMin ?? 0;

    const ydayLabel = fmtDate(yesterdayDate.toISOString());
    const pendingConvs = yesterdayConvs
      .filter((c) => !c.isAnswered)
      .slice(0, 10)
      .map((c) => ({
        contactName: c.contactName,
        phone: c.phone,
        instanceName: c.instanceName,
        minutesSinceLastMsg: Math.round(
          (Date.now() - new Date(c.lastMessageAt).getTime()) / 60000
        ),
      }));

    try {
      const res = await fetch("/api/ai/atendimento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodLabel: `${ydayLabel} (ontem)`,
          metrics: { total, respondidas, pendentes, taxaResposta, avgResponseMin },
          instanceStats,
          pendingConvs,
          pendingLeads: pendingLeads.slice(0, 10),
          stalledOpps: stalledOpps.slice(0, 5),
          openTickets: openTickets.slice(0, 10),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setAiError((body as any).error ?? "Erro ao gerar análise.");
        return;
      }

      const result = await res.json() as AiResult;
      setAiResult(result);

      try {
        const cacheKey = `ai_atendimento_${companyId}_${todayKey}`;
        localStorage.setItem(cacheKey, JSON.stringify(result));
      } catch {
        // ignore storage errors
      }
    } catch {
      setAiError("Erro de conexão. Tente novamente.");
    } finally {
      setAiLoading(false);
    }
  }

  // ── Selected day KPIs ──────────────────────────────────────────────────────
  const selectedDayData = dailyGraph.find((d) => d.dateKey === selectedDateKey);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#080b12] text-white p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            🤖 Assistente de Atendimento
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Visão geral dos últimos 30 dias · Conversas de ontem em destaque
          </p>
        </div>

        {/* AI Button */}
        <div className="flex flex-col items-end gap-1">
          {aiResult ? (
            <div className="text-right">
              <div className="text-xs text-slate-400">
                🤖 Análise de hoje · Gerada às {aiResult.generatedAt}
              </div>
              <button
                onClick={() => handleGenerateAI(true)}
                className="text-xs text-indigo-400 hover:text-indigo-300 underline mt-0.5"
                disabled={aiLoading}
              >
                {aiLoading ? "Analisando..." : "Reanalisar"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleGenerateAI(false)}
              disabled={aiLoading}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {aiLoading ? (
                <>
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analisando...
                </>
              ) : (
                "✨ Gerar análise com IA"
              )}
            </button>
          )}
          {aiError && <p className="text-xs text-red-400">{aiError}</p>}
        </div>
      </div>

      {/* AI Result Block */}
      {aiResult && (
        <div
          className={`rounded-xl border p-5 ${
            aiResult.ratingColor === "green"
              ? "border-green-500/40 bg-green-500/5"
              : aiResult.ratingColor === "yellow"
              ? "border-yellow-500/40 bg-yellow-500/5"
              : aiResult.ratingColor === "orange"
              ? "border-orange-500/40 bg-orange-500/5"
              : "border-red-500/40 bg-red-500/5"
          }`}
        >
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">{aiResult.ratingEmoji}</span>
            <div>
              <p className="font-semibold text-white">
                Avaliação: <span className="text-indigo-300">{aiResult.rating}</span>
              </p>
              <p className="text-xs text-slate-400">Análise de IA baseada nos dados de ontem</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Highlights */}
            <div>
              <p className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2">
                Pontos positivos
              </p>
              <ul className="space-y-1.5">
                {aiResult.highlights.map((h, i) => (
                  <li key={i} className="text-sm text-slate-300 flex gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    {h}
                  </li>
                ))}
              </ul>
            </div>

            {/* Attention */}
            <div>
              <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-2">
                Atenção
              </p>
              <ul className="space-y-1.5">
                {aiResult.attention.map((a, i) => (
                  <li key={i} className="text-sm text-slate-300 flex gap-2">
                    <span className="text-yellow-400 flex-shrink-0">⚠</span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>

            {/* Actions */}
            <div>
              <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">
                Ações recomendadas
              </p>
              <ul className="space-y-1.5">
                {aiResult.actions.map((a, i) => (
                  <li key={i} className="text-sm text-slate-300 flex gap-2">
                    <span className="text-indigo-400 flex-shrink-0">{i + 1}.</span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 30-day Bar Chart */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Conversas por dia (30 dias)</h2>
            <p className="text-xs text-slate-500 mt-0.5">Clique em uma barra para ver os detalhes</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" /> Respondidas
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" /> Pendentes
            </span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={dailyGraph}
            margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
            onClick={(e: unknown) => {
              const ev = e as { activePayload?: { payload?: DayData }[] } | null;
              if (ev?.activePayload?.[0]?.payload) {
                handleBarClick(ev.activePayload[0].payload as DayData);
              }
            }}
            style={{ cursor: "pointer" }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#64748b", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval={4}
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={<CustomBarTooltip data={dailyGraph} />}
              cursor={{ fill: "rgba(99,102,241,0.08)" }}
            />
            <Bar dataKey="respondidas" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]}>
              {dailyGraph.map((entry) => (
                <Cell
                  key={entry.dateKey}
                  fill={entry.dateKey === selectedDateKey ? "#4ade80" : "#22c55e"}
                />
              ))}
            </Bar>
            <Bar dataKey="pendentes" stackId="a" fill="#ef4444" radius={[3, 3, 0, 0]}>
              {dailyGraph.map((entry) => (
                <Cell
                  key={entry.dateKey}
                  fill={entry.dateKey === selectedDateKey ? "#f87171" : "#ef4444"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* KPI cards for selected day */}
      {selectedDayData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">Total conversas</p>
            <p className="text-2xl font-bold text-white">{selectedDayData.total}</p>
            <p className="text-xs text-slate-500 mt-1">{selectedDayData.label}</p>
          </div>
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">Respondidas</p>
            <p className="text-2xl font-bold text-green-400">{selectedDayData.respondidas}</p>
            <p className="text-xs text-slate-500 mt-1">
              {selectedDayData.total > 0
                ? `${Math.round((selectedDayData.respondidas / selectedDayData.total) * 100)}%`
                : "—"}
            </p>
          </div>
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">Pendentes</p>
            <p className="text-2xl font-bold text-red-400">{selectedDayData.pendentes}</p>
            <p className="text-xs text-slate-500 mt-1">sem resposta</p>
          </div>
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">Tempo médio de resposta</p>
            <p className="text-2xl font-bold text-indigo-400">
              {fmtResponseTime(selectedDayData.avgResponseMin > 0 ? selectedDayData.avgResponseMin : null)}
            </p>
            <p className="text-xs text-slate-500 mt-1">primeiro contato</p>
          </div>
        </div>
      )}

      {/* Instance stats table */}
      {instanceStats.length > 0 && (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Desempenho por instância (30 dias)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-[#1e2d45]">
                  <th className="text-left pb-2 font-medium">Instância</th>
                  <th className="text-right pb-2 font-medium">Total</th>
                  <th className="text-right pb-2 font-medium">Respondidas</th>
                  <th className="text-right pb-2 font-medium">Taxa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2d45]">
                {instanceStats.map((inst) => (
                  <tr key={inst.name} className="text-sm">
                    <td className="py-2.5 text-slate-300">{inst.name}</td>
                    <td className="py-2.5 text-right text-white">{inst.total}</td>
                    <td className="py-2.5 text-right text-green-400">{inst.respondidas}</td>
                    <td className="py-2.5 text-right">
                      <span
                        className={
                          inst.taxaResposta >= 80
                            ? "text-green-400"
                            : inst.taxaResposta >= 50
                            ? "text-yellow-400"
                            : "text-red-400"
                        }
                      >
                        {inst.taxaResposta}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Main grid: conversations + right panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conversation list */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Conversas —{" "}
                {selectedDateKey === yesterdayKey
                  ? "Ontem"
                  : dailyGraph.find((d) => d.dateKey === selectedDateKey)?.label ?? selectedDateKey}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {currentConvs.length} conversa{currentConvs.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {loadingDayConvs ? (
            <div className="flex items-center justify-center py-12 text-slate-500 text-sm gap-2">
              <span className="inline-block w-4 h-4 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
              Carregando...
            </div>
          ) : currentConvs.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
              Nenhuma conversa neste dia.
            </div>
          ) : (
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {currentConvs.map((conv) => (
                <div
                  key={conv.phone}
                  className={`rounded-lg border p-3 ${
                    conv.isAnswered
                      ? "border-[#1e2d45] bg-[#0a1120]"
                      : "border-red-500/30 bg-red-500/5 border-l-2 border-l-red-500"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white truncate">
                          {conv.contactName ?? conv.phone}
                        </span>
                        {conv.isGroup && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                            Grupo
                          </span>
                        )}
                        {conv.isAnswered ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">
                            Respondida
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                            Pendente
                          </span>
                        )}
                      </div>
                      {conv.contactName && (
                        <p className="text-xs text-slate-500 mt-0.5">{conv.phone}</p>
                      )}
                      {conv.instanceName && (
                        <p className="text-xs text-slate-600 mt-0.5">📱 {conv.instanceName}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-slate-500">{fmtTime(conv.lastMessageAt)}</p>
                      {!conv.isAnswered && (
                        <p className="text-xs text-red-400 mt-0.5">{timeSince(conv.lastMessageAt)}</p>
                      )}
                    </div>
                  </div>

                  {conv.lastMessagePreview && (
                    <p className="text-xs text-slate-500 mt-2 line-clamp-1 italic">
                      &ldquo;{conv.lastMessagePreview}&rdquo;
                    </p>
                  )}

                  <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-600">
                    <span>{conv.totalMessages} msgs</span>
                    <span>↓{conv.inboundCount} ↑{conv.outboundCount}</span>
                    {!conv.isGroup && conv.responseTimeMinutes !== null && (
                      <span>Resposta: {fmtResponseTime(conv.responseTimeMinutes)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: Pending leads + Stalled Opps + Open Tickets */}
        <div className="space-y-6">
          {/* Pending Leads */}
          {pendingLeads.length > 0 && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">
                ⏰ Retornos pendentes
                <span className="ml-2 text-xs font-normal text-amber-400">
                  {pendingLeads.length}
                </span>
              </h2>
              <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                {pendingLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="flex items-center justify-between gap-2 py-2 border-b border-[#1e2d45] last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">
                        {lead.name ?? lead.phone}
                      </p>
                      <p className="text-xs text-slate-500">
                        {lead.pipeline ?? "—"} · {lead.pipelineStage ?? "—"}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {lead.expectedReturnAt && (
                        <p className="text-xs text-amber-400">
                          {fmtDate(lead.expectedReturnAt)} {fmtTime(lead.expectedReturnAt)}
                        </p>
                      )}
                      <p className="text-[10px] text-slate-500">{lead.attendanceStatus ?? "—"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stalled Opps */}
          {stalledOpps.length > 0 && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">
                🧊 Oportunidades paradas
                <span className="ml-2 text-xs font-normal text-slate-400">
                  +7 dias sem atualização
                </span>
              </h2>
              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                {stalledOpps.map((opp) => (
                  <div
                    key={opp.id}
                    className="flex items-center justify-between gap-2 py-2 border-b border-[#1e2d45] last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{opp.name ?? opp.phone}</p>
                      <p className="text-xs text-slate-500">{opp.pipelineStage ?? "—"}</p>
                    </div>
                    <p className="text-xs text-slate-500 flex-shrink-0">
                      {timeSince(opp.updatedAt)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Open Tickets */}
          {openTickets.length > 0 && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">
                🎫 Chamados abertos
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {openTickets.length}
                </span>
              </h2>
              <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                {openTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="flex items-start gap-2 py-2 border-b border-[#1e2d45] last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{ticket.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {statusLabel(ticket.status)} · {fmtDate(ticket.createdAt)}
                      </p>
                    </div>
                    <span className={`text-xs font-medium flex-shrink-0 ${priorityColor(ticket.priority)}`}>
                      {priorityLabel(ticket.priority)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingLeads.length === 0 && stalledOpps.length === 0 && openTickets.length === 0 && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-8 flex items-center justify-center text-slate-500 text-sm">
              Nenhum item pendente.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
