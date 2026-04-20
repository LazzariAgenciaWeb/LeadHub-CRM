"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
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

interface ConvSummary {
  summary: string;
  quality: string;
  qualityColor: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
    case "URGENT": return "text-red-400 bg-red-500/10 border-red-500/30";
    case "HIGH":   return "text-orange-400 bg-orange-500/10 border-orange-500/30";
    case "MEDIUM": return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
    default:       return "text-slate-400 bg-slate-500/10 border-slate-500/30";
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

function qualityInfo(conv: Conv): {
  emoji: string;
  label: string;
  badgeClass: string;
} {
  if (!conv.isAnswered) {
    return {
      emoji: "🔴",
      label: "Sem resposta",
      badgeClass: "bg-red-500/15 text-red-400 border border-red-500/30",
    };
  }
  if (conv.responseTimeMinutes === null) {
    return {
      emoji: "🟢",
      label: "Respondida",
      badgeClass: "bg-green-500/15 text-green-400 border border-green-500/30",
    };
  }
  if (conv.responseTimeMinutes < 15) {
    return {
      emoji: "🟢",
      label: `Rápido · ${fmtResponseTime(conv.responseTimeMinutes)}`,
      badgeClass: "bg-green-500/15 text-green-400 border border-green-500/30",
    };
  }
  if (conv.responseTimeMinutes < 60) {
    return {
      emoji: "🔵",
      label: `Ok · ${fmtResponseTime(conv.responseTimeMinutes)}`,
      badgeClass: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
    };
  }
  return {
    emoji: "🟡",
    label: `Demorado · ${fmtResponseTime(conv.responseTimeMinutes)}`,
    badgeClass: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30",
  };
}

function aiQualityClass(qualityColor: string): string {
  switch (qualityColor) {
    case "green":  return "bg-green-500/10 text-green-400 border-green-500/20";
    case "blue":   return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "yellow": return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    default:       return "bg-red-500/10 text-red-400 border-red-500/20";
  }
}

// ── Custom Tooltip ─────────────────────────────────────────────────────────────

interface CustomTooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
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

  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedDateKey, setSelectedDateKey] = useState<string>(yesterdayKey);
  const [selectedDayConvs, setSelectedDayConvs] = useState<Conv[] | null>(null);
  const [loadingDayConvs, setLoadingDayConvs] = useState(false);
  const [showChart, setShowChart] = useState(false);

  // Overall AI analysis
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Per-conversation AI summaries
  const [convSummaries, setConvSummaries] = useState<Map<string, ConvSummary>>(new Map());
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);

  // Chat Q&A
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Load cached AI result
  useEffect(() => {
    try {
      const key = `ai_atendimento_${companyId}_${todayKey}`;
      const cached = localStorage.getItem(key);
      if (cached) setAiResult(JSON.parse(cached));
    } catch { /* ignore */ }
  }, [companyId, todayKey]);

  // Scroll chat to bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatLoading]);

  // ── Current conversations ─────────────────────────────────────────────────
  const currentConvs: Conv[] =
    selectedDateKey === yesterdayKey ? yesterdayConvs : (selectedDayConvs ?? []);

  const selectedDayData = dailyGraph.find((d) => d.dateKey === selectedDateKey);

  // ── Bar click ─────────────────────────────────────────────────────────────
  async function handleBarClick(data: DayData) {
    const { dateKey } = data;
    setSelectedDateKey(dateKey);
    setConvSummaries(new Map()); // clear summaries when switching days
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
      if (res.ok) setSelectedDayConvs(await res.json() as Conv[]);
    } catch { /* ignore */ } finally {
      setLoadingDayConvs(false);
    }
  }

  // ── Overall AI analysis ───────────────────────────────────────────────────
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
          periodLabel: `${fmtDate(yesterdayDate.toISOString())} (ontem)`,
          metrics: { total, respondidas, pendentes, taxaResposta, avgResponseMin },
          instanceStats,
          pendingConvs,
          pendingLeads: pendingLeads.slice(0, 10),
          stalledOpps: stalledOpps.slice(0, 5),
          openTickets: openTickets.slice(0, 10),
        }),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setAiError((b as { error?: string }).error ?? "Erro ao gerar análise.");
        return;
      }
      const result = await res.json() as AiResult;
      setAiResult(result);
      try {
        localStorage.setItem(`ai_atendimento_${companyId}_${todayKey}`, JSON.stringify(result));
      } catch { /* ignore */ }
    } catch {
      setAiError("Erro de conexão. Tente novamente.");
    } finally {
      setAiLoading(false);
    }
  }

  // ── Per-conversation summarization ────────────────────────────────────────
  async function handleSummarize() {
    if (summarizing || currentConvs.length === 0) return;
    setSummarizing(true);
    setSummarizeError(null);

    const periodLabel =
      selectedDateKey === yesterdayKey
        ? "Ontem"
        : dailyGraph.find((d) => d.dateKey === selectedDateKey)?.label ?? selectedDateKey;

    try {
      const res = await fetch("/api/ai/atendimento/resumos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversations: currentConvs.slice(0, 30), periodLabel }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setSummarizeError((b as { error?: string }).error ?? "Erro ao resumir.");
        return;
      }
      const summaries = await res.json() as {
        phone: string;
        summary: string;
        quality: string;
        qualityColor: string;
      }[];
      const map = new Map<string, ConvSummary>();
      for (const s of summaries) {
        map.set(s.phone, { summary: s.summary, quality: s.quality, qualityColor: s.qualityColor });
      }
      setConvSummaries(map);
    } catch {
      setSummarizeError("Erro de conexão.");
    } finally {
      setSummarizing(false);
    }
  }

  // ── Chat Q&A ──────────────────────────────────────────────────────────────
  async function handleSendChat() {
    if (!chatInput.trim() || chatLoading) return;
    const question = chatInput.trim();
    setChatInput("");
    setChatError(null);
    setChatLoading(true);

    const newHistory: ChatMessage[] = [...chatHistory, { role: "user", content: question }];
    setChatHistory(newHistory);

    try {
      const res = await fetch("/api/ai/atendimento/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          context: {
            yesterdayConvs,
            pendingLeads,
            stalledOpps,
            openTickets,
            instanceStats,
            periodLabel: "Ontem",
          },
          history: chatHistory.slice(-6),
        }),
      });

      if (res.ok) {
        const { answer } = await res.json() as { answer: string };
        setChatHistory([...newHistory, { role: "assistant", content: answer }]);
      } else {
        const { error } = await res.json().catch(() => ({ error: "Erro desconhecido" }));
        setChatError(error ?? "Erro ao processar pergunta.");
        setChatHistory(newHistory);
      }
    } catch {
      setChatError("Erro de conexão.");
      setChatHistory(newHistory);
    } finally {
      setChatLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const selectedDayLabel =
    selectedDateKey === yesterdayKey
      ? "Ontem"
      : dailyGraph.find((d) => d.dateKey === selectedDateKey)?.label ?? selectedDateKey;

  return (
    <div className="min-h-screen bg-[#080b12] text-white p-6 space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            🤖 Assistente IA
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Acompanhe atendimentos, chamados e leads — pergunte o que precisar
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Summarize conversations button */}
          {currentConvs.length > 0 && (
            <button
              onClick={handleSummarize}
              disabled={summarizing}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#0f1623] hover:bg-[#162033] border border-[#1e2d45] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm transition-colors text-slate-300"
            >
              {summarizing ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-slate-500 border-t-slate-300 rounded-full animate-spin" />
                  Resumindo...
                </>
              ) : convSummaries.size > 0 ? (
                "✨ Resumir novamente"
              ) : (
                "✨ Resumir conversas"
              )}
            </button>
          )}

          {/* Overall AI analysis button */}
          {aiResult ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">
                Análise gerada às {aiResult.generatedAt}
              </span>
              <button
                onClick={() => handleGenerateAI(true)}
                disabled={aiLoading}
                className="text-xs text-indigo-400 hover:text-indigo-300 underline disabled:opacity-50"
              >
                {aiLoading ? "Analisando..." : "Reanalisar"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleGenerateAI(false)}
              disabled={aiLoading}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {aiLoading ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analisando...
                </>
              ) : (
                "🧠 Análise geral IA"
              )}
            </button>
          )}
        </div>
      </div>

      {/* Errors */}
      {(aiError || summarizeError) && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {aiError ?? summarizeError}
        </div>
      )}

      {/* ── AI Overall Analysis ── */}
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
                Avaliação geral:{" "}
                <span className="text-indigo-300">{aiResult.rating}</span>
              </p>
              <p className="text-xs text-slate-400">Baseada nos dados de ontem</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2">Pontos positivos</p>
              <ul className="space-y-1.5">
                {aiResult.highlights.map((h, i) => (
                  <li key={i} className="text-sm text-slate-300 flex gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>{h}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-2">Atenção</p>
              <ul className="space-y-1.5">
                {aiResult.attention.map((a, i) => (
                  <li key={i} className="text-sm text-slate-300 flex gap-2">
                    <span className="text-yellow-400 flex-shrink-0">⚠</span>{a}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">Ações recomendadas</p>
              <ul className="space-y-1.5">
                {aiResult.actions.map((a, i) => (
                  <li key={i} className="text-sm text-slate-300 flex gap-2">
                    <span className="text-indigo-400 flex-shrink-0">{i + 1}.</span>{a}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content: conversations + action items ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">

        {/* ── Left: Conversations ── */}
        <div className="lg:col-span-3 space-y-3">
          {/* Section header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">
                Conversas — {selectedDayLabel}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {currentConvs.length} conversa{currentConvs.length !== 1 ? "s" : ""}
                {selectedDayData && selectedDayData.total > 0 && (
                  <> · {Math.round((selectedDayData.respondidas / selectedDayData.total) * 100)}% respondidas</>
                )}
              </p>
            </div>
            <button
              onClick={() => setShowChart((v) => !v)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
            >
              {showChart ? "▲ Ocultar gráfico" : "▼ Ver gráfico 30 dias"}
            </button>
          </div>

          {/* 30-day chart (collapsible) */}
          {showChart && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-3">Clique em uma barra para ver aquele dia</p>
              <div className="flex items-center gap-4 text-xs text-slate-500 mb-2">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500 inline-block" /> Respondidas</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" /> Pendentes</span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={dailyGraph}
                  margin={{ top: 2, right: 4, left: -20, bottom: 0 }}
                  onClick={(e: unknown) => {
                    const ev = e as { activePayload?: { payload?: DayData }[] } | null;
                    if (ev?.activePayload?.[0]?.payload) {
                      handleBarClick(ev.activePayload[0].payload as DayData);
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} interval={4} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomBarTooltip data={dailyGraph} />} cursor={{ fill: "rgba(99,102,241,0.08)" }} />
                  <Bar dataKey="respondidas" stackId="a" fill="#22c55e">
                    {dailyGraph.map((entry) => (
                      <Cell key={entry.dateKey} fill={entry.dateKey === selectedDateKey ? "#4ade80" : "#22c55e"} />
                    ))}
                  </Bar>
                  <Bar dataKey="pendentes" stackId="a" fill="#ef4444" radius={[3, 3, 0, 0]}>
                    {dailyGraph.map((entry) => (
                      <Cell key={entry.dateKey} fill={entry.dateKey === selectedDateKey ? "#f87171" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Conversation cards */}
          {loadingDayConvs ? (
            <div className="flex items-center justify-center py-16 text-slate-500 text-sm gap-2">
              <span className="inline-block w-4 h-4 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
              Carregando conversas...
            </div>
          ) : currentConvs.length === 0 ? (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-10 flex items-center justify-center text-slate-500 text-sm">
              Nenhuma conversa neste dia.
            </div>
          ) : (
            <div className="space-y-2">
              {currentConvs.map((conv) => {
                const q = qualityInfo(conv);
                const aiSum = convSummaries.get(conv.phone);
                return (
                  <div
                    key={conv.phone}
                    className={`rounded-xl border p-4 transition-colors ${
                      conv.isAnswered
                        ? "border-[#1e2d45] bg-[#0d1525] hover:border-[#2a3d5a]"
                        : "border-red-500/25 bg-red-500/5 hover:border-red-500/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: name + badges */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-white truncate">
                            {conv.contactName ?? conv.phone}
                          </span>
                          {conv.isGroup && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-300">
                              Grupo
                            </span>
                          )}
                          {/* Quality badge */}
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${q.badgeClass}`}>
                            {q.emoji} {q.label}
                          </span>
                        </div>

                        {/* Sub info */}
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                          {conv.contactName && <span>{conv.phone}</span>}
                          {conv.instanceName && <span>📱 {conv.instanceName}</span>}
                          <span>{conv.totalMessages} msgs ({conv.inboundCount}↓ {conv.outboundCount}↑)</span>
                          <span>{fmtTime(conv.firstMessageAt)} → {fmtTime(conv.lastMessageAt)}</span>
                        </div>

                        {/* Last message preview */}
                        {conv.lastMessagePreview && !aiSum && (
                          <p className="text-xs text-slate-500 mt-2 italic line-clamp-1">
                            &ldquo;{conv.lastMessagePreview}&rdquo;
                          </p>
                        )}

                        {/* AI Summary (shown after summarize) */}
                        {aiSum && (
                          <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${aiQualityClass(aiSum.qualityColor)}`}>
                            <span className="font-medium mr-1">IA:</span>{aiSum.summary}
                          </div>
                        )}
                      </div>

                      {/* Right: time + action */}
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <span className="text-xs text-slate-500">{fmtTime(conv.lastMessageAt)}</span>
                        {!conv.isAnswered && (
                          <span className="text-[10px] text-red-400">{timeSince(conv.lastMessageAt)}</span>
                        )}
                        {!conv.isGroup && (
                          <Link
                            href={`/whatsapp?abrir=${encodeURIComponent(conv.phone)}`}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 transition-colors whitespace-nowrap"
                          >
                            Ver conversa →
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right: Action items ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* ── KPI summary for selected day ── */}
          {selectedDayData && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">{selectedDayLabel}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-slate-500">Total</p>
                  <p className="text-xl font-bold text-white">{selectedDayData.total}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Respondidas</p>
                  <p className="text-xl font-bold text-green-400">
                    {selectedDayData.respondidas}
                    <span className="text-xs text-slate-500 font-normal ml-1">
                      {selectedDayData.total > 0
                        ? `${Math.round((selectedDayData.respondidas / selectedDayData.total) * 100)}%`
                        : ""}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Pendentes</p>
                  <p className="text-xl font-bold text-red-400">{selectedDayData.pendentes}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Tempo médio</p>
                  <p className="text-xl font-bold text-indigo-400">
                    {fmtResponseTime(selectedDayData.avgResponseMin > 0 ? selectedDayData.avgResponseMin : null)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Pending Leads ── */}
          {pendingLeads.length > 0 && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                  ⏰ Retornos pendentes
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">
                  {pendingLeads.length}
                </span>
              </div>
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-0.5">
                {pendingLeads.map((lead) => (
                  <div key={lead.id} className="group flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-200 truncate group-hover:text-white transition-colors">
                        {lead.name ?? lead.phone}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {[lead.pipeline, lead.pipelineStage].filter(Boolean).join(" · ") || "—"}
                      </p>
                      {lead.expectedReturnAt && (
                        <p className="text-xs text-amber-400 mt-0.5">
                          Retorno: {fmtDate(lead.expectedReturnAt)} {fmtTime(lead.expectedReturnAt)}
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/crm/leads`}
                      className="flex-shrink-0 text-[10px] px-2 py-1 rounded bg-[#1a2535] hover:bg-[#243249] text-slate-400 hover:text-slate-200 transition-colors border border-[#253449]"
                    >
                      Ver →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Stalled Opps ── */}
          {stalledOpps.length > 0 && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                  🧊 Oportunidades paradas
                </h3>
                <span className="text-xs text-slate-500">+7 dias</span>
              </div>
              <div className="space-y-2 max-h-[180px] overflow-y-auto pr-0.5">
                {stalledOpps.map((opp) => (
                  <div key={opp.id} className="group flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-200 truncate group-hover:text-white transition-colors">
                        {opp.name ?? opp.phone}
                      </p>
                      <p className="text-xs text-slate-500">
                        {opp.pipelineStage ?? "—"} · parada há {timeSince(opp.updatedAt)}
                      </p>
                    </div>
                    <Link
                      href="/crm/oportunidades"
                      className="flex-shrink-0 text-[10px] px-2 py-1 rounded bg-[#1a2535] hover:bg-[#243249] text-slate-400 hover:text-slate-200 transition-colors border border-[#253449]"
                    >
                      Ver →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Open Tickets ── */}
          {openTickets.length > 0 && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                  🎫 Chamados abertos
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">
                  {openTickets.length}
                </span>
              </div>
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-0.5">
                {openTickets.map((ticket) => (
                  <div key={ticket.id} className="group flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-200 truncate group-hover:text-white transition-colors">
                        {ticket.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${priorityColor(ticket.priority)}`}>
                          {priorityLabel(ticket.priority)}
                        </span>
                        <span className="text-xs text-slate-500">{statusLabel(ticket.status)}</span>
                        <span className="text-xs text-slate-600">{fmtDate(ticket.createdAt)}</span>
                      </div>
                    </div>
                    <Link
                      href={`/chamados/${ticket.id}`}
                      className="flex-shrink-0 text-[10px] px-2 py-1 rounded bg-[#1a2535] hover:bg-[#243249] text-slate-400 hover:text-slate-200 transition-colors border border-[#253449]"
                    >
                      Abrir →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Instance stats ── */}
          {instanceStats.length > 0 && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3">📱 Instâncias (30 dias)</h3>
              <div className="space-y-2">
                {instanceStats.map((inst) => (
                  <div key={inst.name} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-300 truncate">{inst.name}</span>
                        <span
                          className={`text-xs font-medium ml-2 flex-shrink-0 ${
                            inst.taxaResposta >= 80
                              ? "text-green-400"
                              : inst.taxaResposta >= 50
                              ? "text-yellow-400"
                              : "text-red-400"
                          }`}
                        >
                          {inst.taxaResposta}%
                        </span>
                      </div>
                      <div className="w-full bg-[#1e2d45] rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${
                            inst.taxaResposta >= 80
                              ? "bg-green-500"
                              : inst.taxaResposta >= 50
                              ? "bg-yellow-500"
                              : "bg-red-500"
                          }`}
                          style={{ width: `${inst.taxaResposta}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingLeads.length === 0 && stalledOpps.length === 0 && openTickets.length === 0 && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-8 flex items-center justify-center text-slate-500 text-sm">
              ✅ Nenhum item pendente
            </div>
          )}
        </div>
      </div>

      {/* ── Chat Q&A ── */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        {/* Chat header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#1e2d45]">
          <div className="w-8 h-8 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-base">
            🤖
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Pergunte ao Assistente</p>
            <p className="text-xs text-slate-500">
              Busca nos dados de atendimento, chamados e leads
            </p>
          </div>
        </div>

        {/* Chat messages */}
        <div className="px-5 py-4 space-y-4 min-h-[80px] max-h-[400px] overflow-y-auto">
          {chatHistory.length === 0 && !chatLoading && (
            <div className="text-center text-slate-600 text-sm py-4">
              <p>Exemplos: &ldquo;Quem não foi respondido ontem?&rdquo; · &ldquo;Quais chamados estão urgentes?&rdquo; · &ldquo;Quem precisa de retorno hoje?&rdquo;</p>
            </div>
          )}

          {chatHistory.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-xs mr-2 flex-shrink-0 mt-0.5">
                  🤖
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white rounded-tr-sm"
                    : "bg-[#162033] border border-[#1e2d45] text-slate-200 rounded-tl-sm"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {chatLoading && (
            <div className="flex justify-start">
              <div className="w-6 h-6 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-xs mr-2 flex-shrink-0">
                🤖
              </div>
              <div className="bg-[#162033] border border-[#1e2d45] rounded-xl rounded-tl-sm px-4 py-3">
                <span className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
                </span>
              </div>
            </div>
          )}

          {chatError && (
            <p className="text-xs text-red-400 text-center">{chatError}</p>
          )}

          <div ref={chatBottomRef} />
        </div>

        {/* Chat input */}
        <div className="px-5 py-4 border-t border-[#1e2d45] flex items-end gap-3">
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendChat();
              }
            }}
            placeholder="Pergunte algo sobre os atendimentos, chamados ou leads..."
            rows={1}
            className="flex-1 bg-[#0a1120] border border-[#1e2d45] rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-indigo-500/50 transition-colors"
            style={{ minHeight: "44px", maxHeight: "120px" }}
          />
          <button
            onClick={handleSendChat}
            disabled={chatLoading || !chatInput.trim()}
            className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {chatLoading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
