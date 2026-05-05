"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, Calendar, Clock, AlarmClock,
  LifeBuoy, Target, Video, MapPin, ExternalLink,
} from "lucide-react";
import { layoutOverlappingEvents } from "./event-layout";

// ── Tipos ────────────────────────────────────────────────────────────────────
// Compartilhados com WeekView. Mantém aqui pra não acoplar os dois.

interface ScheduledConv {
  id: string; phone: string; scheduledReturnAt: string | null;
  returnNote: string | null; status: string;
  leads: { id: string; name: string | null }[];
}
interface LeadFollowUp {
  id: string; name: string | null; phone: string;
  pipeline: string | null; pipelineStage: string | null;
  expectedReturnAt: string | null; status: string;
}
interface TicketItem {
  id: string; title: string; priority: string; status: string;
  createdAt: string; dueDate: string | null;
  company: { id: string; name: string } | null;
}
interface GEvent {
  id: string; summary: string; description?: string;
  start: { dateTime?: string; date?: string };
  end:   { dateTime?: string; date?: string };
  htmlLink?: string; hangoutLink?: string;
  location?: string;
  attendees?: { email: string; displayName?: string }[];
}

interface DayData {
  scheduledConvs: ScheduledConv[];
  leadsFollowUp:  LeadFollowUp[];
  tickets:        TicketItem[];
  googleEvents:   GEvent[];
  googleError:    string | null;
}

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 06h às 22h
const ROW_HEIGHT = 56; // altura em px de cada hora

// ── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(23, 59, 59, 999); return r;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}
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

// ── Tipos unificados de evento ───────────────────────────────────────────────

type EventKind = "scheduled" | "lead" | "ticket" | "google";

interface UnifiedEvent {
  id: string;
  kind: EventKind;
  title: string;
  start: Date;
  end: Date;
  isAllDay?: boolean;
  href?: string;
  hangoutLink?: string;
  meta?: string;
  location?: string;
  description?: string;
}

const KIND_STYLE: Record<EventKind, { bg: string; border: string; text: string; icon: any; iconColor: string; label: string }> = {
  scheduled: { bg: "bg-purple-500/15", border: "border-l-2 border-purple-400", text: "text-purple-200",  icon: AlarmClock, iconColor: "text-purple-300", label: "Retorno" },
  lead:      { bg: "bg-emerald-500/15",border: "border-l-2 border-emerald-400",text: "text-emerald-200", icon: Target,    iconColor: "text-emerald-300", label: "Follow-up" },
  ticket:    { bg: "bg-orange-500/15", border: "border-l-2 border-orange-400", text: "text-orange-200",  icon: LifeBuoy,  iconColor: "text-orange-300",  label: "Chamado" },
  google:    { bg: "bg-sky-500/15",    border: "border-l-2 border-sky-400",    text: "text-sky-200",     icon: Calendar,  iconColor: "text-sky-300",     label: "Agenda" },
};

// ── Componente ───────────────────────────────────────────────────────────────

export default function DayView() {
  const [day, setDay]         = useState<Date>(() => startOfDay(new Date()));
  const [data, setData]       = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const dayEnd = useMemo(() => endOfDay(day), [day]);

  // Busca dados sempre que o dia muda
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          from: day.toISOString(),
          to:   dayEnd.toISOString(),
        });
        const res = await fetch(`/api/calendar/week?${params}`);
        if (!res.ok) return;
        const json: DayData = await res.json();
        if (!cancelled) setData(json);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [day, dayEnd]);

  // Auto-scroll pra hora atual ao montar (se for hoje e estiver depois das 8h)
  useEffect(() => {
    if (!containerRef.current) return;
    const now = new Date();
    if (sameDay(day, now) && now.getHours() >= 8) {
      const targetHour = Math.max(6, now.getHours() - 2);
      const offset = (targetHour - HOURS[0]) * ROW_HEIGHT;
      containerRef.current.scrollTop = offset;
    }
  }, [day]);

  // Indexa eventos do dia
  const events = useMemo(() => {
    if (!data) return [] as UnifiedEvent[];
    const out: UnifiedEvent[] = [];

    for (const c of data.scheduledConvs) {
      if (!c.scheduledReturnAt) continue;
      const start = new Date(c.scheduledReturnAt);
      if (!sameDay(start, day)) continue;
      const end = new Date(start.getTime() + 30 * 60000);
      const name = c.leads[0]?.name ?? formatPhone(c.phone);
      out.push({
        id: `s-${c.id}`,
        kind: "scheduled",
        title: name,
        start, end,
        href: "/whatsapp",
        meta: c.returnNote ?? undefined,
      });
    }
    for (const l of data.leadsFollowUp) {
      if (!l.expectedReturnAt) continue;
      const start = new Date(l.expectedReturnAt);
      if (!sameDay(start, day)) continue;
      const end = new Date(start.getTime() + 30 * 60000);
      out.push({
        id: `l-${l.id}`,
        kind: "lead",
        title: l.name ?? formatPhone(l.phone),
        start, end,
        href: `/crm/${(l.pipeline ?? "leads").toLowerCase()}`,
        meta: l.pipelineStage ?? undefined,
      });
    }
    for (const t of data.tickets) {
      // Posiciona pelo prazo (quando definido) — é a data que importa pro
      // atendente. Cai pra createdAt só em tickets antigos sem dueDate.
      const start = new Date(t.dueDate ?? t.createdAt);
      if (!sameDay(start, day)) continue;
      const end = new Date(start.getTime() + 30 * 60000);
      out.push({
        id: `t-${t.id}`,
        kind: "ticket",
        title: t.title,
        start, end,
        href: `/chamados/${t.id}`,
        meta: `${t.priority} · ${t.company?.name ?? ""}`.trim(),
      });
    }
    for (const ev of data.googleEvents) {
      const startISO = ev.start.dateTime ?? ev.start.date;
      const endISO   = ev.end.dateTime ?? ev.end.date;
      if (!startISO) continue;
      const start = new Date(startISO);
      if (!sameDay(start, day)) continue;
      const end = endISO ? new Date(endISO) : new Date(start.getTime() + 60 * 60000);
      out.push({
        id: `g-${ev.id}`,
        kind: "google",
        title: ev.summary || "(sem título)",
        start, end,
        isAllDay: !ev.start.dateTime,
        href: ev.htmlLink,
        hangoutLink: ev.hangoutLink,
        location: ev.location,
        description: ev.description,
        meta: ev.attendees ? `${ev.attendees.length} convidado${ev.attendees.length > 1 ? "s" : ""}` : undefined,
      });
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [data, day]);

  const allDayEvents = useMemo(() => events.filter((e) => e.isAllDay), [events]);
  const timedEvents  = useMemo(() => events.filter((e) => !e.isAllDay), [events]);

  function navigate(deltaDays: number) {
    setDay((prev) => addDays(prev, deltaDays));
  }

  const today = new Date();
  const isToday = sameDay(day, today);
  const headerLabel = day.toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long",
  });

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 hover:text-white hover:border-[#2e3d55] transition-colors"
          title="Dia anterior"
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={2} />
        </button>
        <button
          onClick={() => setDay(startOfDay(new Date()))}
          className="px-3 h-8 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-[12px] font-medium text-slate-400 hover:text-white hover:border-[#2e3d55] transition-colors"
        >
          Hoje
        </button>
        <button
          onClick={() => navigate(1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 hover:text-white hover:border-[#2e3d55] transition-colors"
          title="Próximo dia"
        >
          <ChevronRight className="w-4 h-4" strokeWidth={2} />
        </button>
        <span className="text-white font-semibold text-[14px] ml-2 capitalize">
          {headerLabel}
          {isToday && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 align-middle">Hoje</span>}
        </span>
        <span className="ml-auto text-slate-500 text-[11px]">
          {loading ? "carregando..." : `${events.length} evento${events.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Eventos all-day */}
      {allDayEvents.length > 0 && (
        <div className="border border-[#1e2d45] rounded-t-xl bg-[#0f1623] px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-[9px] text-slate-600 uppercase tracking-wider font-semibold">Dia todo</span>
          {allDayEvents.map((ev) => {
            const style = KIND_STYLE[ev.kind];
            return (
              <a
                key={ev.id}
                href={ev.href ?? "#"}
                target={ev.kind === "google" ? "_blank" : undefined}
                rel={ev.kind === "google" ? "noreferrer" : undefined}
                className={`text-[11px] px-2 py-0.5 rounded ${style.bg} ${style.text} hover:brightness-125 transition truncate max-w-[200px]`}
              >
                {ev.title}
              </a>
            );
          })}
        </div>
      )}

      {/* Grade de horas */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-y-auto border-x border-b border-[#1e2d45] bg-[#0a0e16] ${
          allDayEvents.length === 0 ? "border-t rounded-t-xl" : ""
        } rounded-b-xl`}
      >
        <div
          className="grid grid-cols-[60px_1fr] relative"
          style={{ minHeight: HOURS.length * ROW_HEIGHT }}
        >
          {/* Coluna de horas */}
          <div className="border-r border-[#1e2d45]">
            {HOURS.map((h) => (
              <div key={h} className="px-2 pt-1 text-[10px] text-slate-500 font-medium" style={{ height: ROW_HEIGHT }}>
                {h.toString().padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Coluna do dia (eventos posicionados) */}
          <div className={`relative ${isToday ? "bg-indigo-500/[0.03]" : ""}`}>
            {/* Linhas de hora */}
            {HOURS.map((h) => (
              <div key={h} className="border-b border-[#1e2d45]/40" style={{ height: ROW_HEIGHT }} />
            ))}

            {/* Linha "agora" — só aparece quando view do dia atual */}
            {isToday && <NowLine />}

            {/* Eventos com hora */}
            {layoutOverlappingEvents(timedEvents).map(({ event, lane, laneCount }) => (
              <PositionedEvent key={event.id} ev={event} lane={lane} laneCount={laneCount} />
            ))}

            {/* Estado vazio */}
            {!loading && events.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
                <Calendar className="w-10 h-10 text-slate-700" strokeWidth={1.5} />
                <p className="text-slate-600 text-sm">Nenhum evento para este dia</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {data?.googleError && (
        <div className="mt-2 text-[11px] text-amber-400">
          Aviso Google: {data.googleError}
        </div>
      )}
    </div>
  );
}

// ── Linha "agora" ────────────────────────────────────────────────────────────

function NowLine() {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  if (hour < HOURS[0] || hour > HOURS[HOURS.length - 1]) return null;
  const top = (hour - HOURS[0]) * ROW_HEIGHT + (minute / 60) * ROW_HEIGHT;
  return (
    <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top }}>
      <div className="flex items-center">
        <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
        <div className="flex-1 h-[1.5px] bg-red-500" />
      </div>
    </div>
  );
}

// ── Evento posicionado ───────────────────────────────────────────────────────
// Versão expandida (vs WeekView): mostra mais detalhes — título, hora,
// local, participantes, link Meet — porque tem espaço horizontal sobrando.

function PositionedEvent({ ev, lane, laneCount }: { ev: UnifiedEvent; lane: number; laneCount: number }) {
  const style = KIND_STYLE[ev.kind];
  const Icon = style.icon;

  const startHour = ev.start.getHours() + ev.start.getMinutes() / 60;
  const endHour   = ev.end.getHours()   + ev.end.getMinutes() / 60;

  const top = Math.max(0, (startHour - HOURS[0]) * ROW_HEIGHT);
  const heightRaw = (Math.min(endHour, HOURS[HOURS.length - 1] + 1) - startHour) * ROW_HEIGHT;
  const height = Math.max(28, heightRaw);

  const startTime = ev.start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const endTime   = ev.end.toLocaleTimeString("pt-BR",   { hour: "2-digit", minute: "2-digit" });
  const isShort = height < 60;

  // Layout horizontal — cada lane ocupa 1/laneCount da largura disponível
  // (descontando 8px de padding lateral). Se há sobreposição, eventos ficam
  // lado a lado em vez de empilhados.
  const SIDE_PADDING = 8;
  const widthPct = 100 / laneCount;
  const leftPct = lane * widthPct;
  // Eventos não-primários (lane > 0) ganham peso visual menor
  const isNarrow = laneCount > 1;

  return (
    <a
      href={ev.href ?? "#"}
      target={ev.kind === "google" ? "_blank" : undefined}
      rel={ev.kind === "google" ? "noreferrer" : undefined}
      className={`absolute rounded ${style.bg} ${style.border} ${style.text} px-2 py-1 overflow-hidden hover:brightness-125 hover:z-20 transition cursor-pointer flex flex-col`}
      style={{
        top,
        height,
        left: `calc(${leftPct}% + ${SIDE_PADDING}px)`,
        width: `calc(${widthPct}% - ${SIDE_PADDING * 2}px)`,
        zIndex: 1 + lane,
      }}
      title={`${startTime} – ${endTime} · ${ev.title}${ev.location ? "\n" + ev.location : ""}${ev.meta ? "\n" + ev.meta : ""}`}
    >
      {/* Linha 1: hora + título + ícones */}
      <div className="flex items-center gap-1.5 min-w-0">
        <Icon className={`w-3 h-3 ${style.iconColor} flex-shrink-0`} strokeWidth={2.5} />
        <span className="text-[10px] font-bold flex-shrink-0">{startTime}{!isShort && ` – ${endTime}`}</span>
        <span className="text-[11px] font-semibold truncate flex-1">{ev.title}</span>
        {ev.hangoutLink && <Video className="w-3 h-3 text-emerald-300 flex-shrink-0" strokeWidth={2.5} />}
        {ev.kind === "google" && ev.href && (
          <ExternalLink className="w-2.5 h-2.5 text-slate-400 flex-shrink-0 opacity-60" strokeWidth={2} />
        )}
      </div>

      {/* Linhas 2+: detalhes (só se altura permitir) */}
      {!isShort && (
        <div className="mt-0.5 space-y-0.5">
          {ev.location && (
            <div className="flex items-center gap-1 text-[10px] opacity-80">
              <MapPin className="w-2.5 h-2.5 flex-shrink-0" strokeWidth={2} />
              <span className="truncate">{ev.location}</span>
            </div>
          )}
          {ev.meta && (
            <div className="text-[10px] opacity-80 truncate">{ev.meta}</div>
          )}
        </div>
      )}
    </a>
  );
}
