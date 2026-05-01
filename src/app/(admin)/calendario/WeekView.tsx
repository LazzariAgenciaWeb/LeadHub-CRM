"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft, ChevronRight, Calendar, Clock, AlarmClock,
  LifeBuoy, Target, Video,
} from "lucide-react";

// ── Tipos ────────────────────────────────────────────────────────────────────

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
  createdAt: string; company: { id: string; name: string } | null;
}
interface GEvent {
  id: string; summary: string;
  start: { dateTime?: string; date?: string };
  end:   { dateTime?: string; date?: string };
  htmlLink?: string; hangoutLink?: string;
  location?: string;
}

interface WeekData {
  scheduledConvs: ScheduledConv[];
  leadsFollowUp:  LeadFollowUp[];
  tickets:        TicketItem[];
  googleEvents:   GEvent[];
  googleError:    string | null;
  range:          { from: string; to: string };
}

// ── Helpers de data ──────────────────────────────────────────────────────────

const DAYS_PT = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6h às 22h

function startOfWeek(d: Date): Date {
  // Semana começando na segunda
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const dow = r.getDay(); // 0=dom 1=seg ... 6=sáb
  const diff = (dow === 0 ? -6 : 1 - dow);
  r.setDate(r.getDate() + diff);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
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
}

const KIND_STYLE: Record<EventKind, { bg: string; border: string; text: string; icon: any; iconColor: string; label: string }> = {
  scheduled: { bg: "bg-purple-500/15", border: "border-l-2 border-purple-400", text: "text-purple-200",  icon: AlarmClock, iconColor: "text-purple-300", label: "Retorno" },
  lead:      { bg: "bg-emerald-500/15",border: "border-l-2 border-emerald-400",text: "text-emerald-200", icon: Target,    iconColor: "text-emerald-300", label: "Follow-up" },
  ticket:    { bg: "bg-orange-500/15", border: "border-l-2 border-orange-400", text: "text-orange-200",  icon: LifeBuoy,  iconColor: "text-orange-300",  label: "Chamado" },
  google:    { bg: "bg-sky-500/15",    border: "border-l-2 border-sky-400",    text: "text-sky-200",     icon: Calendar,  iconColor: "text-sky-300",     label: "Agenda" },
};

// ── Componente ───────────────────────────────────────────────────────────────

export default function WeekView() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [data, setData]           = useState<WeekData | null>(null);
  const [loading, setLoading]     = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const weekEnd = useMemo(() => {
    const r = addDays(weekStart, 7);
    r.setHours(0, 0, 0, 0);
    return r;
  }, [weekStart]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Busca dados sempre que a semana muda
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          from: weekStart.toISOString(),
          to:   weekEnd.toISOString(),
        });
        const res = await fetch(`/api/calendar/week?${params}`);
        if (!res.ok) return;
        const json: WeekData = await res.json();
        if (!cancelled) setData(json);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [weekStart, weekEnd]);

  // Auto-scroll pra hora atual ao montar
  useEffect(() => {
    if (!containerRef.current) return;
    const now = new Date();
    if (now.getHours() >= 8) {
      const targetHour = Math.max(6, now.getHours() - 2);
      const offset = (targetHour - HOURS[0]) * 56;
      containerRef.current.scrollTop = offset;
    }
  }, []);

  // Indexa eventos por dia
  const eventsByDay = useMemo(() => {
    const map: Record<string, UnifiedEvent[]> = {};
    if (!data) return map;

    function key(d: Date) { return d.toDateString(); }
    function push(ev: UnifiedEvent) {
      const k = key(ev.start);
      if (!map[k]) map[k] = [];
      map[k].push(ev);
    }

    for (const c of data.scheduledConvs) {
      if (!c.scheduledReturnAt) continue;
      const start = new Date(c.scheduledReturnAt);
      const end = new Date(start.getTime() + 30 * 60000); // 30min default
      const name = c.leads[0]?.name ?? formatPhone(c.phone);
      push({
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
      const end = new Date(start.getTime() + 30 * 60000);
      push({
        id: `l-${l.id}`,
        kind: "lead",
        title: l.name ?? formatPhone(l.phone),
        start, end,
        href: `/crm/${(l.pipeline ?? "leads").toLowerCase()}`,
        meta: l.pipelineStage ?? undefined,
      });
    }
    for (const t of data.tickets) {
      const start = new Date(t.createdAt);
      const end = new Date(start.getTime() + 30 * 60000);
      push({
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
      const end = endISO ? new Date(endISO) : new Date(start.getTime() + 60 * 60000);
      push({
        id: `g-${ev.id}`,
        kind: "google",
        title: ev.summary || "(sem título)",
        start, end,
        isAllDay: !ev.start.dateTime,
        href: ev.htmlLink,
        hangoutLink: ev.hangoutLink,
        meta: ev.location ?? undefined,
      });
    }

    return map;
  }, [data]);

  function navigate(deltaWeeks: number) {
    setWeekStart((prev) => addDays(prev, deltaWeeks * 7));
  }

  const today = new Date();
  const headerLabel = (() => {
    const startDay = weekStart.getDate();
    const startMonth = weekStart.toLocaleDateString("pt-BR", { month: "short" });
    const endDate = addDays(weekStart, 6);
    const endDay = endDate.getDate();
    const endMonth = endDate.toLocaleDateString("pt-BR", { month: "short" });
    const sameMonth = startMonth === endMonth;
    return sameMonth
      ? `${startDay} – ${endDay} ${startMonth}`
      : `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
  })();

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 hover:text-white hover:border-[#2e3d55] transition-colors"
          title="Semana anterior"
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={2} />
        </button>
        <button
          onClick={() => setWeekStart(startOfWeek(new Date()))}
          className="px-3 h-8 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-[12px] font-medium text-slate-400 hover:text-white hover:border-[#2e3d55] transition-colors"
        >
          Hoje
        </button>
        <button
          onClick={() => navigate(1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 hover:text-white hover:border-[#2e3d55] transition-colors"
          title="Próxima semana"
        >
          <ChevronRight className="w-4 h-4" strokeWidth={2} />
        </button>
        <span className="text-white font-semibold text-[14px] ml-2 capitalize">{headerLabel}</span>
        {loading && (
          <span className="text-slate-500 text-[11px] ml-auto">carregando...</span>
        )}
      </div>

      {/* Header de dias */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border border-[#1e2d45] rounded-t-xl bg-[#0f1623]">
        <div className="border-r border-[#1e2d45]" />
        {days.map((d, i) => {
          const isToday = sameDay(d, today);
          return (
            <div
              key={i}
              className={`text-center py-2 border-r border-[#1e2d45] last:border-r-0 ${isToday ? "bg-indigo-500/10" : ""}`}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {DAYS_PT[i]}
              </div>
              <div className={`text-[14px] font-bold mt-0.5 ${isToday ? "text-indigo-400" : "text-white"}`}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Eventos all-day (Google) — linha entre header e grade */}
      <AllDayRow days={days} eventsByDay={eventsByDay} today={today} />

      {/* Grade de horas */}
      <div ref={containerRef} className="flex-1 overflow-y-auto border-x border-b border-[#1e2d45] rounded-b-xl bg-[#0a0e16]">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] relative" style={{ minHeight: HOURS.length * 56 }}>
          {/* Coluna de horas */}
          <div className="border-r border-[#1e2d45]">
            {HOURS.map((h) => (
              <div key={h} className="h-14 px-2 pt-1 text-[10px] text-slate-500 font-medium relative">
                {h.toString().padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Colunas dos dias */}
          {days.map((d, di) => {
            const dayEvents = (eventsByDay[d.toDateString()] ?? []).filter((ev) => !ev.isAllDay);
            const isToday = sameDay(d, today);
            return (
              <div
                key={di}
                className={`relative border-r border-[#1e2d45] last:border-r-0 ${isToday ? "bg-indigo-500/[0.03]" : ""}`}
              >
                {/* Linhas de hora */}
                {HOURS.map((h) => (
                  <div key={h} className="h-14 border-b border-[#1e2d45]/40" />
                ))}

                {/* Linha "agora" */}
                {isToday && <NowLine />}

                {/* Eventos posicionados absolutamente */}
                {dayEvents.map((ev) => <PositionedEvent key={ev.id} ev={ev} />)}
              </div>
            );
          })}
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

// ── Linha de eventos all-day ─────────────────────────────────────────────────

function AllDayRow({
  days, eventsByDay, today,
}: {
  days: Date[];
  eventsByDay: Record<string, UnifiedEvent[]>;
  today: Date;
}) {
  // Verifica se há algum all-day em qualquer dia da semana
  const hasAny = days.some((d) =>
    (eventsByDay[d.toDateString()] ?? []).some((e) => e.isAllDay)
  );
  if (!hasAny) return null;

  return (
    <div className="grid grid-cols-[60px_repeat(7,1fr)] border-x border-b border-[#1e2d45] bg-[#0f1623] py-1">
      <div className="border-r border-[#1e2d45] text-[9px] text-slate-600 px-2 py-1 self-center">dia todo</div>
      {days.map((d, i) => {
        const events = (eventsByDay[d.toDateString()] ?? []).filter((e) => e.isAllDay);
        const isToday = sameDay(d, today);
        return (
          <div key={i} className={`border-r border-[#1e2d45] last:border-r-0 px-1 py-0.5 space-y-0.5 ${isToday ? "bg-indigo-500/10" : ""}`}>
            {events.map((ev) => {
              const style = KIND_STYLE[ev.kind];
              return (
                <a
                  key={ev.id}
                  href={ev.href ?? "#"}
                  target={ev.kind === "google" ? "_blank" : undefined}
                  rel={ev.kind === "google" ? "noreferrer" : undefined}
                  className={`block text-[10px] px-1.5 py-0.5 rounded ${style.bg} ${style.text} truncate hover:brightness-125 transition`}
                  title={ev.title}
                >
                  {ev.title}
                </a>
              );
            })}
          </div>
        );
      })}
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
  const top = (hour - HOURS[0]) * 56 + (minute / 60) * 56;
  return (
    <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top }}>
      <div className="flex items-center">
        <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
        <div className="flex-1 h-[1.5px] bg-red-500" />
      </div>
    </div>
  );
}

// ── Evento posicionado na grade ──────────────────────────────────────────────

function PositionedEvent({ ev }: { ev: UnifiedEvent }) {
  const style = KIND_STYLE[ev.kind];
  const Icon = style.icon;

  const startHour = ev.start.getHours() + ev.start.getMinutes() / 60;
  const endHour   = ev.end.getHours()   + ev.end.getMinutes() / 60;

  // Clamp na janela visível 6h-22h
  const top = Math.max(0, (startHour - HOURS[0]) * 56);
  const heightRaw = (Math.min(endHour, HOURS[HOURS.length - 1] + 1) - startHour) * 56;
  const height = Math.max(20, heightRaw); // mínimo 20px pra evento visível

  const startTime = ev.start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <a
      href={ev.href ?? "#"}
      target={ev.kind === "google" ? "_blank" : undefined}
      rel={ev.kind === "google" ? "noreferrer" : undefined}
      className={`absolute left-1 right-1 rounded ${style.bg} ${style.border} ${style.text} px-1.5 py-1 overflow-hidden hover:brightness-125 transition cursor-pointer`}
      style={{ top, height, zIndex: 1 }}
      title={`${startTime} ${ev.title}${ev.meta ? "\n" + ev.meta : ""}`}
    >
      <div className="flex items-center gap-1">
        <Icon className={`w-2.5 h-2.5 ${style.iconColor} flex-shrink-0`} strokeWidth={2.5} />
        <span className="text-[10px] font-semibold truncate">{startTime}</span>
        {ev.hangoutLink && <Video className="w-2.5 h-2.5 text-emerald-300 flex-shrink-0" strokeWidth={2.5} />}
      </div>
      <div className="text-[10px] truncate leading-tight mt-0.5">{ev.title}</div>
    </a>
  );
}
