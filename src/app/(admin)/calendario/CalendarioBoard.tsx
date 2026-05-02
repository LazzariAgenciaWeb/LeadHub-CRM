"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Calendar, Clock, MessageSquare, LifeBuoy, Target,
  ChevronRight, RefreshCw, AlertTriangle, CheckCircle2,
  User, Hourglass, X, AlarmClock, Video, MapPin, ExternalLink,
  CalendarDays, List,
} from "lucide-react";
import WeekView from "./WeekView";
import DayView from "./DayView";

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Lead { id: string; name: string | null }

interface ScheduledConv {
  id: string;
  phone: string;
  scheduledReturnAt: string | null;
  returnNote: string | null;
  assigneeId: string | null;
  assignee: { id: string; name: string } | null;
  leads: Lead[];
}

interface WaitingConv {
  id: string;
  phone: string;
  statusUpdatedAt: string;
  assigneeId: string | null;
  assignee: { id: string; name: string } | null;
  leads: Lead[];
}

interface OpenConv {
  id: string;
  phone: string;
  status: string;
  lastMessageAt: string | null;
  lastMessageBody: string | null;
  unreadCount: number;
  leads: Lead[];
}

interface UrgentTicket {
  id: string;
  title: string;
  priority: string;
  status: string;
  createdAt: string;
  company: { id: string; name: string } | null;
}

interface LeadFollowUp {
  id: string;
  name: string | null;
  phone: string;
  pipeline: string | null;
  pipelineStage: string | null;
  expectedReturnAt: string | null;
  status: string;
}

interface GoogleEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end:   { dateTime?: string; date?: string; timeZone?: string };
  htmlLink?: string;
  hangoutLink?: string;
  attendees?: { email: string; displayName?: string }[];
}

interface Props {
  scheduledConvs: ScheduledConv[];
  waitingConvs:   WaitingConv[];
  myOpenConvs:    OpenConv[];
  urgentTickets:  UrgentTicket[];
  leadsFollowUp:  LeadFollowUp[];
  currentUserId:  string;
  isSuperAdmin:   boolean;
  googleConn:     { email: string | null; status: string } | null;
  googleEvents:   GoogleEvent[];
  googleError:    string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatPhone(phone: string): string {
  if (phone.includes("@g.us")) return "Grupo";
  if (phone.includes("@")) return phone.split("@")[0];
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const num = d.slice(4);
    const p = num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`;
    return `+55 (${ddd}) ${p}`;
  }
  return `+${d}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dt = new Date(dateStr); dt.setHours(0, 0, 0, 0);

  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (dt.getTime() === today.getTime()) return `Hoje ${time}`;
  if (dt.getTime() === tomorrow.getTime()) return `Amanhã ${time}`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + ` ${time}`;
}

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

const PRIORITY_META: Record<string, { label: string; chip: string }> = {
  URGENT: { label: "Urgente", chip: "bg-red-500/15 text-red-300 border-red-500/25" },
  HIGH:   { label: "Alta",    chip: "bg-orange-500/15 text-orange-300 border-orange-500/25" },
  MEDIUM: { label: "Média",   chip: "bg-yellow-500/15 text-yellow-300 border-yellow-500/25" },
  LOW:    { label: "Baixa",   chip: "bg-slate-500/15 text-slate-400 border-slate-500/25" },
};

const PIPELINE_LABEL: Record<string, string> = {
  PROSPECCAO: "Prospecção",
  LEADS: "Lead",
  OPORTUNIDADES: "Oportunidade",
};

// ── Seção genérica ────────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  iconColor,
  title,
  count,
  accent,
  children,
  defaultOpen = true,
}: {
  icon: React.ElementType;
  iconColor: string;
  title: string;
  count: number;
  accent: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-1 py-2 group"
      >
        <div className={`w-7 h-7 rounded-lg ${accent} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-3.5 h-3.5 ${iconColor}`} strokeWidth={2} />
        </div>
        <span className="text-[13px] font-semibold text-white flex-1 text-left">{title}</span>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${accent} ${iconColor}`}>
          {count}
        </span>
        <ChevronRight className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <div className="mt-1 space-y-1.5 pl-0">{children}</div>}
    </div>
  );
}

// ── Modal de Agendamento ──────────────────────────────────────────────────────

function ScheduleModal({
  convId,
  convName,
  onClose,
  onSaved,
}: {
  convId: string;
  convName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!date) return;
    setSaving(true);
    try {
      await fetch(`/api/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "SCHEDULED",
          scheduledReturnAt: new Date(date).toISOString(),
          returnNote: note || null,
        }),
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-2xl w-full max-w-sm p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlarmClock className="w-4 h-4 text-purple-400" strokeWidth={2} />
            <span className="text-white font-semibold text-[13px]">Agendar Retorno</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-slate-400 text-[12px] mb-4 truncate">
          Conversa com <span className="text-white">{convName}</span>
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Data e hora do retorno
            </label>
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/25"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Nota (opcional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: cliente pediu para ligar após reunião"
              rows={3}
              className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/25"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-[13px] font-medium text-slate-400 bg-[#161f30] hover:bg-[#1e2d45] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={!date || saving}
            className="flex-1 px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Salvando..." : "Agendar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Linha de Retorno Atrasado (com ações inline) ──────────────────────────────

function OverdueRow({
  conv,
  onResolve,
  onReschedule,
}: {
  conv: ScheduledConv;
  onResolve: (convId: string) => Promise<void>;
  onReschedule: (convId: string, name: string) => void;
}) {
  const [resolving, setResolving] = useState(false);
  const name = conv.leads[0]?.name ?? formatPhone(conv.phone);

  async function handleResolve() {
    setResolving(true);
    try { await onResolve(conv.id); }
    finally { setResolving(false); }
  }

  return (
    <div className="flex items-center gap-3 bg-[#0f1623] border border-red-500/20 rounded-xl px-4 py-3 group">
      <div className="w-7 h-7 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
        <span className="text-red-400 text-[10px] font-bold">
          {(name ?? "?").charAt(0).toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white text-[13px] font-medium truncate">{name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 font-semibold flex-shrink-0">
            Atrasado
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <Clock className="w-3 h-3 text-red-400 flex-shrink-0" strokeWidth={2} />
          <span className="text-red-300 text-[11px]">{formatDateTime(conv.scheduledReturnAt)}</span>
          {conv.returnNote && (
            <span className="text-slate-500 text-[11px] truncate">· {conv.returnNote}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={handleResolve}
          disabled={resolving}
          className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded-md hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
          title="Marcar como resolvido"
        >
          {resolving ? "..." : "✓ Resolvido"}
        </button>
        <button
          onClick={() => onReschedule(conv.id, name)}
          className="text-[11px] font-semibold text-purple-400 hover:text-purple-300 px-2 py-1 rounded-md hover:bg-purple-500/10 transition-colors"
          title="Reagendar"
        >
          Reagendar
        </button>
        <Link
          href="/whatsapp"
          className="text-[11px] font-semibold text-red-400 hover:text-red-300 px-2 py-1 rounded-md hover:bg-red-500/10 transition-colors"
        >
          Abrir
        </Link>
      </div>
    </div>
  );
}

// ── Card de Conexão Google Calendar ──────────────────────────────────────────

function GoogleCalendarCard({
  conn,
  hasEvents,
  error,
}: {
  conn: { email: string | null; status: string } | null;
  hasEvents: boolean;
  error: string | null;
}) {
  const [disconnecting, setDisconnecting] = useState(false);
  const router = useRouter();

  async function disconnect() {
    if (!confirm("Desconectar Google Calendar? Os eventos não aparecerão mais aqui.")) return;
    setDisconnecting(true);
    try {
      await fetch("/api/calendar/google/disconnect", { method: "DELETE" });
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  // Não conectado → CTA
  if (!conn) {
    return (
      <div className="mb-4 bg-gradient-to-br from-sky-500/10 to-blue-500/5 border border-sky-500/20 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 flex items-center justify-center flex-shrink-0">
            <Calendar className="w-5 h-5 text-sky-400" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-semibold text-[13px]">Conecte sua agenda do Google</div>
            <div className="text-slate-400 text-[12px] mt-0.5">
              Veja seus compromissos do dia ao lado dos retornos e chamados.
            </div>
          </div>
          <a
            href="/api/calendar/google/connect"
            className="flex-shrink-0 px-4 py-2 rounded-lg text-[12px] font-semibold text-white bg-sky-600 hover:bg-sky-500 transition-colors"
          >
            Conectar
          </a>
        </div>
      </div>
    );
  }

  // Conectado mas com erro
  if (conn.status !== "ACTIVE" || error) {
    return (
      <div className="mb-4 bg-amber-500/10 border border-amber-500/25 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-400" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-semibold text-[13px]">Reconectar Google Calendar</div>
            <div className="text-amber-300/80 text-[12px] mt-0.5 truncate">
              {error ?? `Conexão em estado ${conn.status}`}
            </div>
          </div>
          <a
            href="/api/calendar/google/connect"
            className="flex-shrink-0 px-4 py-2 rounded-lg text-[12px] font-semibold text-white bg-amber-600 hover:bg-amber-500 transition-colors"
          >
            Reconectar
          </a>
        </div>
      </div>
    );
  }

  // Conectado ok — barra discreta
  return (
    <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-[#0f1623] border border-[#1e2d45] rounded-xl text-[12px]">
      <div className="w-5 h-5 rounded-md bg-sky-500/15 flex items-center justify-center flex-shrink-0">
        <Calendar className="w-3 h-3 text-sky-400" strokeWidth={2.25} />
      </div>
      <span className="text-slate-400">Google Calendar:</span>
      <span className="text-white font-medium truncate">{conn.email ?? "conectado"}</span>
      {!hasEvents && (
        <span className="text-slate-600 text-[11px]">· sem eventos hoje</span>
      )}
      <button
        onClick={disconnect}
        disabled={disconnecting}
        className="ml-auto text-slate-500 hover:text-red-400 text-[11px] transition-colors disabled:opacity-50"
        title="Desconectar"
      >
        {disconnecting ? "..." : "Desconectar"}
      </button>
    </div>
  );
}

// ── Linha de evento do Google ────────────────────────────────────────────────

function GoogleEventRow({ ev }: { ev: GoogleEvent }) {
  const startISO = ev.start.dateTime ?? ev.start.date;
  const endISO   = ev.end.dateTime   ?? ev.end.date;
  const isAllDay = !ev.start.dateTime;

  const startTime = startISO && !isAllDay
    ? new Date(startISO).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "Dia todo";
  const endTime = endISO && !isAllDay
    ? new Date(endISO).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "";

  const meetLink = ev.hangoutLink;
  const attendeeCount = ev.attendees?.length ?? 0;

  return (
    <div className="flex items-center gap-3 bg-[#0f1623] border border-[#1e2d45] rounded-xl px-4 py-3 hover:border-sky-500/30 transition-colors">
      <div className="w-7 h-7 rounded-full bg-sky-500/15 flex items-center justify-center flex-shrink-0">
        <Calendar className="w-3.5 h-3.5 text-sky-400" strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white text-[13px] font-medium truncate">
            {ev.summary || "(sem título)"}
          </span>
          {meetLink && (
            <Video className="w-3 h-3 text-emerald-400 flex-shrink-0" strokeWidth={2} />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <Clock className="w-3 h-3 text-sky-400 flex-shrink-0" strokeWidth={2} />
          <span className="text-sky-300 text-[11px]">
            {isAllDay ? startTime : `${startTime} – ${endTime}`}
          </span>
          {ev.location && (
            <>
              <span className="text-slate-700">·</span>
              <MapPin className="w-3 h-3 text-slate-500 flex-shrink-0" strokeWidth={2} />
              <span className="text-slate-500 text-[11px] truncate">{ev.location}</span>
            </>
          )}
          {attendeeCount > 0 && (
            <span className="text-slate-600 text-[11px]">· {attendeeCount} convidado{attendeeCount > 1 ? "s" : ""}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {meetLink && (
          <a
            href={meetLink}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
            title="Entrar no Google Meet"
          >
            <Video className="w-3 h-3" strokeWidth={2} />
            Meet
          </a>
        )}
        {ev.htmlLink && (
          <a
            href={ev.htmlLink}
            target="_blank"
            rel="noreferrer"
            className="text-slate-500 hover:text-white transition-colors"
            title="Abrir no Google Calendar"
          >
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={2} />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function CalendarioBoard({
  scheduledConvs,
  waitingConvs,
  myOpenConvs,
  urgentTickets,
  leadsFollowUp,
  currentUserId,
  isSuperAdmin,
  googleConn,
  googleEvents,
  googleError,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [scheduleTarget, setScheduleTarget] = useState<{ id: string; name: string } | null>(null);
  const [view, setView] = useState<"agenda" | "day" | "week">("agenda");

  const totalToday =
    scheduledConvs.filter((c) => isToday(c.scheduledReturnAt) || isOverdue(c.scheduledReturnAt)).length +
    waitingConvs.length +
    myOpenConvs.length +
    urgentTickets.length +
    leadsFollowUp.length;

  const overdueScheduled = scheduledConvs.filter((c) => isOverdue(c.scheduledReturnAt));
  const todayScheduled   = scheduledConvs.filter((c) => isToday(c.scheduledReturnAt) && !isOverdue(c.scheduledReturnAt));
  const soonScheduled    = scheduledConvs.filter((c) => !isToday(c.scheduledReturnAt) && !isOverdue(c.scheduledReturnAt));

  function refresh() {
    startTransition(() => router.refresh());
  }

  // Resolve um retorno agendado: limpa scheduledReturnAt + nota e devolve a
  // conversa para IN_PROGRESS (atendido). Usado nos atrasados para sair da lista.
  async function resolveScheduledReturn(convId: string) {
    await fetch(`/api/conversations/${convId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "IN_PROGRESS",
        scheduledReturnAt: null,
        returnNote: null,
      }),
    });
    refresh();
  }

  const now = new Date();
  const dateLabel = now.toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long",
  });

  return (
    <div className="flex-1 bg-[#080b12] min-h-screen p-5 md:p-6 overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="w-5 h-5 text-indigo-400" strokeWidth={2} />
            <h1 className="text-white font-bold text-lg">
              {view === "agenda" ? "Meu Dia" : view === "day" ? "Dia" : "Semana"}
            </h1>
          </div>
          {view === "agenda" && (
            <p className="text-slate-500 text-[13px] capitalize">{dateLabel}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Tabs Meu Dia / Dia / Semana */}
          <div className="flex items-center bg-[#0f1623] border border-[#1e2d45] rounded-lg p-0.5">
            <button
              onClick={() => setView("agenda")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${
                view === "agenda"
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "text-slate-500 hover:text-white"
              }`}
            >
              <List className="w-3.5 h-3.5" strokeWidth={2} />
              Meu Dia
            </button>
            <button
              onClick={() => setView("day")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${
                view === "day"
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "text-slate-500 hover:text-white"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" strokeWidth={2} />
              Dia
            </button>
            <button
              onClick={() => setView("week")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${
                view === "week"
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "text-slate-500 hover:text-white"
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" strokeWidth={2} />
              Semana
            </button>
          </div>
          {view === "agenda" && totalToday > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-500/15 border border-indigo-500/25">
              <span className="text-indigo-400 font-bold text-[12px]">{totalToday}</span>
              <span className="text-indigo-300 text-[11px]">pendentes</span>
            </div>
          )}
          {view === "agenda" && (
            <button
              onClick={refresh}
              disabled={isPending}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-500 hover:text-white hover:border-[#2e3d55] transition-colors"
              title="Atualizar"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPending ? "animate-spin" : ""}`} strokeWidth={2} />
            </button>
          )}

          {/* + Nova reunião — abre o criador de evento do Google Calendar.
              O evento criado lá aparece aqui automaticamente porque já lemos
              os eventos via /api/calendar/google/events (scope readonly). */}
          <a
            href="https://calendar.google.com/calendar/u/0/r/eventedit"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-semibold transition-colors"
            title="Abre o Google Calendar pra criar uma reunião. Aparece aqui após sincronizar."
          >
            <Calendar className="w-3.5 h-3.5" strokeWidth={2.5} />
            Nova reunião
          </a>
        </div>
      </div>

      {/* Vista de um Dia (grid horário) */}
      {view === "day" && (
        <div className="flex-1 min-h-[600px]">
          <DayView />
        </div>
      )}

      {/* Vista Semanal */}
      {view === "week" && (
        <div className="flex-1 min-h-[600px]">
          <WeekView />
        </div>
      )}

      {/* Vista Meu Dia (lista) — só quando view === "agenda" */}
      {view === "agenda" && (
      <>
      {totalToday === 0 && googleEvents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <CheckCircle2 className="w-12 h-12 text-emerald-500/40" strokeWidth={1.5} />
          <p className="text-slate-400 font-medium">Tudo em dia!</p>
          <p className="text-slate-600 text-sm">Nenhum item pendente para hoje.</p>
        </div>
      )}

      {/* ── Card de Conexão Google Calendar ────────────────────────────── */}
      <GoogleCalendarCard conn={googleConn} hasEvents={googleEvents.length > 0} error={googleError} />

      {/* ── Eventos do Google Calendar ────────────────────────────────── */}
      {googleEvents.length > 0 && (
        <Section
          icon={Calendar}
          iconColor="text-sky-400"
          accent="bg-sky-500/15"
          title="Agenda do Google"
          count={googleEvents.length}
        >
          {googleEvents.map((ev) => <GoogleEventRow key={ev.id} ev={ev} />)}
        </Section>
      )}

      {/* ── Retornos Vencidos ──────────────────────────────────────────── */}
      {overdueScheduled.length > 0 && (
        <Section
          icon={AlertTriangle}
          iconColor="text-red-400"
          accent="bg-red-500/15"
          title="Retornos Atrasados"
          count={overdueScheduled.length}
        >
          {overdueScheduled.map((c) => (
            <OverdueRow
              key={c.id}
              conv={c}
              onResolve={resolveScheduledReturn}
              onReschedule={(id, name) => setScheduleTarget({ id, name })}
            />
          ))}
        </Section>
      )}

      {/* ── Retornos de Hoje ──────────────────────────────────────────────── */}
      {todayScheduled.length > 0 && (
        <Section
          icon={AlarmClock}
          iconColor="text-purple-400"
          accent="bg-purple-500/15"
          title="Retornos de Hoje"
          count={todayScheduled.length}
        >
          {todayScheduled.map((c) => {
            const name = c.leads[0]?.name ?? formatPhone(c.phone);
            return (
              <div key={c.id} className="flex items-center gap-3 bg-[#0f1623] border border-[#1e2d45] rounded-xl px-4 py-3 hover:border-purple-500/30 transition-colors">
                <div className="w-7 h-7 rounded-full bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-purple-400 text-[10px] font-bold">
                    {(name ?? "?").charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-white text-[13px] font-medium truncate block">{name}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Clock className="w-3 h-3 text-purple-400 flex-shrink-0" strokeWidth={2} />
                    <span className="text-purple-300 text-[11px]">{formatDateTime(c.scheduledReturnAt)}</span>
                    {c.returnNote && (
                      <span className="text-slate-500 text-[11px] truncate">· {c.returnNote}</span>
                    )}
                  </div>
                </div>
                <Link href="/whatsapp" className="flex-shrink-0 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors">
                  Abrir
                </Link>
              </div>
            );
          })}
        </Section>
      )}

      {/* ── Em Breve (próximos 7 dias) ────────────────────────────────────── */}
      {soonScheduled.length > 0 && (
        <Section
          icon={Calendar}
          iconColor="text-indigo-400"
          accent="bg-indigo-500/15"
          title="Em Breve"
          count={soonScheduled.length}
          defaultOpen={false}
        >
          {soonScheduled.map((c) => {
            const name = c.leads[0]?.name ?? formatPhone(c.phone);
            return (
              <div key={c.id} className="flex items-center gap-3 bg-[#0f1623] border border-[#1e2d45] rounded-xl px-4 py-3 hover:border-indigo-500/30 transition-colors">
                <div className="w-7 h-7 rounded-full bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-indigo-400 text-[10px] font-bold">
                    {(name ?? "?").charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-white text-[13px] font-medium truncate block">{name}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Clock className="w-3 h-3 text-indigo-400 flex-shrink-0" strokeWidth={2} />
                    <span className="text-indigo-300 text-[11px]">{formatDateTime(c.scheduledReturnAt)}</span>
                    {c.returnNote && (
                      <span className="text-slate-500 text-[11px] truncate">· {c.returnNote}</span>
                    )}
                  </div>
                </div>
                <Link href="/whatsapp" className="flex-shrink-0 text-[11px] font-semibold text-slate-400 hover:text-white transition-colors">
                  Abrir
                </Link>
              </div>
            );
          })}
        </Section>
      )}

      {/* ── Aguardando Cliente ───────────────────────────────────────────── */}
      <Section
        icon={Hourglass}
        iconColor="text-blue-400"
        accent="bg-blue-500/15"
        title="Aguardando Cliente"
        count={waitingConvs.length}
      >
        {waitingConvs.map((c) => {
          const name = c.leads[0]?.name ?? formatPhone(c.phone);
          return (
            <div key={c.id} className="flex items-center gap-3 bg-[#0f1623] border border-[#1e2d45] rounded-xl px-4 py-3 hover:border-blue-500/30 transition-colors">
              <div className="w-7 h-7 rounded-full bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                <span className="text-blue-400 text-[10px] font-bold">
                  {(name ?? "?").charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-white text-[13px] font-medium truncate block">{name}</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Clock className="w-3 h-3 text-slate-500 flex-shrink-0" strokeWidth={2} />
                  <span className="text-slate-500 text-[11px]">
                    Aguardando há {timeAgo(c.statusUpdatedAt)}
                  </span>
                  {c.assignee && (
                    <span className="text-slate-600 text-[11px]">· {c.assignee.name}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => setScheduleTarget({ id: c.id, name })}
                  className="text-[11px] font-semibold text-purple-400 hover:text-purple-300 transition-colors"
                  title="Agendar retorno"
                >
                  Agendar
                </button>
                <span className="text-slate-700">·</span>
                <Link href="/whatsapp" className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors">
                  Abrir
                </Link>
              </div>
            </div>
          );
        })}
      </Section>

      {/* ── Minhas Conversas Abertas ──────────────────────────────────────── */}
      <Section
        icon={MessageSquare}
        iconColor="text-cyan-400"
        accent="bg-cyan-500/15"
        title="Minhas Conversas Abertas"
        count={myOpenConvs.length}
      >
        {myOpenConvs.map((c) => {
          const name = c.leads[0]?.name ?? formatPhone(c.phone);
          const statusLabel = c.status === "IN_PROGRESS" ? "Em atendimento" : "Aberta";
          const statusColor = c.status === "IN_PROGRESS" ? "text-yellow-400" : "text-cyan-400";
          return (
            <div key={c.id} className="flex items-center gap-3 bg-[#0f1623] border border-[#1e2d45] rounded-xl px-4 py-3 hover:border-cyan-500/30 transition-colors">
              <div className="w-7 h-7 rounded-full bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
                <span className="text-cyan-400 text-[10px] font-bold">
                  {(name ?? "?").charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white text-[13px] font-medium truncate">{name}</span>
                  {c.unreadCount > 0 && (
                    <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-500 text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[11px] font-medium ${statusColor}`}>{statusLabel}</span>
                  {c.lastMessageAt && (
                    <span className="text-slate-600 text-[11px]">· {timeAgo(c.lastMessageAt)}</span>
                  )}
                  {c.lastMessageBody && (
                    <span className="text-slate-600 text-[11px] truncate">· {c.lastMessageBody.slice(0, 40)}</span>
                  )}
                </div>
              </div>
              <Link href="/whatsapp" className="flex-shrink-0 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors">
                Abrir
              </Link>
            </div>
          );
        })}
      </Section>

      {/* ── Chamados Urgentes ─────────────────────────────────────────────── */}
      <Section
        icon={LifeBuoy}
        iconColor="text-orange-400"
        accent="bg-orange-500/15"
        title="Chamados Críticos"
        count={urgentTickets.length}
      >
        {urgentTickets.map((t) => {
          const meta = PRIORITY_META[t.priority] ?? PRIORITY_META.MEDIUM;
          return (
            <div key={t.id} className="flex items-center gap-3 bg-[#0f1623] border border-[#1e2d45] rounded-xl px-4 py-3 hover:border-orange-500/30 transition-colors">
              <div className="w-7 h-7 rounded-full bg-orange-500/15 flex items-center justify-center flex-shrink-0">
                <LifeBuoy className="w-3.5 h-3.5 text-orange-400" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white text-[13px] font-medium truncate">{t.title}</span>
                  <span className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${meta.chip}`}>
                    {meta.label}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {t.company && (
                    <span className="text-slate-500 text-[11px]">{t.company.name}</span>
                  )}
                  <span className="text-slate-600 text-[11px]">· Aberto {timeAgo(t.createdAt)}</span>
                </div>
              </div>
              <Link
                href={`/chamados/${t.id}`}
                className="flex-shrink-0 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Abrir
              </Link>
            </div>
          );
        })}
      </Section>

      {/* ── Follow-ups de Leads ───────────────────────────────────────────── */}
      <Section
        icon={Target}
        iconColor="text-emerald-400"
        accent="bg-emerald-500/15"
        title="Follow-ups de Leads"
        count={leadsFollowUp.length}
      >
        {leadsFollowUp.map((l) => {
          const pipelineLabel = l.pipeline ? PIPELINE_LABEL[l.pipeline] ?? l.pipeline : null;
          const overdue = isOverdue(l.expectedReturnAt);
          return (
            <div key={l.id} className="flex items-center gap-3 bg-[#0f1623] border border-[#1e2d45] rounded-xl px-4 py-3 hover:border-emerald-500/30 transition-colors">
              <div className="w-7 h-7 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                <span className="text-emerald-400 text-[10px] font-bold">
                  {((l.name ?? l.phone) ?? "?").charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white text-[13px] font-medium truncate">
                    {l.name ?? formatPhone(l.phone)}
                  </span>
                  {pipelineLabel && (
                    <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
                      {pipelineLabel}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Clock className={`w-3 h-3 flex-shrink-0 ${overdue ? "text-red-400" : "text-slate-500"}`} strokeWidth={2} />
                  <span className={`text-[11px] ${overdue ? "text-red-300" : "text-slate-500"}`}>
                    {overdue ? "Atrasado · " : ""}{formatDateTime(l.expectedReturnAt)}
                  </span>
                  {l.pipelineStage && (
                    <span className="text-slate-600 text-[11px] truncate">· {l.pipelineStage}</span>
                  )}
                </div>
              </div>
              <Link
                href={`/crm/${(l.pipeline ?? "leads").toLowerCase()}`}
                className="flex-shrink-0 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Abrir
              </Link>
            </div>
          );
        })}
      </Section>
      </>
      )}

      {/* Modal de Agendamento (compartilhado entre vistas) */}
      {scheduleTarget && (
        <ScheduleModal
          convId={scheduleTarget.id}
          convName={scheduleTarget.name}
          onClose={() => setScheduleTarget(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
