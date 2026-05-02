"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Briefcase, ListChecks, AlertCircle, Clock, User as UserIcon,
  Filter as FilterIcon, Building2, Calendar,
} from "lucide-react";

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
  type: "SUPPORT" | "INTERNAL";
  dueDate: string | null;
  assigneeId: string | null;
  assignee: { id: string; name: string } | null;
  setor: { id: string; name: string } | null;
  clientCompany: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string };
  _count: { messages: number };
}

type QuickFilter = "all" | "overdue" | "unassigned" | "urgent" | "mine";
type KindFilter = "all" | "SUPPORT" | "INTERNAL";

// Cor de urgência por proximidade do prazo. Negativo = atrasado.
function urgencyByDue(dueDate: string | null): { label: string; color: string; bg: string } {
  if (!dueDate) return { label: "Sem prazo", color: "text-slate-500", bg: "bg-slate-500/10" };
  const ms = new Date(dueDate).getTime() - Date.now();
  const days = ms / 86_400_000;
  if (days < 0)        return { label: "Atrasado",   color: "text-red-300",     bg: "bg-red-500/15 border border-red-500/30" };
  if (days < 0.5)      return { label: "Hoje",       color: "text-orange-300",  bg: "bg-orange-500/15 border border-orange-500/30" };
  if (days < 1.5)      return { label: "Amanhã",     color: "text-amber-300",   bg: "bg-amber-500/15 border border-amber-500/30" };
  if (days < 3)        return { label: `${Math.ceil(days)}d`, color: "text-yellow-300", bg: "bg-yellow-500/10 border border-yellow-500/20" };
  return                       { label: `${Math.ceil(days)}d`, color: "text-slate-400",  bg: "bg-slate-500/10 border border-slate-500/20" };
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
  currentUserId,
}: {
  tickets: Ticket[];
  stages: TicketStage[];
  isSuperAdmin: boolean;
  companies: { id: string; name: string }[];
  filterCompanyId: string;
  pipelineCompanyId: string;
  currentUserId: string;
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

  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  const CATEGORIES = ["Acesso / Login", "Relatórios", "Integração WhatsApp", "Campanhas", "Faturamento", "Bug / Erro", "Dúvida", "Outro"];

  // Contagens dos filtros pra mostrar badge — sempre considera o universo total
  const filterCounts = useMemo(() => {
    const now = Date.now();
    return tickets.reduce(
      (acc, t) => {
        const isOpen = t.status !== "RESOLVED" && t.status !== "CLOSED";
        if (t.type === "SUPPORT")  acc.support++;
        if (t.type === "INTERNAL") acc.internal++;
        if (isOpen && t.dueDate && new Date(t.dueDate).getTime() < now) acc.overdue++;
        if (isOpen && !t.assigneeId)                                    acc.unassigned++;
        if (isOpen && t.priority === "URGENT")                          acc.urgent++;
        if (isOpen && t.assigneeId === currentUserId)                   acc.mine++;
        return acc;
      },
      { support: 0, internal: 0, overdue: 0, unassigned: 0, urgent: 0, mine: 0 }
    );
  }, [tickets, currentUserId]);

  // Aplica todos os filtros (busca + tipo + quickFilter)
  const filtered = tickets.filter((t) => {
    if (kindFilter !== "all" && t.type !== kindFilter) return false;

    if (quickFilter !== "all") {
      const isOpen = t.status !== "RESOLVED" && t.status !== "CLOSED";
      if (quickFilter === "overdue"    && !(isOpen && t.dueDate && new Date(t.dueDate).getTime() < Date.now())) return false;
      if (quickFilter === "unassigned" && !(isOpen && !t.assigneeId)) return false;
      if (quickFilter === "urgent"     && !(isOpen && t.priority === "URGENT")) return false;
      if (quickFilter === "mine"       && !(isOpen && t.assigneeId === currentUserId)) return false;
    }

    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      t.company.name.toLowerCase().includes(q) ||
      (t.clientCompany?.name?.toLowerCase().includes(q) ?? false) ||
      (t.category?.toLowerCase().includes(q) ?? false)
    );
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
      <div className="flex flex-col gap-3 px-6 pt-5 pb-3 flex-shrink-0 border-b border-[#1e2d45]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-white font-bold text-xl">🎫 Chamados &amp; Tarefas</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              {totalOpen} aberto{totalOpen !== 1 ? "s" : ""}
              {tickets.length !== totalOpen && (
                <span className="text-slate-600 ml-1">· {tickets.length} total</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isSuperAdmin && companies.length > 0 && (
              <select
                value={filterCompanyId}
                onChange={(e) => router.push(`/chamados?companyId=${e.target.value}`)}
                className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Todas as empresas</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
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
            <Link
              href="/chamados/novo"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              + Novo
            </Link>
          </div>
        </div>

        {/* Barra de filtros: tipo + atalhos */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tipo: Todos / Chamados / Tarefas */}
          <div className="flex items-center bg-[#0f1623] border border-[#1e2d45] rounded-lg p-0.5">
            <button
              onClick={() => setKindFilter("all")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                kindFilter === "all" ? "bg-white/10 text-white" : "text-slate-500 hover:text-white"
              }`}
            >
              Todos <span className="text-slate-600 ml-1">{tickets.length}</span>
            </button>
            <button
              onClick={() => setKindFilter("SUPPORT")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                kindFilter === "SUPPORT" ? "bg-blue-500/15 text-blue-300" : "text-slate-500 hover:text-white"
              }`}
            >
              <Briefcase className="w-3 h-3" strokeWidth={2.5} />
              Chamados <span className="text-slate-600 ml-1">{filterCounts.support}</span>
            </button>
            <button
              onClick={() => setKindFilter("INTERNAL")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                kindFilter === "INTERNAL" ? "bg-emerald-500/15 text-emerald-300" : "text-slate-500 hover:text-white"
              }`}
            >
              <ListChecks className="w-3 h-3" strokeWidth={2.5} />
              Tarefas <span className="text-slate-600 ml-1">{filterCounts.internal}</span>
            </button>
          </div>

          <span className="w-px h-5 bg-[#1e2d45]" />

          {/* Atalhos de filtro */}
          {([
            { key: "all" as const,        label: "Todos",          Icon: FilterIcon,  color: "" },
            { key: "mine" as const,       label: "Meus",           Icon: UserIcon,    color: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",  count: filterCounts.mine },
            { key: "overdue" as const,    label: "Atrasados",      Icon: Clock,       color: "bg-red-500/15 text-red-300 border-red-500/30",          count: filterCounts.overdue },
            { key: "urgent" as const,     label: "Urgentes",       Icon: AlertCircle, color: "bg-orange-500/15 text-orange-300 border-orange-500/30", count: filterCounts.urgent },
            { key: "unassigned" as const, label: "Sem responsável", Icon: UserIcon,    color: "bg-slate-500/15 text-slate-300 border-slate-500/30",   count: filterCounts.unassigned },
          ]).map(({ key, label, Icon, color, count }) => {
            const isActive = quickFilter === key;
            return (
              <button
                key={key}
                onClick={() => setQuickFilter(key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                  isActive
                    ? (color || "bg-white/10 text-white border-white/20")
                    : "bg-[#0f1623] border-[#1e2d45] text-slate-500 hover:text-white hover:border-slate-600"
                }`}
              >
                <Icon className="w-3 h-3" strokeWidth={2.5} />
                {label}
                {count !== undefined && count > 0 && (
                  <span className={`text-[9px] font-bold px-1 rounded-full ${isActive ? "bg-white/15" : "bg-white/10"}`}>{count}</span>
                )}
              </button>
            );
          })}
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
                      const due = urgencyByDue(ticket.dueDate);
                      const isInternal = ticket.type === "INTERNAL";
                      const isMine = ticket.assigneeId === currentUserId;
                      const clientName = ticket.clientCompany?.name;

                      // Borda lateral colorida — verde pra tarefa, azul pra chamado
                      const borderL = isInternal
                        ? "border-l-4 border-l-emerald-500/60"
                        : "border-l-4 border-l-blue-500/60";

                      return (
                        <div
                          key={ticket.id}
                          draggable
                          onDragStart={(e) => onDragStart(e, ticket.id)}
                          className={`bg-[#0f1623] border border-[#1e2d45] ${borderL} rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-white/20 transition-all group ${
                            movingId === ticket.id ? "opacity-40" : ""
                          }`}
                        >
                          {/* Linha 1: tipo + título */}
                          <div className="flex items-start gap-2 mb-2">
                            {isInternal
                              ? <ListChecks className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                              : <Briefcase  className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" strokeWidth={2.5} />}
                            <Link
                              href={`/chamados/${ticket.id}`}
                              className="text-white text-[13px] font-semibold leading-snug hover:text-indigo-300 transition-colors line-clamp-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {ticket.title}
                            </Link>
                          </div>

                          {/* Cliente (só pra SUPPORT) ou empresa (super admin) */}
                          {clientName && (
                            <div className="text-slate-400 text-[11px] mb-1 truncate flex items-center gap-1">
                              <Building2 className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
                              {clientName}
                            </div>
                          )}
                          {isSuperAdmin && !clientName && (
                            <div className="text-slate-500 text-[11px] mb-1.5 truncate">
                              🏢 {ticket.company.name}
                            </div>
                          )}

                          {/* Linha 2: prioridade + categoria + prazo */}
                          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${pc.bg} ${pc.color}`}>
                              {pc.icon} {pc.label}
                            </span>
                            {ticket.category && (
                              <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">
                                {ticket.category}
                              </span>
                            )}
                            {ticket.dueDate && (
                              <span
                                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${due.bg} ${due.color} flex items-center gap-1`}
                                title={new Date(ticket.dueDate).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                              >
                                <Clock className="w-2.5 h-2.5" strokeWidth={2.5} />
                                {due.label}
                              </span>
                            )}
                          </div>

                          {/* Linha 3: atendente + setor + msg count */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {ticket.assignee ? (
                                <span
                                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 ${
                                    isMine
                                      ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/25"
                                      : "bg-yellow-500/10 text-yellow-300 border border-yellow-500/20"
                                  }`}
                                  title={isMine ? "Sua atribuição" : `Responsável: ${ticket.assignee.name}`}
                                >
                                  <span className="w-3 h-3 rounded-full bg-white/15 flex items-center justify-center text-[8px] font-bold">
                                    {ticket.assignee.name.charAt(0).toUpperCase()}
                                  </span>
                                  {isMine ? "Você" : ticket.assignee.name.split(" ")[0]}
                                </span>
                              ) : !isInternal ? (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500 border border-slate-500/20">
                                  Sem responsável
                                </span>
                              ) : null}
                              {ticket.setor && (
                                <span className="text-[10px] text-violet-300 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded truncate">
                                  {ticket.setor.name}
                                </span>
                              )}
                            </div>
                            {ticket._count.messages > 0 && (
                              <span className="text-slate-600 text-[10px] flex-shrink-0">💬 {ticket._count.messages}</span>
                            )}
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
