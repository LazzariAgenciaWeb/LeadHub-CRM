"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Negociacao {
  id: string;
  name: string | null;
  phone: string;
  pipeline: string | null;
  pipelineStage: string | null;
  status: string;
  resumo: string | null;
  expectedReturnAt?: string | null;
  updatedAt?: string;
  conversation?: { lastMessageAt: string | null } | null;
}

const PIPELINE_HREF: Record<string, string> = {
  PROSPECCAO: "/crm/prospeccao",
  LEADS: "/crm/leads",
  OPORTUNIDADES: "/crm/oportunidades",
};
function leadHref(l: { id: string; pipeline: string | null }) {
  return `${PIPELINE_HREF[l.pipeline ?? ""] ?? "/crm/leads"}?lead=${l.id}`;
}

function returnLabel(iso: string | null | undefined): { label: string; color: string } {
  if (!iso) return { label: "sem prazo", color: "text-slate-500" };
  const d = new Date(iso);
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  if (d < startToday) {
    const diffDays = Math.ceil((startToday.getTime() - d.getTime()) / 86400000);
    return { label: `⏰ retorno vencido há ${diffDays}d`, color: "text-red-400" };
  }
  return { label: `⏰ retornar hoje ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, color: "text-amber-400" };
}
function staleLabel(l: Negociacao): { label: string; color: string } {
  const ref = l.conversation?.lastMessageAt ?? l.updatedAt;
  const days = ref ? Math.max(0, Math.floor((Date.now() - new Date(ref).getTime()) / 86400000)) : 0;
  return { label: days === 0 ? "🧊 sem contato hoje" : `🧊 ${days}d sem contato`, color: "text-sky-400/80" };
}

function NegItem({ neg, label }: { neg: Negociacao; label: { label: string; color: string } }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true); setErr(null); setMsg(null);
    try {
      const res = await fetch("/api/ai/generate-followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: neg.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setMsg(data.message ?? null);
      else setErr(data.error ?? "Erro ao gerar follow-up.");
    } catch { setErr("Falha de conexão."); }
    setLoading(false);
  }
  function copy() {
    if (!msg) return;
    navigator.clipboard?.writeText(msg);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  return (
    <li className="rounded-lg bg-[#0a0f1a] border border-[#1e2d45] p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <Link href={leadHref(neg)} className="text-slate-200 text-[13px] font-medium hover:text-white truncate block">
            {neg.name ?? neg.phone}
          </Link>
          <span className={`text-[11px] ${label.color}`}>{label.label}</span>
          {neg.resumo && (
            <p className="text-slate-500 text-[11px] mt-1 leading-snug line-clamp-2">📝 {neg.resumo}</p>
          )}
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="text-[10px] px-2.5 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 font-medium hover:bg-emerald-600/30 disabled:opacity-50 flex-shrink-0"
        >
          {loading ? "..." : "✨ Follow-up"}
        </button>
      </div>
      {err && <div className="mt-2 text-[11px] text-amber-300">{err}</div>}
      {msg && (
        <div className="mt-2">
          <div className="bg-[#0f1623] border border-emerald-500/20 rounded-lg p-2.5 text-slate-200 text-[12px] leading-relaxed whitespace-pre-wrap">{msg}</div>
          <div className="flex gap-1.5 mt-1.5">
            <button onClick={copy} className="text-[10px] px-2 py-1 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:bg-[#1e2d45]">{copied ? "✓ Copiado" : "Copiar"}</button>
            <Link href={leadHref(neg)} className="text-[10px] px-2 py-1 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30">Abrir conversa →</Link>
          </div>
        </div>
      )}
    </li>
  );
}

export default function NegociacoesPanel() {
  const [data, setData] = useState<{ leadsFollowUp: Negociacao[]; staleLeads: Negociacao[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai/negociacoes");
        if (!cancelled && res.ok) setData(await res.json());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const followUps = data?.leadsFollowUp ?? [];
  const stale = data?.staleLeads ?? [];
  const total = followUps.length + stale.length;

  return (
    <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-white font-bold text-sm flex items-center gap-2">💼 Negociações pra agir</h2>
        {total > 0 && (
          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30 font-bold">{total}</span>
        )}
      </div>
      <p className="text-slate-500 text-xs mb-4">
        Diagnóstico instantâneo de quem precisa de retorno. Clique em <strong>✨ Follow-up</strong> pra a IA escrever a mensagem de retomada daquele contato.
      </p>

      {loading ? (
        <div className="text-slate-600 text-xs italic py-4">Carregando negociações...</div>
      ) : total === 0 ? (
        <div className="text-slate-600 text-xs italic py-4">Nenhuma negociação precisando de ação agora. 👏</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">⏰ Pra retornar</div>
            {followUps.length === 0 ? (
              <div className="text-slate-600 text-xs italic py-2">Nada marcado pra retornar.</div>
            ) : (
              <ul className="space-y-2">
                {followUps.map((l) => <NegItem key={l.id} neg={l} label={returnLabel(l.expectedReturnAt)} />)}
              </ul>
            )}
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">🧊 Esfriando</div>
            {stale.length === 0 ? (
              <div className="text-slate-600 text-xs italic py-2">Nada esfriando.</div>
            ) : (
              <ul className="space-y-2">
                {stale.map((l) => <NegItem key={l.id} neg={l} label={staleLabel(l)} />)}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
