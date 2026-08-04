"use client";

import { useState } from "react";
import Link from "next/link";

export type AttentionReason =
  | { kind: "unanswered"; at: string | null; body: string | null }
  | { kind: "overdue"; at: string | null }
  | { kind: "stale"; days: number };

export interface AttentionItem {
  id: string;
  name: string | null;
  phone: string;
  pipeline: string | null;
  pipelineStage: string | null;
  reasons: AttentionReason[];
}

const PIPELINE_HREF: Record<string, string> = {
  PROSPECCAO: "/crm/prospeccao",
  LEADS: "/crm/leads",
  OPORTUNIDADES: "/crm/oportunidades",
};

const PIPELINE_BADGE: Record<string, { label: string; color: string }> = {
  PROSPECCAO:    { label: "Prospecção",   color: "text-violet-400 bg-violet-500/15" },
  LEADS:         { label: "Lead",         color: "text-indigo-400 bg-indigo-500/15" },
  OPORTUNIDADES: { label: "Oportunidade", color: "text-amber-400 bg-amber-500/15" },
};

function leadHref(l: { id: string; pipeline: string | null }) {
  const base = PIPELINE_HREF[l.pipeline ?? ""] ?? "/crm/leads";
  return `${base}?lead=${l.id}`;
}

function timeSince(d: string | null): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "agora";
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function staleUrgency(days: number): { badge: string; color: string; suggestion: string } {
  if (days <= 7)  return { badge: "Morno",      color: "text-amber-400",  suggestion: "Retome o contato em breve" };
  if (days <= 14) return { badge: "Esfriando",  color: "text-orange-400", suggestion: "Contato urgente necessário" };
  if (days <= 30) return { badge: "Frio",       color: "text-red-400",    suggestion: "Últimas tentativas ou arquivar" };
  return               { badge: "Muito frio",  color: "text-slate-500",  suggestion: "Campanha de reengajamento" };
}

function ReasonBadges({ reasons }: { reasons: AttentionReason[] }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-1">
      {reasons.map((r, i) => {
        if (r.kind === "unanswered") {
          return (
            <span key={i} className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
              🔴 Sem resposta {r.at ? `· ${timeSince(r.at)}` : ""}
            </span>
          );
        }
        if (r.kind === "overdue") {
          const d = r.at ? new Date(r.at) : null;
          const now = Date.now();
          const label = d
            ? d.getTime() < now
              ? `Atrasado ${Math.ceil((now - d.getTime()) / 86400000)}d`
              : `Hoje ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
            : "sem prazo";
          return (
            <span key={i} className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
              ⏰ {label}
            </span>
          );
        }
        const urg = staleUrgency(r.days);
        return (
          <span key={i} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded bg-sky-500/10 ${urg.color}`}>
            🧊 {urg.badge} · {r.days}d
          </span>
        );
      })}
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [resumo, setResumo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pl = PIPELINE_BADGE[item.pipeline ?? ""];
  const staleReason = item.reasons.find((r) => r.kind === "stale") as Extract<AttentionReason, { kind: "stale" }> | undefined;
  const suggestion = staleReason ? staleUrgency(staleReason.days).suggestion : null;

  async function generate() {
    setLoading(true); setErr(null); setMsg(null); setResumo(null);
    try {
      const res = await fetch("/api/ai/generate-followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: item.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setMsg(data.message ?? null); setResumo(data.resumo ?? null); }
      else setErr(data.error ?? "Erro ao gerar follow-up.");
    } catch {
      setErr("Falha de conexão.");
    }
    setLoading(false);
  }
  function copy() {
    if (!msg) return;
    navigator.clipboard?.writeText(msg);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="border-b border-[#1e2d45]/50 last:border-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-8 h-8 rounded-full bg-[#1e2d45] flex items-center justify-center text-xs font-bold text-slate-400 flex-shrink-0">
          {(item.name ?? item.phone).slice(0, 2).toUpperCase()}
        </div>
        <Link href={leadHref(item)} className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-200 text-[13px] font-medium truncate">{item.name ?? item.phone}</span>
            {pl && <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${pl.color}`}>{pl.label}</span>}
            {item.pipelineStage && <span className="text-slate-600 text-[10px] truncate">{item.pipelineStage}</span>}
          </div>
          <ReasonBadges reasons={item.reasons} />
          {suggestion && <div className="text-slate-600 text-[10px] mt-0.5 italic">{suggestion}</div>}
        </Link>
        <button
          onClick={generate}
          disabled={loading}
          className="text-[10px] px-2 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 font-medium hover:bg-emerald-600/30 disabled:opacity-50 flex-shrink-0"
        >
          {loading ? "..." : "✨ Follow-up"}
        </button>
      </div>
      {err && <div className="px-4 pb-2 text-[11px] text-amber-300">{err}</div>}
      {msg && (
        <div className="px-4 pb-3">
          {resumo && (
            <div className="mb-1.5 bg-[#0b1220] border border-[#1e2d45] rounded-lg p-2 text-slate-400 text-[11px] leading-snug">
              <span className="text-slate-600 font-semibold">Resumo:</span> {resumo}
            </div>
          )}
          <div className="bg-[#0f1623] border border-emerald-500/20 rounded-lg p-2.5 text-slate-200 text-[12px] leading-relaxed whitespace-pre-wrap">
            {msg}
          </div>
          <div className="flex gap-1.5 mt-1.5">
            <button onClick={copy} className="text-[10px] px-2 py-1 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:bg-[#1e2d45]">
              {copied ? "✓ Copiado" : "Copiar"}
            </button>
            <Link href={leadHref(item)} className="text-[10px] px-2 py-1 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30">
              Abrir conversa →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="bg-[#0f1623] border border-red-500/20 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-red-500/10 flex items-center justify-between">
        <h2 className="text-white font-bold text-sm flex items-center gap-2">
          🚨 Precisam de atenção
          <span className="text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full font-bold">{items.length}</span>
        </h2>
        <span className="text-slate-500 text-xs hidden sm:block">Sem resposta · retornos · esfriando</span>
      </div>
      <div>
        {items.map((item) => (
          <AttentionRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
