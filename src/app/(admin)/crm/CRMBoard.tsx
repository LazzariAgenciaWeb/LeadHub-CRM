"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import ImportExcel from "./ImportExcel";

export interface PipelineStage {
  id: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
  pipeline: string;
}

export interface CRMLead {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  notes: string | null;
  source: string | null;
  pipeline: string | null;
  pipelineStage: string | null;
  value: number | null;
  createdAt: string;
  updatedAt: string;
  expectedReturnAt: string | null;
  attendanceStatus: string | null;
  campaign: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  clickupTaskId: string | null;
  trackingLinkId: string | null;
  trackingLink: {
    id: string;
    code: string;
    label: string | null;
    clicks: number;
    destination: string;
    _count: { clickEvents: number };
  } | null;
}

export interface LeadComment {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

const PIPELINE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  PROSPECCAO: { label: "Prospecção", icon: "🔎", color: "#8b5cf6" },
  LEADS: { label: "Leads", icon: "🎯", color: "#6366f1" },
  OPORTUNIDADES: { label: "Oportunidades", icon: "💡", color: "#f59e0b" },
};

const OTHER_PIPELINES: Record<string, { label: string; key: string }[]> = {
  PROSPECCAO: [{ label: "Leads", key: "LEADS" }, { label: "Oportunidades", key: "OPORTUNIDADES" }],
  LEADS: [{ label: "Prospecção", key: "PROSPECCAO" }, { label: "Oportunidades", key: "OPORTUNIDADES" }],
  OPORTUNIDADES: [{ label: "Prospecção", key: "PROSPECCAO" }, { label: "Leads", key: "LEADS" }],
};

export default function CRMBoard({
  pipeline,
  initialLeads,
  stages,
  isSuperAdmin,
  companies,
  defaultLeadId,
  defaultCompanyId,
}: {
  pipeline: string;
  initialLeads: CRMLead[];
  stages: PipelineStage[];
  isSuperAdmin: boolean;
  companies: { id: string; name: string }[];
  defaultLeadId?: string;
  defaultCompanyId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [leads, setLeads] = useState(initialLeads);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CRMLead | null>(null);

  // Auto-abrir lead quando vindo do WhatsApp via ?lead=ID
  useEffect(() => {
    if (!defaultLeadId) return;
    const lead = initialLeads.find((l) => l.id === defaultLeadId);
    if (lead) openCard(lead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultLeadId]);

  // Card detail state
  const [comments, setComments] = useState<LeadComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [editingValue, setEditingValue] = useState(false);
  const [valueInput, setValueInput] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState("");

  // Vincular tracking link
  const [showLinkTracker, setShowLinkTracker] = useState(false);
  const [trackerLinks, setTrackerLinks] = useState<CRMLead["trackingLink"][]>([]);
  const [loadingTrackerLinks, setLoadingTrackerLinks] = useState(false);
  const [trackerSearch, setTrackerSearch] = useState("");
  const [savingTracker, setSavingTracker] = useState(false);

  // Prospecção Automática (iframe externo)
  const [showAutoProspect, setShowAutoProspect] = useState(false);

  // Adicionar novo lead/prospect manualmente
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", phone: "", notes: "", value: "", companyId: defaultCompanyId ?? "" });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  // Deletar / remover do pipeline
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingLead, setDeletingLead] = useState(false);

  // Vincular conversa WhatsApp
  const [showLinkConv, setShowLinkConv] = useState(false);
  const [linkPhone, setLinkPhone] = useState("");
  const [linkingConv, setLinkingConv] = useState(false);
  const [linkResult, setLinkResult] = useState<string | null>(null);

  // ClickUp task ID (só Oportunidades)
  const [editingClickup, setEditingClickup] = useState(false);
  const [clickupInput, setClickupInput] = useState("");
  const [savingClickup, setSavingClickup] = useState(false);
  const [syncingClickup, setSyncingClickup] = useState(false);
  const [syncClickupError, setSyncClickupError] = useState<string | null>(null);

  // BDR Sync
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ imported: number; skipped: number; total: number } | null>(null);

  const pipelineInfo = PIPELINE_LABELS[pipeline] ?? { label: pipeline, icon: "🫧", color: "#6366f1" };

  // Filtro de busca
  const filteredLeads = leads.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.phone.includes(q) ||
      l.name?.toLowerCase().includes(q) ||
      l.email?.toLowerCase().includes(q)
    );
  });

  // Agrupar leads por etapa
  const byStage: Record<string, CRMLead[]> = {};
  for (const s of stages) byStage[s.name] = [];
  // Leads sem etapa vão para a primeira coluna
  const firstStage = stages[0]?.name ?? "__sem_etapa__";
  const stageNames = new Set(stages.map((s) => s.name));
  for (const lead of filteredLeads) {
    const raw = lead.pipelineStage ?? firstStage;
    // Se a etapa não existe mais nas configurações, cai na primeira coluna
    const stageName = stageNames.has(raw) ? raw : firstStage;
    byStage[stageName].push(lead);
  }

  async function moveToStage(leadId: string, stageName: string) {
    setMovingId(leadId);
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, pipelineStage: stageName } : l))
    );
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipelineStage: stageName }),
    });
    setMovingId(null);
    startTransition(() => router.refresh());
  }

  async function moveToPipeline(leadId: string, newPipeline: string) {
    setMovingId(leadId);
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline: newPipeline, pipelineStage: null }),
    });
    setMovingId(null);
    setSelected(null);
    startTransition(() => router.refresh());
  }

  async function openCard(lead: CRMLead) {
    setSelected(lead);
    setNewComment("");
    setEditingValue(false);
    setValueInput(lead.value?.toString() ?? "");
    setEditingNotes(false);
    setNotesInput(lead.notes ?? "");
    setShowLinkTracker(false);
    setTrackerLinks([]);
    setTrackerSearch("");
    setConfirmDelete(false);
    setShowLinkConv(false);
    setLinkPhone("");
    setLinkResult(null);
    setEditingClickup(false);
    setClickupInput(lead.clickupTaskId ?? "");
    setSyncClickupError(null);
    setLoadingComments(true);
    const res = await fetch(`/api/leads/${lead.id}/comments`);
    if (res.ok) setComments(await res.json());
    setLoadingComments(false);
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !newComment.trim()) return;
    setSavingComment(true);
    const res = await fetch(`/api/leads/${selected.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newComment.trim() }),
    });
    if (res.ok) {
      const comment = await res.json();
      setComments((prev) => [comment, ...prev]);
      setNewComment("");
    }
    setSavingComment(false);
  }

  async function handleSaveValue(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const val = parseFloat(valueInput.replace(",", ".")) || null;
    await fetch(`/api/leads/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: val }),
    });
    setSelected({ ...selected, value: val });
    setLeads((prev) => prev.map((l) => (l.id === selected.id ? { ...l, value: val } : l)));
    setEditingValue(false);
  }

  async function handleSaveNotes(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const notes = notesInput.trim() || null;
    await fetch(`/api/leads/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setSelected({ ...selected, notes });
    setLeads((prev) => prev.map((l) => (l.id === selected.id ? { ...l, notes } : l)));
    setEditingNotes(false);
  }

  async function loadTrackerLinks() {
    if (loadingTrackerLinks || trackerLinks.length > 0) return;
    setLoadingTrackerLinks(true);
    try {
      const companyId = selected?.company?.id ?? defaultCompanyId ?? "";
      const res = await fetch(`/api/tracking-links?companyId=${companyId}`);
      if (res.ok) {
        const data = await res.json();
        setTrackerLinks(data);
      }
    } catch { /* ignore */ } finally {
      setLoadingTrackerLinks(false);
    }
  }

  async function handleLinkTracker(linkId: string | null) {
    if (!selected) return;
    setSavingTracker(true);
    const res = await fetch(`/api/leads/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackingLinkId: linkId }),
    });
    if (res.ok) {
      const updated = await res.json();
      const newLink = updated.trackingLink ?? null;
      setSelected({ ...selected, trackingLinkId: linkId, trackingLink: newLink });
      setLeads((prev) => prev.map((l) => l.id === selected.id ? { ...l, trackingLinkId: linkId, trackingLink: newLink } : l));
      setShowLinkTracker(false);
    }
    setSavingTracker(false);
  }

  async function handleSaveClickup(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSavingClickup(true);
    const val = clickupInput.trim() || null;
    await fetch(`/api/leads/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clickupTaskId: val }),
    });
    setSelected({ ...selected, clickupTaskId: val });
    setLeads((prev) => prev.map((l) => (l.id === selected.id ? { ...l, clickupTaskId: val } : l)));
    setEditingClickup(false);
    setSavingClickup(false);
  }

  async function handleSyncClickup() {
    if (!selected) return;
    setSyncingClickup(true);
    setSyncClickupError(null);
    const res = await fetch(`/api/leads/${selected.id}/sync-clickup`, { method: "POST" });
    const data = await res.json();
    if (res.ok && data.clickupTaskId) {
      setSelected({ ...selected, clickupTaskId: data.clickupTaskId });
      setLeads((prev) => prev.map((l) => (l.id === selected.id ? { ...l, clickupTaskId: data.clickupTaskId } : l)));
    } else {
      let msg = data.error ?? "Erro desconhecido";
      if (data.clickupError) {
        const detail = typeof data.clickupError === "object"
          ? (data.clickupError.err ?? data.clickupError.ECODE ?? JSON.stringify(data.clickupError))
          : data.clickupError;
        msg += `: ${detail}`;
      }
      setSyncClickupError(msg);
    }
    setSyncingClickup(false);
  }

  async function handleDeleteLead() {
    if (!selected) return;
    setDeletingLead(true);
    await fetch(`/api/leads/${selected.id}`, { method: "DELETE" });
    setLeads((prev) => prev.filter((l) => l.id !== selected.id));
    setSelected(null);
    setConfirmDelete(false);
    setDeletingLead(false);
    startTransition(() => router.refresh());
  }

  async function handleLinkConversation() {
    if (!selected || !linkPhone.trim()) return;
    setLinkingConv(true);
    setLinkResult(null);
    const res = await fetch("/api/whatsapp/link-prospect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: linkPhone.trim(),
        companyId: selected.company?.id ?? (selected as any).companyId,
        leadId: selected.id,
      }),
    });
    setLinkingConv(false);
    if (res.ok) {
      const data = await res.json();
      setLinkResult(`✅ ${data.linked} mensagem(ns) vinculada(s)`);
      setLinkPhone("");
    } else {
      const data = await res.json();
      setLinkResult(`❌ ${data.error ?? "Erro ao vincular"}`);
    }
  }

  async function handleRemoveFromPipeline() {
    if (!selected) return;
    await fetch(`/api/leads/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline: null, pipelineStage: null }),
    });
    setLeads((prev) => prev.filter((l) => l.id !== selected.id));
    setSelected(null);
    startTransition(() => router.refresh());
  }

  function onDragStart(e: React.DragEvent, leadId: string) {
    e.dataTransfer.setData("leadId", leadId);
  }

  async function handleAddLead(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    if (!addForm.phone.trim()) { setAddError("Telefone é obrigatório"); return; }
    setAddSaving(true);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: addForm.name.trim() || null,
        phone: addForm.phone.trim(),
        notes: addForm.notes.trim() || null,
        value: pipeline === "OPORTUNIDADES" && addForm.value ? parseFloat(addForm.value.replace(",", ".")) : null,
        pipeline,
        source: pipeline === "PROSPECCAO" ? "bdr" : "manual",
        ...(isSuperAdmin && addForm.companyId ? { companyId: addForm.companyId } : {}),
      }),
    });
    if (res.ok) {
      const newLead = await res.json();
      setLeads((prev) => [newLead, ...prev]);
      setAddForm({ name: "", phone: "", notes: "", value: "", companyId: defaultCompanyId ?? "" });
      setShowAddModal(false);
      startTransition(() => router.refresh());
    } else {
      const err = await res.json();
      setAddError(err.error ?? "Erro ao criar");
    }
    setAddSaving(false);
  }

  async function handleBdrSync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch("/api/sync/bdr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    setSyncResult(data);
    if (data.imported > 0) startTransition(() => router.refresh());
    setSyncing(false);
  }

  function onDrop(e: React.DragEvent, stageName: string) {
    e.preventDefault();
    setDragOverStage(null);
    const leadId = e.dataTransfer.getData("leadId");
    if (leadId) moveToStage(leadId, stageName);
  }

  const totalValue = pipeline === "OPORTUNIDADES"
    ? filteredLeads.filter((l) => l.value != null).reduce((s, l) => s + (l.value ?? 0), 0)
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0 border-b border-[#1e2d45]">
        <div>
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            <span>{pipelineInfo.icon}</span>
            {pipelineInfo.label}
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {leads.length} contato{leads.length !== 1 ? "s" : ""}
            {pipeline === "OPORTUNIDADES" && totalValue > 0 && (
              <span className="text-green-400 font-medium ml-2">
                · R$ {totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar..."
            className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 w-48"
          />
          {pipeline === "PROSPECCAO" && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAutoProspect(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors flex-shrink-0"
                >
                  🤖 Prospecção Automática
                </button>
                <button
                  onClick={handleBdrSync}
                  disabled={syncing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors flex-shrink-0 disabled:opacity-60"
                >
                  {syncing ? "⏳ Importando..." : "☁️ Importar Supabase"}
                </button>
              </div>
              {syncResult && (
                <span className="text-[10px] text-slate-400">
                  {syncResult.imported > 0
                    ? `✅ ${syncResult.imported} importados`
                    : `ℹ️ Nenhum novo (${syncResult.skipped} já existiam)`}
                </span>
              )}
            </div>
          )}
          <ImportExcel pipeline={pipeline} />
          <button
            onClick={() => { setShowAddModal(true); setAddError(""); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors flex-shrink-0"
          >
            + Adicionar
          </button>
        </div>
      </div>

      {stages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center p-8">
          <div>
            <div className="text-4xl mb-3">⚙️</div>
            <div className="text-white font-semibold mb-1">Nenhuma etapa configurada</div>
            <div className="text-slate-500 text-sm mb-4">
              Configure as etapas desta pipeline em Configurações → Pipeline
            </div>
            <a href="/configuracoes?secao=pipeline" className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-500 transition-colors">
              Configurar etapas →
            </a>
          </div>
        </div>
      ) : (
        /* Kanban */
        <div className="flex-1 overflow-x-auto px-6 pb-6 pt-4">
          <div className="flex gap-3 h-full" style={{ minWidth: stages.length * 230 + "px" }}>
            {stages.map((stage) => {
              const stageLeads = byStage[stage.name] ?? [];
              const stageValue = pipeline === "OPORTUNIDADES"
                ? stageLeads.filter((l) => l.value != null).reduce((s, l) => s + (l.value ?? 0), 0)
                : 0;

              return (
                <div
                  key={stage.id}
                  className={`flex flex-col flex-1 min-w-[210px] rounded-xl border transition-all ${
                    stage.isFinal
                      ? "bg-white/[0.02] border-white/10"
                      : "bg-[#0a0f1a] border-[#1e2d45]"
                  } ${dragOverStage === stage.name ? "ring-2 ring-white/20 scale-[1.01]" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.name); }}
                  onDragLeave={() => setDragOverStage(null)}
                  onDrop={(e) => onDrop(e, stage.name)}
                >
                  {/* Coluna header */}
                  <div
                    className="px-3 pt-3 pb-2 flex items-center justify-between flex-shrink-0"
                    style={{ borderBottom: `2px solid ${stage.color}30` }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: stage.color }}
                      />
                      <span className="text-white font-semibold text-[13px]">{stage.name}</span>
                      <span className="bg-white/10 text-slate-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {stageLeads.length}
                      </span>
                    </div>
                    {stageValue > 0 && (
                      <span className="text-[10px] text-green-400 font-medium">
                        R$ {stageValue.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
                      </span>
                    )}
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {stageLeads.length === 0 && (
                      <div className="text-center py-6 text-slate-700 text-xs">
                        Arraste aqui
                      </div>
                    )}
                    {stageLeads.map((lead) => (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, lead.id)}
                        onClick={() => openCard(lead)}
                        className={`bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-white/20 transition-all group ${
                          movingId === lead.id ? "opacity-40" : ""
                        }`}
                      >
                        <div className="text-white text-[13px] font-semibold mb-0.5 truncate">
                          {lead.name ?? lead.phone}
                        </div>
                        {lead.name && (
                          <div className="text-slate-600 text-[10px] mb-1">{lead.phone}</div>
                        )}
                        {lead.campaign && (
                          <div className="text-indigo-400 text-[10px] mb-1 truncate">
                            📣 {lead.campaign.name}
                          </div>
                        )}
                        {lead.value != null && (
                          <div className="text-green-400 text-[11px] font-semibold">
                            R$ {lead.value.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
                          </div>
                        )}
                        {isSuperAdmin && lead.company && (
                          <div className="text-slate-700 text-[10px] mt-1 truncate">
                            {lead.company.name}
                          </div>
                        )}
                        <div className="text-slate-700 text-[10px] mt-1">
                          {new Date(lead.createdAt).toLocaleDateString("pt-BR")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal de adicionar manualmente */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-[#0c1220] border border-[#1e2d45] rounded-2xl w-full max-w-md mx-4 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1e2d45] flex items-center justify-between">
              <div>
                <h2 className="text-white font-bold text-base">
                  {pipelineInfo.icon} Adicionar em {pipelineInfo.label}
                </h2>
                <p className="text-slate-500 text-xs mt-0.5">Cadastro manual de contato</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-500 hover:text-white text-2xl leading-none">×</button>
            </div>

            <form onSubmit={handleAddLead} className="p-6 space-y-4">
              {isSuperAdmin && companies.length > 0 && (
                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">
                    Empresa <span className="text-red-400">*</span>
                  </label>
                  <select
                    required
                    value={addForm.companyId}
                    onChange={(e) => setAddForm((f) => ({ ...f, companyId: e.target.value }))}
                    className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Selecione a empresa</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  {pipeline === "PROSPECCAO" ? "Empresa / Nome" : "Nome"}
                </label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={pipeline === "PROSPECCAO" ? "Ex: Clínica Saúde Total" : "Ex: João Silva"}
                  className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  Telefone <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={addForm.phone}
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="Ex: 5511999999999"
                  className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {pipeline === "OPORTUNIDADES" && (
                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">Valor estimado (R$)</label>
                  <input
                    type="text"
                    value={addForm.value}
                    onChange={(e) => setAddForm((f) => ({ ...f, value: e.target.value }))}
                    placeholder="Ex: 3500,00"
                    className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">Notas / Observações</label>
                <textarea
                  value={addForm.notes}
                  onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Informações relevantes sobre este contato..."
                  rows={3}
                  className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              {addError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">
                  {addError}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={addSaving}
                  className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {addSaving ? "Salvando..." : "Adicionar"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white text-sm transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal de detalhe do card — 2 colunas ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70" onClick={() => setSelected(null)} />

          {/* Modal */}
          <div className="relative bg-[#0c1220] border border-[#1e2d45] w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-5xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">

            {/* ── Header ── */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#1e2d45] flex-shrink-0 bg-[#0f1825]">
              <div className="min-w-0">
                <h2 className="text-white font-bold text-lg truncate">{selected.name ?? selected.phone}</h2>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {selected.name && <span className="text-slate-500 text-xs font-mono">{selected.phone}</span>}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#1e2d45] text-slate-400">
                    {pipelineInfo.icon} {pipelineInfo.label}
                  </span>
                  {selected.pipelineStage && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">
                      {selected.pipelineStage}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <a
                  href={`/whatsapp?abrir=${encodeURIComponent(selected.phone)}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/15 border border-green-500/25 text-green-400 hover:bg-green-500/25 text-xs font-medium transition-colors whitespace-nowrap"
                >
                  💬 WhatsApp
                </a>
                {selected.clickupTaskId && (
                  <a
                    href={selected.clickupTaskId.startsWith("http") ? selected.clickupTaskId : `https://app.clickup.com/t/${selected.clickupTaskId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/25 text-indigo-400 hover:bg-indigo-500/25 text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    ✅ ClickUp
                  </a>
                )}
                <button onClick={() => setSelected(null)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-[#1e2d45] transition-colors text-lg">
                  ×
                </button>
              </div>
            </div>

            {/* ── Corpo: 2 colunas ── */}
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">

              {/* ── Coluna esquerda: informações ── */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 md:border-r border-[#1e2d45]">

                {/* Grid de dados principais */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#161f30] rounded-lg p-3">
                    <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Abertura</div>
                    <div className="text-white text-sm">
                      {new Date(selected.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </div>
                  </div>
                  <div className="bg-[#161f30] rounded-lg p-3">
                    <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Previsão de retorno</div>
                    <div className={`text-sm ${selected.expectedReturnAt ? "text-amber-400" : "text-slate-600"}`}>
                      {selected.expectedReturnAt
                        ? new Date(selected.expectedReturnAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
                        : "—"}
                    </div>
                  </div>

                  {selected.email && (
                    <div className="bg-[#161f30] rounded-lg p-3 col-span-2">
                      <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">E-mail</div>
                      <div className="text-white text-sm">{selected.email}</div>
                    </div>
                  )}

                  {selected.company && (
                    <div className="bg-[#161f30] rounded-lg p-3 col-span-2">
                      <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Empresa</div>
                      <div className="text-white text-sm">🏢 {selected.company.name}</div>
                    </div>
                  )}

                  {selected.campaign && (
                    <div className="bg-[#161f30] rounded-lg p-3 col-span-2">
                      <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Campanha</div>
                      <div className="text-white text-sm">📣 {selected.campaign.name}</div>
                    </div>
                  )}
                </div>

                {/* Valor */}
                <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                  <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">Valor do negócio</div>
                  {editingValue ? (
                    <form onSubmit={handleSaveValue} className="flex gap-2">
                      <input
                        autoFocus
                        type="text"
                        value={valueInput}
                        onChange={(e) => setValueInput(e.target.value)}
                        placeholder="0,00"
                        className="flex-1 bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-green-500"
                      />
                      <button type="submit" className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-500">Salvar</button>
                      <button type="button" onClick={() => setEditingValue(false)} className="text-slate-500 text-xs hover:text-white">✕</button>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-green-400 font-bold text-xl">
                        {selected.value != null ? `R$ ${selected.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—"}
                      </span>
                      <button onClick={() => setEditingValue(true)} className="text-slate-600 hover:text-slate-400 text-xs">✏️ Editar</button>
                    </div>
                  )}
                </div>

                {/* Descrição / Notas */}
                <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-violet-400 text-[10px] font-semibold uppercase tracking-wide">
                      📋 Descrição / Observações
                    </div>
                    {!editingNotes && (
                      <button
                        onClick={() => { setNotesInput(selected.notes ?? ""); setEditingNotes(true); }}
                        className="text-slate-600 hover:text-slate-400 text-xs"
                      >
                        ✏️ {selected.notes ? "Editar" : "Adicionar"}
                      </button>
                    )}
                  </div>
                  {editingNotes ? (
                    <form onSubmit={handleSaveNotes} className="space-y-2">
                      <textarea
                        autoFocus
                        value={notesInput}
                        onChange={(e) => setNotesInput(e.target.value)}
                        rows={5}
                        placeholder="Descreva a demanda, contexto, informações relevantes..."
                        className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 resize-none"
                      />
                      <div className="flex gap-2">
                        <button type="submit" className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-500">Salvar</button>
                        <button type="button" onClick={() => setEditingNotes(false)} className="text-slate-500 text-xs hover:text-white">Cancelar</button>
                      </div>
                    </form>
                  ) : selected.notes ? (
                    <div className="space-y-1">
                      {selected.notes.split("\n").map((line, j) => {
                        const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
                        return (
                          <div key={j} className="text-xs leading-relaxed text-slate-300">
                            {urlMatch ? (
                              <>
                                {line.substring(0, line.indexOf(urlMatch[0]))}
                                <a href={urlMatch[0]} target="_blank" rel="noopener noreferrer" className="underline text-indigo-400 hover:text-indigo-300">{urlMatch[0]}</a>
                              </>
                            ) : line}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600 italic">Clique em &quot;Adicionar&quot; para descrever a demanda.</p>
                  )}
                </div>

                {/* ClickUp */}
                <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-slate-500 text-[10px] uppercase tracking-wide">✅ ClickUp</div>
                    {!editingClickup && selected.clickupTaskId && (
                      <button onClick={() => { setEditingClickup(true); setClickupInput(selected.clickupTaskId ?? ""); }} className="text-slate-600 hover:text-slate-400 text-xs">✏️ Editar</button>
                    )}
                  </div>
                  {editingClickup ? (
                    <form onSubmit={handleSaveClickup} className="space-y-2">
                      <input
                        autoFocus
                        type="text"
                        value={clickupInput}
                        onChange={(e) => setClickupInput(e.target.value)}
                        placeholder="ID ou URL da tarefa no ClickUp"
                        className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                      <div className="flex gap-2">
                        <button type="submit" disabled={savingClickup} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-50">
                          {savingClickup ? "Salvando..." : "Salvar"}
                        </button>
                        <button type="button" onClick={() => setEditingClickup(false)} className="text-slate-500 text-xs hover:text-white">Cancelar</button>
                      </div>
                    </form>
                  ) : selected.clickupTaskId ? (
                    <a
                      href={selected.clickupTaskId.startsWith("http") ? selected.clickupTaskId : `https://app.clickup.com/t/${selected.clickupTaskId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/30 text-xs font-medium transition-colors w-fit"
                    >
                      ↗ Abrir no ClickUp
                    </a>
                  ) : (
                    <div className="space-y-2">
                      <button
                        onClick={handleSyncClickup}
                        disabled={syncingClickup}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-600/20 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {syncingClickup ? <><span className="animate-spin">⏳</span> Criando...</> : "✅ Criar no ClickUp"}
                      </button>
                      {syncClickupError && <p className="text-red-400 text-[10px] bg-red-500/10 border border-red-500/20 rounded p-2">{syncClickupError}</p>}
                    </div>
                  )}
                </div>

                {/* Links de rastreamento */}
                <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-slate-500 text-[10px] uppercase tracking-wide">🔗 Link de rastreamento</div>
                    {selected.trackingLink && !showLinkTracker && (
                      <button
                        onClick={() => { setShowLinkTracker(true); loadTrackerLinks(); }}
                        className="text-slate-600 hover:text-slate-400 text-xs"
                      >
                        Trocar
                      </button>
                    )}
                  </div>

                  {/* Link já vinculado */}
                  {selected.trackingLink && !showLinkTracker ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <a
                          href={`/r/${selected.trackingLink.code}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 text-sm font-medium underline"
                        >
                          {selected.trackingLink.label ?? selected.trackingLink.code}
                        </a>
                        <span className="text-[10px] text-slate-500 font-mono">/r/{selected.trackingLink.code}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-slate-400">
                          <span className="text-white font-semibold">{selected.trackingLink.clicks}</span> cliques externos
                        </span>
                        <span className="text-slate-400">
                          <span className="text-white font-semibold">{selected.trackingLink._count.clickEvents}</span> cliques internos
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigator.clipboard.writeText(`${window.location.origin}/r/${selected.trackingLink!.code}`)}
                          className="text-[10px] px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 transition-colors"
                        >
                          📋 Copiar link
                        </button>
                        <button
                          onClick={() => handleLinkTracker(null)}
                          disabled={savingTracker}
                          className="text-[10px] px-2 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                        >
                          Desvincular
                        </button>
                      </div>
                    </div>
                  ) : !showLinkTracker ? (
                    <button
                      onClick={() => { setShowLinkTracker(true); loadTrackerLinks(); }}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#161f30] border border-dashed border-[#2a3d5a] text-slate-500 hover:text-slate-300 hover:border-[#3a5070] text-xs transition-colors"
                    >
                      + Vincular link de rastreamento
                    </button>
                  ) : null}

                  {/* Seletor de links */}
                  {showLinkTracker && (
                    <div className="space-y-2">
                      <input
                        autoFocus
                        type="text"
                        value={trackerSearch}
                        onChange={(e) => setTrackerSearch(e.target.value)}
                        placeholder="Buscar link pelo nome..."
                        className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                      />
                      {loadingTrackerLinks ? (
                        <div className="text-center text-slate-600 text-xs py-3">Carregando links...</div>
                      ) : (
                        <div className="max-h-44 overflow-y-auto space-y-1">
                          {(trackerLinks as any[])
                            .filter((l: any) =>
                              !trackerSearch || (l.label ?? l.code).toLowerCase().includes(trackerSearch.toLowerCase())
                            )
                            .slice(0, 20)
                            .map((l: any) => (
                              <button
                                key={l.id}
                                onClick={() => handleLinkTracker(l.id)}
                                disabled={savingTracker}
                                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors disabled:opacity-50 ${
                                  selected.trackingLinkId === l.id
                                    ? "bg-indigo-500/20 border border-indigo-500/40 text-indigo-300"
                                    : "bg-[#0a0f1a] border border-[#1e2d45] text-slate-300 hover:bg-[#161f30] hover:text-white"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium truncate">{l.label ?? l.code}</span>
                                  <span className="text-slate-500 flex-shrink-0">{l.clicks} cliques</span>
                                </div>
                                <div className="text-slate-600 text-[10px] truncate mt-0.5">{l.destination}</div>
                              </button>
                            ))}
                          {trackerLinks.length === 0 && !loadingTrackerLinks && (
                            <p className="text-slate-600 text-xs text-center py-3">Nenhum link cadastrado.</p>
                          )}
                        </div>
                      )}
                      <button
                        onClick={() => setShowLinkTracker(false)}
                        className="text-slate-500 text-xs hover:text-white transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>

                {/* Mover etapas */}
                {stages.length > 1 && (
                  <div>
                    <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">Mover para etapa</div>
                    <div className="flex flex-wrap gap-1.5">
                      {stages.filter((s) => s.name !== selected.pipelineStage).map((s) => (
                        <button
                          key={s.id}
                          onClick={() => { moveToStage(selected.id, s.name); setSelected({ ...selected, pipelineStage: s.name }); }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white text-xs font-medium transition-colors"
                        >
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mover pipelines */}
                <div>
                  <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">Mover para outro pipeline</div>
                  <div className="flex gap-2 flex-wrap">
                    {(OTHER_PIPELINES[pipeline] ?? []).map((p) => (
                      <button
                        key={p.key}
                        onClick={() => moveToPipeline(selected.id, p.key)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 text-xs font-medium transition-colors"
                      >
                        {PIPELINE_LABELS[p.key]?.icon} {p.label} →
                      </button>
                    ))}
                  </div>
                </div>

                {/* Vincular conversa */}
                <div>
                  <button
                    onClick={() => { setShowLinkConv(!showLinkConv); setLinkResult(null); setLinkPhone(""); }}
                    className="text-slate-500 text-[10px] uppercase tracking-wide hover:text-slate-300 transition-colors flex items-center gap-1"
                  >
                    🔗 Vincular conversa WhatsApp {showLinkConv ? "▴" : "▾"}
                  </button>
                  {showLinkConv && (
                    <div className="mt-2 space-y-2">
                      <p className="text-slate-600 text-[10px]">Cole o telefone da conversa para vincular as mensagens a este lead.</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={linkPhone}
                          onChange={(e) => setLinkPhone(e.target.value)}
                          placeholder="5511999999999"
                          className="flex-1 bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                        />
                        <button
                          onClick={handleLinkConversation}
                          disabled={linkingConv || !linkPhone.trim()}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
                        >
                          {linkingConv ? "..." : "Vincular"}
                        </button>
                      </div>
                      {linkResult && <p className="text-xs">{linkResult}</p>}
                    </div>
                  )}
                </div>

                {/* Ações destrutivas */}
                <div className="border-t border-[#1e2d45] pt-4 space-y-2">
                  <button
                    onClick={handleRemoveFromPipeline}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-yellow-400 hover:border-yellow-500/30 text-xs font-medium transition-colors"
                  >
                    📥 Mover para Caixa de Entrada
                  </button>
                  {!confirmDelete ? (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-500 hover:text-red-400 hover:border-red-500/30 text-xs font-medium transition-colors"
                    >
                      🗑️ Deletar este lead
                    </button>
                  ) : (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 space-y-2">
                      <p className="text-red-400 text-xs text-center">Tem certeza? Esta ação não pode ser desfeita.</p>
                      <div className="flex gap-2">
                        <button onClick={handleDeleteLead} disabled={deletingLead} className="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold disabled:opacity-50">
                          {deletingLead ? "Deletando..." : "Confirmar exclusão"}
                        </button>
                        <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 text-xs hover:text-white">Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Coluna direita: anotações ── */}
              <div className="md:w-80 lg:w-96 flex flex-col flex-shrink-0 border-t md:border-t-0 border-[#1e2d45] min-h-0">
                {/* Header comentários */}
                <div className="px-4 py-3 border-b border-[#1e2d45] flex-shrink-0 flex items-center gap-2 bg-[#0f1825]">
                  <span className="text-sm font-semibold text-white">💬 Anotações</span>
                  {comments.length > 0 && (
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded-full border border-indigo-500/30">
                      {comments.length}
                    </span>
                  )}
                </div>

                {/* Novo comentário */}
                <form onSubmit={handleAddComment} className="px-4 py-3 border-b border-[#1e2d45] flex-shrink-0 space-y-2">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Nova anotação... (Ctrl+Enter para salvar)"
                    rows={3}
                    className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddComment(e as any);
                    }}
                  />
                  <button
                    type="submit"
                    disabled={savingComment || !newComment.trim()}
                    className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
                  >
                    {savingComment ? "Salvando..." : "Adicionar anotação"}
                  </button>
                </form>

                {/* Lista de comentários */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {loadingComments ? (
                    <div className="text-slate-600 text-xs text-center py-6">Carregando...</div>
                  ) : comments.length === 0 ? (
                    <div className="text-slate-700 text-xs text-center py-6">Nenhuma anotação ainda.<br />Use o campo acima para registrar informações.</div>
                  ) : (
                    comments.map((c) => (
                      <div key={c.id} className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl px-4 py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-indigo-400 text-[11px] font-semibold">{c.authorName}</span>
                          <span className="text-slate-600 text-[10px]">
                            {new Date(c.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                            {" "}
                            {new Date(c.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">{c.body}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Prospecção Automática ── */}
      {showAutoProspect && (
        <div className="fixed inset-0 z-50 flex flex-col">
          {/* Header do modal */}
          <div className="flex items-center justify-between px-5 py-3 bg-[#0c1220] border-b border-[#1e2d45] flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="text-lg">🤖</span>
              <div>
                <h2 className="text-white font-bold text-sm leading-none">Prospecção Automática</h2>
                <p className="text-slate-500 text-[11px] mt-0.5">Ferramenta externa de prospecção</p>
              </div>
            </div>
            <button
              onClick={() => setShowAutoProspect(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white text-sm transition-colors"
            >
              ✕ Fechar
            </button>
          </div>

          {/* iframe */}
          <iframe
            src="https://webhooks.azzagencia.com.br/webhook/c96d1a1b-14dd-457e-a6a9-d2a765328d88"
            className="flex-1 w-full border-0 bg-white"
            title="Prospecção Automática"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      )}
    </div>
  );
}
