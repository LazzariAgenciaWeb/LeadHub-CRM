"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CompanyOption {
  id: string;
  name: string;
}

interface Stage {
  id: string;
  pipeline: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
}

const PIPELINES = [
  { key: "PROSPECCAO", label: "🔎 Prospecção", desc: "Contatos frios do BDR" },
  { key: "LEADS", label: "🎯 Leads", desc: "Prospects com interesse" },
  { key: "OPORTUNIDADES", label: "💡 Oportunidades", desc: "Em negociação / orçamento" },
  { key: "CHAMADOS", label: "🎫 Chamados", desc: "Etapas de atendimento" },
];

const COLOR_PRESETS = [
  "#6366f1", "#8b5cf6", "#3b82f6", "#06b6d4",
  "#22c55e", "#f59e0b", "#f97316", "#ef4444",
  "#64748b", "#ec4899",
];

export default function PipelineSettings({
  initialStages,
  companyId,
  isSuperAdmin = false,
  allCompanies = [],
  selectedCompanyId = "",
}: {
  initialStages: Stage[];
  companyId: string;
  isSuperAdmin?: boolean;
  allCompanies?: CompanyOption[];
  selectedCompanyId?: string;
}) {
  const router = useRouter();
  const [stages, setStages] = useState(initialStages);
  const [activeTab, setActiveTab] = useState("CHAMADOS");
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [newIsFinal, setNewIsFinal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [seeding, setSeeding] = useState<string | null>(null);

  const byPipeline = (p: string) =>
    stages.filter((s) => s.pipeline === p).sort((a, b) => a.order - b.order);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !addingTo) return;
    setSaving(true);
    const existing = byPipeline(addingTo);
    const res = await fetch("/api/pipeline/stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipeline: addingTo,
        name: newName.trim(),
        color: newColor,
        isFinal: newIsFinal,
        order: existing.length,
        companyId,
      }),
    });
    if (res.ok) {
      const stage = await res.json();
      setStages((prev) => [...prev, stage]);
      setNewName("");
      setNewColor("#6366f1");
      setNewIsFinal(false);
      setAddingTo(null);
      router.refresh();
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover esta etapa? Leads nela não serão excluídos.")) return;
    setDeletingId(id);
    await fetch(`/api/pipeline/stages/${id}`, { method: "DELETE" });
    setStages((prev) => prev.filter((s) => s.id !== id));
    setDeletingId(null);
    router.refresh();
  }

  async function handleEditSave(id: string) {
    setSaving(true);
    const res = await fetch(`/api/pipeline/stages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, color: editColor }),
    });
    if (res.ok) {
      const updated = await res.json();
      setStages((prev) => prev.map((s) => (s.id === id ? updated : s)));
      setEditingId(null);
      router.refresh();
    }
    setSaving(false);
  }

  async function handleToggleFinal(stage: Stage) {
    const res = await fetch(`/api/pipeline/stages/${stage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFinal: !stage.isFinal }),
    });
    if (res.ok) {
      setStages((prev) =>
        prev.map((s) => (s.id === stage.id ? { ...s, isFinal: !s.isFinal } : s))
      );
    }
  }

  async function handleSeedStages(pipeline: string, force = false) {
    if (force && !confirm(`Isso vai apagar as etapas atuais de ${pipeline} e recriar as padrão. Confirma?`)) return;
    setSeeding(pipeline);
    try {
      const res = await fetch("/api/pipeline/stages/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline, companyId, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Erro ao criar etapas: ${data.error ?? res.status}`);
        setSeeding(null);
        return;
      }
      if (data.stages && data.stages.length > 0) {
        setStages((prev) => [
          ...prev.filter((s) => s.pipeline !== pipeline),
          ...data.stages,
        ]);
      } else if (data.created === 0) {
        // Já existiam — força recriação
        const res2 = await fetch("/api/pipeline/stages/seed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipeline, companyId, force: true }),
        });
        const data2 = await res2.json();
        if (data2.stages) {
          setStages((prev) => [
            ...prev.filter((s) => s.pipeline !== pipeline),
            ...data2.stages,
          ]);
        }
      }
      router.refresh();
    } catch (err) {
      alert(`Erro inesperado: ${err}`);
    }
    setSeeding(null);
  }

  async function handleMoveUp(stage: Stage) {
    const list = byPipeline(stage.pipeline);
    const idx = list.findIndex((s) => s.id === stage.id);
    if (idx === 0) return;
    const prev = list[idx - 1];
    const reordered = [...list];
    reordered[idx - 1] = { ...stage, order: prev.order };
    reordered[idx] = { ...prev, order: stage.order };
    setStages((all) => [
      ...all.filter((s) => s.pipeline !== stage.pipeline),
      ...reordered,
    ]);
    await fetch("/api/pipeline/stages", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { id: stage.id, order: prev.order },
        { id: prev.id, order: stage.order },
      ]),
    });
    router.refresh();
  }

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-white font-bold text-lg mb-1">CRM / Pipeline</h2>
      <p className="text-slate-500 text-sm mb-4">
        Configure as etapas de cada pipeline. Arraste para reordenar ou use as setas.
      </p>

      {/* Seletor de empresa — visível apenas para SuperAdmin */}
      {isSuperAdmin && allCompanies.length > 0 && (
        <div className="mb-6">
          <label className="block text-slate-400 text-xs font-semibold mb-1.5">
            Empresa
          </label>
          <select
            value={selectedCompanyId}
            onChange={(e) => router.push(`/configuracoes?secao=pipeline&companyId=${e.target.value}`)}
            className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="" disabled>Selecione uma empresa...</option>
            {allCompanies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Tabs de pipeline */}
      <div className="flex gap-1 mb-6 bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-1">
        {PIPELINES.map((p) => (
          <button
            key={p.key}
            onClick={() => setActiveTab(p.key)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-center ${
              activeTab === p.key
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {p.label}
            <div className={`text-[10px] font-normal mt-0.5 ${activeTab === p.key ? "text-indigo-200" : "text-slate-600"}`}>
              {byPipeline(p.key).length} etapas
            </div>
          </button>
        ))}
      </div>

      {/* Etapas do pipeline ativo */}
      {PIPELINES.filter((p) => p.key === activeTab).map((p) => {
        const pStages = byPipeline(p.key);
        return (
          <div key={p.key}>
            {pStages.length > 0 && (
              <div className="flex justify-end mb-3">
                <button
                  onClick={() => handleSeedStages(p.key, true)}
                  disabled={seeding === p.key}
                  className="text-slate-600 hover:text-slate-400 text-xs disabled:opacity-50 transition-colors"
                  title="Apagar etapas atuais e restaurar as padrão"
                >
                  {seeding === p.key ? "Restaurando..." : "↺ Restaurar padrão"}
                </button>
              </div>
            )}
            <div className="space-y-2 mb-4">
              {pStages.length === 0 && (
                <div className="text-center py-8 border border-dashed border-[#1e2d45] rounded-xl">
                  <div className="text-2xl mb-2">🫧</div>
                  <div className="text-slate-500 text-sm mb-3">Nenhuma etapa configurada.</div>
                  <button
                    onClick={() => handleSeedStages(p.key)}
                    disabled={seeding === p.key}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {seeding === p.key ? "Criando..." : "✨ Criar etapas padrão"}
                  </button>
                </div>
              )}
              {pStages.map((stage, idx) => (
                <div
                  key={stage.id}
                  className={`flex items-center gap-3 bg-[#0f1623] border rounded-lg px-4 py-3 ${
                    stage.isFinal ? "border-white/10" : "border-[#1e2d45]"
                  }`}
                >
                  {/* Cor */}
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: stage.color }}
                  />

                  {/* Nome / edição inline */}
                  {editingId === stage.id ? (
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 bg-[#080b12] border border-indigo-500 rounded px-2 py-1 text-sm text-white focus:outline-none"
                      />
                      <div className="flex gap-1 flex-wrap">
                        {COLOR_PRESETS.map((c) => (
                          <button
                            key={c}
                            onClick={() => setEditColor(c)}
                            className={`w-5 h-5 rounded-full border-2 transition-all ${editColor === c ? "border-white scale-110" : "border-transparent"}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <button onClick={() => handleEditSave(stage.id)} disabled={saving} className="px-2 py-1 rounded bg-indigo-600 text-white text-xs hover:bg-indigo-500 disabled:opacity-50">Salvar</button>
                      <button onClick={() => setEditingId(null)} className="text-slate-500 text-xs hover:text-white">✕</button>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center gap-2 min-w-0">
                      <span className="text-white text-sm font-medium truncate">{stage.name}</span>
                      {stage.isFinal && (
                        <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded-full flex-shrink-0">
                          etapa final
                        </span>
                      )}
                    </div>
                  )}

                  {/* Ações */}
                  {editingId !== stage.id && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleMoveUp(stage)}
                        disabled={idx === 0}
                        className="w-6 h-6 flex items-center justify-center rounded text-slate-600 hover:text-white disabled:opacity-20 hover:bg-white/5 text-xs"
                        title="Mover para cima"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => { setEditingId(stage.id); setEditName(stage.name); setEditColor(stage.color); }}
                        className="w-6 h-6 flex items-center justify-center rounded text-slate-600 hover:text-white hover:bg-white/5 text-xs"
                        title="Editar"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleToggleFinal(stage)}
                        className={`w-6 h-6 flex items-center justify-center rounded text-xs hover:bg-white/5 ${stage.isFinal ? "text-amber-400" : "text-slate-600 hover:text-amber-400"}`}
                        title={stage.isFinal ? "Desmarcar como etapa final" : "Marcar como etapa final"}
                      >
                        🏁
                      </button>
                      <button
                        onClick={() => handleDelete(stage.id)}
                        disabled={deletingId === stage.id}
                        className="w-6 h-6 flex items-center justify-center rounded text-slate-600 hover:text-red-400 hover:bg-white/5 text-xs disabled:opacity-50"
                        title="Remover"
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Adicionar nova etapa */}
            {addingTo === p.key ? (
              <form onSubmit={handleAdd} className="bg-[#0f1623] border border-indigo-500/30 rounded-xl p-4 space-y-3">
                <p className="text-indigo-400 text-xs font-semibold">Nova etapa em {p.label}</p>
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nome da etapa (ex: Em Negociação)"
                  className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
                <div>
                  <p className="text-slate-500 text-[10px] mb-2">Cor</p>
                  <div className="flex gap-2 flex-wrap">
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewColor(c)}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${newColor === c ? "border-white scale-110" : "border-transparent"}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newIsFinal}
                    onChange={(e) => setNewIsFinal(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-slate-400 text-xs">Etapa final (Fechado / Perdido)</span>
                </label>
                <div className="flex gap-2">
                  <button type="submit" disabled={saving || !newName.trim()} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50">
                    {saving ? "Salvando..." : "Adicionar"}
                  </button>
                  <button type="button" onClick={() => setAddingTo(null)} className="px-3 py-2 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 text-sm hover:text-white">
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setAddingTo(p.key)}
                className="w-full py-2.5 rounded-xl border border-dashed border-[#1e2d45] text-slate-500 hover:text-white hover:border-indigo-500/30 text-sm transition-colors"
              >
                + Adicionar etapa
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
