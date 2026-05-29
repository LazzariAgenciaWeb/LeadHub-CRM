"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Campaign {
  id: string;
  name: string;
  subject: string;
  status: "DRAFT" | "SCHEDULED" | "SENDING" | "PAUSED" | "COMPLETED" | "FAILED";
  scheduledAt: string | null;
  totalRecipients: number;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  bouncedCount: number;
  unsubscribedCount: number;
  template: { id: string; name: string } | null;
  createdAt: string;
}

const STATUS_META: Record<Campaign["status"], { label: string; color: string }> = {
  DRAFT:     { label: "Rascunho",   color: "bg-slate-500/20 text-slate-300 border-slate-500/40" },
  SCHEDULED: { label: "Agendada",   color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40" },
  SENDING:   { label: "Enviando",   color: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  PAUSED:    { label: "Pausada",    color: "bg-orange-500/20 text-orange-300 border-orange-500/40" },
  COMPLETED: { label: "Concluída",  color: "bg-green-500/20 text-green-300 border-green-500/40" },
  FAILED:    { label: "Falhou",     color: "bg-red-500/20 text-red-300 border-red-500/40" },
};

export default function EmailCampaignsSection({ companyId }: { companyId?: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  const qs = companyId ? `?companyId=${companyId}` : "";

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/email/campaigns${qs}`);
        if (res.ok) setCampaigns(await res.json());
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line
  }, []);

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-white font-bold text-sm">🚀 Campanhas</h2>
          <p className="text-slate-500 text-xs">Disparos em massa com cadência.</p>
        </div>
        <Link
          href={`/campanhas/email/campanhas/nova${companyId ? `?companyId=${companyId}` : ""}`}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
        >
          + Nova campanha
        </Link>
      </div>

      {loading ? (
        <p className="text-slate-600 text-xs text-center py-6">Carregando...</p>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-3xl mb-2">🚀</div>
          <p className="text-slate-500 text-sm">Nenhuma campanha ainda.</p>
          <p className="text-slate-600 text-xs mt-1">Crie a primeira pra começar a disparar.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => {
            const st = STATUS_META[c.status];
            const pct = c.totalRecipients > 0 ? Math.round((c.sentCount / c.totalRecipients) * 100) : 0;
            const openRate = c.sentCount > 0 ? Math.round((c.openedCount / c.sentCount) * 100) : 0;
            return (
              <li key={c.id}>
                <Link
                  href={`/campanhas/email/campanhas/${c.id}`}
                  className="block bg-[#0a0f1a] border border-[#1e2d45] rounded-lg p-3 hover:border-indigo-500/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-white text-sm font-medium truncate">{c.name}</div>
                      <div className="text-slate-500 text-xs truncate">{c.subject}</div>
                    </div>
                    <span className={`text-[10px] font-bold uppercase border px-2 py-0.5 rounded ${st.color}`}>
                      {st.label}
                    </span>
                  </div>
                  {c.totalRecipients > 0 && (
                    <div className="flex items-center gap-3 text-[11px] text-slate-400">
                      <span><strong className="text-white">{c.sentCount}</strong>/{c.totalRecipients} enviados ({pct}%)</span>
                      {c.sentCount > 0 && <span>👁️ {openRate}% aberto</span>}
                      {c.clickedCount > 0 && <span>🖱️ {c.clickedCount} cliques</span>}
                      {c.bouncedCount > 0 && <span className="text-red-400">⚠️ {c.bouncedCount} bounces</span>}
                      {c.unsubscribedCount > 0 && <span className="text-orange-400">🚫 {c.unsubscribedCount} unsub</span>}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
