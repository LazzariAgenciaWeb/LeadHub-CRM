"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface CadenceConfig {
  maxPerHour: number;
  jitterMs: [number, number];
  windowStart: string;
  windowEnd: string;
  daysOfWeek: number[];
  timezone: string;
}

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
  cadenceConfig: CadenceConfig;
  segmentFilter: {
    pipeline?: string | null;
    pipelineStage?: string | null;
    tagIds?: string[];
  } | null;
  companyId: string;
}

export interface TagOption { id: string; name: string; color: string; }
export interface StageOption { name: string; pipeline: string; }

const PIPELINES = [
  { value: "",              label: "Qualquer pipeline" },
  { value: "PROSPECCAO",    label: "🔎 Prospecção" },
  { value: "LEADS",         label: "🎯 Leads" },
  { value: "OPORTUNIDADES", label: "💡 Oportunidades" },
];

const DAYS = [
  { idx: 1, label: "Seg" }, { idx: 2, label: "Ter" }, { idx: 3, label: "Qua" },
  { idx: 4, label: "Qui" }, { idx: 5, label: "Sex" }, { idx: 6, label: "Sáb" }, { idx: 0, label: "Dom" },
];

const STATUS_META: Record<CampaignData["status"], { label: string; color: string }> = {
  DRAFT:     { label: "Rascunho",   color: "bg-slate-500/20 text-slate-300 border-slate-500/40" },
  SCHEDULED: { label: "Agendada",   color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40" },
  SENDING:   { label: "Enviando",   color: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  PAUSED:    { label: "Pausada",    color: "bg-orange-500/20 text-orange-300 border-orange-500/40" },
  COMPLETED: { label: "Concluída",  color: "bg-green-500/20 text-green-300 border-green-500/40" },
  FAILED:    { label: "Falhou",     color: "bg-red-500/20 text-red-300 border-red-500/40" },
};

export default function CampaignDetail({
  campaign: initial,
  tags = [],
  stages = [],
}: {
  campaign: CampaignData;
  tags?: TagOption[];
  stages?: StageOption[];
}) {
  const router = useRouter();
  const [campaign, setCampaign] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // ── Editor de segmento (DRAFT/SCHEDULED/PAUSED) ────────────────────────
  const [segPipeline, setSegPipeline] = useState(initial.segmentFilter?.pipeline ?? "");
  const [segStage, setSegStage] = useState(initial.segmentFilter?.pipelineStage ?? "");
  const [segTagIds, setSegTagIds] = useState<string[]>(initial.segmentFilter?.tagIds ?? []);
  const [segPreview, setSegPreview] = useState<{ count: number; deliverable: number; suppressed: number } | null>(null);
  const [segPreviewLoading, setSegPreviewLoading] = useState(false);
  const [savingSegment, setSavingSegment] = useState(false);
  const segCanEdit = campaign.status === "DRAFT" || campaign.status === "SCHEDULED" || campaign.status === "PAUSED";
  const segDirty =
    segPipeline !== (campaign.segmentFilter?.pipeline ?? "") ||
    segStage !== (campaign.segmentFilter?.pipelineStage ?? "") ||
    JSON.stringify([...segTagIds].sort()) !== JSON.stringify([...(campaign.segmentFilter?.tagIds ?? [])].sort());

  const filteredStages = stages.filter((s) => segPipeline && s.pipeline === segPipeline);

  // Recarrega preview com debounce ao mudar
  useEffect(() => {
    if (!segCanEdit) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSegPreviewLoading(true);
      try {
        const res = await fetch("/api/email/preview-segment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: campaign.companyId,
            segmentFilter: { pipeline: segPipeline || null, pipelineStage: segStage || null, tagIds: segTagIds },
          }),
        });
        if (res.ok && !cancelled) setSegPreview(await res.json());
      } finally { if (!cancelled) setSegPreviewLoading(false); }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [segPipeline, segStage, segTagIds, segCanEdit, campaign.companyId]);

  async function saveSegment() {
    setSavingSegment(true); setMsg(null);
    const filter = { pipeline: segPipeline || null, pipelineStage: segStage || null, tagIds: segTagIds };
    const res = await fetch(`/api/email/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentFilter: filter }),
    });
    if (res.ok) {
      setMsg({ type: "ok", text: "Segmento atualizado ✓" });
      setCampaign((c) => ({ ...c, segmentFilter: filter }));
    } else {
      const d = await res.json().catch(() => ({}));
      setMsg({ type: "err", text: d.error ?? "Erro ao salvar segmento" });
    }
    setSavingSegment(false);
  }

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

  async function runWorkerNow() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/cron/email-worker", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.message ?? data.error ?? `HTTP ${res.status}`;
        setMsg({ type: "err", text: `Worker erro: ${detail}` });
        if (data.stack) console.error("[email-worker stack]", data.stack);
        return;
      }
      const mine = (data.summary ?? []).find((s: any) => s.campaign === campaign.id);
      if (!mine) {
        setMsg({ type: "ok", text: "Worker rodou mas não tinha nada pra esta campanha agora (provavelmente fora da cadência)." });
      } else if (mine.sent || mine.failed) {
        setMsg({ type: "ok", text: `Processou: ${mine.sent} enviados, ${mine.failed ?? 0} falhas.` });
      } else if (mine.skipped) {
        setMsg({ type: "err", text: `Worker pulou: ${mine.skipped}` });
      } else if (mine.completed) {
        setMsg({ type: "ok", text: "Campanha concluída." });
      } else {
        setMsg({ type: "ok", text: JSON.stringify(mine) });
      }
      // Refresh stats
      const dataRes = await fetch(`/api/email/campaigns/${campaign.id}`);
      if (dataRes.ok) {
        const d = await dataRes.json();
        setCampaign((c) => ({ ...c, ...d }));
      }
    } finally {
      setBusy(false);
    }
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

      {/* Destinatários — só faz sentido depois que começou a enviar */}
      {(campaign.status === "SENDING" || campaign.status === "PAUSED" || campaign.status === "COMPLETED" || campaign.status === "FAILED") && (
        <RecipientsTable campaignId={campaign.id} sentCount={campaign.sentCount} />
      )}

      {/* Editor de Segmento — DRAFT/SCHEDULED/PAUSED */}
      {segCanEdit && (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <h2 className="text-white font-bold text-sm mb-1">🎯 Quem vai receber</h2>
          <p className="text-slate-500 text-xs mb-4">
            Edite o pipeline, etapa e tags pra ajustar o público desta campanha. Só vale enquanto a campanha não começou.
          </p>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">Pipeline</label>
                <select value={segPipeline} onChange={(e) => { setSegPipeline(e.target.value); setSegStage(""); }}
                  className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                  {PIPELINES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">Etapa</label>
                <select value={segStage} onChange={(e) => setSegStage(e.target.value)} disabled={!segPipeline}
                  className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50">
                  <option value="">Qualquer etapa</option>
                  {filteredStages.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-slate-400 text-xs font-medium mb-1">Tags <span className="text-slate-600">(qualquer das selecionadas)</span></label>
              {tags.length === 0 ? (
                <p className="text-slate-600 text-xs italic">Nenhuma tag cadastrada nessa empresa.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => {
                    const active = segTagIds.includes(t.id);
                    return (
                      <button key={t.id} type="button"
                        onClick={() => setSegTagIds((cur) => cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id])}
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                        style={active ? { backgroundColor: `${t.color}33`, borderColor: t.color, color: t.color }
                          : { backgroundColor: "transparent", borderColor: "#1e2d45", color: "#94a3b8" }}>
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-[#0a0f1a] border border-indigo-500/20 rounded-lg p-3">
              {segPreviewLoading ? (
                <p className="text-slate-500 text-xs">Calculando...</p>
              ) : segPreview ? (
                <div className="text-sm">
                  <span className="text-white font-bold">{segPreview.deliverable}</span>
                  <span className="text-slate-400"> leads serão atingidos</span>
                  {segPreview.suppressed > 0 && (
                    <span className="text-orange-400 text-xs ml-2">({segPreview.suppressed} descadastrados pulados)</span>
                  )}
                </div>
              ) : <span className="text-slate-600 text-xs">—</span>}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={saveSegment}
                disabled={!segDirty || savingSegment || (segPreview?.deliverable ?? 0) === 0}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-40">
                {savingSegment ? "Salvando..." : "Salvar segmento"}
              </button>
              {!segDirty && <span className="text-slate-600 text-xs">Sem alterações</span>}
              {segDirty && (segPreview?.deliverable ?? 0) === 0 && (
                <span className="text-amber-400 text-xs">Filtros não atingem nenhum lead — ajuste antes de salvar</span>
              )}
            </div>

            <p className="text-slate-600 text-[10px]">
              ⚠️ A lista de destinatários é materializada quando você clica em <strong>🚀 Disparar campanha</strong>. Antes disso, o segmento pode ser ajustado livremente.
            </p>
          </div>
        </div>
      )}

      {/* Cadência editável */}
      <CadenceEditor
        cadence={campaign.cadenceConfig}
        disabled={campaign.status === "COMPLETED"}
        onSave={async (cad) => {
          const res = await fetch(`/api/email/campaigns/${campaign.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cadenceConfig: cad }),
          });
          if (res.ok) {
            setCampaign((c) => ({ ...c, cadenceConfig: cad }));
            setMsg({ type: "ok", text: "Cadência atualizada — vale a partir do próximo tick (~60s)" });
          } else {
            const d = await res.json().catch(() => ({}));
            setMsg({ type: "err", text: d.error ?? "Erro ao salvar cadência" });
          }
        }}
      />

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
            <>
              <button onClick={runWorkerNow} disabled={busy} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50">
                ⚡ Processar agora
              </button>
              <button onClick={() => action("pause", "Pausada")} disabled={busy} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50">
                ⏸️ Pausar
              </button>
            </>
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

function CadenceEditor({
  cadence, disabled, onSave,
}: {
  cadence: CadenceConfig;
  disabled: boolean;
  onSave: (c: CadenceConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState<CadenceConfig>(cadence);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(cadence); }, [cadence]);

  function toggleDay(idx: number) {
    setDraft((d) => ({
      ...d,
      daysOfWeek: d.daysOfWeek.includes(idx)
        ? d.daysOfWeek.filter((x) => x !== idx)
        : [...d.daysOfWeek, idx].sort(),
    }));
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(cadence);

  async function save() {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  }

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-white font-bold text-sm">⏱️ Cadência de envio</h2>
          <p className="text-slate-500 text-xs">Worker só envia dentro desta janela. Pula dias e horários fora.</p>
        </div>
        {disabled && <span className="text-[10px] text-slate-600">Campanha concluída — sem edição</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-slate-400 text-xs font-medium mb-1">Máx. por hora</label>
          <input
            type="number" min={1} max={500} value={draft.maxPerHour} disabled={disabled}
            onChange={(e) => setDraft((d) => ({ ...d, maxPerHour: Math.max(1, parseInt(e.target.value || "60", 10)) }))}
            className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-slate-400 text-xs font-medium mb-1">Início da janela</label>
          <input
            type="time" value={draft.windowStart} disabled={disabled}
            onChange={(e) => setDraft((d) => ({ ...d, windowStart: e.target.value }))}
            className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-slate-400 text-xs font-medium mb-1">Fim da janela</label>
          <input
            type="time" value={draft.windowEnd} disabled={disabled}
            onChange={(e) => setDraft((d) => ({ ...d, windowEnd: e.target.value }))}
            className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-slate-400 text-xs font-medium mb-2">Dias permitidos</label>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => {
            const active = draft.daysOfWeek.includes(d.idx);
            return (
              <button
                key={d.idx} type="button" onClick={() => toggleDay(d.idx)} disabled={disabled}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
                  active ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200" : "bg-[#0a0f1a] border-[#1e2d45] text-slate-400 hover:text-white"
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Presets rápidos */}
      <div className="mb-4">
        <label className="block text-slate-400 text-xs font-medium mb-2">Atalhos</label>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: "Horário comercial (seg-sex, 9h-18h)", cfg: { windowStart: "09:00", windowEnd: "18:00", daysOfWeek: [1, 2, 3, 4, 5] } },
            { label: "Todo dia, 9h-21h",                    cfg: { windowStart: "09:00", windowEnd: "21:00", daysOfWeek: [0, 1, 2, 3, 4, 5, 6] } },
            { label: "24/7 (sem janela)",                   cfg: { windowStart: "00:00", windowEnd: "23:59", daysOfWeek: [0, 1, 2, 3, 4, 5, 6] } },
          ].map((p) => (
            <button
              key={p.label} type="button" disabled={disabled}
              onClick={() => setDraft((d) => ({ ...d, ...p.cfg }))}
              className="px-3 py-1.5 rounded-lg bg-[#0a0f1a] border border-[#1e2d45] text-slate-400 hover:text-white text-[10px] font-medium disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={!dirty || saving || disabled}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-40"
        >
          {saving ? "Salvando..." : "Salvar cadência"}
        </button>
        {!dirty && !disabled && <span className="text-slate-600 text-xs">Sem alterações</span>}
        {dirty && (
          <button onClick={() => setDraft(cadence)} className="px-3 py-2 rounded-lg text-slate-500 hover:text-white text-xs">
            Desfazer
          </button>
        )}
      </div>
      <p className="text-slate-600 text-[10px] mt-2">
        Timezone: {cadence.timezone}. Vale a partir do próximo tick do worker (~60s).
      </p>
    </div>
  );
}

// ─── Listagem de destinatários + modal de preview do email ───────────────────

type RecipientStatus = "PENDING" | "SENDING" | "SENT" | "BOUNCED" | "FAILED" | "SKIPPED";
interface RecipientEvent { id: string; type: string; targetUrl: string | null; createdAt: string; }
interface Recipient {
  id: string; email: string; name: string | null; status: RecipientStatus;
  sentAt: string | null; firstOpenedAt: string | null; firstClickedAt: string | null;
  bouncedAt: string | null; errorMessage: string | null; leadId: string | null;
  lead: { id: string; name: string | null; phone: string; pipeline: string | null } | null;
  events: RecipientEvent[];
  _count: { events: number };
}

const FILTERS: { value: string; label: string }[] = [
  { value: "all",     label: "Todos" },
  { value: "sent",    label: "Enviados" },
  { value: "opened",  label: "Abertos" },
  { value: "clicked", label: "Cliques" },
  { value: "bounced", label: "Bounces" },
  { value: "failed",  label: "Falhas" },
  { value: "pending", label: "Pendentes" },
];

function fmt(dt: string | null): string {
  if (!dt) return "—";
  const d = new Date(dt);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusPill(s: RecipientStatus): { label: string; cls: string } {
  switch (s) {
    case "SENT":    return { label: "Enviado",  cls: "bg-green-500/15 text-green-300 border-green-500/30" };
    case "PENDING": return { label: "Pendente", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" };
    case "SENDING": return { label: "Enviando", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" };
    case "BOUNCED": return { label: "Bounce",   cls: "bg-red-500/15 text-red-300 border-red-500/30" };
    case "FAILED":  return { label: "Falha",    cls: "bg-red-600/15 text-red-400 border-red-600/30" };
    case "SKIPPED": return { label: "Pulado",   cls: "bg-orange-500/15 text-orange-300 border-orange-500/30" };
  }
}

function RecipientsTable({ campaignId, sentCount }: { campaignId: string; sentCount: number }) {
  const [filter, setFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [data, setData] = useState<{ total: number; rows: Recipient[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Recarrega quando muda filtro/page OU quando sentCount muda (envios novos)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/email/campaigns/${campaignId}/recipients?page=${page}&pageSize=${pageSize}&filter=${filter}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData({ total: 0, rows: [] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [campaignId, filter, page, pageSize, sentCount]);

  // Reseta página ao trocar filtro
  useEffect(() => { setPage(1); }, [filter]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-white font-bold text-sm">📋 Destinatários{data ? ` (${data.total})` : ""}</h2>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.value} onClick={() => setFilter(f.value)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                filter === f.value
                  ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200"
                  : "bg-[#0a0f1a] border-[#1e2d45] text-slate-400 hover:text-white"
              }`}>{f.label}</button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <p className="text-slate-500 text-xs">Carregando...</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-slate-600 text-xs italic">Nenhum destinatário neste filtro.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-[#1e2d45]">
                <th className="py-2 pr-2 font-medium">Email</th>
                <th className="py-2 pr-2 font-medium">Status</th>
                <th className="py-2 pr-2 font-medium">Enviado</th>
                <th className="py-2 pr-2 font-medium">Abriu</th>
                <th className="py-2 pr-2 font-medium">Clicou</th>
                <th className="py-2 pr-2 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const exp = expandedId === r.id;
                const pill = statusPill(r.status);
                return (
                  <Fragment key={r.id}>
                    <tr className="border-b border-[#1e2d45]/50 hover:bg-[#0a0f1a]/50">
                      <td className="py-2 pr-2 text-white">
                        <div className="truncate max-w-[240px]" title={r.email}>{r.email}</div>
                        {r.name && <div className="text-slate-500 text-[10px] truncate max-w-[240px]">{r.name}</div>}
                      </td>
                      <td className="py-2 pr-2">
                        <span className={`text-[10px] font-bold uppercase border px-1.5 py-0.5 rounded ${pill.cls}`}>{pill.label}</span>
                        {r.errorMessage && (
                          <div className="text-red-400 text-[10px] mt-0.5 truncate max-w-[200px]" title={r.errorMessage}>{r.errorMessage}</div>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-slate-300">{fmt(r.sentAt)}</td>
                      <td className="py-2 pr-2 text-slate-300">{fmt(r.firstOpenedAt)}</td>
                      <td className="py-2 pr-2 text-slate-300">{fmt(r.firstClickedAt)}</td>
                      <td className="py-2 pr-2 text-right whitespace-nowrap">
                        {r._count.events > 0 && (
                          <button onClick={() => setExpandedId(exp ? null : r.id)}
                            className="text-indigo-400 hover:text-indigo-300 mr-2">
                            {exp ? "Ocultar" : `Eventos (${r._count.events})`}
                          </button>
                        )}
                        <button onClick={() => setPreviewId(r.id)}
                          className="text-slate-400 hover:text-white mr-2">Ver email</button>
                        {r.lead && (
                          <Link href={`/crm/leads?lead=${r.lead.id}`}
                            className="text-cyan-400 hover:text-cyan-300">Lead →</Link>
                        )}
                      </td>
                    </tr>
                    {exp && r.events.length > 0 && (
                      <tr className="border-b border-[#1e2d45]/50 bg-[#0a0f1a]/30">
                        <td colSpan={6} className="py-2 px-3">
                          <div className="text-[10px] text-slate-500 mb-1">Eventos ({r.events.length}{r._count.events > r.events.length ? `, mais ${r._count.events - r.events.length} não exibidos` : ""}):</div>
                          <ul className="space-y-0.5">
                            {r.events.map((ev) => (
                              <li key={ev.id} className="text-[11px] flex items-start gap-2">
                                <span className="text-slate-500 shrink-0 w-24">{fmt(ev.createdAt)}</span>
                                <span className={ev.type === "CLICK" ? "text-cyan-400" : ev.type === "OPEN" ? "text-amber-400" : "text-slate-400"}>
                                  {ev.type}
                                </span>
                                {ev.targetUrl && (
                                  <span className="text-slate-400 truncate" title={ev.targetUrl}>→ {ev.targetUrl}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > pageSize && (
        <div className="flex items-center justify-between mt-3 text-xs">
          <span className="text-slate-500">Página {page} de {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
              className="px-2 py-1 rounded border border-[#1e2d45] text-slate-400 hover:text-white disabled:opacity-30">‹</button>
            <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}
              className="px-2 py-1 rounded border border-[#1e2d45] text-slate-400 hover:text-white disabled:opacity-30">›</button>
          </div>
        </div>
      )}

      {previewId && (
        <PreviewModal
          campaignId={campaignId}
          recipientId={previewId}
          onClose={() => setPreviewId(null)}
        />
      )}
    </div>
  );
}

function PreviewModal({ campaignId, recipientId, onClose }: { campaignId: string; recipientId: string; onClose: () => void }) {
  const [data, setData] = useState<{ to: string; subject: string; html: string; sentAt: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/email/campaigns/${campaignId}/recipients/${recipientId}/preview`)
      .then((r) => r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error)))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [campaignId, recipientId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}>
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl w-full max-w-3xl my-8 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-4 border-b border-[#1e2d45]">
          <div className="min-w-0">
            <h3 className="text-white font-bold text-sm">📧 Email enviado</h3>
            {data && (
              <div className="text-slate-400 text-xs mt-1 space-y-0.5">
                <div><span className="text-slate-500">Para:</span> {data.to}</div>
                <div><span className="text-slate-500">Assunto:</span> {data.subject}</div>
                {data.sentAt && <div><span className="text-slate-500">Enviado:</span> {fmt(data.sentAt)}</div>}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl shrink-0">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 bg-white">
          {err ? (
            <p className="text-red-400 text-sm p-4">{err}</p>
          ) : !data ? (
            <p className="text-slate-500 text-sm p-4">Carregando...</p>
          ) : (
            <iframe
              srcDoc={data.html}
              sandbox=""
              className="w-full min-h-[600px] border-0"
              title="Preview do email"
            />
          )}
        </div>
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
