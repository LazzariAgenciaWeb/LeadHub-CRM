"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface FollowUpLead {
  id: string;
  name: string | null;
  phone: string;
  pipeline: string | null;
  pipelineStage: string | null;
  expectedReturnAt: string | null;
  status: string;
}

interface StaleLead {
  id: string;
  name: string | null;
  phone: string;
  pipeline: string | null;
  pipelineStage: string | null;
  status: string;
  updatedAt: string;
  conversation: { lastMessageAt: string | null } | null;
}

const PIPELINE_HREF: Record<string, string> = {
  PROSPECCAO: "/crm/prospeccao",
  LEADS: "/crm/leads",
  OPORTUNIDADES: "/crm/oportunidades",
};

const PIPELINE_BADGE: Record<string, { label: string; color: string }> = {
  PROSPECCAO:    { label: "Prospect",     color: "text-violet-400 bg-violet-500/15 border-violet-500/30" },
  LEADS:         { label: "Lead",         color: "text-indigo-400 bg-indigo-500/15 border-indigo-500/30" },
  OPORTUNIDADES: { label: "Oportunidade", color: "text-amber-400 bg-amber-500/15 border-amber-500/30" },
};

function leadHref(l: { id: string; pipeline: string | null }): string {
  const base = PIPELINE_HREF[l.pipeline ?? ""] ?? "/crm/leads";
  return `${base}?lead=${l.id}`;
}

function returnLabel(iso: string | null): { label: string; color: string } {
  if (!iso) return { label: "sem prazo", color: "text-slate-500" };
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d < startToday) {
    const diffDays = Math.ceil((startToday.getTime() - d.getTime()) / 86400000);
    return { label: `atrasado ${diffDays}d`, color: "text-red-400" };
  }
  return { label: `hoje ${time}`, color: "text-amber-400" };
}

function daysSince(stale: StaleLead): number {
  const ref = stale.conversation?.lastMessageAt ?? stale.updatedAt;
  const diff = Date.now() - new Date(ref).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function PipelineBadge({ pipeline }: { pipeline: string | null }) {
  const b = PIPELINE_BADGE[pipeline ?? ""];
  if (!b) return null;
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${b.color} flex-shrink-0`}>
      {b.label}
    </span>
  );
}

export default function FollowUpsToday() {
  const [data, setData] = useState<{ leadsFollowUp: FollowUpLead[]; staleLeads: StaleLead[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/followups/me");
        if (!cancelled && res.ok) setData(await res.json());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Some silenciosamente quando carregando ou sem nada — sem "card vazio" no topo.
  if (loading || !data) return null;
  const followUps = data.leadsFollowUp ?? [];
  const stale = data.staleLeads ?? [];
  if (followUps.length === 0 && stale.length === 0) return null;

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-white font-bold text-sm flex items-center gap-2">
          📞 Follow-ups do CRM
        </h2>
        {followUps.length > 0 && (
          <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30 font-bold">
            {followUps.length} pra retornar
          </span>
        )}
        {stale.length > 0 && (
          <span className="text-[10px] bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full border border-sky-500/30 font-bold">
            🧊 {stale.length} esfriando
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pra retornar hoje */}
        <div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            ⏰ Pra retornar hoje
          </div>
          {followUps.length === 0 ? (
            <div className="text-slate-600 text-xs italic py-2">Nenhum retorno marcado pra hoje.</div>
          ) : (
            <ul className="space-y-1.5">
              {followUps.map((l) => {
                const r = returnLabel(l.expectedReturnAt);
                return (
                  <li key={l.id}>
                    <Link
                      href={leadHref(l)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0a0f1a] border border-[#1e2d45] hover:border-amber-500/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-200 text-[12.5px] font-medium truncate">
                            {l.name ?? l.phone}
                          </span>
                          <PipelineBadge pipeline={l.pipeline} />
                        </div>
                        <span className={`text-[11px] ${r.color}`}>{r.label}</span>
                      </div>
                      <span className="text-slate-600 hover:text-white text-xs flex-shrink-0">→</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Esfriando */}
        <div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            🧊 Esfriando — sem contato
          </div>
          {stale.length === 0 ? (
            <div className="text-slate-600 text-xs italic py-2">Nada esfriando. 👏</div>
          ) : (
            <ul className="space-y-1.5">
              {stale.map((l) => {
                const days = daysSince(l);
                return (
                  <li key={l.id}>
                    <Link
                      href={leadHref(l)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0a0f1a] border border-[#1e2d45] hover:border-sky-500/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-200 text-[12.5px] font-medium truncate">
                            {l.name ?? l.phone}
                          </span>
                          <PipelineBadge pipeline={l.pipeline} />
                        </div>
                        <span className="text-[11px] text-sky-400/80">
                          {days === 0 ? "sem contato hoje" : `${days}d sem contato`}
                        </span>
                      </div>
                      <span className="text-slate-600 hover:text-white text-xs flex-shrink-0">→</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
