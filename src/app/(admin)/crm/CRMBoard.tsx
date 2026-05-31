"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Target, Lightbulb,
  Tag, Clock, FileText, Sparkles, Link2, Plug, Settings, MessageSquare, CheckSquare, Building2,
  Activity as ActivityIcon, Inbox,
  type LucideIcon,
} from "lucide-react";
import ImportLeads from "./ImportLeads";
import BuscarProspectsModal from "./BuscarProspectsModal";
import SourceBadge from "@/components/SourceBadge";
import { gradStroke, type GradientKey } from "@/components/IconGradients";
import type { TimelineEvent } from "@/app/api/leads/[id]/timeline/route";

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
  // Rastreabilidade de promoção (de onde foi convertido)
  promotedFromPipeline?: string | null;
  promotedAt?: string | null;
  promotedReason?: string | null;
  promotedViaEmailCampaign?: { id: string; name: string } | null;
  clickupTaskId: string | null;
  // Campos preenchidos pela busca SerpAPI + scraper (módulo Prospecção).
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  address: string | null;
  city: string | null;
  segment: string | null;
  externalId: string | null;
  // NULL = não validado · true/false = checado via Evolution /chat/whatsappNumbers
  hasWhatsapp: boolean | null;
  // Diagnóstico IA (Prospecta IA)
  diagnosis: {
    summary?: string;
    positives?: { title: string; detail: string }[];
    opportunities?: { title: string; detail: string }[];
    criticals?: { title: string; detail: string }[];
  } | null;
  diagnosisAt: string | null;
  diagnosisSource: string | null;
  diagnosisToken: string | null;
  diagnosisClickedAt: string | null;
  trackingLinkId: string | null;
  trackingLink: {
    id: string;
    code: string;
    label: string | null;
    clicks: number;
    destination: string;
    isActive: boolean;
    _count: { clickEvents: number };
  } | null;
  /** Resumo de tarefas (preenchido server-side; opcional) */
  taskSummary?: {
    openCount: number;
    nextDueAt: string | null;
  };
  /** Tags atribuídas ao lead */
  tags?: TagInfo[];
  /** Lead score calculado server-side */
  score?: {
    value: number;
    tier: "fire" | "hot" | "warm" | "cold" | "icy";
    reasons: string[];
  } | null;
}

export interface TagInfo {
  id: string;
  name: string;
  color: string;
}

export interface CustomFieldDef {
  id: string;
  name: string;
  key: string;
  type: "TEXT" | "NUMBER" | "DATE" | "SELECT";
  options: string[] | null;
  required: boolean;
  order: number;
}

export interface CustomValueRow {
  fieldId: string;
  value: string;
}

export interface CRMTask {
  id: string;
  title: string;
  dueAt: string;
  done: boolean;
  doneAt: string | null;
  notes: string | null;
  /** "MANUAL" | "AUTO_LINK_OPEN" — sinaliza tarefas auto-criadas pelo sistema. */
  source: "MANUAL" | "AUTO_LINK_OPEN";
  assignee: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
}

export interface LeadComment {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

const TIMELINE_META: Record<string, { icon: string; titleColor: string; bg: string }> = {
  lead_created:      { icon: "🆕", titleColor: "#a5b4fc", bg: "bg-indigo-500/5 border-indigo-500/15" },
  comment:           { icon: "💬", titleColor: "#a5b4fc", bg: "bg-[#0a0f1a] border-[#1e2d45]" },
  message_in:        { icon: "📥", titleColor: "#6ee7b7", bg: "bg-emerald-500/5 border-emerald-500/15" },
  message_out:       { icon: "📤", titleColor: "#86efac", bg: "bg-green-500/5 border-green-500/15" },
  link_open:         { icon: "👁️", titleColor: "#fbbf24", bg: "bg-amber-500/5 border-amber-500/20" },
  link_click:        { icon: "🖱️", titleColor: "#67e8f9", bg: "bg-cyan-500/5 border-cyan-500/15" },
  tracking_link_set: { icon: "🔗", titleColor: "#c4b5fd", bg: "bg-violet-500/5 border-violet-500/15" },
  // Sinal quente: fundo vermelho mais forte pra puxar o olho — é a linha mais
  // acionável da timeline (cliente abriu agora, tem que ligar).
  hot_signal:        { icon: "🔥", titleColor: "#fca5a5", bg: "bg-red-500/10 border-red-500/30" },
  // Mudanças estruturais do lead (Activity table). Pipeline merece destaque
  // — "Virou Oportunidade" é marco do funil. Os outros mais discretos.
  pipeline_changed:  { icon: "🎯", titleColor: "#86efac", bg: "bg-green-500/8 border-green-500/25" },
  stage_changed:     { icon: "🪜", titleColor: "#c4b5fd", bg: "bg-violet-500/5 border-violet-500/15" },
  assignee_changed:  { icon: "👤", titleColor: "#94a3b8", bg: "bg-slate-500/5 border-slate-500/15" },
  value_changed:     { icon: "💰", titleColor: "#86efac", bg: "bg-emerald-500/5 border-emerald-500/15" },
  clickup_linked:    { icon: "✅", titleColor: "#fcd34d", bg: "bg-amber-500/5 border-amber-500/15" },
};

type TimelineFilter = "all" | "messages" | "links" | "system" | "notes";

const TIMELINE_FILTERS: { id: TimelineFilter; Icon: LucideIcon; grad: GradientKey; label: string }[] = [
  { id: "all",      Icon: Inbox,          grad: "dashboard",   label: "Tudo" },
  { id: "messages", Icon: MessageSquare,  grad: "whatsapp",    label: "Mensagens" },
  { id: "links",    Icon: Link2,          grad: "links",       label: "Links" },
  { id: "notes",    Icon: FileText,       grad: "pipeline",    label: "Anotações" },
  { id: "system",   Icon: Settings,       grad: "configuracoes", label: "Sistema" },
];

const EVENT_GROUP: Record<string, Exclude<TimelineFilter, "all">> = {
  message_in:        "messages",
  message_out:       "messages",
  link_open:         "links",
  link_click:        "links",
  tracking_link_set: "links",
  hot_signal:        "links",
  comment:           "notes",
  lead_created:      "system",
  pipeline_changed:  "system",
  stage_changed:     "system",
  assignee_changed:  "system",
  value_changed:     "system",
  clickup_linked:    "system",
};

function formatTimelineDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffH / 24);
  if (diffMin < 1)  return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  if (diffH < 24)   return `${diffH}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Default: amanhã 09:00, no formato `YYYY-MM-DDTHH:mm` exigido pelo input datetime-local */
function defaultDueAtLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "atrasada 2d", "hoje 14:30", "amanhã 09:00", "23/05 09:00" */
function formatTaskDue(iso: string, done: boolean): { label: string; color: string } {
  const d = new Date(iso);
  if (done) return { label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), color: "text-slate-500" };
  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday); startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startDayAfter = new Date(startTomorrow); startDayAfter.setDate(startDayAfter.getDate() + 1);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d < startToday) {
    const diff = Math.ceil((startToday.getTime() - d.getTime()) / 86400000);
    return { label: `atrasada ${diff}d`, color: "text-red-400" };
  }
  if (d >= startToday && d < startTomorrow) return { label: `hoje ${time}`, color: "text-amber-400" };
  if (d >= startTomorrow && d < startDayAfter) return { label: `amanhã ${time}`, color: "text-sky-400" };
  return { label: `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${time}`, color: "text-slate-400" };
}

/** Status agregado para o card do Kanban (overdue > today > upcoming > none). */
function leadTaskBadge(summary?: { openCount: number; nextDueAt: string | null }): { dot: string; tip: string } | null {
  if (!summary || !summary.openCount || !summary.nextDueAt) return null;
  const due = new Date(summary.nextDueAt);
  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday); startTomorrow.setDate(startTomorrow.getDate() + 1);
  if (due < startToday) return { dot: "bg-red-400", tip: `${summary.openCount} tarefa(s) atrasada(s)` };
  if (due < startTomorrow) return { dot: "bg-amber-400", tip: `${summary.openCount} tarefa(s) hoje` };
  return { dot: "bg-sky-400", tip: `${summary.openCount} tarefa(s) agendada(s)` };
}

/** Cor de borda esquerda do card por tier do lead score */
const SCORE_TIER_BORDER: Record<string, string> = {
  fire: "#ef4444", // vermelho — score 80+
  hot:  "#f97316", // laranja  — 60-79
  warm: "#eab308", // amarelo  — 40-59
  cold: "#64748b", // cinza    — 20-39
  icy:  "#1e293b", // grafite  — 0-19
};
const SCORE_TIER_LABEL: Record<string, string> = {
  fire: "🔥 Quente",
  hot:  "🌶️ Aquecendo",
  warm: "☀️ Morno",
  cold: "❄️ Frio",
  icy:  "🧊 Gelado",
};

/** Cores pré-aprovadas pra tags novas (variedade visual sem o user precisar escolher) */
const TAG_COLOR_PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#ef4444",
  "#f59e0b", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
];
function pickRandomTagColor(): string {
  return TAG_COLOR_PALETTE[Math.floor(Math.random() * TAG_COLOR_PALETTE.length)];
}

function waMeUrl(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

function leadhubInboxUrl(phone: string): string {
  return `/whatsapp?abrir=${encodeURIComponent(phone)}`;
}

const PIPELINE_LABELS: Record<string, { label: string; Icon: LucideIcon; grad: GradientKey; emoji: string; color: string }> = {
  PROSPECCAO:    { label: "Prospecção",    Icon: Search,    grad: "prospeccao",    emoji: "🔎", color: "#8b5cf6" },
  LEADS:         { label: "Leads",         Icon: Target,    grad: "leads",         emoji: "🎯", color: "#6366f1" },
  OPORTUNIDADES: { label: "Oportunidades", Icon: Lightbulb, grad: "oportunidades", emoji: "💡", color: "#f59e0b" },
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
  whatsappEnabled = false,
  clickupEnabled = false,
  prospeccaoEnabled = false,
}: {
  pipeline: string;
  initialLeads: CRMLead[];
  stages: PipelineStage[];
  isSuperAdmin: boolean;
  companies: { id: string; name: string }[];
  defaultLeadId?: string;
  defaultCompanyId?: string;
  whatsappEnabled?: boolean;
  clickupEnabled?: boolean;
  prospeccaoEnabled?: boolean;
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
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(true);
  const [editingValue, setEditingValue] = useState(false);
  const [valueInput, setValueInput] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState("");
  const [editingExpected, setEditingExpected] = useState(false);
  const [expectedInput, setExpectedInput] = useState("");
  const [enrichingProspect, setEnrichingProspect] = useState(false);
  const [enrichProspectMsg, setEnrichProspectMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [diagnosingProspect, setDiagnosingProspect] = useState(false);
  const [diagnoseProspectMsg, setDiagnoseProspectMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedDiagLink, setCopiedDiagLink] = useState(false);
  // Edição inline dos dados de contato/prospect no drawer
  const [editingContact, setEditingContact] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [contactForm, setContactForm] = useState({
    name: "", phone: "", email: "", website: "", instagram: "", facebook: "", city: "", segment: "",
  });

  // Tags da empresa (carregadas sob demanda quando o usuário abre o seletor)
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [loadingAllTags, setLoadingAllTags] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [savingTag, setSavingTag] = useState(false);

  // Filtro por tag no header do Kanban
  const [tagFilterId, setTagFilterId] = useState<string | null>(null);
  // Filtros rápidos de prospect (header do kanban)
  const [filterHasEmail, setFilterHasEmail] = useState(false);
  const [filterHasWhatsapp, setFilterHasWhatsapp] = useState(false);
  const [filterHasDiagnosis, setFilterHasDiagnosis] = useState(false);

  // Custom fields da empresa + valores do lead aberto
  const [customDefs, setCustomDefs] = useState<CustomFieldDef[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [savingCustomField, setSavingCustomField] = useState<string | null>(null);

  // Tarefas do lead aberto
  const [tasks, setTasks] = useState<CRMTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDue, setNewTaskDue] = useState<string>(() => defaultDueAtLocal());
  const [savingTask, setSavingTask] = useState(false);

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
  const [addForm, setAddForm] = useState({ name: "", phone: "", email: "", notes: "", value: "", companyId: defaultCompanyId ?? "" });
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

  // Modal de motivo de perda (acionado ao mover para stage final "perdido/descartado")
  const [lostReasonModal, setLostReasonModal] = useState<{ leadId: string; stageName: string } | null>(null);
  const [lostReasonText, setLostReasonText] = useState("");
  const [lostReasonSaving, setLostReasonSaving] = useState(false);

  const LOST_REASON_PRESETS = [
    "Sem orçamento",
    "Escolheu concorrente",
    "Não respondeu mais",
    "Fora do perfil (ICP)",
    "Sem fit / não é o momento",
    "Preço alto",
  ];

  function isLostStage(stage: PipelineStage | undefined): boolean {
    if (!stage) return false;
    if (!stage.isFinal) return false;
    const n = stage.name.toLowerCase();
    return /perdi|descart|recus|n[aã]o\s*fech/.test(n);
  }

  async function confirmLostReason() {
    if (!lostReasonModal) return;
    const reason = lostReasonText.trim();
    if (!reason) return;
    setLostReasonSaving(true);
    try {
      // 1) registra motivo como comentário (timeline)
      await fetch(`/api/leads/${lostReasonModal.leadId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: `❌ Motivo da perda: ${reason}` }),
      });
      // 2) move o lead para a coluna final
      await moveToStage(lostReasonModal.leadId, lostReasonModal.stageName);
    } finally {
      setLostReasonSaving(false);
      setLostReasonModal(null);
      setLostReasonText("");
    }
  }

  const pipelineInfo = PIPELINE_LABELS[pipeline] ?? { label: pipeline, icon: "🫧", color: "#6366f1" };

  // Tags presentes em pelo menos 1 lead — alimenta o filtro do header.
  const tagsInUse = (() => {
    const map = new Map<string, TagInfo>();
    for (const l of leads) for (const t of l.tags ?? []) if (!map.has(t.id)) map.set(t.id, t);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  // Filtro de busca + tag
  const filteredLeads = leads.filter((l) => {
    if (tagFilterId && !(l.tags ?? []).some((t) => t.id === tagFilterId)) return false;
    if (filterHasEmail && !l.email) return false;
    if (filterHasWhatsapp && l.hasWhatsapp !== true) return false;
    if (filterHasDiagnosis && !l.diagnosisAt) return false;
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

  async function handleDiagnoseProspect() {
    if (!selected) return;
    setDiagnosingProspect(true);
    setDiagnoseProspectMsg(null);
    try {
      const res = await fetch("/api/prospeccao/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDiagnoseProspectMsg({ ok: false, text: data?.error ?? "Falha no diagnóstico" });
        return;
      }
      setDiagnoseProspectMsg({
        ok: true,
        text: `Diagnóstico ${selected.diagnosisAt ? "atualizado" : "gerado"} · fonte: ${data.source}`,
      });
      startTransition(() => router.refresh());
    } catch (err: any) {
      setDiagnoseProspectMsg({ ok: false, text: err?.message ?? "Erro inesperado" });
    } finally {
      setDiagnosingProspect(false);
    }
  }

  async function handleCopyDiagnosisLink() {
    if (!selected?.diagnosisToken) return;
    const url = `${window.location.origin}/d/${selected.diagnosisToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedDiagLink(true);
      setTimeout(() => setCopiedDiagLink(false), 2500);
    } catch {
      // Fallback: prompt
      window.prompt("Copie o link:", url);
    }
  }

  function startEditingContact() {
    if (!selected) return;
    setContactForm({
      name: selected.name ?? "",
      phone: selected.phone ?? "",
      email: selected.email ?? "",
      website: selected.website ?? "",
      instagram: selected.instagram ?? "",
      facebook: selected.facebook ?? "",
      city: selected.city ?? "",
      segment: selected.segment ?? "",
    });
    setEditingContact(true);
  }

  async function handleSaveContact() {
    if (!selected) return;
    if (!contactForm.phone.trim()) {
      alert("Telefone é obrigatório.");
      return;
    }
    setSavingContact(true);
    try {
      const payload = {
        name: contactForm.name.trim() || null,
        phone: contactForm.phone.trim(),
        email: contactForm.email.trim() || null,
        website: contactForm.website.trim() || null,
        instagram: contactForm.instagram.trim() || null,
        facebook: contactForm.facebook.trim() || null,
        city: contactForm.city.trim() || null,
        segment: contactForm.segment.trim() || null,
      };
      const res = await fetch(`/api/leads/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error ?? "Erro ao salvar contato.");
        return;
      }
      // Atualiza o lead aberto localmente pra refletir na hora
      setSelected((prev) => (prev ? { ...prev, ...payload } as CRMLead : prev));
      setEditingContact(false);
      startTransition(() => router.refresh());
    } catch (err: any) {
      alert(err?.message ?? "Erro ao salvar.");
    } finally {
      setSavingContact(false);
    }
  }

  async function handleEnrichProspect() {
    if (!selected) return;
    setEnrichingProspect(true);
    setEnrichProspectMsg(null);
    try {
      const res = await fetch("/api/prospeccao/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEnrichProspectMsg({ ok: false, text: data?.error ?? "Falha ao atualizar" });
        return;
      }
      setEnrichProspectMsg({
        ok: true,
        text: data?.message ?? (data?.filled?.length ? `Adicionados: ${data.filled.join(", ")}` : "Sem dados novos"),
      });
      // Refresh global pra o drawer re-receber o lead com os novos campos
      startTransition(() => router.refresh());
    } catch (err: any) {
      setEnrichProspectMsg({ ok: false, text: err?.message ?? "Erro inesperado" });
    } finally {
      setEnrichingProspect(false);
    }
  }

  async function openCard(lead: CRMLead) {
    setSelected(lead);
    setNewComment("");
    setEditingValue(false);
    setValueInput(lead.value?.toString() ?? "");
    setEditingNotes(false);
    setNotesInput(lead.notes ?? "");
    setEditingExpected(false);
    // new Date(x).toISOString() aceita string ISO OU Date — defensivo contra
    // valor vir como Date (caso prop não tenha sido serializada / fetch direto).
    // O .slice direto crashava o openLead() inteiro, abortando o fetch da
    // timeline e deixando o modal com TODAS as seções vazias.
    setExpectedInput(lead.expectedReturnAt ? new Date(lead.expectedReturnAt).toISOString().slice(0, 10) : "");
    setEnrichingProspect(false);
    setEnrichProspectMsg(null);
    setDiagnosingProspect(false);
    setDiagnoseProspectMsg(null);
    setCopiedDiagLink(false);
    setEditingContact(false);
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
    setActionsOpen(false);
    setIntegrationsOpen(true);
    setLoadingComments(true);
    setLoadingTimeline(true);
    setTimelineFilter("all");
    setTagPickerOpen(false);
    setTagSearch("");
    setTasks([]);
    setNewTaskTitle("");
    setNewTaskDue(defaultDueAtLocal());
    setCustomDefs([]);
    setCustomValues({});
    const [commentsRes, timelineRes] = await Promise.all([
      fetch(`/api/leads/${lead.id}/comments`),
      fetch(`/api/leads/${lead.id}/timeline`),
      loadTasks(lead.id),
      loadCustomFieldsAndValues(lead.id, lead.company?.id ?? defaultCompanyId),
    ]);
    if (commentsRes.ok) setComments(await commentsRes.json());
    if (timelineRes.ok) setTimeline(await timelineRes.json());
    setLoadingComments(false);
    setLoadingTimeline(false);
  }

  async function reloadTimeline() {
    if (!selected) return;
    const res = await fetch(`/api/leads/${selected.id}/timeline`);
    if (res.ok) setTimeline(await res.json());
  }

  async function loadTasks(leadId: string) {
    setLoadingTasks(true);
    const res = await fetch(`/api/leads/${leadId}/tasks`);
    if (res.ok) setTasks(await res.json());
    setLoadingTasks(false);
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !newTaskTitle.trim()) return;
    setSavingTask(true);
    const res = await fetch(`/api/leads/${selected.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newTaskTitle.trim(),
        dueAt: new Date(newTaskDue).toISOString(),
      }),
    });
    if (res.ok) {
      const created: CRMTask = await res.json();
      setTasks((prev) => [created, ...prev].sort(taskSorter));
      setNewTaskTitle("");
      setNewTaskDue(defaultDueAtLocal());
      bumpLeadTaskSummary(selected.id, +1, created.dueAt);
    }
    setSavingTask(false);
  }

  async function handleToggleTask(task: CRMTask) {
    const next = !task.done;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: next, doneAt: next ? new Date().toISOString() : null } : t)));
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: next }),
    });
    if (!res.ok) {
      // rollback
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      return;
    }
    if (selected) bumpLeadTaskSummary(selected.id, next ? -1 : +1);
  }

  async function handleDeleteTask(task: CRMTask) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (selected && !task.done) bumpLeadTaskSummary(selected.id, -1);
  }

  function taskSorter(a: CRMTask, b: CRMTask) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  }

  // ── Custom Fields ────────────────────────────────────────────────────────
  async function loadCustomFieldsAndValues(leadId: string, leadCompanyId: string | undefined) {
    try {
      const defsUrl = isSuperAdmin && leadCompanyId
        ? `/api/custom-fields?companyId=${leadCompanyId}`
        : "/api/custom-fields";
      const [defsRes, valsRes] = await Promise.all([
        fetch(defsUrl),
        fetch(`/api/leads/${leadId}/custom-values`),
      ]);
      const defs: CustomFieldDef[] = defsRes.ok ? await defsRes.json() : [];
      const vals: { fieldId: string; value: string }[] = valsRes.ok ? await valsRes.json() : [];
      setCustomDefs(defs);
      const map: Record<string, string> = {};
      for (const v of vals) map[v.fieldId] = v.value;
      setCustomValues(map);
    } catch {
      setCustomDefs([]);
      setCustomValues({});
    }
  }

  async function handleSaveCustomField(fieldId: string, value: string) {
    if (!selected) return;
    setSavingCustomField(fieldId);
    const before = customValues[fieldId];
    setCustomValues((cur) => ({ ...cur, [fieldId]: value }));
    const res = await fetch(`/api/leads/${selected.id}/custom-values`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldId, value }),
    });
    if (!res.ok) {
      // rollback
      setCustomValues((cur) => ({ ...cur, [fieldId]: before ?? "" }));
    }
    setSavingCustomField(null);
  }

  // ── Tags ─────────────────────────────────────────────────────────────────
  async function loadAllTags() {
    if (loadingAllTags || allTags.length > 0) return;
    setLoadingAllTags(true);
    try {
      const companyId = selected?.company?.id ?? defaultCompanyId ?? "";
      const url = isSuperAdmin && companyId ? `/api/tags?companyId=${companyId}` : "/api/tags";
      const res = await fetch(url);
      if (res.ok) setAllTags(await res.json());
    } finally {
      setLoadingAllTags(false);
    }
  }

  function updateLeadTagsLocal(leadId: string, updater: (current: TagInfo[]) => TagInfo[]) {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, tags: updater(l.tags ?? []) } : l))
    );
    setSelected((cur) => (cur && cur.id === leadId ? { ...cur, tags: updater(cur.tags ?? []) } : cur));
  }

  async function handleAttachTag(tag: TagInfo) {
    if (!selected) return;
    if (selected.tags?.some((t) => t.id === tag.id)) return; // já tem
    setSavingTag(true);
    updateLeadTagsLocal(selected.id, (cur) => [...cur, tag]);
    const res = await fetch(`/api/leads/${selected.id}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: tag.id }),
    });
    if (!res.ok) {
      // rollback
      updateLeadTagsLocal(selected.id, (cur) => cur.filter((t) => t.id !== tag.id));
    }
    setSavingTag(false);
  }

  async function handleDetachTag(tag: TagInfo) {
    if (!selected) return;
    updateLeadTagsLocal(selected.id, (cur) => cur.filter((t) => t.id !== tag.id));
    const res = await fetch(`/api/leads/${selected.id}/tags/${tag.id}`, { method: "DELETE" });
    if (!res.ok) {
      // rollback
      updateLeadTagsLocal(selected.id, (cur) => [...cur, tag]);
    }
  }

  /**
   * "Quick-add" no input do drawer: digita um nome e dá Enter.
   * Se já existe tag com esse nome, só anexa. Se não existe, cria + anexa.
   */
  async function handleQuickCreateTag() {
    if (!selected || !tagSearch.trim()) return;
    const name = tagSearch.trim();
    const existing = allTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      await handleAttachTag(existing);
      setTagSearch("");
      return;
    }
    setSavingTag(true);
    const companyId = selected.company?.id ?? defaultCompanyId;
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        color: pickRandomTagColor(),
        ...(isSuperAdmin && companyId ? { companyId } : {}),
      }),
    });
    if (res.ok) {
      const created: TagInfo = await res.json();
      setAllTags((prev) => [...prev, created]);
      await handleAttachTag(created);
      setTagSearch("");
    }
    setSavingTag(false);
  }

  /** Atualiza o resumo do card no Kanban sem precisar refetchar tudo. */
  function bumpLeadTaskSummary(leadId: string, delta: number, newDueAt?: string) {
    setLeads((prev) =>
      prev.map((l) => {
        if (l.id !== leadId) return l;
        const cur = l.taskSummary ?? { openCount: 0, nextDueAt: null };
        const openCount = Math.max(0, cur.openCount + delta);
        let nextDueAt = cur.nextDueAt;
        if (newDueAt) {
          if (!nextDueAt || new Date(newDueAt) < new Date(nextDueAt)) nextDueAt = newDueAt;
        }
        if (openCount === 0) nextDueAt = null;
        return { ...l, taskSummary: { openCount, nextDueAt } };
      })
    );
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
      reloadTimeline();
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

  async function handleSaveExpected(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const iso = expectedInput ? new Date(expectedInput + "T12:00:00").toISOString() : null;
    await fetch(`/api/leads/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedReturnAt: iso }),
    });
    setSelected({ ...selected, expectedReturnAt: iso });
    setLeads((prev) => prev.map((l) => (l.id === selected.id ? { ...l, expectedReturnAt: iso } : l)));
    setEditingExpected(false);
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
        email: addForm.email.trim() || null,
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
      setAddForm({ name: "", phone: "", email: "", notes: "", value: "", companyId: defaultCompanyId ?? "" });
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
    if (!leadId) return;
    const targetStage = stages.find((s) => s.name === stageName);
    if (isLostStage(targetStage)) {
      setLostReasonText("");
      setLostReasonModal({ leadId, stageName });
      return;
    }
    moveToStage(leadId, stageName);
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
            <pipelineInfo.Icon className="w-5 h-5" stroke={gradStroke(pipelineInfo.grad)} strokeWidth={2.25} />
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
          {tagsInUse.length > 0 && (
            <select
              value={tagFilterId ?? ""}
              onChange={(e) => setTagFilterId(e.target.value || null)}
              className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
              title="Filtrar por tag"
              style={tagFilterId ? { borderLeftWidth: 3, borderLeftColor: tagsInUse.find((t) => t.id === tagFilterId)?.color ?? "#6366f1" } : undefined}
            >
              <option value="">🏷️ Todas as tags</option>
              {tagsInUse.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          {/* Filtros rápidos de contato */}
          <button
            onClick={() => setFilterHasEmail((v) => !v)}
            title="Mostrar só leads com e-mail"
            className={`px-2.5 py-1.5 rounded-lg text-sm border transition-colors ${
              filterHasEmail
                ? "bg-orange-500/20 border-orange-500/40 text-orange-200"
                : "bg-[#0f1623] border-[#1e2d45] text-slate-400 hover:text-white hover:border-slate-600"
            }`}
          >
            📧 Com email
          </button>
          <button
            onClick={() => setFilterHasWhatsapp((v) => !v)}
            title="Mostrar só leads com WhatsApp validado"
            className={`px-2.5 py-1.5 rounded-lg text-sm border transition-colors ${
              filterHasWhatsapp
                ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-200"
                : "bg-[#0f1623] border-[#1e2d45] text-slate-400 hover:text-white hover:border-slate-600"
            }`}
          >
            💬 Com WhatsApp
          </button>
          <button
            onClick={() => setFilterHasDiagnosis((v) => !v)}
            title="Mostrar só leads que já têm diagnóstico gerado"
            className={`px-2.5 py-1.5 rounded-lg text-sm border transition-colors ${
              filterHasDiagnosis
                ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200"
                : "bg-[#0f1623] border-[#1e2d45] text-slate-400 hover:text-white hover:border-slate-600"
            }`}
          >
            🔍 Com diagnóstico
          </button>
          {pipeline === "PROSPECCAO" && (prospeccaoEnabled || isSuperAdmin) && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                {prospeccaoEnabled && (
                  <BuscarProspectsModal isSuperAdmin={isSuperAdmin} defaultCompanyId={defaultCompanyId} />
                )}
                {isSuperAdmin && (
                  <>
                    <a
                      href="https://webhooks.azzagencia.com.br/webhook/c96d1a1b-14dd-457e-a6a9-d2a765328d88"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors flex-shrink-0"
                      title="Webhook do n8n da AZZ (SUPER_ADMIN-only)"
                    >
                      🤖 Prospecção Automática
                    </a>
                    <button
                      onClick={handleBdrSync}
                      disabled={syncing}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors flex-shrink-0 disabled:opacity-60"
                      title="Import do Supabase BDR (SUPER_ADMIN-only)"
                    >
                      {syncing ? "⏳ Importando..." : "☁️ Importar Supabase"}
                    </button>
                  </>
                )}
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
          <ImportLeads pipeline={pipeline} />
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
          <div className="flex gap-5 h-full" style={{ minWidth: stages.length * 280 + "px" }}>
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
                        title={lead.score ? `Score ${lead.score.value}: ${SCORE_TIER_LABEL[lead.score.tier]}` : undefined}
                        style={lead.score ? { borderLeftWidth: 3, borderLeftColor: SCORE_TIER_BORDER[lead.score.tier] } : undefined}
                        className={`relative bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3.5 mb-2 cursor-grab active:cursor-grabbing hover:border-white/20 transition-all group ${
                          movingId === lead.id ? "opacity-40" : ""
                        }`}
                      >
                        {/* Botão WhatsApp rápido — escondido quando Evolution validou que não tem WhatsApp */}
                        {lead.hasWhatsapp !== false && (
                          <a
                            href={whatsappEnabled ? leadhubInboxUrl(lead.phone) : waMeUrl(lead.phone)}
                            target={whatsappEnabled ? "_self" : "_blank"}
                            rel={whatsappEnabled ? undefined : "noopener noreferrer"}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            draggable={false}
                            title={whatsappEnabled ? "Abrir conversa no LeadHub" : "Abrir no WhatsApp Web"}
                            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-md bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/30 hover:text-emerald-200 opacity-0 group-hover:opacity-100 transition-opacity text-[12px] z-10"
                            aria-label="WhatsApp"
                          >
                            💬
                          </a>
                        )}

                        {/* Linha de cima: origem + WhatsApp badge + tarefa-badge + data */}
                        <div className="flex items-center justify-between gap-2 mb-1.5 pr-7">
                          <div className="flex items-center gap-1 min-w-0">
                            <SourceBadge source={lead.source} size="xs" />
                            {lead.hasWhatsapp === true && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-medium" title="Número validado com WhatsApp">
                                ✓ WA
                              </span>
                            )}
                            {lead.hasWhatsapp === false && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-slate-500/15 text-slate-400 border border-slate-500/25 font-medium" title="Evolution validou: este número não tem WhatsApp">
                                ✗ Sem WA
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {(() => {
                              const badge = leadTaskBadge(lead.taskSummary);
                              if (!badge) return null;
                              return (
                                <span
                                  title={badge.tip}
                                  className={`w-2 h-2 rounded-full ${badge.dot} ring-2 ring-[#0f1623]`}
                                  aria-label={badge.tip}
                                />
                              );
                            })()}
                            <span className="text-slate-700 text-[10px] flex-shrink-0" title={`Criado em ${new Date(lead.createdAt).toLocaleDateString("pt-BR")} · Atualizado em ${new Date(lead.updatedAt).toLocaleString("pt-BR")}`}>
                              {relativeShort(lead.updatedAt)}
                            </span>
                          </div>
                        </div>

                        {/* Termômetro de engajamento — só renderiza pra prospects/leads com source SerpAPI
                            ou que tenham diagnóstico/clique (não polui leads de outras origens). */}
                        {(lead.source === "SerpAPI" || lead.diagnosisAt || lead.diagnosisClickedAt) && (
                          <EngagementMeter
                            hasDiagnosis={!!lead.diagnosisAt}
                            clickedLink={!!lead.diagnosisClickedAt}
                          />
                        )}

                        {/* Nome */}
                        <div className="text-white text-[13px] font-semibold mb-0.5 truncate">
                          {lead.name ?? lead.phone}
                        </div>
                        {lead.name && (
                          <div className="text-slate-600 text-[10px] mb-1">{lead.phone}</div>
                        )}

                        {/* Tags compactas */}
                        {(lead.tags ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1">
                            {(lead.tags ?? []).slice(0, 4).map((t) => (
                              <span
                                key={t.id}
                                className="inline-flex items-center px-1.5 py-px rounded-full text-[9px] font-medium border"
                                style={{
                                  backgroundColor: `${t.color}22`,
                                  borderColor: `${t.color}55`,
                                  color: t.color,
                                }}
                              >
                                {t.name}
                              </span>
                            ))}
                            {(lead.tags?.length ?? 0) > 4 && (
                              <span className="text-slate-600 text-[9px] self-center">
                                +{(lead.tags?.length ?? 0) - 4}
                              </span>
                            )}
                          </div>
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
                <h2 className="text-white font-bold text-base flex items-center gap-2">
                  <pipelineInfo.Icon className="w-4 h-4" stroke={gradStroke(pipelineInfo.grad)} strokeWidth={2.25} />
                  Adicionar em {pipelineInfo.label}
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

              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">E-mail</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="Ex: contato@empresa.com.br"
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
              <div className="min-w-0 flex-1">
                <h2 className="text-white font-bold text-lg truncate">{selected.name ?? selected.phone}</h2>
                {selected.name && (
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-slate-500 text-xs font-mono">{selected.phone}</span>
                    {selected.hasWhatsapp === true && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-medium">
                        ✓ Tem WhatsApp
                      </span>
                    )}
                    {selected.hasWhatsapp === false && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400 border border-slate-500/25 font-medium">
                        ✗ Sem WhatsApp
                      </span>
                    )}
                    {selected.hasWhatsapp === null && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/80 border border-amber-500/20 font-medium" title="Número ainda não foi validado via Evolution. Use 🔄 Atualizar dados pra validar.">
                        ⏳ Não validado
                      </span>
                    )}
                  </div>
                )}

                {/* Dropdowns de Pipeline e Etapa */}
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  <select
                    value={selected.pipeline ?? pipeline}
                    onChange={(e) => moveToPipeline(selected.id, e.target.value)}
                    className="bg-[#1e2d45]/60 hover:bg-[#1e2d45] border border-[#1e2d45] rounded-lg px-2.5 py-1 text-xs text-slate-200 cursor-pointer focus:outline-none focus:border-indigo-500"
                    title="Pipeline"
                  >
                    {Object.entries(PIPELINE_LABELS).map(([key, info]) => (
                      <option key={key} value={key}>{info.emoji} {info.label}</option>
                    ))}
                  </select>

                  {stages.length > 0 && (
                    <select
                      value={selected.pipelineStage ?? stages[0].name}
                      onChange={(e) => {
                        const newStage = e.target.value;
                        const target = stages.find((s) => s.name === newStage);
                        if (isLostStage(target)) {
                          setLostReasonText("");
                          setLostReasonModal({ leadId: selected.id, stageName: newStage });
                          return;
                        }
                        moveToStage(selected.id, newStage);
                        setSelected({ ...selected, pipelineStage: newStage });
                      }}
                      className="bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/25 rounded-lg px-2.5 py-1 text-xs text-indigo-300 cursor-pointer focus:outline-none focus:border-indigo-500"
                      title="Etapa"
                      style={{ borderLeftWidth: 3, borderLeftColor: stages.find((s) => s.name === selected.pipelineStage)?.color ?? "#6366f1" }}
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <button onClick={() => setSelected(null)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-[#1e2d45] transition-colors text-lg flex-shrink-0">
                ×
              </button>
            </div>

            {/* ── Corpo: 2 colunas ── */}
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">

              {/* ── Coluna esquerda: informações ── */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 md:border-r border-[#1e2d45]">

                {/* ─── Grupo 1: STATUS DO LEAD ─── */}
                <div className="text-[9px] uppercase tracking-[0.15em] text-slate-600 font-bold pt-1">
                  Status do lead
                </div>

                {/* Lead score — temperatura do lead */}
                {selected.score && (
                  <div
                    className="bg-[#0a0f1a] border rounded-xl p-3 flex items-center gap-3"
                    style={{ borderColor: `${SCORE_TIER_BORDER[selected.score.tier]}55` }}
                  >
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0"
                      style={{ backgroundColor: SCORE_TIER_BORDER[selected.score.tier] }}
                    >
                      {selected.score.value}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm font-semibold">
                        {SCORE_TIER_LABEL[selected.score.tier]}
                      </div>
                      <div className="text-slate-500 text-[10px] mt-0.5 leading-tight" title={selected.score.reasons.join(" · ")}>
                        {selected.score.reasons.length > 0
                          ? selected.score.reasons.slice(0, 2).join(" · ") + (selected.score.reasons.length > 2 ? "…" : "")
                          : "Sem sinais ainda"}
                      </div>
                    </div>
                  </div>
                )}

                {/* Bloco de Origem — bem destacado no topo */}
                <div className="bg-gradient-to-br from-[#0f1825] to-[#0a0f1a] border border-[#1e2d45] rounded-xl p-4">
                  <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-2 font-semibold flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" stroke={gradStroke("crm")} strokeWidth={2.5} />
                    Origem
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <SourceBadge source={selected.source} size="md" />
                    {selected.campaign && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-orange-500/15 text-orange-300 border-orange-500/25">
                        📣 {selected.campaign.name}
                      </span>
                    )}
                    {selected.trackingLink && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-indigo-500/15 text-indigo-300 border-indigo-500/25">
                        🔗 /r/{selected.trackingLink.code}
                        <span className="text-indigo-400/70 ml-1">· {selected.trackingLink._count.clickEvents} cliques</span>
                      </span>
                    )}
                  </div>

                  {/* Rastreabilidade da promoção: veio de outro pipeline + via qual gatilho */}
                  {selected.promotedFromPipeline && (
                    <div className="mt-2.5 pt-2.5 border-t border-[#1e2d45] space-y-1.5">
                      <div className="text-slate-500 text-[10px] uppercase tracking-wide font-semibold">↗️ Conversão</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                          {selected.promotedFromPipeline === "PROSPECCAO" ? "🔎 Veio de Prospecção" :
                           selected.promotedFromPipeline === "LEADS" ? "🎯 Veio de Leads" :
                           `↗️ Veio de ${selected.promotedFromPipeline}`}
                        </span>
                        {selected.promotedReason === "email_click" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/25">
                            📧 Clicou no e-mail
                          </span>
                        )}
                        {selected.promotedReason === "link_click" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">
                            🔗 Clicou no link
                          </span>
                        )}
                        {selected.promotedViaEmailCampaign && (
                          <a
                            href={`/campanhas/email/campanhas/${selected.promotedViaEmailCampaign.id}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/25 hover:bg-violet-500/20 transition-colors"
                            title="Abrir campanha"
                          >
                            🚀 {selected.promotedViaEmailCampaign.name}
                          </a>
                        )}
                        {selected.promotedAt && (
                          <span className="text-slate-600 text-[10px]">
                            em {new Date(selected.promotedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Tags ── */}
                <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-slate-500 text-[10px] uppercase tracking-wide font-semibold flex items-center gap-1.5">
                      <Tag className="w-3 h-3" stroke={gradStroke("setores")} strokeWidth={2.5} />
                      Tags
                    </div>
                    {!tagPickerOpen && (
                      <button
                        onClick={() => { setTagPickerOpen(true); setTagSearch(""); loadAllTags(); }}
                        className="text-slate-600 hover:text-slate-400 text-[10px]"
                      >
                        + Adicionar
                      </button>
                    )}
                  </div>

                  {/* Tags atribuídas */}
                  {(selected.tags ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {selected.tags?.map((t) => (
                        <span
                          key={t.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border group/tag"
                          style={{
                            backgroundColor: `${t.color}22`,
                            borderColor: `${t.color}55`,
                            color: t.color,
                          }}
                        >
                          {t.name}
                          <button
                            onClick={() => handleDetachTag(t)}
                            className="opacity-50 hover:opacity-100 ml-0.5 text-[10px] leading-none"
                            title="Remover tag"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {tagPickerOpen && (
                    <div className="space-y-2 bg-[#0f1623] border border-[#1e2d45] rounded-lg p-2">
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          type="text"
                          value={tagSearch}
                          onChange={(e) => setTagSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); handleQuickCreateTag(); }
                          }}
                          placeholder="Digite nome ou crie nova (Enter)"
                          className="flex-1 bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                        />
                        <button
                          onClick={() => { setTagPickerOpen(false); setTagSearch(""); }}
                          className="text-slate-500 hover:text-white text-xs px-2"
                        >
                          ✕
                        </button>
                      </div>

                      {loadingAllTags ? (
                        <div className="text-slate-600 text-[10px] text-center py-2">Carregando...</div>
                      ) : (
                        <div className="max-h-40 overflow-y-auto space-y-0.5">
                          {(() => {
                            const q = tagSearch.trim().toLowerCase();
                            const assignedIds = new Set((selected.tags ?? []).map((t) => t.id));
                            const matches = allTags
                              .filter((t) => !assignedIds.has(t.id))
                              .filter((t) => !q || t.name.toLowerCase().includes(q))
                              .slice(0, 30);

                            if (matches.length === 0 && q) {
                              return (
                                <button
                                  onClick={handleQuickCreateTag}
                                  disabled={savingTag}
                                  className="w-full text-left px-2 py-1.5 rounded text-xs text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-50"
                                >
                                  + Criar tag &quot;{tagSearch.trim()}&quot;
                                </button>
                              );
                            }

                            return matches.map((t) => (
                              <button
                                key={t.id}
                                onClick={() => handleAttachTag(t)}
                                disabled={savingTag}
                                className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.03] disabled:opacity-50 text-left"
                              >
                                <span
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: t.color }}
                                />
                                <span className="text-xs text-slate-200 truncate">{t.name}</span>
                              </button>
                            ));
                          })()}
                          {allTags.filter((t) => !(selected.tags ?? []).some((s) => s.id === t.id)).length === 0 && !tagSearch && (
                            <p className="text-slate-600 text-[10px] text-center py-2 italic">
                              Nenhuma tag criada ainda. Digite um nome e tecle Enter pra criar.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {(selected.tags ?? []).length === 0 && !tagPickerOpen && (
                    <p className="text-slate-700 text-[10px] italic">Nenhuma tag. Clique em &quot;Adicionar&quot;.</p>
                  )}
                </div>

                {/* ─── Grupo 2: PRÓXIMA AÇÃO ─── */}
                <div className="text-[9px] uppercase tracking-[0.15em] text-slate-600 font-bold pt-3 border-t border-[#1e2d45]">
                  Próxima ação
                </div>

                {/* ── Tarefas / Follow-ups (ação primária — vem antes da info) ── */}
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-amber-400 text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5">
                      <Clock className="w-3 h-3" stroke={gradStroke("atendimento")} strokeWidth={2.5} />
                      Próximos passos
                      {tasks.filter((t) => !t.done).length > 0 && (
                        <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                          {tasks.filter((t) => !t.done).length} aberta(s)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quick-add */}
                  <form onSubmit={handleAddTask} className="space-y-2 mb-3">
                    <input
                      type="text"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      placeholder="O que fazer? (ex: Ligar pra confirmar reunião)"
                      className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60"
                    />
                    <div className="flex gap-2">
                      <input
                        type="datetime-local"
                        value={newTaskDue}
                        onChange={(e) => setNewTaskDue(e.target.value)}
                        className="flex-1 bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500/60"
                      />
                      <button
                        type="submit"
                        disabled={savingTask || !newTaskTitle.trim()}
                        className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-40 transition-colors whitespace-nowrap"
                      >
                        {savingTask ? "..." : "+ Tarefa"}
                      </button>
                    </div>
                  </form>

                  {/* Lista */}
                  {loadingTasks ? (
                    <p className="text-slate-600 text-xs text-center py-2">Carregando...</p>
                  ) : tasks.length === 0 ? (
                    <p className="text-slate-600 text-xs italic text-center py-2">Nenhuma tarefa. Crie um follow-up acima.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {tasks.map((t) => {
                        const due = formatTaskDue(t.dueAt, t.done);
                        const isAuto = t.source === "AUTO_LINK_OPEN";
                        const isHotOpen = isAuto && !t.done;
                        return (
                          <li
                            key={t.id}
                            className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border ${
                              t.done
                                ? "bg-[#0a0f1a]/40 border-[#1e2d45]/40"
                                : isHotOpen
                                ? "bg-red-500/10 border-red-500/30 hover:border-red-500/50"
                                : "bg-[#0a0f1a] border-[#1e2d45] hover:border-amber-500/30"
                            } group`}
                          >
                            <button
                              onClick={() => handleToggleTask(t)}
                              className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] transition-colors ${
                                t.done
                                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                                  : isHotOpen
                                  ? "border-red-400 hover:bg-red-500/20"
                                  : "border-slate-600 hover:border-amber-400"
                              }`}
                              title={t.done ? "Reabrir tarefa" : "Marcar como feita"}
                            >
                              {t.done ? "✓" : ""}
                            </button>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <div className={`text-xs leading-tight ${
                                  t.done
                                    ? "text-slate-500 line-through"
                                    : isHotOpen
                                    ? "text-red-200 font-medium"
                                    : "text-slate-200"
                                }`}>
                                  {t.title}
                                </div>
                                {isHotOpen && (
                                  <span className="bg-red-500/25 text-red-200 border border-red-500/40 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded">
                                    Sinal quente
                                  </span>
                                )}
                              </div>
                              <div className={`text-[10px] mt-0.5 ${due.color}`}>
                                {due.label}
                                {t.assignee && <span className="text-slate-600 ml-2">· {t.assignee.name}</span>}
                                {isAuto && !t.assignee && <span className="text-slate-600 ml-2">· sem responsável</span>}
                              </div>
                              {isHotOpen && t.notes && (
                                <div className="text-[10px] text-red-300/70 mt-1 italic line-clamp-2">{t.notes}</div>
                              )}
                            </div>

                            <button
                              onClick={() => handleDeleteTask(t)}
                              className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 text-xs transition-all flex-shrink-0"
                              title="Remover"
                            >
                              ✕
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* ─── Grupo 3: INFORMAÇÕES ─── */}
                <div className="flex items-center justify-between pt-3 border-t border-[#1e2d45]">
                  <div className="text-[9px] uppercase tracking-[0.15em] text-slate-600 font-bold">
                    Informações
                  </div>
                  {!editingContact && (
                    <button
                      onClick={startEditingContact}
                      className="text-[10px] px-2 py-0.5 rounded bg-[#1e2d45] hover:bg-[#2a3a55] text-slate-300 hover:text-white font-medium transition-colors"
                      title="Editar nome, telefone, e-mail, site e redes sociais"
                    >
                      ✏️ Editar contato
                    </button>
                  )}
                </div>

                {/* Form de edição de contato (substitui a grade quando ativo) */}
                {editingContact && (
                  <div className="bg-[#0f1623] border border-indigo-700/40 rounded-lg p-3 space-y-2">
                    {([
                      ["name", "Nome", "text"],
                      ["phone", "Telefone *", "text"],
                      ["email", "E-mail", "email"],
                      ["website", "Site", "text"],
                      ["instagram", "Instagram (URL)", "text"],
                      ["facebook", "Facebook (URL)", "text"],
                      ["city", "Cidade", "text"],
                      ["segment", "Segmento", "text"],
                    ] as const).map(([field, label, type]) => (
                      <div key={field}>
                        <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-0.5">{label}</label>
                        <input
                          type={type}
                          value={(contactForm as any)[field]}
                          onChange={(e) => setContactForm((f) => ({ ...f, [field]: e.target.value }))}
                          className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={handleSaveContact}
                        disabled={savingContact}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors disabled:opacity-60"
                      >
                        {savingContact ? "Salvando..." : "Salvar"}
                      </button>
                      <button
                        onClick={() => setEditingContact(false)}
                        className="px-3 py-1.5 rounded-lg bg-[#1e2d45] hover:bg-[#2a3a55] text-slate-300 text-xs transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {/* Grid de dados principais */}
                {!editingContact && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#161f30] rounded-lg p-3">
                    <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Abertura</div>
                    <div className="text-white text-sm">
                      {new Date(selected.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </div>
                  </div>
                  <div className="bg-[#161f30] rounded-lg p-3 group/exp">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-slate-500 text-[10px] uppercase tracking-wide">Previsão de retorno</div>
                      {!editingExpected && (
                        <button
                          onClick={() => {
                            setExpectedInput(selected.expectedReturnAt ? new Date(selected.expectedReturnAt).toISOString().slice(0, 10) : "");
                            setEditingExpected(true);
                          }}
                          className="opacity-0 group-hover/exp:opacity-100 text-slate-600 hover:text-slate-400 text-[10px] transition-opacity"
                        >
                          ✏️
                        </button>
                      )}
                    </div>
                    {editingExpected ? (
                      <form onSubmit={handleSaveExpected} className="flex gap-1">
                        <input
                          autoFocus
                          type="date"
                          value={expectedInput}
                          onChange={(e) => setExpectedInput(e.target.value)}
                          className="flex-1 bg-[#0a0f1a] border border-[#1e2d45] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500"
                        />
                        <button type="submit" className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px]">OK</button>
                        <button type="button" onClick={() => setEditingExpected(false)} className="text-slate-500 text-xs hover:text-white px-1">✕</button>
                      </form>
                    ) : (
                      <div className={`text-sm ${selected.expectedReturnAt ? "text-amber-400" : "text-slate-600"}`}>
                        {selected.expectedReturnAt
                          ? new Date(selected.expectedReturnAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
                          : "—"}
                      </div>
                    )}
                  </div>

                  {selected.email && (
                    <div className="bg-[#161f30] rounded-lg p-3 col-span-2">
                      <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">E-mail</div>
                      <div className="text-white text-sm">
                        <a
                          href={`mailto:${selected.email}`}
                          className="text-white hover:text-indigo-400 transition-colors"
                        >
                          {selected.email}
                        </a>
                      </div>
                    </div>
                  )}

                  {(selected.website || selected.instagram || selected.facebook || selected.address || selected.city || selected.segment || selected.source === "SerpAPI" || selected.externalId) && (
                    <div className="bg-[#161f30] rounded-lg p-3 col-span-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-slate-500 text-[10px] uppercase tracking-wide">Dados do prospect</div>
                        {(selected.source === "SerpAPI" || selected.externalId) && (
                          <button
                            onClick={handleEnrichProspect}
                            disabled={enrichingProspect}
                            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600/80 hover:bg-indigo-500 text-white font-medium transition-colors disabled:opacity-60"
                            title="Re-roda scraper do site + valida WhatsApp pra preencher campos vazios. Não sobrescreve dado editado à mão."
                          >
                            {enrichingProspect ? "⏳ Atualizando..." : "🔄 Atualizar dados"}
                          </button>
                        )}
                      </div>
                      {enrichProspectMsg && (
                        <div
                          className={`text-[11px] rounded px-1.5 py-1 ${
                            enrichProspectMsg.ok
                              ? "text-emerald-300 bg-emerald-950/40 border border-emerald-900"
                              : "text-red-300 bg-red-950/40 border border-red-900"
                          }`}
                        >
                          {enrichProspectMsg.ok ? "✅" : "⚠️"} {enrichProspectMsg.text}
                        </div>
                      )}
                      {selected.segment && (
                        <div className="flex items-baseline gap-2 text-sm">
                          <span className="text-slate-500 text-[11px] w-16 shrink-0">Segmento</span>
                          <span className="text-indigo-300 bg-indigo-950/50 px-1.5 py-0.5 rounded text-xs">{selected.segment}</span>
                        </div>
                      )}
                      {selected.city && (
                        <div className="flex items-baseline gap-2 text-sm">
                          <span className="text-slate-500 text-[11px] w-16 shrink-0">Cidade</span>
                          <span className="text-white">{selected.city}</span>
                        </div>
                      )}
                      {selected.address && (
                        <div className="flex items-baseline gap-2 text-sm">
                          <span className="text-slate-500 text-[11px] w-16 shrink-0">Endereço</span>
                          <span className="text-white text-xs">📍 {selected.address}</span>
                        </div>
                      )}
                      {selected.website && (
                        <div className="flex items-baseline gap-2 text-sm">
                          <span className="text-slate-500 text-[11px] w-16 shrink-0">Site</span>
                          <a
                            href={selected.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-400 hover:underline truncate text-xs"
                          >
                            🌐 {(() => { try { return new URL(selected.website!).hostname; } catch { return selected.website; } })()}
                          </a>
                        </div>
                      )}
                      {selected.instagram && (
                        <div className="flex items-baseline gap-2 text-sm">
                          <span className="text-slate-500 text-[11px] w-16 shrink-0">Instagram</span>
                          <a
                            href={selected.instagram}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-pink-400 hover:underline text-xs"
                          >
                            📷 {selected.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, "@")}
                          </a>
                        </div>
                      )}
                      {selected.facebook && (
                        <div className="flex items-baseline gap-2 text-sm">
                          <span className="text-slate-500 text-[11px] w-16 shrink-0">Facebook</span>
                          <a
                            href={selected.facebook}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline text-xs"
                          >
                            👤 {selected.facebook.replace(/^https?:\/\/(www\.)?facebook\.com\//, "/")}
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Diagnóstico IA (Prospecta IA) ───────────────────── */}
                  {(selected.source === "SerpAPI" || selected.externalId || selected.website || selected.instagram) && (
                    <div className="bg-[#161f30] rounded-lg p-3 col-span-2 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="text-slate-500 text-[10px] uppercase tracking-wide">
                          Diagnóstico IA
                          {selected.diagnosisAt && (
                            <span className="text-slate-600 normal-case ml-2">
                              · gerado {new Date(selected.diagnosisAt).toLocaleDateString("pt-BR")}
                              {selected.diagnosisSource && ` · fonte: ${selected.diagnosisSource}`}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1.5">
                          {selected.diagnosis && selected.diagnosisToken && (
                            <button
                              onClick={handleCopyDiagnosisLink}
                              className="text-[10px] px-2 py-0.5 rounded bg-[#1e2d45] hover:bg-[#2a3a55] text-slate-300 hover:text-white font-medium transition-colors"
                              title="Copia o link público que mostra o diagnóstico e converte o prospect em lead quando clicado"
                            >
                              {copiedDiagLink ? "✓ Copiado!" : "📋 Copiar link"}
                            </button>
                          )}
                          <button
                            onClick={handleDiagnoseProspect}
                            disabled={diagnosingProspect}
                            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600/80 hover:bg-indigo-500 text-white font-medium transition-colors disabled:opacity-60"
                            title="Gera análise IA do site/Instagram. Custa ~$0.001 (OpenAI) + 1 chamada PageSpeed gratuita."
                          >
                            {diagnosingProspect
                              ? "⏳ Gerando..."
                              : selected.diagnosisAt
                              ? "🔄 Regenerar"
                              : "🔍 Gerar diagnóstico"}
                          </button>
                        </div>
                      </div>
                      {diagnoseProspectMsg && (
                        <div
                          className={`text-[11px] rounded px-1.5 py-1 ${
                            diagnoseProspectMsg.ok
                              ? "text-emerald-300 bg-emerald-950/40 border border-emerald-900"
                              : "text-red-300 bg-red-950/40 border border-red-900"
                          }`}
                        >
                          {diagnoseProspectMsg.ok ? "✅" : "⚠️"} {diagnoseProspectMsg.text}
                        </div>
                      )}
                      {selected.diagnosisClickedAt && (
                        <div className="text-[11px] text-rose-300 bg-rose-950/30 border border-rose-900/50 rounded px-1.5 py-1">
                          🔥 Prospect clicou no link em {new Date(selected.diagnosisClickedAt).toLocaleDateString("pt-BR")} — promovido pra Leads automaticamente
                        </div>
                      )}
                      {selected.diagnosis ? (
                        <div className="space-y-2 mt-1">
                          {selected.diagnosis.summary && (
                            <p className="text-slate-300 text-xs italic leading-relaxed">{selected.diagnosis.summary}</p>
                          )}
                          {(selected.diagnosis.positives ?? []).length > 0 && (
                            <DiagBlock title="✅ Pontos fortes" tint="emerald" items={selected.diagnosis.positives ?? []} />
                          )}
                          {(selected.diagnosis.opportunities ?? []).length > 0 && (
                            <DiagBlock title="⚠️ Oportunidades" tint="amber" items={selected.diagnosis.opportunities ?? []} />
                          )}
                          {(selected.diagnosis.criticals ?? []).length > 0 && (
                            <DiagBlock title="🔴 Quick wins" tint="rose" items={selected.diagnosis.criticals ?? []} />
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 italic">
                          Ainda não há diagnóstico. Clique em "🔍 Gerar diagnóstico" pra analisar site/Instagram via IA.
                        </p>
                      )}
                    </div>
                  )}

                  {selected.company && (
                    <div className="bg-[#161f30] rounded-lg p-3 col-span-2">
                      <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Empresa</div>
                      <div className="text-white text-sm flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5" stroke={gradStroke("empresa")} strokeWidth={2.25} />
                        {selected.company.name}
                      </div>
                    </div>
                  )}

                  {selected.campaign && (
                    <div className="bg-[#161f30] rounded-lg p-3 col-span-2">
                      <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Campanha</div>
                      <div className="text-white text-sm">📣 {selected.campaign.name}</div>
                    </div>
                  )}
                </div>
                )}

                {/* ── Campos customizados (renderiza se a empresa tem defs) ── */}
                {customDefs.length > 0 && (
                  <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-slate-500 text-[10px] uppercase tracking-wide font-semibold flex items-center gap-1.5">
                        <FileText className="w-3 h-3" stroke={gradStroke("pipeline")} strokeWidth={2.5} />
                        Campos personalizados
                      </div>
                      <a href="/configuracoes?secao=custom-fields" className="text-slate-600 hover:text-slate-400 text-[10px]">
                        ⚙️ Gerenciar
                      </a>
                    </div>
                    <div className="space-y-2.5">
                      {customDefs.map((def) => (
                        <CustomFieldRow
                          key={def.id}
                          def={def}
                          value={customValues[def.id] ?? ""}
                          saving={savingCustomField === def.id}
                          onSave={(v) => handleSaveCustomField(def.id, v)}
                        />
                      ))}
                    </div>
                  </div>
                )}

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
                    <div className="text-violet-400 text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5">
                      <FileText className="w-3 h-3" stroke={gradStroke("integracoes")} strokeWidth={2.5} />
                      Descrição / Observações
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

                {/* ─── Grupo 4: CONEXÕES EXTERNAS ─── */}
                <div className="text-[9px] uppercase tracking-[0.15em] text-slate-600 font-bold pt-3 border-t border-[#1e2d45]">
                  Conexões
                </div>

                {/* ── Integrações (agrupadas — só mostra as ativas) ── */}
                {(whatsappEnabled || clickupEnabled || true) && (
                  <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl overflow-hidden">
                    <button
                      onClick={() => setIntegrationsOpen(!integrationsOpen)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#0f1825] transition-colors"
                    >
                      <span className="text-white text-sm font-semibold flex items-center gap-2">
                        <Plug className="w-4 h-4" stroke={gradStroke("integracoes")} strokeWidth={2.25} />
                        Conexões externas
                      </span>
                      <span className={`text-slate-500 text-xs transition-transform ${integrationsOpen ? "rotate-180" : ""}`}>▾</span>
                    </button>

                    {integrationsOpen && (
                      <div className="px-4 pb-4 space-y-3 border-t border-[#1e2d45]">

                        {/* WhatsApp — escondido quando Evolution validou que o número NÃO tem WhatsApp.
                            Quando null/true: mostra os botões normalmente. */}
                        <div className="pt-3">
                          <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-2 font-semibold flex items-center gap-1.5">
                            <MessageSquare className="w-3 h-3" stroke={gradStroke("whatsapp")} strokeWidth={2.5} />
                            WhatsApp
                            {selected.hasWhatsapp === true && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-medium normal-case tracking-normal">
                                ✓ validado
                              </span>
                            )}
                            {selected.hasWhatsapp === false && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-slate-500/15 text-slate-400 border border-slate-500/25 font-medium normal-case tracking-normal">
                                ✗ sem WhatsApp
                              </span>
                            )}
                          </div>
                          {selected.hasWhatsapp === false ? (
                            <div className="text-xs text-slate-500 italic">
                              Evolution confirmou que este número não tem WhatsApp. Botões ocultos pra não tentar mensagem em vão.
                            </div>
                          ) : (
                          <div className="flex flex-wrap gap-2">
                            {whatsappEnabled && (
                              <a
                                href={leadhubInboxUrl(selected.phone)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/25 text-xs font-medium transition-colors"
                              >
                                💬 Abrir no LeadHub
                              </a>
                            )}
                            <a
                              href={waMeUrl(selected.phone)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                whatsappEnabled
                                  ? "bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white"
                                  : "bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/25"
                              }`}
                            >
                              🌐 WhatsApp Web
                            </a>
                            {whatsappEnabled && (
                              <button
                                onClick={() => { setShowLinkConv(!showLinkConv); setLinkResult(null); setLinkPhone(""); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white text-xs transition-colors"
                              >
                                🔗 Vincular outra conversa {showLinkConv ? "▴" : "▾"}
                              </button>
                            )}
                          </div>
                          )}
                            {showLinkConv && selected.hasWhatsapp !== false && (
                              <div className="mt-2 space-y-2 bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3">
                                <p className="text-slate-500 text-[10px]">Cole o telefone da conversa para vincular as mensagens a este lead.</p>
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

                        {/* ClickUp — só se ativo */}
                        {clickupEnabled && (
                          <div className="pt-3 border-t border-[#1e2d45]">
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-slate-500 text-[10px] uppercase tracking-wide font-semibold flex items-center gap-1.5">
                                <CheckSquare className="w-3 h-3" stroke={gradStroke("clickup")} strokeWidth={2.5} />
                                ClickUp
                              </div>
                              {!editingClickup && selected.clickupTaskId && (
                                <button onClick={() => { setEditingClickup(true); setClickupInput(selected.clickupTaskId ?? ""); }} className="text-slate-600 hover:text-slate-400 text-[10px]">✏️ Editar</button>
                              )}
                            </div>
                            {editingClickup ? (
                              <form onSubmit={handleSaveClickup} className="space-y-2">
                                <input autoFocus type="text" value={clickupInput} onChange={(e) => setClickupInput(e.target.value)}
                                  placeholder="ID ou URL da tarefa no ClickUp"
                                  className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono" />
                                <div className="flex gap-2">
                                  <button type="submit" disabled={savingClickup} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-50">
                                    {savingClickup ? "Salvando..." : "Salvar"}
                                  </button>
                                  <button type="button" onClick={() => setEditingClickup(false)} className="text-slate-500 text-xs hover:text-white">Cancelar</button>
                                </div>
                              </form>
                            ) : selected.clickupTaskId ? (
                              <a href={selected.clickupTaskId.startsWith("http") ? selected.clickupTaskId : `https://app.clickup.com/t/${selected.clickupTaskId}`}
                                target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/25 text-xs font-medium transition-colors">
                                ↗ Abrir tarefa
                              </a>
                            ) : (
                              <div className="space-y-2">
                                <button onClick={handleSyncClickup} disabled={syncingClickup}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 text-xs font-medium transition-colors disabled:opacity-50">
                                  {syncingClickup ? <><span className="animate-spin">⏳</span> Criando...</> : "+ Criar tarefa no ClickUp"}
                                </button>
                                {syncClickupError && <p className="text-red-400 text-[10px] bg-red-500/10 border border-red-500/20 rounded p-2">{syncClickupError}</p>}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Link de rastreamento — sempre disponível */}
                        <div className="pt-3 border-t border-[#1e2d45]">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-slate-500 text-[10px] uppercase tracking-wide font-semibold flex items-center gap-1.5">
                              <Link2 className="w-3 h-3" stroke={gradStroke("links")} strokeWidth={2.5} />
                              Link de rastreamento
                            </div>
                            {selected.trackingLink && !showLinkTracker && (
                              <button onClick={() => { setShowLinkTracker(true); loadTrackerLinks(); }} className="text-slate-600 hover:text-slate-400 text-[10px]">Trocar</button>
                            )}
                          </div>

                          {selected.trackingLink && !showLinkTracker ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <a href={`/r/${selected.trackingLink.code}`} target="_blank" rel="noopener noreferrer"
                                  className={`text-sm font-medium underline ${selected.trackingLink.isActive ? "text-indigo-400 hover:text-indigo-300" : "text-slate-400 hover:text-slate-300 line-through"}`}>
                                  {selected.trackingLink.label ?? selected.trackingLink.code}
                                </a>
                                <span className="text-[10px] text-slate-500 font-mono">/r/{selected.trackingLink.code}</span>
                                {!selected.trackingLink.isActive && (
                                  <span className="text-red-400 text-[10px] bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide">
                                    ⏸ Pausado
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-4 text-xs">
                                <span className="text-slate-400"><span className="text-white font-semibold">{selected.trackingLink.clicks}</span> cliques externos</span>
                                <span className="text-slate-400"><span className="text-white font-semibold">{selected.trackingLink._count.clickEvents}</span> internos</span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/r/${selected.trackingLink!.code}`)}
                                  className="text-[10px] px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 transition-colors">
                                  📋 Copiar
                                </button>
                                {selected.trackingLink.destination && (
                                  <a
                                    href={selected.trackingLink.destination}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Abre a URL original sem contar como clique externo"
                                    className="text-[10px] px-2 py-1 rounded bg-slate-500/10 border border-slate-500/20 text-slate-300 hover:bg-slate-500/20 transition-colors"
                                  >
                                    ↗ Original
                                  </a>
                                )}
                                <button
                                  onClick={async () => {
                                    const next = !selected.trackingLink!.isActive;
                                    const res = await fetch(`/api/tracking-links/${selected.trackingLink!.id}`, {
                                      method:  "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body:    JSON.stringify({ isActive: next }),
                                    });
                                    if (res.ok) {
                                      const updated = { ...selected.trackingLink!, isActive: next };
                                      setSelected({ ...selected, trackingLink: updated });
                                      setLeads((prev) => prev.map((l) => l.id === selected.id ? { ...l, trackingLink: updated } : l));
                                    }
                                  }}
                                  title={selected.trackingLink.isActive
                                    ? "Pausar: cliques seguem contando, mas o destino não abre"
                                    : "Reativar: o link volta a abrir o destino"}
                                  className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                                    selected.trackingLink.isActive
                                      ? "bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20"
                                      : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                                  }`}
                                >
                                  {selected.trackingLink.isActive ? "⏸ Pausar" : "▶ Reativar"}
                                </button>
                                <button onClick={() => handleLinkTracker(null)} disabled={savingTracker}
                                  className="text-[10px] px-2 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50">
                                  Desvincular
                                </button>
                              </div>
                            </div>
                          ) : !showLinkTracker ? (
                            <button onClick={() => { setShowLinkTracker(true); loadTrackerLinks(); }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161f30] border border-dashed border-[#2a3d5a] text-slate-500 hover:text-slate-300 hover:border-[#3a5070] text-xs transition-colors">
                              + Vincular link
                            </button>
                          ) : null}

                          {showLinkTracker && (
                            <div className="space-y-2 mt-2 bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3">
                              <input autoFocus type="text" value={trackerSearch} onChange={(e) => setTrackerSearch(e.target.value)}
                                placeholder="Buscar link..."
                                className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
                              {loadingTrackerLinks ? (
                                <div className="text-center text-slate-600 text-xs py-3">Carregando...</div>
                              ) : (
                                <div className="max-h-44 overflow-y-auto space-y-1">
                                  {(trackerLinks as any[])
                                    .filter((l: any) => !trackerSearch || (l.label ?? l.code).toLowerCase().includes(trackerSearch.toLowerCase()))
                                    .slice(0, 20)
                                    .map((l: any) => (
                                      <button key={l.id} onClick={() => handleLinkTracker(l.id)} disabled={savingTracker}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors disabled:opacity-50 ${
                                          selected.trackingLinkId === l.id
                                            ? "bg-indigo-500/20 border border-indigo-500/40 text-indigo-300"
                                            : "bg-[#0a0f1a] border border-[#1e2d45] text-slate-300 hover:bg-[#161f30] hover:text-white"
                                        }`}>
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
                              <button onClick={() => setShowLinkTracker(false)} className="text-slate-500 text-xs hover:text-white transition-colors">Cancelar</button>
                            </div>
                          )}
                        </div>

                      </div>
                    )}
                  </div>
                )}

                {/* ── Botão Ações (rodapé da coluna esquerda) ── */}
                <div className="border-t border-[#1e2d45] pt-4 relative">
                  {confirmDelete ? (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 space-y-2">
                      <p className="text-red-400 text-xs text-center">Tem certeza? Esta ação não pode ser desfeita.</p>
                      <div className="flex gap-2">
                        <button onClick={handleDeleteLead} disabled={deletingLead} className="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold disabled:opacity-50">
                          {deletingLead ? "Deletando..." : "Confirmar exclusão"}
                        </button>
                        <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 text-xs hover:text-white">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => setActionsOpen(!actionsOpen)}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white hover:bg-[#1a2540] text-xs font-medium transition-colors"
                      >
                        <Settings className="w-3.5 h-3.5" stroke={gradStroke("configuracoes")} strokeWidth={2.5} />
                        Ações <span className={`text-[10px] transition-transform ${actionsOpen ? "rotate-180" : ""}`}>▾</span>
                      </button>
                      {actionsOpen && (
                        <div className="absolute bottom-full left-0 right-0 mb-1 bg-[#0f1623] border border-[#1e2d45] rounded-lg shadow-xl overflow-hidden z-10">
                          <button
                            onClick={() => { setActionsOpen(false); handleRemoveFromPipeline(); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-amber-500/10 hover:text-amber-400 transition-colors text-left"
                          >
                            📥 Mover para Caixa de Entrada
                          </button>
                          <div className="border-t border-[#1e2d45]" />
                          <button
                            onClick={() => { setActionsOpen(false); setConfirmDelete(true); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors text-left"
                          >
                            🗑️ Deletar este lead
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* ── Coluna direita: timeline ── */}
              <div className="md:w-80 lg:w-96 flex flex-col flex-shrink-0 border-t md:border-t-0 border-[#1e2d45] min-h-0">
                {/* Header */}
                <div className="px-4 py-3 border-b border-[#1e2d45] flex-shrink-0 flex items-center gap-2 bg-[#0f1825]">
                  <span className="text-sm font-semibold text-white flex items-center gap-1.5">
                    <ActivityIcon className="w-3.5 h-3.5" stroke={gradStroke("relatorios")} strokeWidth={2.25} />
                    Atividade
                  </span>
                  {timeline.length > 0 && (
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded-full border border-indigo-500/30">
                      {timeline.length}
                    </span>
                  )}
                </div>

                {/* Novo comentário */}
                <form onSubmit={handleAddComment} className="px-4 py-3 border-b border-[#1e2d45] flex-shrink-0 space-y-2">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Adicionar anotação... (Ctrl+Enter)"
                    rows={2}
                    className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddComment(e as any);
                    }}
                  />
                  <button
                    type="submit"
                    disabled={savingComment || !newComment.trim()}
                    className="w-full py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
                  >
                    {savingComment ? "Salvando..." : "💬 Adicionar anotação"}
                  </button>
                </form>

                {/* Filtros — agrupam eventos por tipo */}
                <div className="px-3 py-2 border-b border-[#1e2d45] flex-shrink-0 flex flex-wrap gap-1">
                  {TIMELINE_FILTERS.map((f) => {
                    const count = f.id === "all"
                      ? timeline.length
                      : timeline.filter((e) => EVENT_GROUP[e.type] === f.id).length;
                    const active = timelineFilter === f.id;
                    const disabled = f.id !== "all" && count === 0;
                    return (
                      <button
                        key={f.id}
                        onClick={() => setTimelineFilter(f.id)}
                        disabled={disabled}
                        title={f.label}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                          active
                            ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200"
                            : "bg-[#0a0f1a] border-[#1e2d45] text-slate-400 hover:text-white hover:border-[#2a3d5a]"
                        }`}
                      >
                        <f.Icon className="w-3 h-3" stroke={gradStroke(f.grad)} strokeWidth={2.5} />
                        <span>{f.label}</span>
                        {count > 0 && (
                          <span className={`text-[9px] font-bold px-1 rounded ${
                            active ? "bg-indigo-500/30 text-indigo-100" : "bg-[#1e2d45] text-slate-500"
                          }`}>
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Timeline */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {loadingTimeline ? (
                    <div className="text-slate-600 text-xs text-center py-6">Carregando atividades...</div>
                  ) : timeline.length === 0 ? (
                    <div className="text-slate-700 text-xs text-center py-6">Nenhuma atividade registrada.</div>
                  ) : (() => {
                    const filtered = timelineFilter === "all"
                      ? timeline
                      : timeline.filter((e) => EVENT_GROUP[e.type] === timelineFilter);
                    if (filtered.length === 0) {
                      return (
                        <div className="text-slate-700 text-xs text-center py-6">
                          Nenhum evento neste filtro.
                        </div>
                      );
                    }
                    return filtered.map((evt) => {
                      const meta = TIMELINE_META[evt.type] ?? TIMELINE_META.lead_created;
                      return (
                        <div key={evt.id} className={`rounded-lg px-3 py-2.5 border ${meta.bg}`}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[11px] font-semibold flex items-center gap-1.5" style={{ color: meta.titleColor }}>
                              <span>{meta.icon}</span>
                              <span className="truncate">{evt.title}</span>
                            </span>
                            <span className="text-slate-500 text-[10px] flex-shrink-0">
                              {formatTimelineDate(evt.timestamp)}
                            </span>
                          </div>
                          {evt.body && (
                            <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap break-words">{evt.body}</p>
                          )}
                          {evt.type === "link_open" && evt.meta?.url && (
                            <a
                              href={evt.meta.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-amber-400 text-[10px] underline hover:text-amber-300 mt-1 inline-block break-all"
                            >
                              ↗ {evt.meta.url}
                            </a>
                          )}
                          {evt.type === "link_click" && evt.meta?.url && (
                            <a
                              href={evt.meta.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cyan-400 text-[10px] underline hover:text-cyan-300 mt-1 inline-block break-all"
                            >
                              ↗ {evt.meta.url}
                            </a>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Motivo de perda ── */}
      {lostReasonModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !lostReasonSaving && setLostReasonModal(null)}
          />
          <div className="relative bg-[#0c1220] border border-red-500/30 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#1e2d45] bg-red-500/5">
              <h2 className="text-white font-bold text-base flex items-center gap-2">
                <span>❌</span> Marcar como perdido
              </h2>
              <p className="text-slate-400 text-xs mt-1">
                Por que esse lead foi perdido? Essa informação alimenta os relatórios de funil.
              </p>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {LOST_REASON_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setLostReasonText(preset)}
                    className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                      lostReasonText === preset
                        ? "bg-red-500/20 border-red-500/50 text-red-200"
                        : "bg-[#161f30] border-[#1e2d45] text-slate-400 hover:text-white"
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <textarea
                autoFocus
                value={lostReasonText}
                onChange={(e) => setLostReasonText(e.target.value)}
                placeholder="Detalhe o motivo (obrigatório)..."
                rows={3}
                className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-red-500/60 resize-none"
              />

              <div className="flex gap-2 pt-1">
                <button
                  onClick={confirmLostReason}
                  disabled={lostReasonSaving || !lostReasonText.trim()}
                  className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {lostReasonSaving ? "Salvando..." : "Confirmar perda"}
                </button>
                <button
                  type="button"
                  onClick={() => { setLostReasonModal(null); setLostReasonText(""); }}
                  disabled={lostReasonSaving}
                  className="px-4 py-2.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white text-sm transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
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

/**
 * Renderiza UM campo customizado conforme o tipo. Salva no blur (TEXT/NUMBER)
 * ou no change (DATE/SELECT) — UX que vendedor já tá acostumado em formulários.
 */
function CustomFieldRow({
  def,
  value,
  saving,
  onSave,
}: {
  def: CustomFieldDef;
  value: string;
  saving: boolean;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Sincroniza quando o valor remoto mudar (ex: outro tab editou)
  useEffect(() => { setDraft(value); }, [value]);

  const baseInput = "w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50";

  return (
    <div>
      <label className="block text-slate-400 text-[10px] font-medium mb-1 flex items-center gap-1">
        {def.name}
        {def.required && <span className="text-red-400">*</span>}
        {saving && <span className="text-slate-600 text-[9px] ml-1">salvando...</span>}
      </label>

      {def.type === "TEXT" && (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft !== value) onSave(draft); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="—"
          disabled={saving}
          className={baseInput}
        />
      )}

      {def.type === "NUMBER" && (
        <input
          type="number"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft !== value) onSave(draft); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="0"
          disabled={saving}
          className={baseInput}
        />
      )}

      {def.type === "DATE" && (
        <input
          type="date"
          value={draft ? new Date(draft).toISOString().slice(0, 10) : ""}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            onSave(v);
          }}
          disabled={saving}
          className={baseInput}
        />
      )}

      {def.type === "SELECT" && (
        <select
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onSave(e.target.value);
          }}
          disabled={saving}
          className={`${baseInput} cursor-pointer`}
        >
          <option value="">—</option>
          {(def.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// Tempo relativo curto — "hoje", "ontem", "3d", "2sem", "1mo".
// Usado no card pra mostrar "atualizado há X".
function relativeShort(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  const ms = Date.now() - date.getTime();
  if (ms < 0) return "agora";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return minutes < 1 ? "agora" : `${minutes}m`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(ms / 86_400_000);
  if (days === 1) return "ontem";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}sem`;
  return `${Math.floor(days / 30)}mo`;
}

// Termômetro de engajamento do prospect — 4 etapas em pontinhos.
// Etapas 3-4 (email enviado/aberto) ficam cinza-placeholder até a Fase 3.
function EngagementMeter({
  hasDiagnosis,
  clickedLink,
}: {
  hasDiagnosis: boolean;
  clickedLink: boolean;
}) {
  // 4 dots: importado (sempre on se chegou aqui), diagnóstico, email (placeholder), clicou
  const dotClass = (active: boolean, color: string) =>
    `w-1.5 h-1.5 rounded-full ${active ? color : "bg-slate-800"}`;
  return (
    <div className="flex items-center gap-0.5 mt-1.5" title="Engajamento: importado · diagnóstico · email (em breve) · clicou">
      <div className={dotClass(true, "bg-sky-500")} title="Importado" />
      <div className={dotClass(hasDiagnosis, "bg-amber-400")} title={hasDiagnosis ? "Diagnóstico gerado" : "Sem diagnóstico"} />
      <div className="w-1.5 h-1.5 rounded-full bg-slate-800 opacity-50" title="Email enviado/aberto (disponível na Fase 3)" />
      <div className={dotClass(clickedLink, "bg-rose-500")} title={clickedLink ? "🔥 Clicou no link do diagnóstico" : "Não clicou no link"} />
      {clickedLink && <span className="text-[9px] text-rose-300 font-semibold ml-1">🔥</span>}
    </div>
  );
}

// Bloco visual de pontos do diagnóstico no drawer (reutilizado pelos 3 tipos)
function DiagBlock({
  title,
  tint,
  items,
}: {
  title: string;
  tint: "emerald" | "amber" | "rose";
  items: { title: string; detail: string }[];
}) {
  const colors = {
    emerald: { border: "border-emerald-700/40", bg: "bg-emerald-950/20", t: "text-emerald-300" },
    amber:   { border: "border-amber-700/40",   bg: "bg-amber-950/20",   t: "text-amber-300"   },
    rose:    { border: "border-rose-700/40",    bg: "bg-rose-950/20",    t: "text-rose-300"    },
  }[tint];
  return (
    <div className={`${colors.bg} ${colors.border} border rounded-md p-2`}>
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${colors.t} mb-1`}>{title}</div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-[11px] text-slate-200 leading-snug">
            <strong className="text-white">{it.title}</strong>
            {it.detail && <span className="text-slate-400"> — {it.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
