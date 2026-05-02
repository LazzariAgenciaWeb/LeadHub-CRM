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
  mediaBase64?: string | null;
  mediaType?: string | null;
  source?: string;
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
  type?: "SUPPORT" | "INTERNAL";
  dueDate?: string | null;
  assigneeId?: string | null;
  assignee?: { id: string; name: string } | null;
  setor?: { id: string; name: string } | null;
  clientCompany?: { id: string; name: string; phone?: string | null; email?: string | null } | null;
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
  canManage,
  currentUserName,
  stages,
}: {
  ticket: Ticket;
  isSuperAdmin: boolean;
  // canManage = SUPER_ADMIN ou ADMIN da agência. Habilita todas as ações
  // de gerenciamento do chamado (etapa, prioridade, atendente, prazo, anexos,
  // notas internas, edição). CLIENT (cliente final) só responde mensagens.
  canManage: boolean;
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

  // Excluir / arquivar
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Anexo de imagem na resposta (paste/upload — base64)
  const [attachment, setAttachment] = useState<{ data: string; type: string; name: string } | null>(null);

  // Reabertura quando ticket está fechado/resolvido
  const [reopening, setReopening] = useState(false);

  function pickFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [header, b64] = result.split(",");
      const mime = header.match(/data:(.*);base64/)?.[1] ?? file.type;
      setAttachment({ data: b64, type: mime, name: file.name });
    };
    reader.readAsDataURL(file);
  }

  // Cola imagens com Ctrl+V
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) {
            pickFile(file);
            e.preventDefault();
            break;
          }
        }
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // Banner "sugestão de fechamento" — quando última msg foi nossa há mais de 3 dias
  const stalenessInfo = (() => {
    if (status === "RESOLVED" || status === "CLOSED") return null;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) return null;
    if (lastMsg.authorRole === "CLIENT") return null; // cliente foi o último a falar
    const daysSince = (Date.now() - new Date(lastMsg.createdAt).getTime()) / 86_400_000;
    if (daysSince < 3) return null;
    return { days: Math.floor(daysSince) };
  })();

  async function handleSuggestClose() {
    setUpdatingStage(true);
    await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "RESOLVED" }),
    });
    setStatus("RESOLVED");
    setUpdatingStage(false);
    startTransition(() => router.refresh());
  }

  async function handleReopen() {
    setReopening(true);
    await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    });
    setStatus("IN_PROGRESS");
    setReopening(false);
    startTransition(() => router.refresh());
  }

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
    if (!reply.trim() && !attachment) return;
    setSending(true);
    const payload: any = { messageBody: reply, isInternal };
    if (attachment) {
      payload.mediaBase64 = attachment.data;
      payload.mediaType = attachment.type;
    }
    const res = await fetch(`/api/tickets/${ticket.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const msg = await res.json();
      setMessages((prev) => [...prev, msg]);
      setReply("");
      setAttachment(null);
    }
    setSending(false);
  }

  async function handleDelete() {
    setDeleting(true);
    await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
    router.push("/chamados");
  }

  async function handleArchive() {
    await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CLOSED" }),
    });
    setStatus("CLOSED");
    setConfirmDelete(false);
    startTransition(() => router.refresh());
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
            {canManage && (
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
                            {msg.mediaBase64 && msg.mediaType?.startsWith("image/") && (
                              <img
                                src={`data:${msg.mediaType};base64,${msg.mediaBase64}`}
                                alt="anexo"
                                className="rounded-lg max-h-80 mb-2 cursor-pointer hover:opacity-90 transition"
                                onClick={(e) => {
                                  const w = window.open();
                                  if (w) w.document.write(`<img src="${(e.target as HTMLImageElement).src}" style="max-width:100%">`);
                                }}
                              />
                            )}
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
              {/* Banner de sugestão de fechamento — quando >3 dias parado aguardando cliente */}
              {stalenessInfo && (
                <div className="mb-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 flex items-start gap-2.5">
                  <span className="text-yellow-400 text-base flex-shrink-0">⏳</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-yellow-300 text-xs font-semibold">
                      Aguardando cliente há {stalenessInfo.days} dia{stalenessInfo.days !== 1 ? "s" : ""}
                    </p>
                    <p className="text-slate-400 text-[11px] mt-0.5">
                      O cliente não responde desde a sua última mensagem. Considere fechar — você pode reabrir depois quando o cliente voltar.
                    </p>
                  </div>
                  <button
                    onClick={handleSuggestClose}
                    disabled={updatingStage}
                    className="px-3 py-1 rounded-md bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-200 text-[11px] font-semibold flex-shrink-0 transition-colors disabled:opacity-50"
                  >
                    Fechar chamado
                  </button>
                </div>
              )}

              <form onSubmit={sendReply} className="space-y-2">
                <textarea
                  rows={3}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={canManage ? "Adicionar atualização / responder ao cliente..." : "Escreva uma mensagem para o suporte..."}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(e as any); } }}
                  className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                />

                {/* Preview do anexo */}
                {attachment && (
                  <div className="bg-[#0a0f1a] border border-indigo-500/30 rounded-lg p-2 flex items-center gap-3">
                    <img
                      src={`data:${attachment.type};base64,${attachment.data}`}
                      alt={attachment.name}
                      className="w-12 h-12 object-cover rounded flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-200 text-xs truncate">{attachment.name}</p>
                      <p className="text-slate-600 text-[10px]">{attachment.type}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      className="text-slate-500 hover:text-red-400 text-lg leading-none px-1"
                    >×</button>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    {canManage && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} className="w-3.5 h-3.5 rounded" />
                        <span className="text-amber-400 text-xs">🔒 Nota interna</span>
                      </label>
                    )}
                    <label className="flex items-center gap-1 text-slate-500 text-xs hover:text-indigo-300 cursor-pointer transition-colors">
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
                      📎 Anexar
                    </label>
                    <span className="text-slate-700 text-xs">ou Ctrl+V cola imagem</span>
                  </div>
                  <button
                    type="submit"
                    disabled={sending || (!reply.trim() && !attachment)}
                    className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
                  >
                    {sending ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="flex-shrink-0 px-6 pb-5 pt-3 border-t border-[#1e2d45] text-center">
              <p className="text-slate-500 text-sm mb-2">
                Chamado encerrado.
              </p>
              <button
                onClick={handleReopen}
                disabled={reopening}
                className="px-4 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 text-sm font-medium hover:bg-indigo-600/30 disabled:opacity-50 transition-colors"
              >
                {reopening ? "Reabrindo..." : "↩ Reabrir chamado"}
              </button>
            </div>
          )}
        </div>

        {/* Right sidebar: metadata */}
        <div className="w-[260px] min-w-[260px] flex-shrink-0 overflow-y-auto p-4 space-y-4">
          {/* Stage */}
          {canManage && stages.length > 0 && (
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
          {canManage && (
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
          {/* Cliente do chamado — empresa que está sendo atendida.
              Distinto de "Empresa-agência" abaixo (a dona do ticket). */}
          {ticket.type !== "INTERNAL" && (
            <div className="bg-[#0f1623] border border-blue-500/20 rounded-lg p-3">
              <div className="text-[10px] text-blue-400/80 uppercase tracking-wide mb-1.5 font-semibold">
                🏢 Cliente do chamado
              </div>
              {ticket.clientCompany ? (
                <div>
                  <Link
                    href={`/empresas/${ticket.clientCompany.id}`}
                    className="text-white text-sm font-semibold hover:text-blue-300 transition-colors block"
                  >
                    {ticket.clientCompany.name}
                  </Link>
                  {ticket.clientCompany.phone && (
                    <p className="text-slate-500 text-[11px] mt-0.5">📞 {ticket.clientCompany.phone}</p>
                  )}
                  {ticket.clientCompany.email && (
                    <p className="text-slate-500 text-[11px]">✉️ {ticket.clientCompany.email}</p>
                  )}
                </div>
              ) : (
                <div className="text-slate-500 text-xs italic">
                  Sem cliente vinculado.
                  <br />
                  <span className="text-slate-600 text-[10px]">Edite no kanban ou via API.</span>
                </div>
              )}
            </div>
          )}
          {ticket.type === "INTERNAL" && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
              <div className="text-[10px] text-emerald-400/80 uppercase tracking-wide mb-1 font-semibold">
                ✅ Tarefa interna
              </div>
              <p className="text-slate-400 text-xs">Atendimento interno (sem cliente).</p>
            </div>
          )}

          {/* Prazo de encerramento */}
          {ticket.dueDate && (() => {
            const due = new Date(ticket.dueDate);
            const ms = due.getTime() - Date.now();
            const days = ms / 86_400_000;
            const overdue = days < 0;
            const today = days >= 0 && days < 1;
            const color = overdue ? "border-red-500/40 bg-red-500/10"
              : today ? "border-orange-500/40 bg-orange-500/10"
              : days < 3 ? "border-amber-500/30 bg-amber-500/5"
              : "border-[#1e2d45] bg-[#0f1623]";
            const textColor = overdue ? "text-red-300"
              : today ? "text-orange-300"
              : days < 3 ? "text-amber-300"
              : "text-slate-300";
            return (
              <div className={`border rounded-lg p-3 ${color}`}>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">
                  📅 Prazo de Encerramento
                </div>
                <p className={`text-sm font-semibold ${textColor}`}>
                  {due.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
                {overdue && <p className="text-red-400 text-[10px] mt-0.5 font-semibold animate-pulse">Atrasado</p>}
                {today && <p className="text-orange-400 text-[10px] mt-0.5 font-semibold">Hoje</p>}
                {!overdue && !today && days < 3 && (
                  <p className="text-amber-400 text-[10px] mt-0.5">Em {Math.ceil(days)} dia{Math.ceil(days) !== 1 ? "s" : ""}</p>
                )}
              </div>
            );
          })()}

          {/* Atendente responsável */}
          {ticket.assignee && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">
                👤 Atendente
              </div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center text-[10px] font-bold text-indigo-300">
                  {ticket.assignee.name.charAt(0).toUpperCase()}
                </span>
                <span className="text-slate-200 text-sm">{ticket.assignee.name}</span>
              </div>
            </div>
          )}

          {/* Setor responsável */}
          {ticket.setor && (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">
                🏷️ Setor
              </div>
              <span className="inline-block text-[11px] font-semibold text-violet-300 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded">
                {ticket.setor.name}
              </span>
            </div>
          )}

          {/* Empresa-agência — só super admin precisa ver/mudar */}
          {isSuperAdmin && (
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">Empresa-agência</div>
              {!editingCompany && (
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
          )}

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

          {/* Status muda automaticamente conforme a Etapa do pipeline (acima).
              Mantemos só o botão "Fechar chamado" pra clientes finais que não
              têm acesso ao kanban de etapas. */}
          {!canManage && !isClosed && (
            <button
              onClick={() => handleStatusChange("CLOSED")}
              className="w-full py-2 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 text-xs hover:text-white transition-colors"
            >
              Fechar chamado
            </button>
          )}

          {/* Excluir / Arquivar — só SUPER_ADMIN */}
          {isSuperAdmin && (
            <div className="pt-2 border-t border-[#1e2d45] space-y-2">
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full py-1.5 rounded-lg border border-red-500/20 text-red-400/70 text-xs hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/40 transition-colors"
                >
                  🗑️ Excluir chamado
                </button>
              ) : (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-2">
                  <p className="text-red-400 text-xs font-semibold">Tem certeza?</p>
                  <p className="text-slate-500 text-[10px]">Esta ação não pode ser desfeita. Todas as mensagens serão removidas.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
                    >
                      {deleting ? "Excluindo..." : "Sim, excluir"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 py-1.5 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 text-xs hover:text-white transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                  <button
                    onClick={handleArchive}
                    className="w-full py-1.5 rounded-lg border border-slate-600 text-slate-500 text-xs hover:text-slate-300 hover:border-slate-500 transition-colors"
                  >
                    📦 Só fechar (manter histórico)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
