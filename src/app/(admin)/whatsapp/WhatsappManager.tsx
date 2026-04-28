"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Instance {
  id: string;
  instanceName: string;
  phone: string | null;
  status: "CONNECTED" | "DISCONNECTED" | "CONNECTING";
  company: { id: string; name: string } | null;
}

interface CompanyContactInfo {
  id: string;
  name: string | null;
  role: string;
  hasAccess: boolean;
  company: { id: string; name: string };
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
    companyId?: string;
  } | null;
  lastMsg: {
    body: string;
    direction: string;
    receivedAt: string;
    participantPhone: string | null;
    instance: { instanceName: string } | null;
  } | null;
  companyContact: CompanyContactInfo | null;
}

interface WaMessage {
  id: string;
  externalId?: string | null;
  body: string;
  direction: string;
  receivedAt: string;
  participantPhone: string | null;
  participantName: string | null;
  instance: { instanceName: string } | null;
  campaign: { id: string; name: string } | null;
  ack?: number | null;
  quotedId?: string | null;
  quotedBody?: string | null;
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

/**
 * Retorna todas as variantes normalizadas de um número brasileiro/internacional
 * para lookup no instancePhoneMap.
 *
 * Problema: Evolution API às vezes salva/envia o número com ou sem o dígito "9"
 * extra obrigatório em celulares brasileiros (DDD + 9 + 8 dígitos vs DDD + 8 dígitos).
 *
 * Exemplo: 11 9XXXX-XXXX → também tenta 11 XXXX-XXXX e vice-versa.
 */
function phoneVariants(rawDigits: string): string[] {
  const digits = rawDigits.replace(/\D/g, "");
  // Remove prefixo 55 para trabalhar na forma sem país
  const withoutCountry = digits.startsWith("55") ? digits.slice(2) : digits;
  const withCountry = "55" + withoutCountry;

  const variants = new Set<string>([digits, withoutCountry, withCountry]);

  // Aplica variante do 9 apenas para números brasileiros (DDD 2 dígitos + corpo)
  if (withoutCountry.length === 11) {
    // Tem 9 → tenta sem (DDD + 8 dígitos)
    const ddd = withoutCountry.slice(0, 2);
    const corpo = withoutCountry.slice(2);
    if (corpo.startsWith("9") && corpo.length === 9) {
      const sem9 = ddd + corpo.slice(1);         // 10 dígitos
      variants.add(sem9);
      variants.add("55" + sem9);
    }
  } else if (withoutCountry.length === 10) {
    // Sem 9 → tenta com (DDD + 9 + 8 dígitos)
    const ddd = withoutCountry.slice(0, 2);
    const corpo = withoutCountry.slice(2);       // 8 dígitos
    const com9 = ddd + "9" + corpo;              // 11 dígitos
    variants.add(com9);
    variants.add("55" + com9);
  }

  return [...variants];
}

export default function WhatsappManager({
  instances,
  isSuperAdmin,
  defaultCompanyId,
  conversations,
  defaultPhone,
  finalStageNames = [],
  userSignature = "",
  userName = "",
}: {
  instances: Instance[];
  isSuperAdmin: boolean;
  defaultCompanyId: string;
  conversations: Conversation[];
  defaultPhone?: string;
  finalStageNames?: string[];
  userSignature?: string;
  userName?: string;
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

  // Convert to oportunidade
  const [showOportunidadeForm, setShowOportunidadeForm] = useState(false);
  const [oportunidadeForm, setOportunidadeForm] = useState({ name: "", value: "" });
  const [convertingOportunidade, setConvertingOportunidade] = useState(false);

  // Reply
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Citação (responder mensagem específica)
  const [replyingTo, setReplyingTo] = useState<WaMessage | null>(null);

  // Scroll to bottom button visibility
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Participante de grupo: editar nome / mover empresa / marcar como meu
  const [editingParticipant, setEditingParticipant] = useState<string | null>(null); // phone
  const [participantMarkMode, setParticipantMarkMode] = useState<"contact" | "mine" | null>(null);
  const [participantNames, setParticipantNames] = useState<Record<string, string>>({}); // phone → name
  const [participantCompanies, setParticipantCompanies] = useState<Record<string, { id: string; name: string }>>({});
  const [participantNameInput, setParticipantNameInput] = useState("");
  const [participantCompanySearch, setParticipantCompanySearch] = useState("");
  const [participantCompanyResults, setParticipantCompanyResults] = useState<{ id: string; name: string }[]>([]);
  const [savingParticipant, setSavingParticipant] = useState(false);
  const [markingAsMine, setMarkingAsMine] = useState(false);
  // Overrides locais: phone → instanceName (aplicados imediatamente ao marcar "é meu número")
  const [instancePhoneOverrides, setInstancePhoneOverrides] = useState<Map<string, string>>(new Map());

  // Name editor
  const [editingName, setEditingName] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Group name overrides — atualizado localmente sem precisar de router.refresh()
  const [groupNameOverrides, setGroupNameOverrides] = useState<Record<string, string>>({});
  const [refreshingGroupName, setRefreshingGroupName] = useState(false);

  // Notes / comments
  const [leadNotes, setLeadNotes] = useState<string>("");
  const [showNotesPanel, setShowNotesPanel] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [instanceFilter, setInstanceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  // Ocultar grupos — persiste no localStorage
  const [hideGroups, setHideGroups] = useState<boolean>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("wa_hide_groups") === "1";
    return false;
  });
  function toggleHideGroups() {
    setHideGroups((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem("wa_hide_groups", next ? "1" : "0");
      return next;
    });
  }

  // Atendimento
  const [attendanceStatus, setAttendanceStatus] = useState<string | null>(null);
  const [expectedReturn, setExpectedReturn] = useState<string>("");
  const [savingAttendance, setSavingAttendance] = useState(false);
  // Override local de attendanceStatus por telefone — evita sidebar desatualizada antes do router.refresh()
  const [localAttendanceOverrides, setLocalAttendanceOverrides] = useState<Map<string, string>>(new Map());

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

  // Adicionar como contato de empresa
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [companyResults, setCompanyResults] = useState<{ id: string; name: string; segment: string | null }[]>([]);
  const [searchingCompany, setSearchingCompany] = useState(false);
  const [addContactForm, setAddContactForm] = useState({ companyId: "", companyName: "", contactName: "", role: "CONTACT" });
  const [savingContact, setSavingContact] = useState(false);
  const [creatingContactCompany, setCreatingContactCompany] = useState(false);

  // Mesclar contatos duplicados
  const [showMergePanel, setShowMergePanel] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeResults, setMergeResults] = useState<{ phone: string; name: string | null }[]>([]);
  const [mergingContacts, setMergingContacts] = useState(false);

  // Nova conversa (iniciar com número novo)
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvPhone, setNewConvPhone] = useState("");
  const [newConvMsg, setNewConvMsg] = useState("");
  const [newConvInstanceId, setNewConvInstanceId] = useState("");
  const [sendingNewConv, setSendingNewConv] = useState(false);
  const [newConvError, setNewConvError] = useState<string | null>(null);

  // Atribuir grupo a empresa
  const [showGroupCompany, setShowGroupCompany] = useState(false);
  const [groupCompanySearch, setGroupCompanySearch] = useState("");
  const [groupCompanyResults, setGroupCompanyResults] = useState<{ id: string; name: string; segment: string | null }[]>([]);
  const [searchingGroupCompany, setSearchingGroupCompany] = useState(false);
  const [assigningGroupCompany, setAssigningGroupCompany] = useState(false);
  const [assignGroupError, setAssignGroupError] = useState<string | null>(null);
  const [creatingGroupCompany, setCreatingGroupCompany] = useState(false);

  // Instância selecionada para responder grupos (persiste em localStorage)
  const [groupInstanceId, setGroupInstanceId] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("group_instance_id") ?? "";
    return "";
  });
  function selectGroupInstance(id: string) {
    setGroupInstanceId(id);
    if (typeof window !== "undefined") localStorage.setItem("group_instance_id", id);
  }

  // Chamado aberto + menu de ações
  const [openTicket, setOpenTicket] = useState<{ id: string; title: string; status: string } | null>(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  // Painel IA
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiIntent, setAiIntent] = useState<string | null>(null);
  const [aiSuggestedReply, setAiSuggestedReply] = useState<string | null>(null);
  const [aiLoadingSummary, setAiLoadingSummary] = useState(false);
  const [aiLoadingReply, setAiLoadingReply] = useState(false);

  useEffect(() => {
    if (!showActionsMenu) return;
    function handleClick(e: MouseEvent) {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showActionsMenu]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const selectedConvRef = useRef<Conversation | null>(null);
  const openTicketRef = useRef<{ id: string; title: string; status: string } | null>(null);
  // Flag para forçar scroll no próximo render (ao abrir conversa ou enviar mensagem)
  const forceScrollRef = useRef(false);

  function scrollToBottom(force = false) {
    const el = messagesContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (force || nearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: force ? "instant" : "smooth" });
    }
  }

  function handleMessagesScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 200);
  }

  useEffect(() => {
    const force = forceScrollRef.current;
    forceScrollRef.current = false;
    scrollToBottom(force);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convMessages]);

  useEffect(() => {
    selectedConvRef.current = selectedConv;
  }, [selectedConv]);

  useEffect(() => {
    openTicketRef.current = openTicket;
  }, [openTicket]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      router.refresh();
      const conv = selectedConvRef.current;
      if (!conv) return;

      const msgParams = new URLSearchParams({ phone: conv.phone });
      if (conv.companyId) msgParams.set("companyId", conv.companyId);

      // Estratégia dupla para o chamado:
      // 1) busca por phone (descobre ticket novo)
      // 2) se já tem ticket aberto, verifica o status diretamente pelo ID
      //    (cobre casos onde o ticket não tem phone salvo ou phone diferente)
      const ticketParams = new URLSearchParams({ phone: conv.phone, openOnly: "true" });
      if (conv.companyId) ticketParams.set("companyId", conv.companyId);
      const currentTicketId = openTicketRef.current?.id;

      const fetches: Promise<Response>[] = [
        fetch(`/api/whatsapp/messages?${msgParams}`),
        fetch(`/api/tickets?${ticketParams}`),
      ];
      if (currentTicketId) fetches.push(fetch(`/api/tickets/${currentTicketId}`));
      if (conv.lead?.id)   fetches.push(fetch(`/api/leads/${conv.lead.id}`));

      const results = await Promise.all(fetches);
      const [msgsRes, ticketsRes, ...rest] = results;
      const ticketByIdRes = currentTicketId ? rest[0] : undefined;
      const leadRes       = currentTicketId ? rest[1] : rest[0];

      if (msgsRes.ok) setConvMessages(await msgsRes.json());

      // Atualiza chamado: usa o resultado por ID se disponível (mais confiável)
      if (ticketByIdRes?.ok) {
        const t = await ticketByIdRes.json();
        const isFinal = t.status === "RESOLVED" || t.status === "CLOSED";
        setOpenTicket(isFinal ? null : { id: t.id, title: t.title, status: t.status });
      } else if (ticketsRes.ok) {
        const tickets = await ticketsRes.json();
        setOpenTicket(tickets[0] ?? null);
      }

      // Atualiza pipeline/stage/attendanceStatus do lead sem fechar a conversa
      if (leadRes?.ok) {
        const updatedLead = await leadRes.json();
        setSelectedConv((prev) => {
          if (!prev || !updatedLead) return prev;
          return {
            ...prev,
            lead: {
              ...prev.lead,
              ...updatedLead,
              notes: updatedLead.notes ?? prev.lead?.notes ?? null,
            },
          };
        });
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [router]);

  // Auto-sync: se alguma instância está em CONNECTING mas a Evolution já reconectou,
  // consulta o status real via API após 12 s e atualiza o banco + UI
  useEffect(() => {
    const connecting = instances.filter((i) => i.status === "CONNECTING");
    if (connecting.length === 0) return;
    const timer = setTimeout(async () => {
      await Promise.all(connecting.map((inst) =>
        fetch(`/api/whatsapp/${inst.id}/sync`, { method: "POST" }).catch(() => {})
      ));
      router.refresh();
    }, 12_000);
    return () => clearTimeout(timer);
  }, [instances, router]);

  // Auto-abrir conversa quando vindo do CRM via ?abrir=PHONE
  useEffect(() => {
    if (!defaultPhone || conversations.length === 0) return;
    const conv = conversations.find((c) => c.phone === defaultPhone);
    if (conv) loadConversation(conv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unique instances that appear in conversations (for filter)
  const conversationInstances = useMemo(() => {
    const names = conversations
      .filter((c) => !(!isSuperAdmin && defaultCompanyId && c.companyId !== defaultCompanyId))
      .map((c) => c.lastMsg?.instance?.instanceName)
      .filter(Boolean) as string[];
    return [...new Set(names)];
  }, [conversations, isSuperAdmin, defaultCompanyId]);

  // Filtered conversations
  const filteredConvs = useMemo(() => {
    return conversations.filter((c) => {
      // Filtro de empresa (client-side, defesa contra dados misturados no refresh)
      if (!isSuperAdmin && defaultCompanyId && c.companyId !== defaultCompanyId) return false;

      // Ocultar grupos
      if (hideGroups && c.phone.includes("@g.us")) return false;

      // Busca por texto
      if (search) {
        const q = search.toLowerCase();
        const matchName = c.lead?.name?.toLowerCase().includes(q) || c.companyContact?.name?.toLowerCase().includes(q);
        const matchPhone = c.phone.includes(q);
        const matchCompany = c.companyContact?.company.name.toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchCompany) return false;
      }
      // Filtro de instância
      if (instanceFilter && c.lastMsg?.instance?.instanceName !== instanceFilter) return false;

      // Filtros de status
      if (statusFilter) {
        const isInbound = c.lastMsg?.direction === "INBOUND";
        const mins = isInbound
          ? Math.floor((Date.now() - new Date(c.lastMsg!.receivedAt).getTime()) / 60_000)
          : -1;
        // Usa override local se existir (atualização otimista antes do router.refresh)
        const atStatus = localAttendanceOverrides.get(c.phone) ?? c.lead?.attendanceStatus;

        switch (statusFilter) {
          case "URGENT":      if (!(isInbound && mins >= 20)) return false; break;
          case "UNANSWERED":  if (!isInbound || atStatus === "RESOLVED") return false; break;
          case "IN_PROGRESS": if (atStatus !== "IN_PROGRESS") return false; break;
          case "RESOLVED":    if (atStatus !== "RESOLVED") return false; break;
          case "SCHEDULED":   if (atStatus !== "SCHEDULED") return false; break;
          case "CLIENTS":     if (!c.companyContact) return false; break;
          case "NO_LEAD":     if (c.lead?.pipeline) return false; break;
        }
      }
      return true;
    });
  }, [conversations, search, instanceFilter, statusFilter, localAttendanceOverrides, hideGroups, isSuperAdmin, defaultCompanyId]);

  // Contagem por filtro de status (para mostrar badges nos chips)
  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { URGENT: 0, UNANSWERED: 0, IN_PROGRESS: 0, RESOLVED: 0, SCHEDULED: 0, CLIENTS: 0, NO_LEAD: 0 };
    const now = Date.now();
    for (const c of conversations) {
      // Respeita filtro de empresa client-side
      if (!isSuperAdmin && defaultCompanyId && c.companyId !== defaultCompanyId) continue;
      const isInbound = c.lastMsg?.direction === "INBOUND";
      const mins = isInbound ? Math.floor((now - new Date(c.lastMsg!.receivedAt).getTime()) / 60_000) : -1;
      // Usa override local se existir
      const atStatus = localAttendanceOverrides.get(c.phone) ?? c.lead?.attendanceStatus;
      if (isInbound && mins >= 20) counts.URGENT++;
      if (isInbound && atStatus !== "RESOLVED") counts.UNANSWERED++;
      if (atStatus === "IN_PROGRESS") counts.IN_PROGRESS++;
      if (atStatus === "RESOLVED")    counts.RESOLVED++;
      if (atStatus === "SCHEDULED")   counts.SCHEDULED++;
      if (c.companyContact)            counts.CLIENTS++;
      if (!c.lead?.pipeline)           counts.NO_LEAD++;
    }
    return counts;
  }, [conversations, localAttendanceOverrides, isSuperAdmin, defaultCompanyId]);

  // Mapa phone → instanceName para identificar "nossos números" em grupos.
  // Indexa TODAS as variantes (com/sem 55, com/sem o 9 extra) para cobrir inconsistências
  // entre como a Evolution salva o número da instância e como envia o participantPhone.
  const instancePhoneMap = useMemo(() => {
    const map = new Map<string, string>(); // variante → instanceName
    for (const inst of instances) {
      if (inst.phone) {
        for (const v of phoneVariants(inst.phone)) {
          map.set(v, inst.instanceName);
        }
      }
    }
    // Aplica overrides locais (definidos ao clicar "É meu número") — efeito imediato sem aguardar router.refresh
    for (const [phone, instanceName] of instancePhoneOverrides) {
      for (const v of phoneVariants(phone)) {
        map.set(v, instanceName);
      }
    }
    return map;
  }, [instances, instancePhoneOverrides]);

  // Mapa phone normalizado → nome vindo do pushName (preenchido ao carregar mensagens do grupo)
  const pushNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const msg of convMessages) {
      if (msg.participantPhone && msg.participantName) {
        const raw = msg.participantPhone.replace("@s.whatsapp.net", "").replace(/\D/g, "");
        const norm = raw.replace(/^55/, "");
        if (!map.has(norm)) map.set(norm, msg.participantName);
        if (!map.has(raw))  map.set(raw,  msg.participantName);
      }
    }
    return map;
  }, [convMessages]);

  function resolveParticipant(participantPhone: string | null, pushName?: string | null): { isOurs: boolean; label: string; rawNorm: string } | null {
    if (!participantPhone) return null;
    const raw = participantPhone.replace("@s.whatsapp.net", "").replace(/\D/g, "");
    const norm = raw.replace(/^55/, "");

    // Tenta todas as variantes (com/sem 55, com/sem 9 extra) para encontrar a instância
    const allVariants = phoneVariants(raw);
    const instanceName = allVariants.reduce<string | undefined>((found, v) => found ?? instancePhoneMap.get(v), undefined);
    if (instanceName) return { isOurs: true, label: instanceName, rawNorm: norm };

    // Prioridade de nome: nome salvo manualmente > pushName da Evolution > número formatado
    const savedName = participantNames[norm] ?? participantNames[raw];
    const evolutionName = pushName ?? pushNameMap.get(norm) ?? pushNameMap.get(raw);
    let display: string;
    if (savedName) {
      display = savedName;
    } else if (evolutionName) {
      display = evolutionName;
    } else if (norm.length >= 10 && norm.length <= 11) {
      // Brasileiro: (DDD) XXXXX-XXXX
      display = norm.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
    } else if (norm.length > 11) {
      // Internacional longo: mostra só últimos 9 dígitos precedidos de "..."
      display = "…" + norm.slice(-9).replace(/(\d{4,5})(\d{4})$/, "$1-$2");
    } else {
      display = norm;
    }
    return { isOurs: false, label: display, rawNorm: norm };
  }

  // Cor estável por participante (hash do telefone → paleta)
  function getParticipantColor(phone: string): string {
    const palette = [
      "text-cyan-400", "text-emerald-400", "text-violet-400",
      "text-orange-400", "text-pink-400", "text-yellow-400",
      "text-blue-400",  "text-teal-400",  "text-rose-400",
    ];
    let h = 0;
    for (let i = 0; i < phone.length; i++) h = (Math.imul(31, h) + phone.charCodeAt(i)) | 0;
    return palette[Math.abs(h) % palette.length];
  }

  async function handleNewConv(e: React.FormEvent) {
    e.preventDefault();
    let phone = newConvPhone.trim().replace(/\D/g, "");
    if (!phone || !newConvMsg.trim()) return;
    // Garante código do país Brasil (+55) se o número parece brasileiro sem DDI
    // Números brasileiros: DDD (2) + 8 ou 9 dígitos = 10 ou 11 dígitos no total
    if (!phone.startsWith("55") && (phone.length === 10 || phone.length === 11)) {
      phone = "55" + phone;
    }
    const instId = newConvInstanceId || instances.find((i) => i.status === "CONNECTED")?.id;
    if (!instId) { setNewConvError("Nenhuma instância conectada."); return; }
    setSendingNewConv(true);
    setNewConvError(null);
    const res = await fetch(`/api/whatsapp/${instId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, text: newConvMsg.trim() }),
    });
    setSendingNewConv(false);
    if (!res.ok) {
      const d = await res.json();
      setNewConvError(d.error ?? "Erro ao enviar");
      return;
    }
    // Fechar o formulário e recarregar para a conversa aparecer
    setShowNewConv(false);
    setNewConvPhone("");
    setNewConvMsg("");
    setNewConvInstanceId("");
    router.refresh();
    // Após refresh, tentar abrir a nova conversa (pode demorar um ciclo)
    setTimeout(() => {
      const conv = conversations.find((c) => c.phone === phone || c.phone.endsWith(phone));
      if (conv) loadConversation(conv);
    }, 500);
  }

  // Carregar nomes de participantes ao abrir conversa de grupo
  async function loadParticipantContacts(phones: string[]) {
    if (!phones.length) return;
    // Also include country-code variant so DB lookups work regardless of storage format
    const phonesWithVariants = [...new Set(
      phones.flatMap((p) => {
        const digits = p.replace(/\D/g, "");
        const variants = [digits];
        if (digits.startsWith("55")) variants.push(digits.slice(2)); // sem 55
        else if (digits.length === 11) variants.push("55" + digits);  // com 55
        return variants;
      })
    )];
    const res = await fetch(`/api/whatsapp/participant-contact?phones=${phonesWithVariants.join(",")}`);
    if (!res.ok) return;
    const contacts: { phone: string; name: string | null; company: { id: string; name: string } | null }[] = await res.json();
    const names: Record<string, string> = {};
    const companies: Record<string, { id: string; name: string }> = {};
    for (const c of contacts) {
      const p = c.phone;
      // Store under both variants so resolveParticipant finds it
      const withoutCC = p.startsWith("55") && p.length > 11 ? p.slice(2) : p;
      const withCC = p.startsWith("55") ? p : "55" + p;
      if (c.name) { names[p] = c.name; names[withoutCC] = c.name; names[withCC] = c.name; }
      if (c.company) { companies[p] = c.company; companies[withoutCC] = c.company; }
    }
    // Merge instead of replace so switching conversations doesn't lose previous names
    setParticipantNames((prev) => ({ ...prev, ...names }));
    setParticipantCompanies((prev) => ({ ...prev, ...companies }));
  }

  async function handleOpenParticipantEdit(phone: string) {
    const norm = phone.replace("@s.whatsapp.net", "").replace(/\D/g, "");
    setEditingParticipant(norm);
    setParticipantMarkMode(null); // começa na tela de escolha
    setParticipantNameInput(participantNames[norm] ?? "");
    setParticipantCompanySearch("");
    setParticipantCompanyResults([]);
  }

  async function searchParticipantCompanies(q: string) {
    if (!q.trim()) return;
    const res = await fetch(`/api/companies?search=${encodeURIComponent(q)}`);
    if (res.ok) {
      const data = await res.json();
      setParticipantCompanyResults((data.companies ?? data).slice(0, 6));
    }
  }

  async function handleSaveParticipant(companyId?: string) {
    if (!editingParticipant) return;
    setSavingParticipant(true);
    const res = await fetch("/api/whatsapp/participant-contact", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: editingParticipant,
        name: participantNameInput.trim() || undefined,
        companyId,
      }),
    });
    setSavingParticipant(false);
    if (res.ok) {
      const { contact } = await res.json();
      setParticipantNames((prev) => ({ ...prev, [editingParticipant]: contact.name ?? prev[editingParticipant] }));
      if (contact.company) setParticipantCompanies((prev) => ({ ...prev, [editingParticipant]: contact.company }));
      setEditingParticipant(null);
    }
  }

  async function handleMarkAsMine(instanceId: string) {
    if (!editingParticipant) return;
    const inst = instances.find((i) => i.id === instanceId);
    if (!inst) return;
    setMarkingAsMine(true);
    const res = await fetch(`/api/whatsapp/${instanceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: editingParticipant }),
    });
    setMarkingAsMine(false);
    if (res.ok) {
      // Atualiza mapa local imediatamente — os balões do grupo mudam de lado sem precisar de router.refresh
      const norm = editingParticipant.replace(/^55/, "");
      setInstancePhoneOverrides((prev) => {
        const next = new Map(prev);
        next.set(editingParticipant, inst.instanceName);
        next.set(norm, inst.instanceName);
        return next;
      });
      setEditingParticipant(null);
      setParticipantMarkMode(null);
    }
  }

  async function searchGroupCompanies(q: string) {
    if (!q.trim()) return;
    setSearchingGroupCompany(true);
    const params = new URLSearchParams({ search: q });
    if (selectedConv?.companyId) params.set("companyId", selectedConv.companyId);
    const res = await fetch(`/api/companies?${params}`);
    if (res.ok) {
      const data = await res.json();
      setGroupCompanyResults((data.companies ?? data).slice(0, 8));
    }
    setSearchingGroupCompany(false);
  }

  async function handleAssignGroupCompany(targetCompanyId: string) {
    if (!selectedConv) return;
    setAssigningGroupCompany(true);
    setAssignGroupError(null);
    const res = await fetch("/api/whatsapp/group-company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupJid: selectedConv.phone, targetCompanyId }),
    });
    setAssigningGroupCompany(false);
    if (res.ok) {
      const { contact } = await res.json();
      setSelectedConv({ ...selectedConv, companyContact: { id: contact.id, name: contact.name, role: "CONTACT", hasAccess: false, company: contact.company } });
      setShowGroupCompany(false);
      setGroupCompanySearch("");
      setGroupCompanyResults([]);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setAssignGroupError(err.error ?? "Erro ao atribuir empresa");
    }
  }

  async function handleCreateAndAssignCompany(name: string) {
    if (!selectedConv || !name.trim()) return;
    setCreatingGroupCompany(true);
    setAssignGroupError(null);
    // 1. Criar a empresa
    const createRes = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      setAssignGroupError(err.error ?? "Erro ao criar empresa");
      setCreatingGroupCompany(false);
      return;
    }
    const newCompany = await createRes.json();
    // 2. Atribuir o grupo à nova empresa
    await handleAssignGroupCompany(newCompany.id);
    setCreatingGroupCompany(false);
  }

  // Criar empresa e avançar direto para o passo 2 do formulário de contato individual
  async function handleCreateCompanyForContact(name: string) {
    if (!name.trim()) return;
    setCreatingContactCompany(true);
    const createRes = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      alert(err.error ?? "Erro ao criar empresa");
      setCreatingContactCompany(false);
      return;
    }
    const newCompany = await createRes.json();
    // Avança para o passo 2 com a empresa recém-criada
    setAddContactForm((prev) => ({ ...prev, companyId: newCompany.id, companyName: newCompany.name }));
    setCompanySearch("");
    setCompanyResults([]);
    setCreatingContactCompany(false);
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedConv || !leadName.trim()) return;
    setSavingName(true);

    if (selectedConv.lead) {
      // Lead já existe: só atualiza o nome
      await fetch(`/api/leads/${selectedConv.lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: leadName.trim() }),
      });
      setSelectedConv({ ...selectedConv, lead: { ...selectedConv.lead, name: leadName.trim() } });
    } else {
      // Sem lead: cria um contato na caixa de entrada (pipeline: null)
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: selectedConv.phone,
          name: leadName.trim(),
          pipeline: null,
          source: "whatsapp",
          companyId: selectedConv.companyId,
        }),
      });
      if (res.ok) {
        const newLead = await res.json();
        // Vincula as mensagens desse telefone ao novo lead
        await fetch("/api/whatsapp/link-prospect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: selectedConv.phone, companyId: selectedConv.companyId, leadId: newLead.id }),
        });
        setSelectedConv({
          ...selectedConv,
          lead: {
            id: newLead.id, name: newLead.name, status: newLead.status,
            notes: null, pipeline: null, pipelineStage: null,
            attendanceStatus: null, expectedReturnAt: null,
          },
        });
      }
    }

    setSavingName(false);
    setEditingName(false);
    router.refresh();
  }

  async function loadConversation(conv: Conversation) {
    setSelectedConv(conv);
    setShowConvertForm(false);
    setShowTicketForm(false);
    setShowOportunidadeForm(false);
    setTicketCreated(false);
    setShowLinkProspect(false);
    setConvMessages([]);
    // Pré-preenche com a assinatura do usuário (topo da mensagem)
    setReplyText(userSignature ? `-- ${userSignature}\n\n` : "");
    setReplyError(null);
    setEditingName(false);
    setLeadName(conv.lead?.name ?? "");
    setLeadNotes(conv.lead?.notes ?? "");
    setShowNotesPanel(false);
    setNewNote("");
    setAttendanceStatus(conv.lead?.attendanceStatus ?? null);
    setExpectedReturn(conv.lead?.expectedReturnAt ? new Date(conv.lead.expectedReturnAt).toISOString().slice(0, 16) : "");
    setShowAddCompany(false);
    setCompanySearch(""); setCompanyResults([]);
    setAddContactForm({ companyId: "", companyName: "", contactName: "", role: "CONTACT" });
    setShowMergePanel(false);
    setMergeSearch(""); setMergeResults([]);
    setOpenTicket(null);
    setShowActionsMenu(false);
    setShowAiPanel(false);
    setAiSummary(null);
    setAiIntent(null);
    setAiSuggestedReply(null);
    setLoadingMsgs(true);

    const params = new URLSearchParams({ phone: conv.phone });
    if (conv.companyId) params.set("companyId", conv.companyId);

    const ticketParams = new URLSearchParams({ phone: conv.phone, openOnly: "true" });
    if (conv.companyId) ticketParams.set("companyId", conv.companyId);

    const [msgsRes, campaignsRes, ticketsRes] = await Promise.all([
      fetch(`/api/whatsapp/messages?${params}`),
      fetch(`/api/campaigns?companyId=${conv.companyId}`),
      fetch(`/api/tickets?${ticketParams}`),
    ]);

    const msgs = await msgsRes.json();
    // Set forceScroll BEFORE updating convMessages so the useEffect sees it as true
    forceScrollRef.current = true;
    setConvMessages(msgs);

    // Para grupos: carregar nomes dos participantes
    if (conv.phone.includes("@g.us")) {
      // Normalize phones to "without country code" format (same as saved in CompanyContact.phone)
      const participantPhones = [...new Set(
        msgs.filter((m: any) => m.participantPhone).map((m: any) => {
          const raw = (m.participantPhone as string).replace("@s.whatsapp.net", "").replace(/\D/g, "");
          return raw.startsWith("55") && raw.length > 11 ? raw.slice(2) : raw;
        })
      )] as string[];
      loadParticipantContacts(participantPhones);
    }

    if (campaignsRes.ok) {
      const data = await campaignsRes.json();
      setCampaigns(data.campaigns ?? data);
    }
    if (ticketsRes.ok) {
      const tickets = await ticketsRes.json();
      setOpenTicket(tickets[0] ?? null);
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
        phone: selectedConv.phone,
      }),
    });
    setConvertingTicket(false);
    if (res.ok) {
      const newTicket = await res.json();
      setOpenTicket({ id: newTicket.id, title: newTicket.title, status: newTicket.status });
      setTicketCreated(true);
      setShowTicketForm(false);
      router.refresh();
    }
  }

  async function handleCreateOportunidade(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedConv) return;
    setConvertingOportunidade(true);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: selectedConv.phone,
        name: oportunidadeForm.name.trim() || selectedConv.lead?.name || null,
        value: oportunidadeForm.value ? parseFloat(oportunidadeForm.value.replace(",", ".")) : null,
        pipeline: "OPORTUNIDADES",
        source: "whatsapp",
        companyId: selectedConv.companyId,
      }),
    });
    setConvertingOportunidade(false);
    if (res.ok) {
      const newLead = await res.json();
      setSelectedConv({ ...selectedConv, lead: { ...newLead, notes: null } });
      setShowOportunidadeForm(false);
      setOportunidadeForm({ name: "", value: "" });
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

    const isGroup = selectedConv.phone.includes("@g.us");

    // Para grupos: usar a instância selecionada pelo usuário
    // Para individuais: usar a instância da última mensagem → conectada → qualquer
    const lastInstanceName =
      convMessages.length > 0 ? convMessages[convMessages.length - 1].instance?.instanceName : null;

    const inst = isGroup
      ? (instances.find((i) => i.id === groupInstanceId) ??
         instances.find((i) => i.status === "CONNECTED" && i.company?.id === selectedConv.companyId) ??
         instances.find((i) => i.company?.id === selectedConv.companyId))
      : ((lastInstanceName ? instances.find((i) => i.instanceName === lastInstanceName) : null) ??
         instances.find((i) => i.status === "CONNECTED" && i.company?.id === selectedConv.companyId) ??
         instances.find((i) => i.company?.id === selectedConv.companyId));

    if (!inst) {
      setReplyError("Nenhuma instância conectada. Configure em Configurações → Instâncias WhatsApp.");
      return;
    }

    setSendingReply(true);
    setReplyError(null);

    const payload: Record<string, unknown> = { phone: selectedConv.phone, text: replyText.trim() };
    if (replyingTo?.externalId) {
      payload.quotedExternalId = replyingTo.externalId;
      payload.quotedBody = replyingTo.body;
      payload.quotedFromMe = replyingTo.direction === "OUTBOUND";
    }

    const res = await fetch(`/api/whatsapp/${inst.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSendingReply(false);

    if (!res.ok) {
      const data = await res.json();
      setReplyError(data.error ?? "Erro ao enviar mensagem");
    } else {
      const data = await res.json();
      forceScrollRef.current = true; // sempre vai ao fundo ao enviar mensagem
      setConvMessages((prev) => [
        ...prev,
        data.message ?? {
          id: `tmp-${Date.now()}`,
          body: replyText.trim(),
          direction: "OUTBOUND",
          receivedAt: new Date().toISOString(),
          participantPhone: null,
          participantName: null,
          instance: { instanceName: inst.instanceName },
          campaign: null,
          ack: 0,
          quotedId: replyingTo?.externalId ?? null,
          quotedBody: replyingTo?.body ?? null,
        },
      ]);
      // Após enviar, limpa citação e volta à assinatura
      setReplyingTo(null);
      setReplyText(userSignature ? `-- ${userSignature}\n\n` : "");
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

  async function searchCompanies(q: string) {
    setSearchingCompany(true);
    const res = await fetch(`/api/companies?search=${encodeURIComponent(q)}`);
    if (res.ok) setCompanyResults(await res.json());
    setSearchingCompany(false);
  }

  async function handleAddAsContact() {
    if (!selectedConv || !addContactForm.companyId) return;
    setSavingContact(true);
    const res = await fetch(`/api/companies/${addContactForm.companyId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: selectedConv.phone,
        name: addContactForm.contactName || selectedConv.lead?.name || null,
        role: addContactForm.role,
        isGroup: false,
      }),
    });
    if (res.ok) {
      setShowAddCompany(false);
      setAddContactForm({ companyId: "", companyName: "", contactName: "", role: "CONTACT" });
      setCompanyResults([]);
      setCompanySearch("");
      router.refresh();
    } else {
      const err = await res.json();
      alert(err.error ?? "Erro ao adicionar contato");
    }
    setSavingContact(false);
  }

  async function quickResolve(e: React.MouseEvent, conv: Conversation) {
    e.stopPropagation();
    // Override imediato na sidebar antes do router.refresh()
    setLocalAttendanceOverrides(prev => new Map(prev).set(conv.phone, "RESOLVED"));
    if (!conv.lead) {
      // Sem lead: criar registro mínimo para rastrear atendimento
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: conv.phone, pipeline: null, source: "whatsapp", companyId: conv.companyId }),
      });
      if (res.ok) {
        const newLead = await res.json();
        await fetch(`/api/leads/${newLead.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendanceStatus: "RESOLVED" }),
        });
        if (selectedConv?.phone === conv.phone) {
          setAttendanceStatus("RESOLVED");
          setSelectedConv({ ...selectedConv!, lead: { id: newLead.id, name: newLead.name, status: newLead.status, notes: null, pipeline: null, pipelineStage: null, attendanceStatus: "RESOLVED", expectedReturnAt: null } });
        }
      }
      router.refresh();
      return;
    }
    await fetch(`/api/leads/${conv.lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendanceStatus: "RESOLVED" }),
    });
    // Atualiza estado local do selectedConv se for o aberto
    if (selectedConv?.phone === conv.phone) {
      setAttendanceStatus("RESOLVED");
      setSelectedConv({ ...selectedConv, lead: { ...selectedConv.lead!, attendanceStatus: "RESOLVED" } });
    }
    router.refresh();
  }

  function searchMergeTargets(q: string) {
    const lower = q.toLowerCase();
    const results = conversations
      .filter((c) => c.phone !== selectedConv?.phone)
      .filter((c) =>
        c.phone.includes(q) ||
        c.lead?.name?.toLowerCase().includes(lower) ||
        c.companyContact?.name?.toLowerCase().includes(lower)
      )
      .slice(0, 8)
      .map((c) => ({ phone: c.phone, name: c.companyContact?.name ?? c.lead?.name ?? null }));
    setMergeResults(results);
  }

  async function handleMerge(mergePhone: string) {
    if (!selectedConv) return;
    setMergingContacts(true);
    const res = await fetch("/api/whatsapp/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keepPhone: selectedConv.phone,
        mergePhone,
        companyId: selectedConv.companyId,
      }),
    });
    setMergingContacts(false);
    if (res.ok) {
      setShowMergePanel(false);
      setMergeSearch(""); setMergeResults([]);
      router.refresh();
    } else {
      const data = await res.json();
      alert(data.error ?? "Erro ao mesclar contatos");
    }
  }

  async function handleAiSummarize() {
    if (!selectedConv) return;
    setAiLoadingSummary(true);
    setAiSummary(null);
    setAiIntent(null);
    const params = new URLSearchParams({ phone: selectedConv.phone, companyId: selectedConv.companyId });
    try {
      const res = await fetch(`/api/ai/summarize?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAiSummary(data.summary ?? null);
        setAiIntent(data.intent ?? null);
      } else {
        const err = await res.json().catch(() => ({}));
        setAiSummary(err.error ?? "Erro ao gerar resumo. Verifique se a API Key da OpenAI está configurada.");
      }
    } catch {
      setAiSummary("Falha de conexão ao chamar a IA.");
    }
    setAiLoadingSummary(false);
  }

  async function handleAiSuggestReply() {
    if (!selectedConv) return;
    setAiLoadingReply(true);
    setAiSuggestedReply(null);
    const params = new URLSearchParams({ phone: selectedConv.phone, companyId: selectedConv.companyId });
    try {
      const res = await fetch(`/api/ai/suggest-reply?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAiSuggestedReply(data.reply ?? null);
      } else {
        const err = await res.json().catch(() => ({}));
        setAiSuggestedReply(err.error ?? "Erro ao gerar sugestão.");
      }
    } catch {
      setAiSuggestedReply("Falha de conexão ao chamar a IA.");
    }
    setAiLoadingReply(false);
  }

  async function handleSetAttendance(status: string) {
    if (!selectedConv) return;
    setSavingAttendance(true);
    setAttendanceStatus(status);
    // Atualiza sidebar imediatamente (antes do router.refresh() chegar)
    setLocalAttendanceOverrides(prev => new Map(prev).set(selectedConv.phone, status));

    if (!selectedConv.lead) {
      // Sem lead: criar registro mínimo para rastrear atendimento
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selectedConv.phone, pipeline: null, source: "whatsapp", companyId: selectedConv.companyId }),
      });
      if (res.ok) {
        const newLead = await res.json();
        const patchBody: any = { attendanceStatus: status };
        if (status === "SCHEDULED" && expectedReturn) patchBody.expectedReturnAt = new Date(expectedReturn).toISOString();
        await fetch(`/api/leads/${newLead.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
        setSelectedConv({ ...selectedConv, lead: { id: newLead.id, name: newLead.name, status: newLead.status, notes: null, pipeline: null, pipelineStage: null, attendanceStatus: status, expectedReturnAt: status === "SCHEDULED" && expectedReturn ? expectedReturn : null } });
      }
      setSavingAttendance(false);
      router.refresh();
      return;
    }

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
    const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86_400_000);
    const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const dayStart  = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (dayStart >= today)     return time;
    if (dayStart >= yesterday) return `ontem ${time}`;
    const daysAgo = Math.round((today.getTime() - dayStart.getTime()) / 86_400_000);
    if (daysAgo < 7) {
      const weekday = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
      return `${weekday} ${time}`;
    }
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + time;
  }

  function formatDateDivider(dt: string) {
    const d = new Date(dt);
    const now = new Date();
    const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86_400_000);
    const dayStart  = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (dayStart >= today)     return "Hoje";
    if (dayStart >= yesterday) return "Ontem";
    return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  }

  // Anel de urgência no avatar — cor por tempo sem resposta + prioridade do pipeline
  function getUrgencyRing(conv: Conversation): { ring: string; icon: string; pulse: boolean } {
    const isInbound = conv.lastMsg?.direction === "INBOUND";
    const pipeline  = conv.lead?.pipeline;
    // Usa override local para refletir mudança imediatamente antes do router.refresh()
    const status    = localAttendanceOverrides.get(conv.phone) ?? conv.lead?.attendanceStatus;

    // Resolvido / Em Atendimento / Agendado → anel de status, sem urgência
    if (status === "RESOLVED")    return { ring: "ring-1 ring-green-600/50",  icon: "✅", pulse: false };
    if (status === "IN_PROGRESS") return { ring: "ring-2 ring-blue-500",      icon: "💬", pulse: false };
    if (status === "SCHEDULED")   return { ring: "ring-2 ring-purple-500/70", icon: "📅", pulse: false };

    // Prospecção: nós quem contactamos — só urgente se ELE respondeu (INBOUND)
    if (pipeline === "PROSPECCAO" && !isInbound) return { ring: "ring-1 ring-white/5", icon: "", pulse: false };

    // Sem mensagem recebida = sem urgência
    if (!isInbound) return { ring: "ring-1 ring-white/5", icon: "", pulse: false };

    // Calcula minutos aguardando
    const mins = Math.floor((Date.now() - new Date(conv.lastMsg!.receivedAt).getTime()) / 60_000);

    // Oportunidades: thresholds mais curtos (mais urgente)
    const yellowAt = pipeline === "OPORTUNIDADES" ? 3 : 5;
    const redAt    = pipeline === "OPORTUNIDADES" ? 10 : 20;

    if (mins >= redAt)    return { ring: "ring-2 ring-red-500",    icon: "⏳", pulse: true  };
    if (mins >= yellowAt) return { ring: "ring-2 ring-yellow-500", icon: "⏳", pulse: false };
    return                       { ring: "ring-2 ring-green-500",  icon: "⏳", pulse: false };
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
            <button
              onClick={() => { setShowNewConv(!showNewConv); setNewConvError(null); }}
              title="Nova conversa"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${showNewConv ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#0f1623] border-[#1e2d45] text-slate-300 hover:text-white hover:border-slate-500"}`}
            >
              ✉️ Nova
            </button>
            <Link
              href="/configuracoes?secao=instancias"
              className="px-3 py-1.5 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 hover:text-white text-xs transition-colors"
            >
              ⚙️ Instâncias
            </Link>
          </div>
        </div>
      </div>

      {/* Formulário Nova Conversa */}
      {showNewConv && (
        <div className="mx-6 mt-3 flex-shrink-0 bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4">
          <p className="text-indigo-300 text-xs font-semibold mb-3">✉️ Iniciar nova conversa</p>
          <form onSubmit={handleNewConv} className="space-y-2">
            <input
              autoFocus
              type="text"
              value={newConvPhone}
              onChange={(e) => setNewConvPhone(e.target.value)}
              placeholder="Telefone (ex: 55119...)"
              className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
            <textarea
              value={newConvMsg}
              onChange={(e) => setNewConvMsg(e.target.value)}
              placeholder="Mensagem..."
              rows={2}
              className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
            />
            {instances.length > 1 && (
              <select
                value={newConvInstanceId}
                onChange={(e) => setNewConvInstanceId(e.target.value)}
                className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Instância automática (conectada)</option>
                {instances.filter((i) => i.status === "CONNECTED").map((i) => (
                  <option key={i.id} value={i.id}>{i.instanceName}</option>
                ))}
              </select>
            )}
            {newConvError && <p className="text-red-400 text-xs">{newConvError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={sendingNewConv || !newConvPhone.trim() || !newConvMsg.trim()}
                className="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
              >
                {sendingNewConv ? "Enviando..." : "Enviar →"}
              </button>
              <button
                type="button"
                onClick={() => { setShowNewConv(false); setNewConvPhone(""); setNewConvMsg(""); setNewConvError(null); }}
                className="px-3 py-1.5 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 text-xs hover:text-white transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

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

          {/* ── Busca + botão de filtro ── */}
          <div className="px-3 pt-3 pb-2 flex-shrink-0">
            <div className="flex gap-2">
              {/* Campo de busca */}
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="flex-1 min-w-0 bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />

              {/* Botão filtro */}
              {(() => {
                const hasFilter = !!(statusFilter || instanceFilter || hideGroups);
                const activeCount = (statusFilter ? 1 : 0) + (instanceFilter ? 1 : 0) + (hideGroups ? 1 : 0);
                return (
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    title="Filtros"
                    className={`relative flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      showFilters || hasFilter
                        ? "bg-indigo-600 text-white"
                        : "bg-[#0f1623] border border-[#1e2d45] text-slate-400 hover:text-white hover:border-slate-600"
                    }`}
                  >
                    {/* Ícone funil SVG */}
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M1.5 2A.5.5 0 0 1 2 1.5h12a.5.5 0 0 1 .354.854l-4.5 4.5A.5.5 0 0 1 9.5 7v5.5a.5.5 0 0 1-.276.447l-3 1.5A.5.5 0 0 1 5.5 14V7a.5.5 0 0 1-.146-.354l-4.5-4.5A.5.5 0 0 1 1.5 2z"/>
                    </svg>
                    {/* Badge de filtros ativos */}
                    {activeCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
                        {activeCount}
                      </span>
                    )}
                  </button>
                );
              })()}
            </div>

            {/* Painel de filtros — abre/fecha */}
            {showFilters && (
              <div className="mt-2 bg-[#0c1220] border border-[#1e2d45] rounded-xl overflow-hidden">

                {/* Status de atendimento */}
                <div className="px-3 pt-3 pb-2">
                  <p className="text-slate-600 text-[9px] font-semibold uppercase tracking-widest mb-2">Atendimento</p>
                  <div className="grid grid-cols-2 gap-1">
                    {([
                      { key: "",           label: "Todos",       icon: "💬", dim: "text-slate-400" },
                      { key: "URGENT",     label: "Urgente",     icon: "🔴", dim: "text-red-400",    count: filterCounts.URGENT },
                      { key: "UNANSWERED", label: "Sem resposta",icon: "⏳", dim: "text-yellow-400", count: filterCounts.UNANSWERED },
                      { key: "IN_PROGRESS",label: "Em atend.",   icon: "💬", dim: "text-blue-400",   count: filterCounts.IN_PROGRESS },
                      { key: "RESOLVED",   label: "Resolvidos",  icon: "✅", dim: "text-green-400",  count: filterCounts.RESOLVED },
                      { key: "SCHEDULED",  label: "Agendados",   icon: "📅", dim: "text-purple-400", count: filterCounts.SCHEDULED },
                      { key: "CLIENTS",    label: "Clientes",    icon: "⭐", dim: "text-amber-400",  count: filterCounts.CLIENTS },
                      { key: "NO_LEAD",    label: "Entrada",     icon: "📥", dim: "text-slate-400",  count: filterCounts.NO_LEAD },
                    ]).map(({ key, label, icon, dim, count }) => {
                      const isActive = statusFilter === key;
                      return (
                        <button
                          key={key}
                          onClick={() => setStatusFilter(key)}
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                            isActive
                              ? "bg-indigo-600 text-white"
                              : "hover:bg-white/5 text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          <span className="text-[12px]">{icon}</span>
                          <span className={`flex-1 text-left ${isActive ? "text-white" : dim}`}>{label}</span>
                          {count !== undefined && count > 0 && (
                            <span className={`text-[9px] font-bold px-1 rounded-full ${isActive ? "bg-white/20 text-white" : "bg-white/8 text-slate-500"}`}>
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Instâncias */}
                {conversationInstances.length > 0 && (
                  <div className="px-3 pb-3 border-t border-[#1e2d45] pt-2">
                    <p className="text-slate-600 text-[9px] font-semibold uppercase tracking-widest mb-2">Instância WhatsApp</p>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => setInstanceFilter("")}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                          instanceFilter === "" ? "bg-indigo-600 text-white" : "hover:bg-white/5 text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        <span>📱</span>
                        <span>Todas as instâncias</span>
                      </button>
                      {conversationInstances.map((name) => (
                        <button
                          key={name}
                          onClick={() => setInstanceFilter(instanceFilter === name ? "" : name)}
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                            instanceFilter === name ? "bg-indigo-600 text-white" : "hover:bg-white/5 text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${instanceFilter === name ? "bg-white" : "bg-slate-600"}`} />
                          <span>{name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ocultar grupos */}
                <div className="px-3 pb-3 border-t border-[#1e2d45] pt-2">
                  <p className="text-slate-600 text-[9px] font-semibold uppercase tracking-widest mb-2">Grupos</p>
                  <button
                    onClick={toggleHideGroups}
                    className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                      hideGroups
                        ? "bg-indigo-600 text-white"
                        : "hover:bg-white/5 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    <span className="text-[12px]">👥</span>
                    <span className="flex-1 text-left">Ocultar grupos</span>
                    <span className={`w-7 h-4 rounded-full flex items-center transition-colors ${hideGroups ? "bg-indigo-400" : "bg-slate-700"}`}>
                      <span className={`w-3 h-3 rounded-full bg-white shadow transition-transform mx-0.5 ${hideGroups ? "translate-x-3" : "translate-x-0"}`} />
                    </span>
                  </button>
                </div>

                {/* Rodapé com limpar */}
                {(statusFilter || instanceFilter || hideGroups) && (
                  <div className="px-3 py-2 border-t border-[#1e2d45] flex items-center justify-between">
                    <span className="text-slate-600 text-[10px]">
                      {filteredConvs.length} de {conversations.length}
                    </span>
                    <button
                      onClick={() => { setStatusFilter(""); setInstanceFilter(""); setHideGroups(false); localStorage.setItem("wa_hide_groups", "0"); }}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium"
                    >
                      Limpar filtros ✕
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Indicador compacto de filtro ativo (quando painel fechado) */}
            {!showFilters && (statusFilter || instanceFilter || hideGroups) && (
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-slate-600 text-[10px]">
                  {filteredConvs.length} de {conversations.length} conversas
                  {hideGroups && <span className="ml-1 text-indigo-400">· sem grupos</span>}
                </span>
                <button
                  onClick={() => { setStatusFilter(""); setInstanceFilter(""); setHideGroups(false); localStorage.setItem("wa_hide_groups", "0"); }}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300"
                >
                  Limpar ✕
                </button>
              </div>
            )}
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
                const { ring, icon, pulse } = getUrgencyRing(conv);
                // Grupos: verificar se aguarda resposta nossa (último INBOUND de participante não-instância)
                const isGroupConvItem = conv.phone.includes("@g.us");
                const groupWaiting = isGroupConvItem && conv.lastMsg?.direction === "INBOUND" && (() => {
                  const p = resolveParticipant(conv.lastMsg?.participantPhone ?? null);
                  return p ? !p.isOurs : false;
                })();
                return (
                  <div
                    key={conv.phone}
                    className={`relative group/item w-full text-left px-4 py-3 hover:bg-white/[0.03] transition-colors cursor-pointer border-l-2 ${
                      isSelected
                        ? "bg-indigo-500/10 border-l-indigo-500"
                        : "border-l-transparent"
                    }`}
                    onClick={() => loadConversation(conv)}
                  >
                    {/* Botão rápido: Resolvido (aparece no hover quando não resolvido e última msg é inbound) */}
                    {conv.lastMsg?.direction === "INBOUND" && conv.lead?.attendanceStatus !== "RESOLVED" && (
                      <button
                        onClick={(e) => quickResolve(e, conv)}
                        title="Marcar como resolvido"
                        className="absolute top-2 right-2 opacity-0 group-hover/item:opacity-100 transition-opacity z-10 w-6 h-6 rounded-full bg-green-500/20 border border-green-500/40 text-green-400 hover:bg-green-500/40 text-[11px] flex items-center justify-center"
                      >
                        ✅
                      </button>
                    )}

                        {/* Linha 1: avatar-col + nome + horário */}
                        <div className="flex items-start justify-between mb-1">
                          <div className="flex items-start gap-2.5 min-w-0">

                            {/* Avatar: anel colorido de urgência + ícone de status abaixo */}
                            <div className="flex flex-col items-center gap-0.5 flex-shrink-0 w-8">
                              <div className={`w-8 h-8 rounded-full bg-[#1e2d45] flex items-center justify-center text-[11px] font-bold text-slate-300 ${ring} ${pulse ? "animate-pulse" : ""}`}>
                                {conv.phone.slice(-2)}
                              </div>
                              {icon && (
                                <span className="text-[11px] leading-none select-none">{icon}</span>
                              )}
                            </div>

                            {/* Nome + telefone */}
                            <div className="min-w-0 pt-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-white text-[13px] font-semibold truncate leading-tight">
                                  {groupNameOverrides[conv.phone] ?? conv.companyContact?.name ?? conv.lead?.name ?? conv.phone}
                                </span>
                                        {conv.phone.includes("@g.us") && (
                                  <span title="Grupo" className="text-slate-400 text-[11px] flex-shrink-0">👥</span>
                                )}
                                {groupWaiting && (
                                  <span title="Aguardando resposta" className="text-yellow-400 text-[11px] flex-shrink-0">⏳</span>
                                )}
                                {conv.companyContact && (
                                  <span title={`Cliente: ${conv.companyContact.company.name}`} className="text-amber-400 text-[11px] flex-shrink-0">⭐</span>
                                )}
                              </div>
                              {(conv.lead?.name || conv.companyContact?.name) && !conv.phone.includes("@g.us") && (
                                <div className="text-slate-600 text-[10px] leading-tight">{conv.phone}</div>
                              )}
                              {conv.companyContact && (
                                <div className="text-amber-400/70 text-[10px] leading-tight truncate">
                                  🏢 {conv.companyContact.company.name}
                                </div>
                              )}
                              {conv.phone.includes("@g.us") && !conv.companyContact && (
                                <div className="text-slate-700 text-[10px] leading-tight">Sem empresa</div>
                              )}
                            </div>
                          </div>

                          <span className="text-slate-600 text-[10px] flex-shrink-0 ml-2 pt-0.5">
                            {conv.lastMsg ? formatTime(conv.lastMsg.receivedAt) : ""}
                          </span>
                        </div>

                        {/* Linha 2: prévia da mensagem */}
                        {conv.lastMsg && (() => {
                          const MEDIA_PFX = ["🎵","🎤","🖼️","🎥","📎","😄","📍","👤"];
                          const isMed = MEDIA_PFX.some(p => conv.lastMsg!.body?.startsWith(p));
                          const isGroupItem = conv.phone.includes("@g.us");

                          // Para grupos: descobre quem enviou a última mensagem
                          let senderPrefix = "";
                          let senderColor = "text-slate-500";
                          if (isGroupItem) {
                            if (conv.lastMsg.direction === "OUTBOUND") {
                              senderPrefix = "→ Você: ";
                            } else {
                              const participant = resolveParticipant(conv.lastMsg.participantPhone ?? null);
                              if (participant?.isOurs) {
                                senderPrefix = `→ ${participant.label}: `;
                                senderColor = "text-indigo-400/80";
                              } else if (participant) {
                                senderPrefix = `${participant.label}: `;
                                senderColor = groupWaiting ? "text-yellow-500/80" : "text-slate-400";
                              }
                            }
                          } else if (conv.lastMsg.direction === "OUTBOUND") {
                            senderPrefix = "→ ";
                          }

                          return (
                            <div className={`text-[11px] truncate pl-[42px] ${isMed ? "text-slate-600 italic" : "text-slate-500"}`}>
                              {senderPrefix && (
                                <span className={`font-medium ${senderColor}`}>{senderPrefix}</span>
                              )}
                              {conv.lastMsg.body}
                            </div>
                          );
                        })()}

                        {/* Linha 3: pipeline + instância (sem badge de atendimento — está no ícone do avatar) */}
                        <div className="flex items-center gap-1.5 mt-1.5 pl-[42px] flex-wrap">
                          {conv.lead?.pipeline ? (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PIPELINE_BADGE[conv.lead.pipeline] ?? "text-slate-400 bg-white/5"}`}>
                              {PIPELINE_LABEL[conv.lead.pipeline] ?? conv.lead.pipeline}
                              {conv.lead.pipelineStage ? ` · ${conv.lead.pipelineStage}` : ""}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-600 bg-white/5 px-1.5 py-0.5 rounded-full">Sem tipo</span>
                          )}
                          {instanceName && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${getInstanceBadgeColor(instanceName)}`}>
                              {instanceName}
                            </span>
                          )}
                        </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Conversation detail */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
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
                          {groupNameOverrides[selectedConv.phone] ?? selectedConv.companyContact?.name ?? selectedConv.lead?.name ?? selectedConv.phone}
                        </span>
                        {/* Refresh nome do grupo */}
                        {selectedConv.phone.includes("@g.us") && (
                          <button
                            onClick={async () => {
                              setRefreshingGroupName(true);
                              try {
                                const res = await fetch("/api/whatsapp/group-name", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ groupJid: selectedConv.phone, companyId: selectedConv.companyId }),
                                });
                                if (res.ok) {
                                  const { name } = await res.json();
                                  // Atualiza o mapa local — lista da esquerda + cabeçalho sem router.refresh()
                                  setGroupNameOverrides((prev) => ({ ...prev, [selectedConv.phone]: name }));
                                } else {
                                  const d = await res.json().catch(() => ({}));
                                  alert(d.error ?? "Não foi possível buscar o nome do grupo");
                                }
                              } catch {
                                alert("Erro de conexão ao buscar nome do grupo");
                              } finally {
                                setRefreshingGroupName(false);
                              }
                            }}
                            disabled={refreshingGroupName}
                            className="text-slate-600 hover:text-slate-300 text-xs flex-shrink-0 disabled:animate-spin disabled:opacity-50"
                            title="Atualizar nome do grupo"
                          >
                            🔄
                          </button>
                        )}
                        {!selectedConv.phone.includes("@g.us") && (
                        <button
                          onClick={() => { setLeadName(selectedConv.lead?.name ?? ""); setEditingName(true); }}
                          className="text-slate-600 hover:text-slate-400 text-xs flex-shrink-0"
                          title="Editar nome"
                        >
                          ✏️
                        </button>
                        )}
                      </div>
                      {(selectedConv.companyContact?.name || selectedConv.lead?.name) && !selectedConv.phone.includes("@g.us") && (
                        <div className="text-slate-500 text-xs">{selectedConv.phone}</div>
                      )}
                      {/* Grupo: lista de participantes únicos */}
                      {selectedConv.phone.includes("@g.us") && convMessages.length > 0 && (() => {
                        const unique = new Map<string, ReturnType<typeof resolveParticipant>>();
                        for (const m of convMessages) {
                          if (m.participantPhone && !unique.has(m.participantPhone)) {
                            unique.set(m.participantPhone, resolveParticipant(m.participantPhone, m.participantName));
                          }
                        }
                        const list = [...unique.values()].filter(Boolean) as NonNullable<ReturnType<typeof resolveParticipant>>[];
                        const ours = list.filter(p => p.isOurs);
                        const clients = list.filter(p => !p.isOurs);
                        return (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {ours.map(p => (
                              <span key={p.rawNorm} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 ${getInstanceBadgeColor(p.label).split(" ").filter(c => c.startsWith("text-")).join(" ")}`} title={p.rawNorm}>
                                📤 {p.label}
                              </span>
                            ))}
                            {clients.map(p => (
                              <button
                                key={p.rawNorm}
                                onClick={() => handleOpenParticipantEdit(p.rawNorm)}
                                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 hover:border-white/20 transition-colors ${getParticipantColor(p.rawNorm)}`}
                                title="Clique para nomear"
                              >
                                👤 {p.label}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Direita: pills de status + menu ações */}
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">

                  {/* ── Pills de status (o que o contato É) ── */}
                  {/* Helpers */}
                  {(() => {
                    const isLeadInFinalStage = !!(selectedConv.lead?.pipelineStage && finalStageNames.includes(selectedConv.lead.pipelineStage));
                    const isTicketFinal = openTicket?.status === "RESOLVED" || openTicket?.status === "CLOSED";
                    return (
                      <>
                        {/* Cliente vinculado → link para empresa */}
                        {selectedConv.companyContact && (
                          <Link
                            href={`/empresas/${selectedConv.companyContact.company.id}`}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                          >
                            ⭐ {selectedConv.companyContact.company.name}
                          </Link>
                        )}

                        {/* Pipeline → link para CRM (oculto se em etapa final) */}
                        {selectedConv.lead?.pipeline && selectedConv.lead?.id && !isLeadInFinalStage && (
                          <Link
                            href={`/crm/${selectedConv.lead.pipeline === "LEADS" ? "leads" : selectedConv.lead.pipeline === "OPORTUNIDADES" ? "oportunidades" : "prospeccao"}?lead=${selectedConv.lead.id}`}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-transparent hover:opacity-80 transition-opacity ${PIPELINE_BADGE[selectedConv.lead.pipeline] ?? "text-slate-400 bg-white/5"}`}
                          >
                            {PIPELINE_LABEL[selectedConv.lead.pipeline] ?? selectedConv.lead.pipeline}
                            {selectedConv.lead.pipelineStage ? ` · ${selectedConv.lead.pipelineStage}` : ""}
                            <span className="ml-0.5 opacity-50 text-[10px]">↗</span>
                          </Link>
                        )}

                        {/* Pill de etapa final (concluído/perdido) — clique para ver no CRM */}
                        {selectedConv.lead?.pipeline && selectedConv.lead?.id && isLeadInFinalStage && (
                          <Link
                            href={`/crm/${selectedConv.lead.pipeline === "LEADS" ? "leads" : selectedConv.lead.pipeline === "OPORTUNIDADES" ? "oportunidades" : "prospeccao"}?lead=${selectedConv.lead.id}`}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-slate-700/50 text-slate-500 bg-white/3 hover:opacity-80 transition-opacity line-through"
                            title="Concluído — clique para ver"
                          >
                            {PIPELINE_LABEL[selectedConv.lead.pipeline] ?? selectedConv.lead.pipeline}
                            {selectedConv.lead.pipelineStage ? ` · ${selectedConv.lead.pipelineStage}` : ""}
                          </Link>
                        )}

                        {/* Chamado aberto → link (oculto se resolvido/fechado) */}
                        {openTicket && !isTicketFinal && (
                          <Link
                            href={`/chamados/${openTicket.id}`}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-orange-400 bg-orange-500/10 border border-orange-500/20 hover:bg-orange-500/20 transition-colors max-w-[180px]"
                            title={openTicket.title}
                          >
                            🎫 <span className="truncate">{openTicket.title.length > 20 ? openTicket.title.slice(0, 20) + "…" : openTicket.title}</span>
                            <span className="ml-0.5 opacity-50 text-[10px]">↗</span>
                          </Link>
                        )}

                        {/* Chamado encerrado: não exibe pill — "Abrir Chamado" fica disponível no menu + Ações */}
                      </>
                    );
                  })()}

                  {ticketCreated && !openTicket && (
                    <span className="text-green-400 text-xs">✓ Chamado criado!</span>
                  )}
                </div>
              </div>


              {/* Painel IA */}
              {showAiPanel && (
                <div className="px-5 py-4 border-b border-[#1e2d45] bg-emerald-500/5 flex-shrink-0">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-emerald-300 text-xs font-semibold">🤖 Assistente IA — últimas 24h</p>
                    <button onClick={() => setShowAiPanel(false)} className="text-slate-600 hover:text-slate-300 text-xs">✕</button>
                  </div>

                  {/* Botões de ação */}
                  <div className="flex gap-2 mb-3 flex-wrap">
                    <button
                      onClick={handleAiSummarize}
                      disabled={aiLoadingSummary || aiLoadingReply}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-xs font-medium hover:bg-emerald-600/30 disabled:opacity-50 transition-colors"
                    >
                      {aiLoadingSummary ? "Resumindo..." : "📋 Resumir conversa"}
                    </button>
                    <button
                      onClick={handleAiSuggestReply}
                      disabled={aiLoadingReply || aiLoadingSummary}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-xs font-medium hover:bg-indigo-600/30 disabled:opacity-50 transition-colors"
                    >
                      {aiLoadingReply ? "Gerando..." : "💡 Sugerir resposta"}
                    </button>
                  </div>

                  {/* Resultado: Resumo */}
                  {aiSummary && (
                    <div className="mb-3">
                      <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-wide mb-1.5">Resumo</p>
                      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3 text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">
                        {aiSummary}
                      </div>
                      {aiIntent && (
                        <p className="text-slate-600 text-[10px] mt-1.5">
                          💡 Intenção: <span className="text-emerald-400 font-medium">{aiIntent}</span>
                        </p>
                      )}
                      {/* Ações rápidas baseadas no resumo */}
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        <button
                          onClick={() => { setShowConvertForm(true); setShowAiPanel(false); }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/20 text-blue-300 text-[10px] font-medium hover:bg-blue-500/25 transition-colors"
                        >
                          🎯 Criar Lead
                        </button>
                        <button
                          onClick={() => { setShowOportunidadeForm(true); setShowAiPanel(false); }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/20 text-amber-300 text-[10px] font-medium hover:bg-amber-500/25 transition-colors"
                        >
                          💰 Criar Oportunidade
                        </button>
                        <button
                          onClick={() => {
                            setTicketForm((prev) => ({ ...prev, description: aiSummary ?? "" }));
                            setShowTicketForm(true);
                            setShowAiPanel(false);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-500/15 border border-orange-500/20 text-orange-300 text-[10px] font-medium hover:bg-orange-500/25 transition-colors"
                        >
                          🎫 Abrir Chamado
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Resultado: Sugestão de resposta */}
                  {aiSuggestedReply && (
                    <div>
                      <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-wide mb-1.5">Sugestão de resposta</p>
                      <div className="bg-[#0f1623] border border-indigo-500/30 rounded-lg p-3 text-slate-200 text-xs leading-relaxed whitespace-pre-wrap">
                        {aiSuggestedReply}
                      </div>
                      <button
                        onClick={() => {
                          setReplyText(aiSuggestedReply);
                          setShowAiPanel(false);
                          setTimeout(() => replyTextareaRef.current?.focus(), 100);
                        }}
                        className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-xs font-medium hover:bg-indigo-600/30 transition-colors"
                      >
                        ✏️ Usar como resposta
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Painel: Atribuir grupo a empresa */}
              {showGroupCompany && selectedConv.phone.includes("@g.us") && (
                <div className="px-5 py-4 border-b border-[#1e2d45] bg-indigo-500/5 flex-shrink-0">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-indigo-300 text-xs font-semibold">
                      🏢 {selectedConv.companyContact ? `Empresa atual: ${selectedConv.companyContact.company.name}` : "Atribuir grupo a uma empresa"}
                    </p>
                    <button onClick={() => { setShowGroupCompany(false); setGroupCompanySearch(""); setGroupCompanyResults([]); setAssignGroupError(null); }} className="text-slate-600 hover:text-slate-300 text-xs">✕</button>
                  </div>

                  {/* Campo de busca */}
                  <div className="flex gap-2 mb-2">
                    <input
                      autoFocus
                      type="text"
                      value={groupCompanySearch}
                      onChange={(e) => {
                        setGroupCompanySearch(e.target.value);
                        setAssignGroupError(null);
                        if (e.target.value.length >= 1) searchGroupCompanies(e.target.value);
                        else setGroupCompanyResults([]);
                      }}
                      placeholder="Digite o nome da empresa..."
                      className="flex-1 bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    />
                    {searchingGroupCompany && <span className="text-slate-500 text-xs self-center px-1">...</span>}
                  </div>

                  {/* Resultados */}
                  {groupCompanyResults.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {groupCompanyResults.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => handleAssignGroupCompany(c.id)}
                          disabled={assigningGroupCompany || creatingGroupCompany}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#0f1623] border border-[#1e2d45] hover:border-indigo-500/60 text-left transition-colors disabled:opacity-50"
                        >
                          <div>
                            <div className="text-white text-xs font-medium">{c.name}</div>
                            {c.segment && <div className="text-slate-500 text-[10px]">{c.segment}</div>}
                          </div>
                          <span className="text-indigo-400 text-xs flex-shrink-0 ml-2">
                            {assigningGroupCompany ? "..." : "Selecionar →"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Nenhum resultado → oferecer criar */}
                  {groupCompanySearch.trim().length >= 1 && groupCompanyResults.length === 0 && !searchingGroupCompany && (
                    <div className="mt-1 p-3 rounded-lg bg-[#0f1623] border border-dashed border-[#1e2d45]">
                      <p className="text-slate-500 text-xs mb-2">
                        Nenhuma empresa encontrada para <span className="text-white">"{groupCompanySearch}"</span>
                      </p>
                      <button
                        onClick={() => handleCreateAndAssignCompany(groupCompanySearch)}
                        disabled={creatingGroupCompany || assigningGroupCompany}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
                      >
                        {creatingGroupCompany ? "Criando..." : `➕ Criar empresa "${groupCompanySearch}"`}
                      </button>
                    </div>
                  )}

                  {/* Erro */}
                  {assignGroupError && (
                    <p className="text-red-400 text-xs mt-2">{assignGroupError}</p>
                  )}
                </div>
              )}

              {/* Painel: Adicionar como contato de empresa */}
              {showAddCompany && !selectedConv.companyContact && (
                <div className="px-5 py-4 border-b border-[#1e2d45] bg-amber-500/5 flex-shrink-0">
                  <p className="text-amber-400 text-xs font-semibold mb-3">⭐ Vincular como cliente de uma empresa</p>

                  {!addContactForm.companyId ? (
                    /* Passo 1: buscar empresa */
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          type="text"
                          value={companySearch}
                          onChange={(e) => { setCompanySearch(e.target.value); if (e.target.value.length >= 1) searchCompanies(e.target.value); }}
                          placeholder="Buscar empresa pelo nome..."
                          className="flex-1 bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                        />
                        {searchingCompany && <span className="text-slate-500 text-xs self-center">...</span>}
                      </div>
                      {companyResults.length > 0 && (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {companyResults.map((co) => (
                            <button
                              key={co.id}
                              onClick={() => setAddContactForm({ ...addContactForm, companyId: co.id, companyName: co.name })}
                              className="w-full text-left flex items-center gap-2 bg-[#0f1623] border border-[#1e2d45] hover:border-amber-500/40 rounded-lg px-3 py-2 transition-colors"
                            >
                              <span className="text-lg">🏢</span>
                              <div>
                                <div className="text-white text-xs font-semibold">{co.name}</div>
                                {co.segment && <div className="text-slate-500 text-[10px]">{co.segment}</div>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {companySearch.trim().length >= 1 && !searchingCompany && companyResults.length === 0 && (
                        <div className="space-y-1">
                          <p className="text-slate-600 text-xs">
                            Nenhuma empresa encontrada para <span className="text-white">"{companySearch}"</span>.
                          </p>
                          <button
                            type="button"
                            onClick={() => handleCreateCompanyForContact(companySearch)}
                            disabled={creatingContactCompany}
                            className="w-full text-left flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 hover:border-amber-400/60 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
                          >
                            <span className="text-lg">➕</span>
                            <span className="text-amber-300 text-xs font-semibold">
                              {creatingContactCompany ? "Criando..." : `Criar empresa "${companySearch}"`}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Passo 2: configurar contato */
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        <span className="text-base">🏢</span>
                        <span className="text-amber-300 text-sm font-semibold flex-1">{addContactForm.companyName}</span>
                        <button onClick={() => setAddContactForm({ ...addContactForm, companyId: "", companyName: "" })} className="text-slate-500 hover:text-white text-xs">✕</button>
                      </div>
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="block text-slate-500 text-[10px] uppercase tracking-wide mb-1">Nome do contato</label>
                          <input
                            type="text"
                            value={addContactForm.contactName}
                            onChange={(e) => setAddContactForm({ ...addContactForm, contactName: e.target.value })}
                            placeholder={selectedConv.lead?.name ?? selectedConv.phone}
                            className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-500 text-[10px] uppercase tracking-wide mb-1">Papel</label>
                          <select
                            value={addContactForm.role}
                            onChange={(e) => setAddContactForm({ ...addContactForm, role: e.target.value })}
                            className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-amber-500"
                          >
                            <option value="CONTACT">👤 Contato</option>
                            <option value="DECISION_MAKER">🎯 Decisor</option>
                            <option value="TECHNICAL">🔧 Técnico</option>
                            <option value="FINANCIAL">💰 Financeiro</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleAddAsContact}
                          disabled={savingContact}
                          className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-50"
                        >
                          {savingContact ? "Salvando..." : "⭐ Confirmar como cliente"}
                        </button>
                        <button onClick={() => setShowAddCompany(false)} className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-400 text-xs hover:text-white">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
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

              {/* Form: Criar Oportunidade */}
              {showOportunidadeForm && (
                <div className="px-5 py-3.5 border-b border-[#1e2d45] bg-amber-500/5 flex-shrink-0">
                  <p className="text-amber-400 text-xs font-semibold mb-3">💰 Criar Oportunidade</p>
                  <form onSubmit={handleCreateOportunidade} className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-slate-400 text-[10px] uppercase tracking-wide mb-1">Nome</label>
                      <input
                        type="text"
                        value={oportunidadeForm.name}
                        onChange={(e) => setOportunidadeForm({ ...oportunidadeForm, name: e.target.value })}
                        placeholder={selectedConv.lead?.name ?? "Nome (opcional)"}
                        className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-[10px] uppercase tracking-wide mb-1">Valor (R$)</label>
                      <input
                        type="text"
                        value={oportunidadeForm.value}
                        onChange={(e) => setOportunidadeForm({ ...oportunidadeForm, value: e.target.value })}
                        placeholder="Opcional"
                        className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 w-28"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" disabled={convertingOportunidade} className="px-4 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-500 disabled:opacity-50 transition-colors">
                        {convertingOportunidade ? "Criando..." : "💰 Criar Oportunidade"}
                      </button>
                      <button type="button" onClick={() => setShowOportunidadeForm(false)} className="px-3 py-1.5 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 text-sm hover:text-white transition-colors">
                        Cancelar
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Painel: Mesclar contatos */}
              {showMergePanel && selectedConv.lead && (
                <div className="px-5 py-3.5 border-b border-[#1e2d45] bg-cyan-500/5 flex-shrink-0">
                  <p className="text-cyan-400 text-xs font-semibold mb-1">🔗 Mesclar com contato duplicado</p>
                  <p className="text-slate-500 text-[10px] mb-3">
                    Busque a conversa duplicada. Todas as mensagens serão unificadas neste contato ({selectedConv.phone}) e o duplicado será removido.
                  </p>
                  <div className="flex gap-2 mb-3">
                    <input
                      autoFocus
                      type="text"
                      value={mergeSearch}
                      onChange={(e) => { setMergeSearch(e.target.value); searchMergeTargets(e.target.value); }}
                      placeholder="Buscar por nome ou telefone..."
                      className="flex-1 bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  {mergeResults.length > 0 && (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {mergeResults.map((r) => (
                        <div key={r.phone} className="flex items-center justify-between bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2">
                          <div>
                            <div className="text-white text-xs font-semibold">{r.name ?? "Sem nome"}</div>
                            <div className="text-slate-500 text-[10px] font-mono">{r.phone}</div>
                          </div>
                          <button
                            onClick={() => handleMerge(r.phone)}
                            disabled={mergingContacts}
                            className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
                          >
                            {mergingContacts ? "..." : "Mesclar"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {mergeSearch && mergeResults.length === 0 && (
                    <p className="text-slate-600 text-xs text-center py-2">Nenhum contato encontrado.</p>
                  )}
                </div>
              )}

              {/* Messages */}
              {/* Botão flutuante: rolar para o final */}
              {showScrollBtn && (
                <div className="absolute bottom-[80px] right-6 z-20">
                  <button
                    onClick={() => { forceScrollRef.current = true; scrollToBottom(true); }}
                    className="w-9 h-9 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg flex items-center justify-center text-base transition-colors"
                    title="Ir para o final"
                  >
                    ↓
                  </button>
                </div>
              )}

              <div ref={messagesContainerRef} onScroll={handleMessagesScroll} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {loadingMsgs ? (
                  <div className="flex items-center justify-center py-10 text-slate-500 text-sm">Carregando...</div>
                ) : convMessages.length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-slate-500 text-sm">Nenhuma mensagem.</div>
                ) : (
                  (() => {
                    let lastDateKey = "";
                    return convMessages.map((msg) => {
                    const msgDateKey = new Date(msg.receivedAt).toDateString();
                    const showDivider = msgDateKey !== lastDateKey;
                    lastDateKey = msgDateKey;

                    const isOut = msg.direction === "OUTBOUND";
                    const isGroupConv = selectedConv?.phone.includes("@g.us");
                    const MEDIA_PREFIXES = ["🎵", "🎤", "🖼️", "🎥", "📎", "😄", "📍", "👤"];
                    const isMedia = MEDIA_PREFIXES.some(p => msg.body?.startsWith(p));

                    // Resolver remetente do grupo (INBOUND): nosso número ou cliente
                    const groupParticipant = isGroupConv && !isOut
                      ? resolveParticipant(msg.participantPhone, msg.participantName)
                      : null;

                    // Em grupo, mensagem INBOUND de um dos nossos números → estilo "enviado"
                    const isOursInGroup = isGroupConv && !isOut && groupParticipant?.isOurs === true;

                    // Nome do remetente para mensagens recebidas (conversa individual)
                    const contactDisplayName = !isGroupConv && !isOut
                      ? (selectedConv?.companyContact?.name ?? selectedConv?.lead?.name ?? selectedConv?.phone)
                      : null;

                    // Estilo do bubble
                    const bubbleStyle = isOut || isOursInGroup
                      ? "bg-indigo-600 text-white rounded-tr-none"
                      : "bg-[#0f1623] border border-[#1e2d45] text-slate-200 rounded-tl-none";
                    const bubbleAlign = isOut || isOursInGroup ? "items-end" : "items-start";

                    // ACK icon para mensagens OUTBOUND
                    const ackIcon = (isOut || isOursInGroup) ? (() => {
                      if (msg.ack === null || msg.ack === undefined) return null;
                      if (msg.ack <= 0)  return <span className="text-[11px] text-indigo-300/50" title="Pendente">🕐</span>;
                      if (msg.ack === 1) return <span className="text-[11px] text-indigo-300/60" title="Enviado">✓</span>;
                      if (msg.ack === 2) return <span className="text-[11px] text-indigo-300/80" title="Entregue">✓✓</span>;
                      return <span className="text-[11px] text-blue-300" title="Lido">✓✓</span>; // 3=read 4=played
                    })() : null;

                    return (
                      <div key={msg.id} className="group/msg">
                        {showDivider && (
                          <div className="flex items-center gap-3 my-3">
                            <div className="flex-1 h-px bg-[#1e2d45]" />
                            <span className="text-[10px] text-slate-600 font-medium px-2 py-0.5 rounded-full bg-[#0f1623] border border-[#1e2d45] whitespace-nowrap">
                              {formatDateDivider(msg.receivedAt)}
                            </span>
                            <div className="flex-1 h-px bg-[#1e2d45]" />
                          </div>
                        )}
                      <div className={`flex items-end gap-1.5 ${isOut || isOursInGroup ? "flex-row-reverse" : "flex-row"}`}>
                        {/* Botão Responder — aparece no hover, para mensagens recebidas */}
                        {!isOut && !isOursInGroup && (
                          <button
                            onClick={() => { setReplyingTo(msg); replyTextareaRef.current?.focus(); }}
                            className="opacity-0 group-hover/msg:opacity-100 transition-opacity flex-shrink-0 mb-1 w-6 h-6 rounded-full bg-[#1e2d45] hover:bg-[#2a3d5a] flex items-center justify-center text-slate-400 hover:text-white text-[11px]"
                            title="Responder"
                          >
                            ↩
                          </button>
                        )}

                        <div className={`flex flex-col ${bubbleAlign} max-w-[75%]`}>
                          <div className={`rounded-2xl px-4 py-2.5 ${bubbleStyle}`}>

                            {/* Grupo: participante é um dos nossos números → nome da instância */}
                            {isGroupConv && groupParticipant?.isOurs && (
                              <div className={`text-[10px] font-bold mb-1 truncate ${getInstanceBadgeColor(groupParticipant.label).split(" ").filter(c => c.startsWith("text-")).join(" ")}`}>
                                📤 {groupParticipant.label}
                              </div>
                            )}

                            {/* Grupo: participante é cliente — cor estável + clicável para nomear */}
                            {isGroupConv && groupParticipant && !groupParticipant.isOurs && (
                              <button
                                onClick={() => handleOpenParticipantEdit(groupParticipant.rawNorm)}
                                className={`text-[10px] font-bold mb-1 truncate text-left max-w-full flex items-center gap-1 group/participant hover:opacity-80 ${getParticipantColor(groupParticipant.rawNorm)}`}
                                title="Clique para nomear este contato"
                              >
                                👤 {groupParticipant.label}
                                <span className="opacity-0 group-hover/participant:opacity-60 text-[9px]">✏️</span>
                              </button>
                            )}

                            {/* Individual recebido: nome do contato */}
                            {contactDisplayName && (
                              <div className="text-[10px] text-cyan-400 font-semibold mb-1 truncate">
                                {contactDisplayName}
                              </div>
                            )}

                            {/* Individual enviado / outbound direto: via instância */}
                            {isOut && msg.instance && (
                              <div className={`text-[10px] font-semibold mb-1 truncate ${getInstanceBadgeColor(msg.instance.instanceName).split(" ").filter(c => c.startsWith("text-")).join(" ")}`}>
                                Via {msg.instance.instanceName}
                              </div>
                            )}

                            {/* Bloco de citação (mensagem respondida) */}
                            {msg.quotedBody && (
                              <div className={`mb-2 pl-2 border-l-2 ${isOut || isOursInGroup ? "border-indigo-300/40" : "border-slate-500/50"} rounded-sm`}>
                                <p className={`text-[11px] italic truncate ${isOut || isOursInGroup ? "text-indigo-200/70" : "text-slate-500"}`}>
                                  {msg.quotedBody}
                                </p>
                              </div>
                            )}

                            <p className={`text-sm whitespace-pre-wrap break-words ${isMedia ? (isOut || isOursInGroup ? "italic text-indigo-200" : "italic text-slate-400") : ""}`}>{msg.body}</p>
                            <div className={`flex items-center gap-1.5 mt-1 flex-wrap ${isOut || isOursInGroup ? "justify-end" : "justify-start"}`}>
                              <span className={`text-[10px] ${isOut || isOursInGroup ? "text-indigo-200/60" : "text-slate-600"}`}>
                                {new Date(msg.receivedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                              {ackIcon}
                              {msg.campaign && (
                                <span className="text-[10px] text-indigo-400/70">📣 {msg.campaign.name}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      </div>
                    );
                  });
                  })()
                )}
                {/* Popup de edição de participante de grupo */}
                {editingParticipant && (
                  <div className="sticky bottom-2 mx-auto w-full max-w-sm bg-[#0d1525] border border-indigo-500/30 rounded-2xl p-4 shadow-2xl z-30">
                    {/* Header comum */}
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-indigo-300 text-xs font-semibold">
                        {participantMarkMode === "mine" ? "📤 Associar ao meu número" : participantMarkMode === "contact" ? "👤 Nomear contato" : "⚙️ O que deseja fazer?"}
                      </p>
                      <button
                        onClick={() => { setEditingParticipant(null); setParticipantMarkMode(null); }}
                        className="text-slate-600 hover:text-slate-300 text-xs"
                      >✕</button>
                    </div>
                    <p className="text-slate-600 text-[10px] mb-3 font-mono">{editingParticipant}</p>

                    {/* Modo: escolha inicial */}
                    {participantMarkMode === null && (
                      <div className="space-y-2">
                        <button
                          onClick={() => setParticipantMarkMode("contact")}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0f1623] border border-[#1e2d45] hover:border-indigo-500/50 text-left transition-colors group"
                        >
                          <span className="text-xl">👤</span>
                          <div>
                            <p className="text-white text-xs font-medium group-hover:text-indigo-300 transition-colors">Nomear contato</p>
                            <p className="text-slate-600 text-[10px]">Salvar nome ou vincular a uma empresa cliente</p>
                          </div>
                        </button>
                        <button
                          onClick={() => setParticipantMarkMode("mine")}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0f1623] border border-[#1e2d45] hover:border-emerald-500/50 text-left transition-colors group"
                        >
                          <span className="text-xl">📤</span>
                          <div>
                            <p className="text-white text-xs font-medium group-hover:text-emerald-300 transition-colors">É meu número</p>
                            <p className="text-slate-600 text-[10px]">Associar este número a uma das minhas instâncias WhatsApp</p>
                          </div>
                        </button>
                      </div>
                    )}

                    {/* Modo: nomear contato */}
                    {participantMarkMode === "contact" && (
                      <>
                        <input
                          autoFocus
                          type="text"
                          value={participantNameInput}
                          onChange={(e) => setParticipantNameInput(e.target.value)}
                          placeholder="Nome do contato..."
                          className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 mb-2"
                        />
                        {/* Vincular a empresa */}
                        <div className="mb-3">
                          <input
                            type="text"
                            value={participantCompanySearch}
                            onChange={(e) => { setParticipantCompanySearch(e.target.value); if (e.target.value.length >= 1) searchParticipantCompanies(e.target.value); else setParticipantCompanyResults([]); }}
                            placeholder="Empresa (opcional)..."
                            className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                          />
                          {participantCompanyResults.length > 0 && (
                            <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                              {participantCompanyResults.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => { handleSaveParticipant(c.id); }}
                                  disabled={savingParticipant}
                                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#0f1623] border border-[#1e2d45] hover:border-indigo-500/50 text-left text-xs transition-colors disabled:opacity-50"
                                >
                                  <span className="text-white">{c.name}</span>
                                  <span className="text-indigo-400 text-[10px]">{savingParticipant ? "..." : "Salvar →"}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {participantCompanies[editingParticipant] && (
                            <p className="text-amber-400 text-[10px] mt-1">🏢 Empresa atual: {participantCompanies[editingParticipant].name}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveParticipant()}
                            disabled={savingParticipant}
                            className="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
                          >
                            {savingParticipant ? "Salvando..." : "Salvar nome"}
                          </button>
                          <button
                            onClick={() => setParticipantMarkMode(null)}
                            className="px-3 py-1.5 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 text-xs hover:text-white transition-colors"
                          >
                            ← Voltar
                          </button>
                        </div>
                      </>
                    )}

                    {/* Modo: marcar como meu número */}
                    {participantMarkMode === "mine" && (
                      <>
                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2 mb-3">
                          <p className="text-emerald-300 text-[11px] font-medium">Qual chip/WhatsApp da agência usa este número?</p>
                          <p className="text-slate-500 text-[10px] mt-0.5">Escolha a conexão correspondente. O número será vinculado e reconhecido em todos os grupos.</p>
                        </div>
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                          {instances.map((inst) => {
                            const badgeColor = getInstanceBadgeColor(inst.instanceName);
                            const isConnected = inst.status === "CONNECTED";
                            return (
                              <button
                                key={inst.id}
                                onClick={() => handleMarkAsMine(inst.id)}
                                disabled={markingAsMine}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#0f1623] border border-[#1e2d45] hover:border-emerald-500/50 text-left transition-colors disabled:opacity-50 group"
                              >
                                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isConnected ? "bg-green-400" : "bg-slate-600"}`} />
                                <div className="flex-1 min-w-0">
                                  <p className={`text-xs font-semibold truncate ${badgeColor.split(" ").filter((c) => c.startsWith("text-")).join(" ")}`}>
                                    {inst.instanceName}
                                  </p>
                                  {inst.phone ? (
                                    <p className="text-slate-400 text-[10px] font-mono truncate">
                                      {inst.phone.replace(/(\d{2})(\d{2})(\d{4,5})(\d{4})/, "+$1 ($2) $3-$4")}
                                    </p>
                                  ) : (
                                    <p className="text-slate-600 text-[10px]">Sem número configurado</p>
                                  )}
                                </div>
                                <span className="text-emerald-400 text-[11px] font-semibold group-hover:text-emerald-300 transition-colors flex-shrink-0">
                                  {markingAsMine ? "salvando..." : "Este! →"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <button
                          onClick={() => setParticipantMarkMode(null)}
                          className="mt-3 w-full py-1.5 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 text-xs hover:text-white transition-colors"
                        >
                          ← Voltar
                        </button>
                      </>
                    )}
                  </div>
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
                {/* Seletor de instância para grupos */}
                {selectedConv?.phone.includes("@g.us") && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-slate-500 text-[11px]">📱 Responder via:</span>
                    <select
                      value={groupInstanceId}
                      onChange={(e) => selectGroupInstance(e.target.value)}
                      className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">— selecionar instância —</option>
                      {instances
                        .filter((i) => !selectedConv.companyId || i.company?.id === selectedConv.companyId)
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.instanceName} {i.status === "CONNECTED" ? "✓" : "✗"}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                {replyError && <div className="text-red-400 text-xs mb-2">{replyError}</div>}

                {/* Emoji picker simples */}
                {showEmojiPicker && (
                  <div className="mb-2 p-2 bg-[#0a0f1a] border border-[#1e2d45] rounded-xl flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                    {["😀","😂","😊","😍","🤔","😢","😡","👍","👎","🙏","❤️","🔥","✅","⚠️","🎉","💪","👋","🤝","💡","📋","📞","💰","🗓️","✉️","🚀","⏰","🎯","📢","🔔","💬","👀","✏️","🏢","📊","🤩","😎","🥳","💯","🙌","🫡"].map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          const ta = replyTextareaRef.current;
                          if (!ta) { setReplyText((t) => t + e); return; }
                          const start = ta.selectionStart ?? replyText.length;
                          const end = ta.selectionEnd ?? replyText.length;
                          const next = replyText.slice(0, start) + e + replyText.slice(end);
                          setReplyText(next);
                          setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + e.length; ta.focus(); }, 0);
                        }}
                        className="text-lg hover:scale-125 transition-transform leading-none"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}

                <form onSubmit={handleReply} className="flex items-end gap-2">

                  {/* ── Botão + Ações (abre para cima) ── */}
                  {(() => {
                    const isLeadInFinalStage = !!(selectedConv.lead?.pipelineStage && finalStageNames.includes(selectedConv.lead.pipelineStage));
                    const isTicketFinal = openTicket?.status === "RESOLVED" || openTicket?.status === "CLOSED";
                    return (
                      <div className="relative flex-shrink-0" ref={actionsMenuRef}>
                        <button
                          type="button"
                          onClick={() => setShowActionsMenu(!showActionsMenu)}
                          className={`flex items-center gap-1 px-3 rounded-xl text-xs font-semibold border transition-colors ${
                            showActionsMenu
                              ? "bg-indigo-600 border-indigo-500 text-white"
                              : "bg-[#0f1623] border-[#1e2d45] text-slate-400 hover:text-white hover:border-slate-500"
                          }`}
                          style={{ height: "42px" }}
                        >
                          + <span className="hidden sm:inline ml-0.5">Ações</span> <span className="text-[10px] opacity-60">{showActionsMenu ? "▾" : "▴"}</span>
                        </button>

                        {showActionsMenu && (
                          <div className="absolute left-0 bottom-full mb-2 w-64 bg-[#0d1525] border border-[#1e2d45] rounded-xl shadow-2xl z-50 overflow-hidden py-1">

                            {/* ── Status de Atendimento ── */}
                            <div className="px-3 pt-2.5 pb-1.5">
                              <p className="text-slate-600 text-[9px] font-semibold uppercase tracking-widest mb-2">Atendimento</p>
                              <div className="grid grid-cols-2 gap-1">
                                {(["WAITING", "IN_PROGRESS", "RESOLVED", "SCHEDULED"] as const).map((s) => {
                                  const a = ATTENDANCE[s];
                                  const isActive = attendanceStatus === s;
                                  return (
                                    <button
                                      key={s}
                                      type="button"
                                      onClick={() => { handleSetAttendance(s); if (s !== "SCHEDULED") setShowActionsMenu(false); }}
                                      disabled={savingAttendance}
                                      className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-semibold border transition-all disabled:opacity-50 ${
                                        isActive ? a.btn : "border-[#1e2d45] text-slate-500 hover:text-slate-200 hover:border-slate-600 hover:bg-white/5"
                                      }`}
                                    >
                                      {a.icon} {a.label}
                                    </button>
                                  );
                                })}
                              </div>
                              {attendanceStatus === "SCHEDULED" && (
                                <div className="flex gap-2 mt-2">
                                  <input
                                    type="datetime-local"
                                    value={expectedReturn}
                                    onChange={(e) => setExpectedReturn(e.target.value)}
                                    className="flex-1 bg-[#0f1623] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => { handleSetAttendance("SCHEDULED"); setShowActionsMenu(false); }}
                                    disabled={savingAttendance || !expectedReturn}
                                    className="px-2.5 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-500 disabled:opacity-50"
                                  >
                                    Salvar
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="border-t border-[#1e2d45] my-1" />

                            {/* ── Classificar ── */}
                            <div className="px-3 py-1.5">
                              <p className="text-slate-600 text-[9px] font-semibold uppercase tracking-widest mb-2">Classificar</p>
                              <div className="space-y-0.5">
                                <button
                                  type="button"
                                  onClick={() => { setShowConvertForm(true); setShowTicketForm(false); setShowOportunidadeForm(false); setShowLinkProspect(false); setShowAddCompany(false); setShowActionsMenu(false); }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                                >
                                  🎯 Criar Lead
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setShowOportunidadeForm(true); setShowConvertForm(false); setShowTicketForm(false); setShowLinkProspect(false); setShowAddCompany(false); setShowActionsMenu(false); }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                                >
                                  💰 Criar Oportunidade
                                </button>
                                {(!openTicket || isTicketFinal) && (
                                  <button
                                    type="button"
                                    onClick={() => { setShowTicketForm(true); setShowConvertForm(false); setShowOportunidadeForm(false); setShowLinkProspect(false); setShowAddCompany(false); setShowActionsMenu(false); }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                                  >
                                    🎫 Abrir Chamado
                                  </button>
                                )}
                                {!selectedConv.companyContact && !selectedConv.phone.includes("@g.us") && (
                                  <button
                                    type="button"
                                    onClick={() => { setShowAddCompany(true); setShowConvertForm(false); setShowTicketForm(false); setShowOportunidadeForm(false); setShowLinkProspect(false); setShowActionsMenu(false); }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                                  >
                                    ⭐ É Cliente
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => { setShowLinkProspect(true); setShowConvertForm(false); setShowTicketForm(false); setShowOportunidadeForm(false); setShowAddCompany(false); setShowActionsMenu(false); }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                                >
                                  🔎 Vincular Prospect
                                </button>
                              </div>
                            </div>

                            <div className="border-t border-[#1e2d45] my-1" />

                            {/* ── Mais opções ── */}
                            <div className="px-3 py-1.5">
                              <p className="text-slate-600 text-[9px] font-semibold uppercase tracking-widest mb-2">Mais</p>
                              <div className="space-y-0.5">
                                <button
                                  type="button"
                                  onClick={() => { setShowAiPanel(!showAiPanel); setShowActionsMenu(false); }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors text-left"
                                >
                                  🤖 Assistente IA
                                </button>
                                {selectedConv.phone.includes("@g.us") && (
                                  <button
                                    type="button"
                                    onClick={() => { setShowGroupCompany(!showGroupCompany); setShowActionsMenu(false); setGroupCompanySearch(""); setGroupCompanyResults([]); setAssignGroupError(null); }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                                  >
                                    🏢 {selectedConv.companyContact ? "Mudar empresa" : "Atribuir empresa"}
                                  </button>
                                )}
                                {selectedConv.lead && (
                                  <button
                                    type="button"
                                    onClick={() => { setShowMergePanel(!showMergePanel); setShowActionsMenu(false); setMergeSearch(""); setMergeResults([]); }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                                  >
                                    🔗 Mesclar contato
                                  </button>
                                )}
                              </div>
                            </div>

                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Preview da citação (ao clicar Responder) */}
                  {replyingTo && (
                    <div className="mx-1 mb-1 flex items-start gap-2 bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0 border-l-2 border-indigo-400 pl-2">
                        <p className="text-[10px] text-indigo-400 font-semibold mb-0.5">
                          {replyingTo.direction === "OUTBOUND" ? "Você" : (selectedConv?.companyContact?.name ?? selectedConv?.lead?.name ?? selectedConv?.phone)}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">{replyingTo.body}</p>
                      </div>
                      <button
                        onClick={() => setReplyingTo(null)}
                        className="text-slate-600 hover:text-white text-sm flex-shrink-0 mt-0.5"
                      >✕</button>
                    </div>
                  )}

                  <div className="flex-1 relative">
                    <textarea
                      ref={replyTextareaRef}
                      value={replyText}
                      onChange={(e) => {
                        setReplyText(e.target.value);
                        // Auto-expand: reset height then set to scrollHeight
                        e.target.style.height = "auto";
                        e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey) {
                          e.preventDefault();
                          if (replyText.trim() && !sendingReply) handleReply(e as any);
                        }
                        // Ctrl+Enter ou Shift+Enter → quebra de linha (comportamento default do textarea)
                      }}
                      placeholder="Digite uma mensagem... (Enter envia · Ctrl+Enter nova linha)"
                      disabled={sendingReply}
                      rows={1}
                      className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50 resize-none overflow-hidden"
                      style={{ minHeight: "42px", maxHeight: "160px" }}
                    />
                    {/* Botão emoji dentro do campo */}
                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker((v) => !v)}
                      className={`absolute right-2.5 bottom-2.5 text-base transition-colors ${showEmojiPicker ? "text-yellow-400" : "text-slate-600 hover:text-slate-300"}`}
                      title="Emojis"
                    >
                      😊
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={sendingReply || !replyText.trim()}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors flex-shrink-0"
                    style={{ height: "42px" }}
                  >
                    {sendingReply ? "..." : "↑"}
                  </button>
                </form>
                <p className="text-slate-700 text-[10px] mt-1">Enter envia · Ctrl+Enter quebra linha</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
