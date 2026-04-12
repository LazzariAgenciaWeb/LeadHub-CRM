"use client";

import { useState, useRef, useEffect } from "react";
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
  lead: { id: string; name: string | null; status: string } | null;
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

// Cores para badges de instância (rotaciona por nome)
const INSTANCE_BADGE_COLORS = [
  "bg-violet-500/20 text-violet-300",
  "bg-cyan-500/20 text-cyan-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-orange-500/20 text-orange-300",
  "bg-pink-500/20 text-pink-300",
  "bg-yellow-500/20 text-yellow-300",
];

function getInstanceBadgeColor(instanceName: string) {
  let hash = 0;
  for (let i = 0; i < instanceName.length; i++) hash = instanceName.charCodeAt(i) + ((hash << 5) - hash);
  return INSTANCE_BADGE_COLORS[Math.abs(hash) % INSTANCE_BADGE_COLORS.length];
}

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

  const [converting, setConverting] = useState(false);
  const [convertForm, setConvertForm] = useState({ name: "", status: "NEW", campaignId: "" });
  const [showConvertForm, setShowConvertForm] = useState(false);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);

  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [search, setSearch] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedConvRef = useRef<Conversation | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convMessages]);

  // Auto-refresh: atualiza mensagens e lista de conversas a cada 5 segundos
  useEffect(() => {
    selectedConvRef.current = selectedConv;
  }, [selectedConv]);

  useEffect(() => {
    const interval = setInterval(async () => {
      // Atualiza a página para recarregar a lista de conversas
      router.refresh();

      // Atualiza mensagens da conversa selecionada
      const conv = selectedConvRef.current;
      if (!conv) return;
      const params = new URLSearchParams({ phone: conv.phone });
      if (conv.companyId) params.set("companyId", conv.companyId);
      const res = await fetch(`/api/whatsapp/messages?${params}`);
      if (res.ok) {
        const msgs = await res.json();
        setConvMessages(msgs);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [router]);

  const filteredConvs = conversations.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.phone.includes(q) || c.lead?.name?.toLowerCase().includes(q);
  });

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
    setConvMessages([]);
    setReplyText("");
    setReplyError(null);
    setEditingName(false);
    setLeadName(conv.lead?.name ?? "");
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
      setSelectedConv({ ...selectedConv, lead: data.lead });
      router.refresh();
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedConv || !replyText.trim()) return;

    // Usar a instância que recebeu/enviou a última mensagem da conversa
    const lastInstanceName = convMessages.length > 0
      ? convMessages[convMessages.length - 1].instance?.instanceName
      : null;

    const inst = (lastInstanceName
      ? instances.find((i) => i.instanceName === lastInstanceName)
      : null)
      ?? instances.find((i) => i.status === "CONNECTED" && i.company?.id === selectedConv.companyId)
      ?? instances.find((i) => i.company?.id === selectedConv.companyId);

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

  function formatTime(dt: string) {
    const d = new Date(dt);
    const now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("pt-BR");
  }

  const connectedCount = instances.filter((i) => i.status === "CONNECTED").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-[#1e2d45]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold text-xl">📥 Mensagens</h1>
            <p className="text-slate-500 text-sm mt-0.5">{conversations.length} conversa{conversations.length !== 1 ? "s" : ""}</p>
          </div>

          {/* Instâncias ativas + link para config */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {instances.slice(0, 4).map((inst) => {
                const s = INSTANCE_STATUS[inst.status] ?? INSTANCE_STATUS.DISCONNECTED;
                return (
                  <div key={inst.id} title={`${inst.instanceName} — ${s.label}`} className="flex items-center gap-1.5 bg-[#0f1623] border border-[#1e2d45] rounded-full px-2.5 py-1">
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

      {/* No instances warning */}
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

      {/* Body: lista + detalhe */}
      <div className="flex flex-1 overflow-hidden">
        {/* Conversation list */}
        <div className="w-[300px] min-w-[300px] border-r border-[#1e2d45] flex flex-col overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-[#1e2d45] flex-shrink-0">
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
                  {conversations.length === 0 ? "Nenhuma mensagem recebida ainda." : "Nenhum resultado para a busca."}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {filteredConvs.map((conv) => (
                <button
                  key={conv.phone}
                  onClick={() => loadConversation(conv)}
                  className={`w-full text-left px-4 py-3 border-b border-[#1e2d45]/50 hover:bg-white/[0.03] transition-colors ${
                    selectedConv?.phone === conv.phone ? "bg-indigo-500/10 border-l-2 border-l-indigo-500" : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#1e2d45] flex items-center justify-center text-xs font-bold text-slate-400 flex-shrink-0">
                        {conv.phone.slice(-2)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-white text-[13px] font-semibold truncate">
                          {conv.lead?.name ?? conv.phone}
                        </div>
                        {conv.lead?.name && <div className="text-slate-600 text-[10px]">{conv.phone}</div>}
                      </div>
                    </div>
                    <span className="text-slate-600 text-[10px] flex-shrink-0 ml-2">
                      {conv.lastMsg ? formatTime(conv.lastMsg.receivedAt) : ""}
                    </span>
                  </div>

                  {conv.lastMsg && (
                    <div className="text-slate-500 text-[11px] truncate pl-10">
                      {conv.lastMsg.direction === "OUTBOUND" ? "→ " : ""}{conv.lastMsg.body}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-1 pl-10">
                    <span className="text-[10px] text-slate-600">📥{conv.inboundCount} 📤{conv.outboundCount}</span>
                    {conv.lead ? (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${LEAD_STATUS_COLOR[conv.lead.status] ?? ""}`}>
                        {LEAD_STATUS_LABEL[conv.lead.status] ?? conv.lead.status}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-600 bg-white/5 px-1.5 py-0.5 rounded-full">Não é lead</span>
                    )}
                  </div>
                </button>
              ))}
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
              <div className="px-5 py-3.5 border-b border-[#1e2d45] flex items-center justify-between flex-shrink-0">
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
                      <button type="button" onClick={() => setEditingName(false)} className="text-slate-500 text-xs hover:text-white">Cancelar</button>
                    </form>
                  ) : (
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold truncate">{selectedConv.lead?.name ?? selectedConv.phone}</span>
                        {selectedConv.lead && (
                          <button
                            onClick={() => { setLeadName(selectedConv.lead?.name ?? ""); setEditingName(true); }}
                            className="text-slate-600 hover:text-slate-400 text-xs flex-shrink-0"
                            title="Editar nome"
                          >✏️</button>
                        )}
                      </div>
                      {selectedConv.lead?.name && <div className="text-slate-500 text-xs">{selectedConv.phone}</div>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {selectedConv.lead ? (
                    <>
                      <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${LEAD_STATUS_COLOR[selectedConv.lead.status] ?? ""}`}>
                        ✓ Lead — {LEAD_STATUS_LABEL[selectedConv.lead.status] ?? selectedConv.lead.status}
                      </span>
                      <Link href="/leads" className="text-indigo-400 text-xs hover:underline">Ver lead →</Link>
                    </>
                  ) : (
                    <button
                      onClick={() => setShowConvertForm(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 transition-colors"
                    >
                      🎯 Converter em Lead
                    </button>
                  )}
                </div>
              </div>

              {/* Convert form */}
              {showConvertForm && !selectedConv.lead && (
                <div className="px-5 py-3.5 border-b border-[#1e2d45] bg-indigo-500/5 flex-shrink-0">
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
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${getInstanceBadgeColor(msg.instance.instanceName)}`}>
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
