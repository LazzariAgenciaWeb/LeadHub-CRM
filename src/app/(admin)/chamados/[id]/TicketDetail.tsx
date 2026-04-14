"use client";

import { useState, useRef, useEffect } from "react";
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

interface Ticket {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string | null;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string };
  messages: TicketMessage[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  OPEN: { label: "Aberto", color: "text-indigo-400 bg-indigo-500/15", dot: "bg-indigo-400" },
  IN_PROGRESS: { label: "Em Andamento", color: "text-blue-400 bg-blue-500/15", dot: "bg-blue-400 animate-pulse" },
  RESOLVED: { label: "Resolvido", color: "text-green-400 bg-green-500/15", dot: "bg-green-400" },
  CLOSED: { label: "Fechado", color: "text-slate-500 bg-slate-500/10", dot: "bg-slate-500" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  LOW: { label: "Baixa", color: "text-slate-400", icon: "🟢" },
  MEDIUM: { label: "Média", color: "text-yellow-400", icon: "🟡" },
  HIGH: { label: "Alta", color: "text-orange-400", icon: "🟠" },
  URGENT: { label: "Urgente", color: "text-red-400", icon: "🔴" },
};

export default function TicketDetail({
  ticket,
  isSuperAdmin,
  currentUserName,
}: {
  ticket: Ticket;
  isSuperAdmin: boolean;
  currentUserName: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<TicketMessage[]>(ticket.messages);
  const [status, setStatus] = useState(ticket.status);
  const [reply, setReply] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      // Se admin respondeu, atualiza status local
      if (isSuperAdmin && status === "OPEN") setStatus("IN_PROGRESS");
    }
    setSending(false);
  }

  async function changeStatus(newStatus: string) {
    setUpdatingStatus(true);
    await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setStatus(newStatus);
    setUpdatingStatus(false);
  }

  const sc = STATUS_CONFIG[status] ?? STATUS_CONFIG.OPEN;
  const pc = PRIORITY_CONFIG[ticket.priority] ?? PRIORITY_CONFIG.MEDIUM;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-[#1e2d45]">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link href="/chamados" className="text-slate-500 hover:text-white text-sm transition-colors">
                ← Chamados
              </Link>
              <span className="text-slate-700">/</span>
              <span className="text-slate-500 text-sm truncate">{ticket.title}</span>
            </div>
            <h1 className="text-white font-bold text-lg">{ticket.title}</h1>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${sc.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                {sc.label}
              </span>
              <span className={`text-[11px] font-semibold ${pc.color}`}>
                {pc.icon} {pc.label}
              </span>
              {ticket.category && (
                <span className="text-[11px] text-slate-500 bg-white/5 px-2 py-0.5 rounded">
                  {ticket.category}
                </span>
              )}
              <span className="text-slate-500 text-[11px]">{ticket.company.name}</span>
              <span className="text-slate-600 text-[11px]">
                Aberto em {new Date(ticket.createdAt).toLocaleString("pt-BR")}
              </span>
            </div>
          </div>

          {/* Status actions */}
          <div className="flex-shrink-0 flex items-center gap-2">
            {ticket.phone && (
              <Link
                href={`/whatsapp?abrir=${encodeURIComponent(ticket.phone)}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-medium hover:bg-green-500/20 transition-colors"
              >
                💬 Responder no WhatsApp
              </Link>
            )}
            {isSuperAdmin && (
              <select
                value={status}
                disabled={updatingStatus}
                onChange={(e) => changeStatus(e.target.value)}
                className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="OPEN">Aberto</option>
                <option value="IN_PROGRESS">Em Andamento</option>
                <option value="RESOLVED">Resolvido</option>
                <option value="CLOSED">Fechado</option>
              </select>
            )}
            {!isSuperAdmin && status !== "CLOSED" && (
              <button
                onClick={() => changeStatus("CLOSED")}
                disabled={updatingStatus}
                className="px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 text-xs hover:text-white transition-colors"
              >
                Fechar chamado
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages thread */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg, idx) => {
          const isAdmin = msg.authorRole === "SUPER_ADMIN";
          const isMe = msg.authorName === currentUserName;

          if (msg.isInternal) {
            return (
              <div key={msg.id} className="flex justify-center">
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3 max-w-2xl w-full">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-amber-400 text-[10px] font-bold uppercase tracking-wide">🔒 Nota interna</span>
                    <span className="text-slate-600 text-[10px]">{msg.authorName}</span>
                  </div>
                  <p className="text-amber-200/70 text-sm whitespace-pre-wrap">{msg.body}</p>
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex gap-3 ${isAdmin ? "flex-row-reverse" : ""}`}>
              {/* Avatar */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${isAdmin ? "bg-gradient-to-br from-indigo-500 to-purple-600 text-white" : "bg-[#1e2d45] text-slate-400"}`}>
                {msg.authorName.charAt(0).toUpperCase()}
              </div>

              {/* Bubble */}
              <div className={`max-w-[70%] ${isAdmin ? "items-end" : "items-start"} flex flex-col gap-1`}>
                <div className="flex items-center gap-2">
                  {!isAdmin && <span className="text-slate-500 text-[11px] font-medium">{msg.authorName}</span>}
                  {isAdmin && <span className="text-indigo-400 text-[11px] font-medium">Suporte LeadHub</span>}
                  {idx === 0 && <span className="text-[10px] text-slate-600 bg-white/5 px-1.5 py-0.5 rounded">Descrição inicial</span>}
                </div>
                <div className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${isAdmin ? "bg-indigo-600 text-white rounded-tr-none" : "bg-[#0f1623] border border-[#1e2d45] text-slate-200 rounded-tl-none"}`}>
                  {msg.body}
                </div>
                <span className="text-[10px] text-slate-600">
                  {new Date(msg.createdAt).toLocaleString("pt-BR")}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply box */}
      {status !== "CLOSED" ? (
        <div className="flex-shrink-0 px-6 pb-6 pt-3 border-t border-[#1e2d45]">
          <form onSubmit={sendReply} className="space-y-3">
            <textarea
              rows={3}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={isSuperAdmin ? "Responder ao cliente..." : "Escreva uma mensagem para o suporte..."}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmitEnter(e);
              }}
              className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
            />
            <div className="flex items-center justify-between">
              {isSuperAdmin ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                    className="w-3.5 h-3.5 rounded"
                  />
                  <span className="text-amber-400 text-xs font-medium">🔒 Nota interna (não visível ao cliente)</span>
                </label>
              ) : (
                <span className="text-slate-600 text-xs">Ctrl+Enter para enviar</span>
              )}
              <button
                type="submit"
                disabled={sending || !reply.trim()}
                className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
              >
                {sending ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="flex-shrink-0 px-6 pb-6 pt-3 border-t border-[#1e2d45]">
          <div className="text-center py-4 text-slate-500 text-sm">
            Este chamado está fechado.{" "}
            {!isSuperAdmin && (
              <button
                onClick={() => changeStatus("OPEN")}
                className="text-indigo-400 hover:underline"
              >
                Reabrir
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function handleSubmitEnter(e: React.KeyboardEvent) {
  const form = (e.target as HTMLElement).closest("form");
  if (form) form.requestSubmit();
}
