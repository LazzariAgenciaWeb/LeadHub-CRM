"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface CampaignData {
  id: string;
  name: string;
  subject: string;
  status: "DRAFT" | "SCHEDULED" | "SENDING" | "PAUSED" | "COMPLETED" | "FAILED";
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  totalRecipients: number;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  bouncedCount: number;
  unsubscribedCount: number;
  failedCount: number;
  templateName: string | null;
  createdByName: string | null;
  createdAt: string;
}

const STATUS_META: Record<CampaignData["status"], { label: string; color: string }> = {
  DRAFT:     { label: "Rascunho",   color: "bg-slate-500/20 text-slate-300 border-slate-500/40" },
  SCHEDULED: { label: "Agendada",   color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40" },
  SENDING:   { label: "Enviando",   color: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  PAUSED:    { label: "Pausada",    color: "bg-orange-500/20 text-orange-300 border-orange-500/40" },
  COMPLETED: { label: "Concluída",  color: "bg-green-500/20 text-green-300 border-green-500/40" },
  FAILED:    { label: "Falhou",     color: "bg-red-500/20 text-red-300 border-red-500/40" },
};

export default function CampaignDetail({ campaign: initial }: { campaign: CampaignData }) {
  const router = useRouter();
  const [campaign, setCampaign] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Polling de stats quando SENDING (a cada 10s)
  useEffect(() => {
    if (campaign.status !== "SENDING" && campaign.status !== "SCHEDULED") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/email/campaigns/${campaign.id}`);
      if (res.ok) {
        const d = await res.json();
        setCampaign((c) => ({
          ...c,
          status: d.status,
          totalRecipients: d.totalRecipients,
          sentCount: d.sentCount,
          openedCount: d.openedCount,
          clickedCount: d.clickedCount,
          bouncedCount: d.bouncedCount,
          unsubscribedCount: d.unsubscribedCount,
          failedCount: d.failedCount,
          startedAt: d.startedAt,
          completedAt: d.completedAt,
        }));
      }
    }, 10000);
    return () => clearInterval(t);
  }, [campaign.status, campaign.id]);

  async function action(path: string, label: string) {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/email/campaigns/${campaign.id}/${path}`, { method: "POST" });
    if (res.ok) {
      setMsg({ type: "ok", text: `${label} ✓` });
      router.refresh();
      const data = await fetch(`/api/email/campaigns/${campaign.id}`).then((r) => r.json());
      setCampaign((c) => ({ ...c, ...data }));
    } else {
      const d = await res.json().catch(() => ({}));
      setMsg({ type: "err", text: d.error ?? "Erro" });
    }
    setBusy(false);
  }

  async function testSend() {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/email/campaigns/${campaign.id}/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testTo ? { to: testTo } : {}),
    });
    if (res.ok) {
      const d = await res.json();
      setMsg({ type: "ok", text: `Teste enviado pra ${d.sentTo}` });
    } else {
      const d = await res.json().catch(() => ({}));
      setMsg({ type: "err", text: d.error ?? "Erro no test-send" });
    }
    setBusy(false);
  }

  const st = STATUS_META[campaign.status];
  const total = campaign.totalRecipients || 0;
  const processed = campaign.sentCount + campaign.bouncedCount + campaign.failedCount;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const openRate = campaign.sentCount > 0 ? Math.round((campaign.openedCount / campaign.sentCount) * 100) : 0;
  const clickRate = campaign.openedCount > 0 ? Math.round((campaign.clickedCount / campaign.openedCount) * 100) : 0;

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <Link href="/campanhas/email" className="text-slate-500 hover:text-white text-xs">← Voltar</Link>
            <span className={`text-[10px] font-bold uppercase border px-2 py-0.5 rounded ${st.color}`}>{st.label}</span>
          </div>
          <h1 className="text-white font-bold text-xl truncate">{campaign.name}</h1>
          <p className="text-slate-500 text-sm mt-0.5">{campaign.subject}</p>
          {campaign.templateName && <p className="text-slate-600 text-xs mt-1">Template: {campaign.templateName}</p>}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPI label="Total" value={total} color="#6366f1" />
        <KPI label="Enviados" value={campaign.sentCount} sub={total > 0 ? `${Math.round((campaign.sentCount / total) * 100)}%` : ""} color="#22c55e" />
        <KPI label="Abertos" value={campaign.openedCount} sub={`${openRate}% de quem recebeu`} color="#f59e0b" />
        <KPI label="Cliques" value={campaign.clickedCount} sub={`${clickRate}% de quem abriu`} color="#06b6d4" />
        <KPI label="Bounces" value={campaign.bouncedCount} color="#ef4444" />
        <KPI label="Falhas" value={campaign.failedCount} color="#dc2626" />
        <KPI label="Descadastros" value={campaign.unsubscribedCount} color="#f97316" />
        <KPI label="Progresso" value={`${pct}%`} sub="processados/total" color="#a855f7" />
      </div>

      {/* Barra de progresso */}
      {total > 0 && (
        <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-lg p-3">
          <div className="h-2 bg-[#1e2d45] rounded-full overflow-hidden mb-1">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>{campaign.sentCount + campaign.bouncedCount + campaign.failedCount} processados</span>
            <span>{total - campaign.sentCount - campaign.bouncedCount - campaign.failedCount} pendentes</span>
          </div>
        </div>
      )}

      {/* Ações */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 space-y-4">
        <h2 className="text-white font-bold text-sm">⚙️ Ações</h2>

        {/* Test-send */}
        <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-lg p-3">
          <p className="text-slate-400 text-xs font-medium mb-2">Enviar email de teste</p>
          <div className="flex gap-2">
            <input
              type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)}
              placeholder="seu@email.com (vazio = seu próprio email)"
              className="flex-1 bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
            <button onClick={testSend} disabled={busy} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50">
              Enviar teste
            </button>
          </div>
        </div>

        {/* Start/pause/resume */}
        <div className="flex gap-2 flex-wrap">
          {(campaign.status === "DRAFT" || campaign.status === "SCHEDULED") && (
            <button onClick={() => action("start", "Disparada")} disabled={busy} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium disabled:opacity-50">
              🚀 Disparar campanha
            </button>
          )}
          {campaign.status === "SENDING" && (
            <button onClick={() => action("pause", "Pausada")} disabled={busy} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50">
              ⏸️ Pausar
            </button>
          )}
          {campaign.status === "PAUSED" && (
            <button onClick={() => action("resume", "Retomada")} disabled={busy} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium disabled:opacity-50">
              ▶️ Retomar
            </button>
          )}
        </div>

        {msg && (
          <div className={`text-xs rounded-lg px-3 py-2 border ${
            msg.type === "ok" ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"
          }`}>{msg.text}</div>
        )}

        {campaign.status === "SENDING" && (
          <p className="text-slate-600 text-[10px] italic">Stats atualizam automaticamente a cada 10s.</p>
        )}
      </div>

      {/* Metadados */}
      <div className="text-xs text-slate-600 space-y-0.5">
        {campaign.createdAt && <p>Criada em {new Date(campaign.createdAt).toLocaleString("pt-BR")} {campaign.createdByName && `por ${campaign.createdByName}`}</p>}
        {campaign.scheduledAt && <p>Agendada para {new Date(campaign.scheduledAt).toLocaleString("pt-BR")}</p>}
        {campaign.startedAt && <p>Iniciada em {new Date(campaign.startedAt).toLocaleString("pt-BR")}</p>}
        {campaign.completedAt && <p>Concluída em {new Date(campaign.completedAt).toLocaleString("pt-BR")}</p>}
      </div>
    </div>
  );
}

function KPI({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-3 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ backgroundColor: color }} />
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}
