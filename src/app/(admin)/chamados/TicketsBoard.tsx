"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface TicketStage {
  id: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
}

interface Ticket {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string | null;
  ticketStage: string | null;
  phone: string | null;
  clickupTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string };
  _count: { messages: number };
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: string; bg: string }> = {
  LOW:    { label: "Baixa",   color: "text-slate-400",  icon: "🟢", bg: "bg-slate-500/10 border-slate-500/20" },
  MEDIUM: { label: "Média",   color: "text-yellow-400", icon: "🟡", bg: "bg-yellow-500/10 border-yellow-500/20" },
  HIGH:   { label: "Alta",    color: "text-orange-400", icon: "🟠", bg: "bg-orange-500/10 border-orange-500/20" },
  URGENT: { label: "Urgente", color: "text-red-400",    icon: "🔴", bg: "bg-red-500/10 border-red-500/20" },
};

export default function TicketsBoard({
  tickets: initialTickets,
  stages,
  isSuperAdmin,
  companies,
  filterCompanyId,
  pipelineCompanyId,
}: {
  tickets: Ticket[];
  stages: TicketStage[];
  isSuperAdmin: boolean;
  companies: { id: string; name: string }[];
  filterCompanyId: string;
  pipelineCompanyId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tickets, setTickets] = useState(initialTickets);
  const [search, setSearch] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ title: "", description: "", priority: "MEDIUM", category: "", companyId: filterCompanyId || "" });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  const CATEGORIES = ["Acesso / Login", "Relatórios", "Integração WhatsApp", "Campanhas", "Faturamento", "Bug / Erro", "Dúvida", "Outro"];

  // Filter by search
  const filtered = tickets.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.title.toLowerCase().includes(q) || t.company.name.toLowerCase().includes(q) || (t.category?.toLowerCase().includes(q) ?? false);
  });

  const firstStage = stages[0]?.name ?? "Novo";

  // Group by stage
  const byStage: Record<string, Ticket[]> = {};
  for (const s of stages) byStage[s.name] = [];
  for (const t of filtered) {
    const stageName = t.ticketStage ?? firstStage;
    if (!byStage[stageName]) byStage[stageName] = [];
    byStage[stageName].push(t);
  }

  async function moveToStage(ticketId: string, stageName: string) {
    setMovingId(ticketId);
    setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, ticketStage: stageName } : t)));
    await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketStage: stageName }),
    });
    setMovingId(null);
    startTransition(() => router.refresh());
  }

  function onDragStart(e: React.DragEvent, ticketId: string) {
    e.dataTransfer.setData("ticketId", ticketId);
  }

  function onDrop(e: React.DragEvent, stageName: string) {
    e.preventDefault();
    setDragOverStage(null);
    const ticketId = e.dataTransfer.getData("ticketId");
    if (ticketId) moveToStage(ticketId, stageName);
  }

  async function handleAddTicket(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    if (!addForm.title.trim() || !addForm.description.trim()) { setAddError("Título e descrição são obrigatórios"); return; }
    const effectiveCompanyId = isSuperAdmin ? addForm.companyId : filterCompanyId;
    if (!effectiveCompanyId) { setAddError("Selecione a empresa"); return; }
    setAddSaving(true);
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...addForm, companyId: effectiveCompanyId }),
    });
    if (res.ok) {
      const ticket = await res.json();
      setTickets((prev) => [ticket, ...prev]);
      setAddForm({ title: "", description: "", priority: "MEDIUM", category: "", companyId: filterCompanyId || "" });
      setShowAddModal(false);
      startTransition(() => router.refresh());
    } else {
      const err = await res.json();
      setAddError(err.error ?? "Erro ao criar chamado");
    }
    setAddSaving(false);
  }

  const totalOpen = tickets.filter((t) => !stages.find((s) => s.name === (t.ticketStage ?? firstStage))?.isFinal).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0 border-b border-[#1e2d45]">
        <div>
          <h1 className="text-white font-bold text-xl">🎫 Chamados</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {totalOpen} aberto{totalOpen !== 1 ? "s" : ""}
            {tickets.length !== totalOpen && (
              <span className="text-slate-600 ml-1">· {tickets.length} total</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isSuperAdmin && companies.length > 0 && (
            <form>
              <select
                name="companyId"
                defaultValue={filterCompanyId}
                onChange={(e) => router.push(`/chamados?companyId=${e.target.value}`)}
                className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Todas as empresas</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </form>
          )}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar chamado..."
            className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 w-48"
          />
          {stages.length === 0 && (
            <a
              href="/configuracoes?secao=pipeline"
              className="px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 text-xs hover:text-white transition-colors"
            >
              ⚙️ Configurar etapas
            </a>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            + Novo Chamado
          </button>
        </div>
      </div>

      {/* Kanban */}
      {stages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center p-8">
          <div>
            <div className="text-4xl mb-3">⚙️</div>
            <div className="text-white font-semibold mb-1">Nenhuma etapa configurada</div>
            <div className="text-slate-500 text-sm mb-4">Configure as etapas em Configurações → CRM / Pipeline → aba Chamados</div>
            <a href="/configuracoes?secao=pipeline" className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-500 transition-colors">
              Configurar etapas →
            </a>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto px-6 pb-6 pt-4">
          <div className="flex gap-3 h-full" style={{ minWidth: stages.length * 240 + "px" }}>
            {stages.map((stage) => {
              const stageTickets = byStage[stage.name] ?? [];
              return (
                <div
                  key={stage.id}
                  className={`flex flex-col flex-1 min-w-[220px] rounded-xl border transition-all ${
                    stage.isFinal ? "bg-white/[0.02] border-white/10" : "bg-[#0a0f1a] border-[#1e2d45]"
                  } ${dragOverStage === stage.name ? "ring-2 ring-white/20 scale-[1.01]" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.name); }}
                  onDragLeave={() => setDragOverStage(null)}
                  onDrop={(e) => onDrop(e, stage.name)}
                >
                  {/* Column header */}
                  <div
                    className="px-3 pt-3 pb-2 flex items-center justify-between flex-shrink-0"
                    style={{ borderBottom: `2px solid ${stage.color}30` }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="text-white font-semibold text-[13px]">{stage.name}</span>
                      <span className="bg-white/10 text-slate-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {stageTickets.length}
                      </span>
                    </div>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {stageTickets.length === 0 && (
                      <div className="text-center py-6 text-slate-700 text-xs">Arraste aqui</div>
                    )}
                    {stageTickets.map((ticket) => {
                      const pc = PRIORITY_CONFIG[ticket.priority] ?? PRIORITY_CONFIG.MEDIUM;
                      const lastActivity = new Date(ticket.updatedAt);
                      const now = new Date();
                      const diffH = Math.floor((now.getTime() - lastActivity.getTime()) / 3600000);
                      const ageLabel = diffH < 1 ? "agora" : diffH < 24 ? `${diffH}h` : `${Math.floor(diffH / 24)}d`;

                      return (
                        <div
                          key={ticket.id}
                          draggable
                          onDragStart={(e) => onDragStart(e, ticket.id)}
                          className={`bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-white/20 transition-all group ${
                            movingId === ticket.id ? "opacity-40" : ""
                          }`}
                        >
                          {/* Priority + title */}
                          <div className="flex items-start gap-2 mb-2">
                            <span className="text-[12px] flex-shrink-0 mt-0.5">{pc.icon}</span>
                            <Link
                              href={`/chamados/${ticket.id}`}
                              className="text-white text-[13px] font-semibold leading-snug hover:text-indigo-300 transition-colors line-clamp-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {ticket.title}
                            </Link>
                          </div>

                          {/* Company */}
                          {isSuperAdmin && (
                            <div className="text-slate-500 text-[11px] mb-1.5 truncate">
                              🏢 {ticket.company.name}
                            </div>
                          )}

                          {/* Category + messages */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {ticket.category && (
                                <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">
                                  {ticket.category}
                                </span>
                              )}
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${pc.bg} ${pc.color}`}>
                                {pc.label}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {ticket._count.messages > 0 && (
                                <span className="text-slate-600 text-[10px]">💬{ticket._count.messages}</span>
                              )}
                              <span className="text-slate-700 text-[10px] font-mono">{ageLabel}</span>
                            </div>
                          </div>

                          {/* Quick move buttons (appear on hover) */}
                          <div className="hidden group-hover:flex gap-1 mt-2 pt-2 border-t border-[#1e2d45]">
                            {stages
                              .filter((s) => s.name !== stage.name)
                              .slice(0, 3)
                              .map((s) => (
                                <button
                                  key={s.id}
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); moveToStage(ticket.id, s.name); }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-500 hover:text-white bg-white/5 hover:bg-white/10 transition-colors truncate max-w-[80px]"
                                  title={`Mover para ${s.name}`}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                                  <span className="truncate">{s.name}</span>
                                </button>
                              ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-[#0c1220] border border-[#1e2d45] rounded-2xl w-full max-w-lg mx-4 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1e2d45] flex items-center justify-between">
              <div>
                <h2 className="text-white font-bold text-base">🎫 Novo Chamado</h2>
                <p className="text-slate-500 text-xs mt-0.5">Abrir um chamado de suporte</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-500 hover:text-white text-2xl leading-none">×</button>
            </div>
            <form onSubmit={handleAddTicket} className="p-6 space-y-4">
              {isSuperAdmin && (
                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">Empresa <span className="text-red-400">*</span></label>
                  <select
                    required
                    value={addForm.companyId}
                    onChange={(e) => setAddForm((f) => ({ ...f, companyId: e.target.value }))}
                    className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Selecione a empresa</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">Título <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  required
                  value={addForm.title}
                  onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Descreva o problema em poucas palavras..."
                  className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">Categoria</label>
                  <select
                    value={addForm.category}
                    onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Sem categoria</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">Prioridade</label>
                  <select
                    value={addForm.priority}
                    onChange={(e) => setAddForm((f) => ({ ...f, priority: e.target.value }))}
                    className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="LOW">🟢 Baixa</option>
                    <option value="MEDIUM">🟡 Média</option>
                    <option value="HIGH">🟠 Alta</option>
                    <option value="URGENT">🔴 Urgente</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">Descrição <span className="text-red-400">*</span></label>
                <textarea
                  required
                  rows={4}
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Descreva o problema com detalhes..."
                  className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
              {addError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">{addError}</div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={addSaving}
                  className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {addSaving ? "Abrindo..." : "Abrir Chamado"}
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
    </div>
  );
}
