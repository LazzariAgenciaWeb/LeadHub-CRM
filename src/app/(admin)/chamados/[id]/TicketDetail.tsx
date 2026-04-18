"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface TicketMessage {
  id: string;
  body: string;
  isInternal: boolean;
  authorName: string;
  authorRole: string;
  createdAt: string;
}

interface TicketStageOption {
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
  messages: TicketMessage[];
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  LOW:    { label: "Baixa",   color: "text-slate-400",  icon: "🟢" },
  MEDIUM: { label: "Média",   color: "text-yellow-400", icon: "🟡" },
  HIGH:   { label: "Alta",    color: "text-orange-400", icon: "🟠" },
  URGENT: { label: "Urgente", color: "text-red-400",    icon: "🔴" },
};

export default function TicketDetail({
  ticket,
  isSuperAdmin,
  currentUserName,
  stages,
}: {
  ticket: Ticket;
  isSuperAdmin: boolean;
  currentUserName: string;
  stages: TicketStageOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [messages, setMessages] = useState<TicketMessage[]>(ticket.messages);
  const [status, setStatus] = useState(ticket.status);
  const [ticketStage, setTicketStage] = useState(ticket.ticketStage ?? stages[0]?.name ?? "");
  const [priority, setPriority] = useState(ticket.priority);
  const [reply, setReply] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [updatingStage, setUpdatingStage] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ClickUp
  const [clickupTaskId, setClickupTaskId] = useState(ticket.clickupTaskId ?? "");
  const [editingClickup, setEditingClickup] = useState(false);
  const [clickupInput, setClickupInput] = useState(ticket.clickupTaskId ?? "");
  const [savingClickup, setSavingClickup] = useState(false);
  const [syncingClickup, setSyncingClickup] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Change company (SUPER_ADMIN only)
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyName, setCompanyName] = useState(ticket.company.name);
  const [companySearchInput, setCompanySearchInput] = useState("");
  const [companyResults, setCompanyResults] = useState<{ id: string; name: string }[]>([]);
  const [searchingCompany, setSearchingCompany] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    const res = await fetch(`/api/tickets/${ticket.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageBody: reply, isInternal }),
    });
    if (res.ok) {
      const msg = await res.json();
      setMessages((prev) => [...prev, msg]);
      setReply("");
    }
    setSending(false);
  }

  async function handleStageChange(newStage: string) {
    setUpdatingStage(true);
    setTicketStage(newStage);

    // Se a etapa destino é final, sincroniza o status com RESOLVED
    // para que os filtros openOnly=true parem de retornar este chamado
    const stageObj = stages.find((s) => s.name === newStage);
    const newStatus = stageObj?.isFinal ? "RESOLVED" : undefined;
    if (newStatus) setStatus(newStatus);

    await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketStage: newStage,
        ...(newStatus ? { status: newStatus } : {}),
      }),
    });
    setUpdatingStage(false);
    startTransition(() => router.refresh());
  }

  async function handlePriorityChange(newPriority: string) {
    setPriority(newPriority);
    await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: newPriority }),
    });
    startTransition(() => router.refresh());
  }

  async function handleStatusChange(newStatus: string) {
    setStatus(newStatus);
    await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    startTransition(() => router.refresh());
  }

  async function handleSaveClickup(e: React.FormEvent) {
    e.preventDefault();
    setSavingClickup(true);
    const val = clickupInput.trim() || null;
    await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clickupTaskId: val }),
    });
    setClickupTaskId(val ?? "");
    setEditingClickup(false);
    setSavingClickup(false);
  }

  async function handleSyncClickup() {
    setSyncingClickup(true);
    setSyncError(null);
    const res = await fetch(`/api/tickets/${ticket.id}/sync-clickup`, { method: "POST" });
    const data = await res.json();
    if (res.ok && data.clickupTaskId) {
      setClickupTaskId(data.clickupTaskId);
      setClickupInput(data.clickupTaskId);
    } else {
      // Monta mensagem de erro legível
      let msg = data.error ?? "Erro desconhecido";
      if (data.clickupError) {
        const detail = typeof data.clickupError === "object"
          ? (data.clickupError.err ?? data.clickupError.ECODE ?? JSON.stringify(data.clickupError))
          : data.clickupError;
        msg += `: ${detail}`;
      }
      setSyncError(msg);
    }
    setSyncingClickup(false);
  }

  async function searchTicketCompanies(q: string) {
    if (!q.trim()) return;
    setSearchingCompany(true);
    const res = await fetch(`/api/companies?search=${encodeURIComponent(q)}`);
    if (res.ok) {
      const data = await res.json();
      setCompanyResults((data.companies ?? data).slice(0, 6));
    }
    setSearchingCompany(false);
  }

  async function handleChangeCompany(company: { id: string; name: string }) {
    await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: company.id }),
    });
    setCompanyName(company.name);
    setEditingCompany(false);
    setCompanySearchInput("");
    setCompanyResults([]);
    startTransition(() => router.refresh());
  }

  const pc = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.MEDIUM;
  const currentStageObj = stages.find((s) => s.name === ticketStage);
  const isClosed = status === "CLOSED" || currentStageObj?.isFinal;

  // "description" is always messages[0] body (the initial request), subsequent are updates
  const [initialMsg, ...updates] = messages;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-[#1e2d45]">
        <div className="flex items-center gap-2 mb-2 text-sm">
          <Link href="/chamados" className="text-slate-500 hover:text-white transition-colors flex items-center gap-1">
            ← Chamados
          </Link>
          <span className="text-slate-700">/</span>
          <span className="text-slate-500 truncate max-w-xs">{ticket.title}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-bold text-lg leading-snug">{ticket.title}</h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {/* Stage badge */}
              {currentStageObj && (
                <span
                  className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border"
                  style={{ color: currentStageObj.color, backgroundColor: currentStageObj.color + "20", borderColor: currentStageObj.color + "40" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: currentStageObj.color }} />
                  {currentStageObj.name}
                </span>
              )}
              {/* Priority */}
              <span className={`text-[11px] font-semibold ${pc.color}`}>{pc.icon} {pc.label}</span>
              {/* Company */}
              <span className="text-slate-500 text-[11px]">🏢 {ticket.company.name}</span>
              {/* Category */}
              {ticket.category && (
                <span className="text-[11px] text-slate-500 bg-white/5 px-2 py-0.5 rounded">{ticket.category}</span>
              )}
              {/* Messages count */}
              <span className="text-slate-600 text-[11px]">💬 {messages.length} mensagen{messages.length !== 1 ? "s" : ""}</span>
            </div>
          </div>
          {/* Atalhos rápidos */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {ticket.phone && (
              <Link
                href={`/whatsapp?abrir=${encodeURIComponent(ticket.phone)}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-medium hover:bg-green-500/20 transition-colors"
              >
                💬 WhatsApp
              </Link>
            )}
            {isSuperAdmin && (
              clickupTaskId ? (
                <a
                  href={clickupTaskId.startsWith("http") ? clickupTaskId : `https://app.clickup.com/t/${clickupTaskId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#7B68EE]/10 border border-[#7B68EE]/30 text-[#a99ef5] text-xs font-medium hover:bg-[#7B68EE]/20 transition-colors"
                >
                  ✅ ClickUp ↗
                </a>
              ) : (
                <button
                  onClick={handleSyncClickup}
                  disabled={syncingClickup}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#7B68EE]/10 border border-[#7B68EE]/30 text-[#a99ef5] text-xs font-medium hover:bg-[#7B68EE]/20 disabled:opacity-50 transition-colors"
                >
                  {syncingClickup ? "Criando..." : "✅ Criar no ClickUp"}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Body: two columns */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: description + activity + reply */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-[#1e2d45]">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {/* Original request card */}
            {initialMsg && (
              <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-indigo-400 text-[10px] font-bold uppercase tracking-wide">📋 Solicitação Original</span>
                  <span className="text-slate-600 text-[10px]">— {initialMsg.authorName}</span>
                  <span className="text-slate-700 text-[10px] ml-auto font-mono">
                    {new Date(initialMsg.createdAt).toLocaleString("pt-BR")}
                  </span>
                </div>
                <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">{initialMsg.body}</p>
              </div>
            )}

            {/* Activity feed */}
            {updates.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-3">
                  Atualizações ({updates.length})
                </div>
                <div className="space-y-3">
                  {updates.map((msg) => {
                    const isAdmin = msg.authorRole === "SUPER_ADMIN";
                    if (msg.isInternal) {
                      return (
                        <div key={msg.id} className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-amber-400 text-[10px] font-bold">🔒 Nota interna</span>
                            <span className="text-slate-600 text-[10px]">{msg.authorName}</span>
                            <span className="text-slate-700 text-[10px] ml-auto font-mono">
                              {new Date(msg.createdAt).toLocaleString("pt-BR")}
                            </span>
                          </div>
                          <p className="text-amber-200/70 text-sm whitespace-pre-wrap">{msg.body}</p>
                        </div>
                      );
                    }
                    return (
                      <div key={msg.id} className={`flex gap-3 ${isAdmin ? "flex-row-reverse" : ""}`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${isAdmin ? "bg-gradient-to-br from-indigo-500 to-purple-600 text-white" : "bg-[#1e2d45] text-slate-400"}`}>
                          {msg.authorName.charAt(0).toUpperCase()}
                        </div>
                        <div className={`flex-1 min-w-0 ${isAdmin ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-medium ${isAdmin ? "text-indigo-400" : "text-slate-500"}`}>
                              {isAdmin ? "Suporte" : msg.authorName}
                            </span>
                            <span className="text-slate-700 text-[10px] font-mono">
                              {new Date(msg.createdAt).toLocaleString("pt-BR")}
                            </span>
                          </div>
                          <div className={`rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap max-w-[85%] ${isAdmin ? "bg-indigo-600 text-white" : "bg-[#0f1623] border border-[#1e2d45] text-slate-200"}`}>
                            {msg.body}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply box */}
          {!isClosed ? (
            <div className="flex-shrink-0 px-6 pb-5 pt-3 border-t border-[#1e2d45]">
              <form onSubmit={sendReply} className="space-y-2">
                <textarea
                  rows={3}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={isSuperAdmin ? "Adicionar atualização / responder ao cliente..." : "Escreva uma mensagem para o suporte..."}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(e as any); } }}
                  className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                />
                <div className="flex items-center justify-between">
                  {isSuperAdmin ? (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} className="w-3.5 h-3.5 rounded" />
                      <span className="text-amber-400 text-xs">🔒 Nota interna</span>
                    </label>
                  ) : (
                    <span className="text-slate-600 text-xs">Ctrl+Enter para enviar</span>
                  )}
                  <button
                    type="submit"
                    disabled={sending || !reply.trim()}
                    className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
                  >
                    {sending ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="flex-shrink-0 px-6 pb-5 pt-3 border-t border-[#1e2d45] text-center">
              <p className="text-slate-500 text-sm">
                Chamado encerrado.{" "}
                {!isSuperAdmin && (
                  <button onClick={() => handleStatusChange("OPEN")} className="text-indigo-400 hover:underline">
                    Reabrir
                  </button>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Right sidebar: metadata */}
        <div className="w-[260px] min-w-[260px] flex-shrink-0 overflow-y-auto p-4 space-y-4">
          {/* Stage */}
          {isSuperAdmin && stages.length > 0 && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Etapa</div>
              <div className="space-y-1">
                {stages.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleStageChange(s.name)}
                    disabled={updatingStage || ticketStage === s.name}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors text-left ${
                      ticketStage === s.name
                        ? "bg-white/10 text-white"
                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    {s.name}
                    {ticketStage === s.name && <span className="ml-auto text-[10px] text-slate-500">atual</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Priority */}
          {isSuperAdmin && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Prioridade</div>
              <select
                value={priority}
                onChange={(e) => handlePriorityChange(e.target.value)}
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="LOW">🟢 Baixa</option>
                <option value="MEDIUM">🟡 Média</option>
                <option value="HIGH">🟠 Alta</option>
                <option value="URGENT">🔴 Urgente</option>
              </select>
            </div>
          )}

          {/* Company */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">Empresa</div>
              {isSuperAdmin && !editingCompany && (
                <button
                  onClick={() => { setEditingCompany(true); setCompanySearchInput(""); setCompanyResults([]); }}
                  className="text-slate-600 hover:text-slate-400 text-[10px] transition-colors"
                  title="Mudar empresa"
                >
                  ✏️
                </button>
              )}
            </div>
            {editingCompany ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    type="text"
                    value={companySearchInput}
                    onChange={(e) => {
                      setCompanySearchInput(e.target.value);
                      if (e.target.value.length >= 1) searchTicketCompanies(e.target.value);
                      else setCompanyResults([]);
                    }}
                    placeholder="Buscar empresa..."
                    className="flex-1 bg-[#0a0f1a] border border-[#1e2d45] rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                  {searchingCompany && <span className="text-slate-600 text-[10px]">...</span>}
                </div>
                {companyResults.length > 0 && (
                  <div className="space-y-0.5 max-h-32 overflow-y-auto">
                    {companyResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleChangeCompany(c)}
                        className="w-full text-left px-2 py-1 rounded text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                      >
                        🏢 {c.name}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => { setEditingCompany(false); setCompanySearchInput(""); setCompanyResults([]); }}
                  className="text-slate-600 text-[10px] hover:text-slate-400 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <Link href={`/empresas/${ticket.company.id}`} className="text-white text-sm font-medium hover:text-indigo-300 transition-colors">
                {companyName}
              </Link>
            )}
          </div>

          {/* Category */}
          {ticket.category && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Categoria</div>
              <div className="text-slate-300 text-sm">{ticket.category}</div>
            </div>
          )}

          {/* ClickUp */}
          {isSuperAdmin && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide">✅ ClickUp</div>
                {!editingClickup && clickupTaskId && (
                  <button
                    onClick={() => { setEditingClickup(true); setClickupInput(clickupTaskId); setSyncError(null); }}
                    className="text-slate-600 hover:text-slate-400 text-[10px] transition-colors"
                    title="Editar ID manualmente"
                  >
                    ✏️
                  </button>
                )}
              </div>

              {editingClickup ? (
                <form onSubmit={handleSaveClickup} className="space-y-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={clickupInput}
                    onChange={(e) => setClickupInput(e.target.value)}
                    placeholder="ID ou URL da tarefa"
                    className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <div className="flex gap-1.5">
                    <button type="submit" disabled={savingClickup} className="flex-1 py-1 rounded bg-indigo-600 text-white text-[10px] font-medium hover:bg-indigo-500 disabled:opacity-50">
                      {savingClickup ? "..." : "Salvar"}
                    </button>
                    <button type="button" onClick={() => { setEditingClickup(false); setClickupInput(clickupTaskId); }} className="text-slate-500 text-[10px] hover:text-white px-1">✕</button>
                  </div>
                </form>
              ) : clickupTaskId ? (
                /* Tem task ID — mostra link */
                <div className="space-y-2">
                  <a
                    href={clickupTaskId.startsWith("http") ? clickupTaskId : `https://app.clickup.com/t/${clickupTaskId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#7B68EE]/15 border border-[#7B68EE]/30 text-[#b0a4f8] text-xs font-medium hover:bg-[#7B68EE]/25 transition-colors w-full justify-center"
                  >
                    ↗ Abrir no ClickUp
                  </a>
                  <p className="text-slate-700 text-[10px] font-mono truncate text-center">{clickupTaskId}</p>
                </div>
              ) : (
                /* Sem task — botão de criar */
                <div className="space-y-2">
                  <button
                    onClick={handleSyncClickup}
                    disabled={syncingClickup}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#7B68EE]/15 border border-[#7B68EE]/30 text-[#b0a4f8] text-xs font-medium hover:bg-[#7B68EE]/25 disabled:opacity-50 transition-colors"
                  >
                    {syncingClickup ? "Criando..." : "✅ Criar no ClickUp"}
                  </button>
                  {syncError && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                      <p className="text-red-400 text-[10px] leading-relaxed break-words">{syncError}</p>
                    </div>
                  )}
                  <button
                    onClick={() => { setEditingClickup(true); setClickupInput(""); setSyncError(null); }}
                    className="w-full text-slate-600 text-[10px] hover:text-slate-400 transition-colors text-center"
                  >
                    + Vincular ID existente
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Dates */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3 space-y-2">
            <div>
              <div className="text-[10px] text-slate-600 mb-0.5">Aberto em</div>
              <div className="text-slate-400 text-xs">{new Date(ticket.createdAt).toLocaleString("pt-BR")}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-600 mb-0.5">Última atualização</div>
              <div className="text-slate-400 text-xs">{new Date(ticket.updatedAt).toLocaleString("pt-BR")}</div>
            </div>
          </div>

          {/* Actions */}
          {isSuperAdmin && (
            <div className="space-y-2">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">Ações</div>
              <select
                value={status}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="OPEN">Aberto</option>
                <option value="IN_PROGRESS">Em Andamento</option>
                <option value="RESOLVED">Resolvido</option>
                <option value="CLOSED">Fechado</option>
              </select>
            </div>
          )}
          {!isSuperAdmin && !isClosed && (
            <button
              onClick={() => handleStatusChange("CLOSED")}
              className="w-full py-2 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 text-xs hover:text-white transition-colors"
            >
              Fechar chamado
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
