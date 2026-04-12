"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Instance {
  id: string;
  instanceName: string;
  status: "CONNECTED" | "DISCONNECTED" | "CONNECTING";
  company: { id: string; name: string } | null;
}

interface Conversation {
  phone: string;
  companyId: string;
  totalMessages: number;
  inboundCount: number;
  outboundCount: number;
  lead: {
    id: string; name: string | null; status: string; notes: string | null;
    pipeline: string | null; pipelineStage: string | null;
    attendanceStatus: string | null; expectedReturnAt: string | null;
  } | null;
  lastMsg: {
    body: string;
    direction: string;
    receivedAt: string;
    instance: { instanceName: string } | null;
  } | null;
}

interface WaMessage {
  id: string;
  body: string;
  direction: string;
  receivedAt: string;
  instance: { instanceName: string } | null;
  campaign: { id: string; name: string } | null;
}

const LEAD_STATUS_COLOR: Record<string, string> = {
  NEW: "text-indigo-400 bg-indigo-500/15",
  CONTACTED: "text-blue-400 bg-blue-500/15",
  PROPOSAL: "text-yellow-400 bg-yellow-500/15",
  CLOSED: "text-green-400 bg-green-500/15",
  LOST: "text-red-400 bg-red-500/10",
};

const LEAD_STATUS_LABEL: Record<string, string> = {
  NEW: "Novo", CONTACTED: "Em Contato", PROPOSAL: "Proposta", CLOSED: "Fechado", LOST: "Perdido",
};

const INSTANCE_STATUS: Record<string, { dot: string; label: string }> = {
  CONNECTED: { dot: "bg-green-400", label: "Conectado" },
  DISCONNECTED: { dot: "bg-red-400", label: "Desconectado" },
  CONNECTING: { dot: "bg-yellow-400 animate-pulse", label: "Conectando" },
};

const INSTANCE_BADGE_COLORS = [
  "bg-violet-500/20 text-violet-300 border-violet-500/20",
  "bg-cyan-500/20 text-cyan-300 border-cyan-500/20",
  "bg-emerald-500/20 text-emerald-300 border-emerald-500/20",
  "bg-orange-500/20 text-orange-300 border-orange-500/20",
  "bg-pink-500/20 text-pink-300 border-pink-500/20",
  "bg-yellow-500/20 text-yellow-300 border-yellow-500/20",
];

function getInstanceBadgeColor(instanceName: string) {
  let hash = 0;
  for (let i = 0; i < instanceName.length; i++) hash = instanceName.charCodeAt(i) + ((hash << 5) - hash);
  return INSTANCE_BADGE_COLORS[Math.abs(hash) % INSTANCE_BADGE_COLORS.length];
}

const PIPELINE_BADGE: Record<string, string> = {
  PROSPECCAO:    "text-violet-400 bg-violet-500/15",
  LEADS:         "text-blue-400 bg-blue-500/15",
  OPORTUNIDADES: "text-amber-400 bg-amber-500/15",
};
const PIPELINE_LABEL: Record<string, string> = {
  PROSPECCAO:    "🔎 Prospecção",
  LEADS:         "💬 Lead",
  OPORTUNIDADES: "💰 Oportunidade",
};
const ATTENDANCE: Record<string, { label: string; icon: string; ring: string; btn: string }> = {
  WAITING:     { label: "Aguardando",      icon: "⏳", ring: "border-yellow-500/40 bg-yellow-500/5",  btn: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
  IN_PROGRESS: { label: "Em Atendimento",  icon: "💬", ring: "border-blue-500/40 bg-blue-500/5",     btn: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  RESOLVED:    { label: "Resolvido",       icon: "✅", ring: "border-green-500/40 bg-green-500/5",   btn: "bg-green-500/20 text-green-300 border-green-500/30" },
  SCHEDULED:   { label: "Agendado",        icon: "📅", ring: "border-purple-500/40 bg-purple-500/5", btn: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
};

export default function WhatsappManager({
  instances,
  isSuperAdmin,
  defaultCompanyId,
  conversations,
}: {
  instances: Instance[];
  isSuperAdmin: boolean;
  defaultCompanyId: string;
  conversations: Conversation[];
}) {
  const router = useRouter();

  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [convMessages, setConvMessages] = useState<WaMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  // Convert to lead
  const [converting, setConverting] = useState(false);
  const [convertForm, setConvertForm] = useState({ name: "", status: "NEW", campaignId: "" });
  const [showConvertForm, setShowConvertForm] = useState(false);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);

  // Convert to ticket
  const [showTicketForm, setShowTicketForm] = useState(false);
  const [ticketForm, setTicketForm] = useState({ title: "", description: "" });
  const [convertingTicket, setConvertingTicket] = useState(false);
  const [ticketCreated, setTicketCreated] = useState(false);

  // Reply
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  // Name editor
  const [editingName, setEditingName] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Notes / comments
  const [leadNotes, setLeadNotes] = useState<string>("");
  const [showNotesPanel, setShowNotesPanel] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [instanceFilter, setInstanceFilter] = useState("");

  // Atendimento
  const [attendanceStatus, setAttendanceStatus] = useState<string | null>(null);
  const [expectedReturn, setExpectedReturn] = useState<string>("");
  const [savingAttendance, setSavingAttendance] = useState(false);

  // Tick a cada 30s para atualizar as bordas de urgência sem aguardar o router.refresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);

  // Vincular prospect
  const [showLinkProspect, setShowLinkProspect] = useState(false);
  const [prospectSearch, setProspectSearch] = useState("");
  const [prospectResults, setProspectResults] = useState<{ id: string; name: string | null; phone: string; pipelineStage: string | null }[]>([]);
  const [searchingProspect, setSearchingProspect] = useState(false);
  const [linkingProspect, setLinkingProspect] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedConvRef = useRef<Conversation | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convMessages]);

  useEffect(() => {
    selectedConvRef.current = selectedConv;
  }, [selectedConv]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      router.refresh();
      const conv = selectedConvRef.current;
      if (!conv) return;
      const params = new URLSearchParams({ phone: conv.phone });
      if (conv.companyId) params.set("companyId", conv.companyId);
      const res = await fetch(`/api/whatsapp/messages?${params}`);
      if (res.ok) setConvMessages(await res.json());
    }, 5000);
    return () => clearInterval(interval);
  }, [router]);

  // Unique instances that appear in conversations (for filter)
  const conversationInstances = useMemo(() => {
    const names = conversations
      .map((c) => c.lastMsg?.instance?.instanceName)
      .filter(Boolean) as string[];
    return [...new Set(names)];
  }, [conversations]);

  // Filtered conversations
  const filteredConvs = useMemo(() => {
    return conversations.filter((c) => {
      if (search) {
        const q = search.toLowerCase();
        if (!c.phone.includes(q) && !c.lead?.name?.toLowerCase().includes(q)) return false;
      }
      if (instanceFilter && c.lastMsg?.instance?.instanceName !== instanceFilter) return false;
      return true;
    });
  }, [conversations, search, instanceFilter]);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedConv?.lead || !leadName.trim()) return;
    setSavingName(true);
    await fetch(`/api/leads/${selectedConv.lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: leadName.trim() }),
    });
    setSavingName(false);
    setEditingName(false);
    setSelectedConv({ ...selectedConv, lead: { ...selectedConv.lead, name: leadName.trim() } });
    router.refresh();
  }

  async function loadConversation(conv: Conversation) {
    setSelectedConv(conv);
    setShowConvertForm(false);
    setShowTicketForm(false);
    setTicketCreated(false);
    setShowLinkProspect(false);
    setConvMessages([]);
    setReplyText("");
    setReplyError(null);
    setEditingName(false);
    setLeadName(conv.lead?.name ?? "");
    setLeadNotes(conv.lead?.notes ?? "");
    setShowNotesPanel(false);
    setNewNote("");
    setAttendanceStatus(conv.lead?.attendanceStatus ?? null);
    setExpectedReturn(conv.lead?.expectedReturnAt ? new Date(conv.lead.expectedReturnAt).toISOString().slice(0, 16) : "");
    setLoadingMsgs(true);

    const params = new URLSearchParams({ phone: conv.phone });
    if (conv.companyId) params.set("companyId", conv.companyId);

    const [msgsRes, campaignsRes] = await Promise.all([
      fetch(`/api/whatsapp/messages?${params}`),
      fetch(`/api/campaigns?companyId=${conv.companyId}`),
    ]);

    setConvMessages(await msgsRes.json());
    if (campaignsRes.ok) {
      const data = await campaignsRes.json();
      setCampaigns(data.campaigns ?? data);
    }
    setLoadingMsgs(false);
  }

  async function handleConvertLead(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedConv) return;
    setConverting(true);
    const res = await fetch("/api/whatsapp/convert-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: selectedConv.phone,
        companyId: selectedConv.companyId,
        name: convertForm.name || null,
        status: convertForm.status,
        campaignId: convertForm.campaignId || null,
      }),
    });
    const data = await res.json();
    setConverting(false);
    setShowConvertForm(false);
    if (data.lead) {
      setSelectedConv({ ...selectedConv, lead: { ...data.lead, notes: null } });
      router.refresh();
    }
  }

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedConv) return;
    setConvertingTicket(true);
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: ticketForm.title || `Suporte — ${selectedConv.lead?.name ?? selectedConv.phone}`,
        description: ticketForm.description || `Contato via WhatsApp: ${selectedConv.phone}`,
        companyId: selectedConv.companyId,
        priority: "MEDIUM",
      }),
    });
    setConvertingTicket(false);
    if (res.ok) {
      setTicketCreated(true);
      setShowTicketForm(false);
      router.refresh();
    }
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedConv?.lead || !newNote.trim()) return;
    setSavingNote(true);
    const now = new Date();
    const dateStr =
      now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) +
      " " +
      now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const entry = `[${dateStr}] ${newNote.trim()}`;
    const combined = leadNotes ? `${entry}\n\n${leadNotes}` : entry;

    await fetch(`/api/leads/${selectedConv.lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: combined }),
    });

    setLeadNotes(combined);
    setNewNote("");
    setSavingNote(false);
    setShowNotesPanel(true); // keep open to see the new note
    router.refresh();
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedConv || !replyText.trim()) return;

    const lastInstanceName =
      convMessages.length > 0 ? convMessages[convMessages.length - 1].instance?.instanceName : null;

    const inst =
      (lastInstanceName ? instances.find((i) => i.instanceName === lastInstanceName) : null) ??
      instances.find((i) => i.status === "CONNECTED" && i.company?.id === selectedConv.companyId) ??
      instances.find((i) => i.company?.id === selectedConv.companyId);

    if (!inst) {
      setReplyError("Nenhuma instância conectada. Configure em Configurações → Instâncias WhatsApp.");
      return;
    }

    setSendingReply(true);
    setReplyError(null);

    const res = await fetch(`/api/whatsapp/${inst.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: selectedConv.phone, text: replyText.trim() }),
    });

    setSendingReply(false);

    if (!res.ok) {
      const data = await res.json();
      setReplyError(data.error ?? "Erro ao enviar mensagem");
    } else {
      setConvMessages((prev) => [
        ...prev,
        {
          id: `tmp-${Date.now()}`,
          body: replyText.trim(),
          direction: "OUTBOUND",
          receivedAt: new Date().toISOString(),
          instance: { instanceName: inst.instanceName },
          campaign: null,
        },
      ]);
      setReplyText("");
    }
  }

  async function searchProspects(q: string) {
    if (!q.trim() || !selectedConv) return;
    setSearchingProspect(true);
    const params = new URLSearchParams({
      pipeline: "PROSPECCAO",
      search: q.trim(),
      companyId: selectedConv.companyId,
      limit: "8",
    });
    const res = await fetch(`/api/leads?${params}`);
    if (res.ok) {
      const data = await res.json();
      setProspectResults(data.leads ?? []);
    }
    setSearchingProspect(false);
  }

  async function handleLinkProspect(prospectId: string) {
    if (!selectedConv) return;
    setLinkingProspect(true);
    // Atualiza o prospect: adiciona o telefone da conversa e vincula as mensagens
    await fetch(`/api/leads/${prospectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: selectedConv.phone }),
    });
    // Vincula as mensagens desse telefone ao prospect
    await fetch("/api/whatsapp/link-prospect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: selectedConv.phone,
        companyId: selectedConv.companyId,
        leadId: prospectId,
      }),
    });
    setLinkingProspect(false);
    setShowLinkProspect(false);
    setProspectSearch("");
    setProspectResults([]);
    router.refresh();
  }

  async function handleSetAttendance(status: string) {
    if (!selectedConv?.lead) return;
    setSavingAttendance(true);
    setAttendanceStatus(status);
    const body: any = { attendanceStatus: status };
    if (status === "SCHEDULED" && expectedReturn) {
      body.expectedReturnAt = new Date(expectedReturn).toISOString();
    } else if (status !== "SCHEDULED") {
      body.expectedReturnAt = null;
    }
    await fetch(`/api/leads/${selectedConv.lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSavingAttendance(false);
    router.refresh();
  }

  function formatTime(dt: string) {
    const d = new Date(dt);
    const now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("pt-BR");
  }

  // Borda de urgência baseada em tempo sem resposta (só quando última msg é INBOUND)
  function getUrgencyBorder(conv: Conversation): string {
    if (conv.lastMsg?.direction !== "INBOUND") return "";
    const mins = Math.floor((Date.now() - new Date(conv.lastMsg.receivedAt).getTime()) / 60_000);
    if (mins >= 20) return "border-l-2 border-l-red-500";
    if (mins >= 5)  return "border-l-2 border-l-yellow-500";
    return "border-l-2 border-l-green-500";
  }

  // Parse notes into individual entries for display
  const parsedNotes = useMemo(() => {
    if (!leadNotes) return [];
    return leadNotes.split(/\n\n+/).map((entry) => {
      const match = entry.match(/^\[(.+?)\]\s*([\s\S]*)$/);
      if (match) return { date: match[1], text: match[2].trim() };
      return { date: null, text: entry.trim() };
    }).filter((n) => n.text);
  }, [leadNotes]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-[#1e2d45]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold text-xl">🗨️ Mensagens</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              {conversations.length} conversa{conversations.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {instances.slice(0, 4).map((inst) => {
                const s = INSTANCE_STATUS[inst.status] ?? INSTANCE_STATUS.DISCONNECTED;
                return (
                  <div
                    key={inst.id}
                    title={`${inst.instanceName} — ${s.label}`}
                    className="flex items-center gap-1.5 bg-[#0f1623] border border-[#1e2d45] rounded-full px-2.5 py-1"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
                    <span className="text-slate-400 text-[11px] max-w-[80px] truncate">{inst.instanceName}</span>
                  </div>
                );
              })}
              {instances.length > 4 && (
                <span className="text-slate-600 text-[11px]">+{instances.length - 4}</span>
              )}
            </div>
            <Link
              href="/configuracoes?secao=instancias"
              className="px-3 py-1.5 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 hover:text-white text-xs transition-colors"
            >
              ⚙️ Instâncias
            </Link>
          </div>
        </div>
      </div>

      {instances.length === 0 && (
        <div className="mx-6 mt-4 flex-shrink-0 bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <div className="flex-1">
            <div className="text-yellow-400 font-semibold text-sm">Nenhuma instância configurada</div>
            <div className="text-slate-500 text-xs mt-0.5">Configure um número WhatsApp para começar a receber mensagens.</div>
          </div>
          <Link href="/configuracoes?secao=instancias" className="px-3 py-1.5 rounded-lg bg-yellow-500/15 text-yellow-400 text-xs font-medium hover:bg-yellow-500/25 transition-colors flex-shrink-0">
            Configurar →
          </Link>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Conversation list */}
        <div className="w-[300px] min-w-[300px] border-r border-[#1e2d45] flex flex-col overflow-hidden">

          {/* Filtro por instância */}
          {conversationInstances.length > 1 && (
            <div className="px-3 pt-3 pb-2 flex-shrink-0 flex flex-wrap gap-1.5">
              <button
                onClick={() => setInstanceFilter("")}
                className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                  instanceFilter === ""
                    ? "bg-indigo-600 text-white"
                    : "bg-[#0f1623] border border-[#1e2d45] text-slate-400 hover:text-white"
                }`}
              >
                Todas
              </button>
              {conversationInstances.map((name) => (
                <button
                  key={name}
                  onClick={() => setInstanceFilter(instanceFilter === name ? "" : name)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${
                    instanceFilter === name
                      ? getInstanceBadgeColor(name) + " border-current"
                      : "bg-[#0f1623] border-[#1e2d45] text-slate-400 hover:text-white"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {/* Search */}
          <div className={`px-3 pb-3 flex-shrink-0 ${conversationInstances.length > 1 ? "" : "pt-3"}`}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {filteredConvs.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6 text-center">
              <div>
                <div className="text-3xl mb-2">📭</div>
                <div className="text-slate-500 text-sm">
                  {conversations.length === 0 ? "Nenhuma mensagem recebida ainda." : "Nenhum resultado."}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto divide-y divide-[#1e2d45]/50">
              {filteredConvs.map((conv) => {
                const instanceName = conv.lastMsg?.instance?.instanceName;
                const isSelected = selectedConv?.phone === conv.phone;
                return (
                  <button
                    key={conv.phone}
                    onClick={() => loadConversation(conv)}
                    className={`w-full text-left px-4 py-3 hover:bg-white/[0.03] transition-colors ${
                      isSelected
                        ? "bg-indigo-500/10 border-l-2 border-l-indigo-500"
                        : getUrgencyBorder(conv)
                    }`}
                  >
                    {/* Linha 1: avatar + nome + horário */}
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Avatar com dot de não lido */}
                        <div className="relative w-8 h-8 flex-shrink-0">
                          <div className="w-8 h-8 rounded-full bg-[#1e2d45] flex items-center justify-center text-xs font-bold text-slate-400">
                            {conv.phone.slice(-2)}
                          </div>
                          {conv.lastMsg?.direction === "INBOUND" && (
                            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-[#0c1220] animate-pulse" title="Aguardando resposta" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-white text-[13px] font-semibold truncate">
                            {conv.lead?.name ?? conv.phone}
                          </div>
                          {conv.lead?.name && (
                            <div className="text-slate-600 text-[10px]">{conv.phone}</div>
                          )}
                        </div>
                      </div>
                      <span className="text-slate-600 text-[10px] flex-shrink-0 ml-2">
                        {conv.lastMsg ? formatTime(conv.lastMsg.receivedAt) : ""}
                      </span>
                    </div>

                    {/* Linha 2: prévia da mensagem */}
                    {conv.lastMsg && (
                      <div className="text-slate-500 text-[11px] truncate pl-10">
                        {conv.lastMsg.direction === "OUTBOUND" ? "→ " : ""}{conv.lastMsg.body}
                      </div>
                    )}

                    {/* Linha 3: pipeline badge + instância */}
                    <div className="flex items-center gap-2 mt-1.5 pl-10 flex-wrap">
                      {conv.lead?.pipeline ? (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PIPELINE_BADGE[conv.lead.pipeline] ?? "text-slate-400 bg-white/5"}`}>
                          {PIPELINE_LABEL[conv.lead.pipeline] ?? conv.lead.pipeline}
                          {conv.lead.pipelineStage ? ` · ${conv.lead.pipelineStage}` : ""}
                        </span>
                      ) : conv.lead ? (
                        <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded-full">🎯 Lead</span>
                      ) : (
                        <span className="text-[10px] text-slate-600 bg-white/5 px-1.5 py-0.5 rounded-full">Sem tipo</span>
                      )}
                      {/* Badge de atendimento — sempre mostra se há lead ou msg inbound */}
                      {(() => {
                        const status = conv.lead?.attendanceStatus
                          ?? (conv.lastMsg?.direction === "INBOUND" ? "WAITING" : null);
                        if (!status) return null;
                        const a = ATTENDANCE[status];
                        const color =
                          status === "WAITING"     ? "text-yellow-400 bg-yellow-500/15 border border-yellow-500/20" :
                          status === "IN_PROGRESS" ? "text-blue-400 bg-blue-500/15 border border-blue-500/20" :
                          status === "RESOLVED"    ? "text-green-400 bg-green-500/15 border border-green-500/20" :
                                                    "text-purple-400 bg-purple-500/15 border border-purple-500/20";
                        return (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${color}`}>
                            {a?.icon} {a?.label}
                          </span>
                        );
                      })()}
                      {instanceName && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${getInstanceBadgeColor(instanceName)}`}>
                          {instanceName}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Conversation detail */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedConv ? (
            <div className="flex-1 flex items-center justify-center text-center p-8">
              <div>
                <div className="text-5xl mb-4">💬</div>
                <div className="text-white font-semibold mb-2">Selecione uma conversa</div>
                <div className="text-slate-500 text-sm">Clique em um contato à esquerda para ver as mensagens.</div>
              </div>
            </div>
          ) : (
            <>
              {/* Conv header */}
              <div className="px-5 py-3.5 border-b border-[#1e2d45] flex items-center justify-between flex-shrink-0 gap-3">
                {/* Nome / edição */}
                <div className="flex items-center gap-3 min-w-0">
                  {editingName ? (
                    <form onSubmit={handleSaveName} className="flex items-center gap-2">
                      <input
                        autoFocus
                        type="text"
                        value={leadName}
                        onChange={(e) => setLeadName(e.target.value)}
                        placeholder="Nome do lead..."
                        className="bg-[#0f1623] border border-indigo-500 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none"
                      />
                      <button type="submit" disabled={savingName} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-50">
                        {savingName ? "..." : "Salvar"}
                      </button>
                      <button type="button" onClick={() => setEditingName(false)} className="text-slate-500 text-xs hover:text-white">
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold truncate">
                          {selectedConv.lead?.name ?? selectedConv.phone}
                        </span>
                        {selectedConv.lead && (
                          <button
                            onClick={() => { setLeadName(selectedConv.lead?.name ?? ""); setEditingName(true); }}
                            className="text-slate-600 hover:text-slate-400 text-xs flex-shrink-0"
                            title="Editar nome"
                          >
                            ✏️
                          </button>
                        )}
                      </div>
                      {selectedConv.lead?.name && (
                        <div className="text-slate-500 text-xs">{selectedConv.phone}</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Ações à direita */}
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                  {selectedConv.lead ? (
                    <>
                      {selectedConv.lead.pipeline ? (
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${PIPELINE_BADGE[selectedConv.lead.pipeline] ?? "text-slate-400 bg-white/5"}`}>
                          {PIPELINE_LABEL[selectedConv.lead.pipeline] ?? selectedConv.lead.pipeline}
                          {selectedConv.lead.pipelineStage ? ` · ${selectedConv.lead.pipelineStage}` : ""}
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full text-slate-400 bg-white/5">
                          🎯 Lead
                        </span>
                      )}
                      <Link href="/crm/leads" className="text-indigo-400 text-xs hover:underline">
                        Ver CRM →
                      </Link>
                    </>
                  ) : (
                    <>
                      {/* Vincular a prospect existente */}
                      <button
                        onClick={() => { setShowLinkProspect(!showLinkProspect); setShowConvertForm(false); setShowTicketForm(false); setProspectSearch(""); setProspectResults([]); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          showLinkProspect
                            ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                            : "bg-[#0f1623] border border-[#1e2d45] text-slate-300 hover:text-white hover:border-violet-500/50"
                        }`}
                      >
                        🔎 Vincular Prospect
                      </button>
                      {/* Botão criar lead */}
                      <button
                        onClick={() => { setShowConvertForm(!showConvertForm); setShowTicketForm(false); setShowLinkProspect(false); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          showConvertForm
                            ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                            : "bg-indigo-600 text-white hover:bg-indigo-500"
                        }`}
                      >
                        🎯 Criar Lead
                      </button>
                      {/* Botão abrir chamado */}
                      <button
                        onClick={() => { setShowTicketForm(!showTicketForm); setShowConvertForm(false); setShowLinkProspect(false); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          showTicketForm
                            ? "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                            : "bg-[#0f1623] border border-[#1e2d45] text-slate-300 hover:text-white hover:border-orange-500/50"
                        }`}
                      >
                        🎫 Abrir Chamado
                      </button>
                    </>
                  )}

                  {/* Chamado mesmo tendo lead */}
                  {selectedConv.lead && (
                    <button
                      onClick={() => setShowTicketForm(!showTicketForm)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        showTicketForm
                          ? "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                          : "bg-[#0f1623] border border-[#1e2d45] text-slate-400 hover:text-white hover:border-orange-500/50"
                      }`}
                    >
                      🎫 Chamado
                    </button>
                  )}

                  {ticketCreated && (
                    <span className="text-green-400 text-xs">✓ Chamado criado!</span>
                  )}
                </div>
              </div>

              {/* Painel de Atendimento */}
              {selectedConv.lead && (
                <div className={`px-5 py-3 border-b border-[#1e2d45] flex-shrink-0 ${ATTENDANCE[attendanceStatus ?? ""]?.ring ?? "bg-[#0a0f1a]"}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide flex-shrink-0">Atendimento:</span>
                    {(["WAITING", "IN_PROGRESS", "RESOLVED", "SCHEDULED"] as const).map((s) => {
                      const a = ATTENDANCE[s];
                      const isActive = attendanceStatus === s;
                      return (
                        <button
                          key={s}
                          onClick={() => handleSetAttendance(s)}
                          disabled={savingAttendance}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all disabled:opacity-50 ${
                            isActive ? a.btn + " scale-105 shadow-sm" : "border-[#1e2d45] text-slate-500 hover:text-slate-300 hover:border-slate-600"
                          }`}
                        >
                          {a.icon} {a.label}
                        </button>
                      );
                    })}
                    {attendanceStatus === "SCHEDULED" && (
                      <div className="flex items-center gap-2 ml-auto">
                        <input
                          type="datetime-local"
                          value={expectedReturn}
                          onChange={(e) => setExpectedReturn(e.target.value)}
                          className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500"
                        />
                        <button
                          onClick={() => handleSetAttendance("SCHEDULED")}
                          disabled={savingAttendance || !expectedReturn}
                          className="px-2.5 py-1 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-500 disabled:opacity-50"
                        >
                          Salvar
                        </button>
                      </div>
                    )}
                    {selectedConv.lead.expectedReturnAt && attendanceStatus === "SCHEDULED" && !expectedReturn && (
                      <span className="text-purple-400 text-[11px] ml-auto">
                        📅 {new Date(selectedConv.lead.expectedReturnAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Painel: Vincular Prospect */}
              {showLinkProspect && !selectedConv.lead && (
                <div className="px-5 py-3.5 border-b border-[#1e2d45] bg-violet-500/5 flex-shrink-0">
                  <p className="text-violet-400 text-xs font-semibold mb-3">🔎 Vincular a um Prospect existente</p>
                  <div className="flex gap-2 mb-3">
                    <input
                      autoFocus
                      type="text"
                      value={prospectSearch}
                      onChange={(e) => setProspectSearch(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && searchProspects(prospectSearch)}
                      placeholder="Buscar por nome ou telefone..."
                      className="flex-1 bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500"
                    />
                    <button
                      onClick={() => searchProspects(prospectSearch)}
                      disabled={searchingProspect}
                      className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-500 disabled:opacity-50"
                    >
                      {searchingProspect ? "..." : "Buscar"}
                    </button>
                  </div>
                  {prospectResults.length > 0 && (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {prospectResults.map((p) => (
                        <div key={p.id} className="flex items-center justify-between bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2">
                          <div>
                            <div className="text-white text-xs font-semibold">{p.name ?? "Sem nome"}</div>
                            <div className="text-slate-500 text-[10px]">{p.phone} {p.pipelineStage ? `· ${p.pipelineStage}` : ""}</div>
                          </div>
                          <button
                            onClick={() => handleLinkProspect(p.id)}
                            disabled={linkingProspect}
                            className="px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
                          >
                            {linkingProspect ? "..." : "Vincular"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {prospectSearch && !searchingProspect && prospectResults.length === 0 && (
                    <p className="text-slate-600 text-xs text-center py-2">Nenhum prospect encontrado. Tente outro termo.</p>
                  )}
                  <p className="text-slate-600 text-[10px] mt-2">
                    Ao vincular, o telefone da conversa será associado ao prospect e as mensagens ficarão vinculadas.
                  </p>
                </div>
              )}

              {/* Form: Criar Lead */}
              {showConvertForm && !selectedConv.lead && (
                <div className="px-5 py-3.5 border-b border-[#1e2d45] bg-indigo-500/5 flex-shrink-0">
                  <p className="text-indigo-400 text-xs font-semibold mb-3">🎯 Converter em Lead</p>
                  <form onSubmit={handleConvertLead} className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-slate-400 text-[10px] uppercase tracking-wide mb-1">Nome</label>
                      <input
                        type="text"
                        value={convertForm.name}
                        onChange={(e) => setConvertForm({ ...convertForm, name: e.target.value })}
                        placeholder="Nome (opcional)"
                        className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-[10px] uppercase tracking-wide mb-1">Status</label>
                      <select
                        value={convertForm.status}
                        onChange={(e) => setConvertForm({ ...convertForm, status: e.target.value })}
                        className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="NEW">Novo</option>
                        <option value="CONTACTED">Em Contato</option>
                        <option value="PROPOSAL">Proposta</option>
                        <option value="CLOSED">Fechado</option>
                      </select>
                    </div>
                    {campaigns.length > 0 && (
                      <div>
                        <label className="block text-slate-400 text-[10px] uppercase tracking-wide mb-1">Campanha</label>
                        <select
                          value={convertForm.campaignId}
                          onChange={(e) => setConvertForm({ ...convertForm, campaignId: e.target.value })}
                          className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="">Sem campanha</option>
                          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button type="submit" disabled={converting} className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 transition-colors">
                        {converting ? "Convertendo..." : "Confirmar"}
                      </button>
                      <button type="button" onClick={() => setShowConvertForm(false)} className="px-3 py-1.5 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 text-sm hover:text-white transition-colors">
                        Cancelar
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Form: Abrir Chamado */}
              {showTicketForm && (
                <div className="px-5 py-3.5 border-b border-[#1e2d45] bg-orange-500/5 flex-shrink-0">
                  <p className="text-orange-400 text-xs font-semibold mb-3">🎫 Abrir Chamado de Suporte</p>
                  <form onSubmit={handleCreateTicket} className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-slate-400 text-[10px] uppercase tracking-wide mb-1">Assunto</label>
                      <input
                        type="text"
                        value={ticketForm.title}
                        onChange={(e) => setTicketForm({ ...ticketForm, title: e.target.value })}
                        placeholder={`Suporte — ${selectedConv.lead?.name ?? selectedConv.phone}`}
                        className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-slate-400 text-[10px] uppercase tracking-wide mb-1">Descrição (opcional)</label>
                      <input
                        type="text"
                        value={ticketForm.description}
                        onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })}
                        placeholder={`Contato via WhatsApp: ${selectedConv.phone}`}
                        className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" disabled={convertingTicket} className="px-4 py-1.5 rounded-lg bg-orange-600 text-white text-sm font-medium hover:bg-orange-500 disabled:opacity-50 transition-colors">
                        {convertingTicket ? "Criando..." : "Criar Chamado"}
                      </button>
                      <button type="button" onClick={() => setShowTicketForm(false)} className="px-3 py-1.5 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 text-sm hover:text-white transition-colors">
                        Cancelar
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {loadingMsgs ? (
                  <div className="flex items-center justify-center py-10 text-slate-500 text-sm">Carregando...</div>
                ) : convMessages.length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-slate-500 text-sm">Nenhuma mensagem.</div>
                ) : (
                  convMessages.map((msg) => {
                    const isOut = msg.direction === "OUTBOUND";
                    return (
                      <div key={msg.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${isOut ? "bg-indigo-600 text-white rounded-tr-none" : "bg-[#0f1623] border border-[#1e2d45] text-slate-200 rounded-tl-none"}`}>
                          <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                          <div className={`flex items-center gap-2 mt-1 flex-wrap ${isOut ? "justify-end" : "justify-start"}`}>
                            <span className={`text-[10px] ${isOut ? "text-indigo-200/60" : "text-slate-600"}`}>
                              {new Date(msg.receivedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {msg.instance && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${getInstanceBadgeColor(msg.instance.instanceName)}`}>
                                {msg.instance.instanceName}
                              </span>
                            )}
                            {msg.campaign && (
                              <span className="text-[10px] text-indigo-400/70">📣 {msg.campaign.name}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Painel de notas (só para leads) */}
              {selectedConv.lead && (
                <div className="flex-shrink-0 border-t border-[#1e2d45]">
                  {/* Toggle */}
                  <button
                    onClick={() => setShowNotesPanel(!showNotesPanel)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs font-semibold">📝 Notas do atendimento</span>
                      {parsedNotes.length > 0 && (
                        <span className="text-[10px] text-slate-600 bg-white/5 px-1.5 py-0.5 rounded-full">
                          {parsedNotes.length}
                        </span>
                      )}
                    </div>
                    <span className="text-slate-600 text-[10px]">{showNotesPanel ? "▴" : "▾"}</span>
                  </button>

                  {showNotesPanel && (
                    <div className="px-4 pb-3 space-y-3">
                      {/* Input nova nota */}
                      <form onSubmit={handleAddNote} className="flex gap-2">
                        <input
                          type="text"
                          value={newNote}
                          onChange={(e) => setNewNote(e.target.value)}
                          placeholder="Adicionar nota... (ex: cliente pediu proposta, voltará semana que vem)"
                          className="flex-1 bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                        />
                        <button
                          type="submit"
                          disabled={savingNote || !newNote.trim()}
                          className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-40 flex-shrink-0"
                        >
                          {savingNote ? "..." : "Salvar"}
                        </button>
                      </form>

                      {/* Lista de notas */}
                      {parsedNotes.length > 0 && (
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                          {parsedNotes.map((note, i) => (
                            <div key={i} className="flex gap-2.5 bg-[#0a0f1a] rounded-lg px-3 py-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-slate-200 text-xs leading-relaxed whitespace-pre-wrap">{note.text}</p>
                              </div>
                              {note.date && (
                                <span className="flex-shrink-0 text-slate-600 text-[10px] font-mono mt-0.5">{note.date}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {parsedNotes.length === 0 && (
                        <p className="text-slate-600 text-xs">Nenhuma nota ainda. Adicione informações sobre o atendimento acima.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Reply */}
              <div className="flex-shrink-0 border-t border-[#1e2d45] px-4 py-3">
                {replyError && <div className="text-red-400 text-xs mb-2">{replyError}</div>}
                <form onSubmit={handleReply} className="flex gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Digite uma mensagem..."
                    disabled={sendingReply}
                    className="flex-1 bg-[#0f1623] border border-[#1e2d45] rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={sendingReply || !replyText.trim()}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors flex-shrink-0"
                  >
                    {sendingReply ? "..." : "Enviar"}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
