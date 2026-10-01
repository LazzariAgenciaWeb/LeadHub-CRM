"use client";

import { useEffect, useState } from "react";
import {
  Flag, History, MessageCircle, Bot, UserCheck, Users, Target, Milestone,
  RefreshCw, Eye, DollarSign, Trophy, CircleX, type LucideIcon,
} from "lucide-react";
import type { JourneyKind, JourneyStep, JourneySummary } from "@/app/api/leads/[id]/journey/route";

const KIND_META: Record<JourneyKind, { Icon: LucideIcon; color: string; dot: string }> = {
  origin:        { Icon: Flag,          color: "#a5b4fc", dot: "bg-indigo-500" },
  previous:      { Icon: History,       color: "#94a3b8", dot: "bg-slate-500" },
  first_contact: { Icon: MessageCircle, color: "#7dd3fc", dot: "bg-sky-500" },
  ai:            { Icon: Bot,           color: "#e879f9", dot: "bg-fuchsia-500" },
  human:         { Icon: UserCheck,     color: "#86efac", dot: "bg-green-500" },
  assigned:      { Icon: Users,         color: "#94a3b8", dot: "bg-slate-500" },
  pipeline:      { Icon: Target,        color: "#fcd34d", dot: "bg-amber-500" },
  stage:         { Icon: Milestone,     color: "#c4b5fd", dot: "bg-violet-500" },
  status:        { Icon: RefreshCw,     color: "#94a3b8", dot: "bg-slate-500" },
  link:          { Icon: Eye,           color: "#fbbf24", dot: "bg-amber-400" },
  value:         { Icon: DollarSign,    color: "#6ee7b7", dot: "bg-emerald-500" },
  won:           { Icon: Trophy,        color: "#4ade80", dot: "bg-green-400" },
  lost:          { Icon: CircleX,       color: "#f87171", dot: "bg-red-500" },
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) +
    " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtMinutes(m: number) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60 ? ` ${m % 60}min` : ""}`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-2.5 py-2 min-w-0">
      <div className="text-[9px] uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
      <div className={`text-xs font-semibold truncate ${tone ?? "text-slate-200"}`} title={value}>{value}</div>
    </div>
  );
}

/**
 * Jornada do lead até a venda: resumo + marcos em ordem cronológica.
 * Busca /api/leads/[id]/journey por conta própria (só carrega quando a aba
 * "Jornada" é aberta).
 */
export default function LeadJourney({ leadId }: { leadId: string }) {
  const [data, setData] = useState<{ summary: JourneySummary; steps: JourneyStep[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    fetch(`/api/leads/${leadId}/journey`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [leadId]);

  if (error) return <div className="text-slate-600 text-xs text-center py-6">Não foi possível carregar a jornada.</div>;
  if (!data) return <div className="text-slate-600 text-xs text-center py-6">Montando a jornada...</div>;

  const { summary, steps } = data;
  const outcome =
    summary.outcome === "won"  ? { label: "Venda fechada", tone: "text-green-400" } :
    summary.outcome === "lost" ? { label: "Perdido",       tone: "text-red-400" } :
                                 { label: "Em andamento",  tone: "text-amber-300" };

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid grid-cols-2 gap-1.5">
        <Stat label="Origem" value={summary.origin} />
        <Stat label="Situação" value={outcome.label} tone={outcome.tone} />
        <Stat
          label={summary.outcome === "open" ? "No funil há" : "Até o desfecho"}
          value={`${summary.days} dia${summary.days !== 1 ? "s" : ""}`}
        />
        <Stat
          label="1ª resposta"
          value={summary.firstResponseMinutes != null ? fmtMinutes(summary.firstResponseMinutes) : "—"}
        />
        <Stat label="Mensagens" value={`${summary.messagesIn} recebidas · ${summary.messagesOut} enviadas`} />
        <Stat
          label="Quem atendeu"
          value={[
            summary.aiInvolved ? "IA" : null,
            ...summary.attendants,
          ].filter(Boolean).join(", ") || "—"}
        />
      </div>

      {/* Marcos */}
      <ol className="relative ml-2 border-l border-[#1e2d45]">
        {steps.map((s) => {
          const m = KIND_META[s.kind] ?? KIND_META.status;
          return (
            <li key={s.id} className="relative pl-5 pb-4 last:pb-0">
              <span className={`absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ring-2 ring-[#0c1220] ${m.dot}`} />
              <div className="flex items-start justify-between gap-2">
                <span className="text-[12px] font-semibold flex items-center gap-1.5 min-w-0" style={{ color: m.color }}>
                  <m.Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2.25} />
                  <span className="break-words">{s.title}</span>
                </span>
                <span className="text-slate-500 text-[10px] flex-shrink-0 whitespace-nowrap mt-0.5">{fmtDate(s.timestamp)}</span>
              </div>
              {s.detail && (
                <p className="text-slate-400 text-[11px] leading-relaxed mt-0.5 break-words">{s.detail}</p>
              )}
              {s.actor && s.kind !== "human" && (
                <p className="text-slate-600 text-[10px] mt-0.5">por {s.actor}</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
