"use client";

import { useState } from "react";
import { Plus, Trash2, Clock } from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Interval = {
  id:        string;   // local UUID para React key
  startTime: string;
  endTime:   string;
  label:     string;
};

type DayConfig = {
  dayOfWeek: number;
  isOpen:    boolean;
  openTime:  string;
  closeTime: string;
  intervals: Interval[];
};

type Props = {
  initialSchedule: DayConfig[];
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DAY_FULL   = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function HorariosAtendimento({ initialSchedule }: Props) {
  const [schedule, setSchedule] = useState<DayConfig[]>(() =>
    initialSchedule.map((d) => ({
      ...d,
      intervals: d.intervals.map((iv) => ({ ...iv, id: uid() })),
    }))
  );
  const [saving, setSaving]   = useState(false);
  const [saved,  setSaved]    = useState(false);
  const [error,  setError]    = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function updateDay(dayOfWeek: number, patch: Partial<DayConfig>) {
    setSchedule((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d))
    );
  }

  function addInterval(dayOfWeek: number) {
    setSchedule((prev) =>
      prev.map((d) => {
        if (d.dayOfWeek !== dayOfWeek) return d;
        return {
          ...d,
          intervals: [
            ...d.intervals,
            { id: uid(), startTime: "12:00", endTime: "13:00", label: "Almoço" },
          ],
        };
      })
    );
  }

  function updateInterval(dayOfWeek: number, ivId: string, patch: Partial<Interval>) {
    setSchedule((prev) =>
      prev.map((d) => {
        if (d.dayOfWeek !== dayOfWeek) return d;
        return {
          ...d,
          intervals: d.intervals.map((iv) => (iv.id === ivId ? { ...iv, ...patch } : iv)),
        };
      })
    );
  }

  function removeInterval(dayOfWeek: number, ivId: string) {
    setSchedule((prev) =>
      prev.map((d) => {
        if (d.dayOfWeek !== dayOfWeek) return d;
        return { ...d, intervals: d.intervals.filter((iv) => iv.id !== ivId) };
      })
    );
  }

  // ─── Salvar ──────────────────────────────────────────────────────────────────

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/configuracoes/horarios", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule: schedule.map((d) => ({
            dayOfWeek: d.dayOfWeek,
            isOpen:    d.isOpen,
            openTime:  d.openTime,
            closeTime: d.closeTime,
            intervals: d.intervals.map(({ startTime, endTime, label }) => ({
              startTime, endTime, label: label || null,
            })),
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Erro ao salvar");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // ─── Resumo de horas ─────────────────────────────────────────────────────────

  function totalHours(day: DayConfig): string {
    if (!day.isOpen) return "Fechado";
    const [oh, om] = day.openTime.split(":").map(Number);
    const [ch, cm] = day.closeTime.split(":").map(Number);
    let mins = (ch * 60 + cm) - (oh * 60 + om);
    for (const iv of day.intervals) {
      const [sh, sm] = iv.startTime.split(":").map(Number);
      const [eh, em] = iv.endTime.split(":").map(Number);
      mins -= (eh * 60 + em) - (sh * 60 + sm);
    }
    if (mins <= 0) return "0h";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h${m}min` : `${h}h`;
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-white text-sm font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-400" />
          Horário de atendimento
        </h3>
        <p className="text-slate-500 text-xs mt-0.5">
          Define quando o horário comercial está ativo. Mensagens recebidas fora deste horário
          têm o tempo de resposta contado a partir da próxima abertura.
        </p>
      </div>

      <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[80px_1fr_1fr_1fr_80px] gap-3 px-4 py-2.5 border-b border-[#1e2d45] bg-[#080b12]">
          <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Dia</span>
          <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Entrada</span>
          <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Saída</span>
          <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Intervalos</span>
          <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider text-right">Total</span>
        </div>

        {schedule.map((day) => {
          const isExpanded = expanded === day.dayOfWeek;
          return (
            <div key={day.dayOfWeek} className="border-b border-[#1e2d45] last:border-0">
              {/* Linha principal */}
              <div className="grid grid-cols-[80px_1fr_1fr_1fr_80px] gap-3 items-center px-4 py-3">
                {/* Dia + toggle */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={day.isOpen}
                    onChange={(e) => updateDay(day.dayOfWeek, { isOpen: e.target.checked })}
                    className="w-3.5 h-3.5 rounded accent-indigo-500 flex-shrink-0"
                  />
                  <span className={`text-sm font-medium ${day.isOpen ? "text-white" : "text-slate-500"}`}>
                    {DAY_LABELS[day.dayOfWeek]}
                  </span>
                </label>

                {/* Entrada */}
                <input
                  type="time"
                  value={day.openTime}
                  disabled={!day.isOpen}
                  onChange={(e) => updateDay(day.dayOfWeek, { openTime: e.target.value })}
                  className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-sm text-white
                             focus:outline-none focus:border-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed
                             w-full"
                />

                {/* Saída */}
                <input
                  type="time"
                  value={day.closeTime}
                  disabled={!day.isOpen}
                  onChange={(e) => updateDay(day.dayOfWeek, { closeTime: e.target.value })}
                  className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-sm text-white
                             focus:outline-none focus:border-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed
                             w-full"
                />

                {/* Intervalos — badge + botão expandir */}
                <div className="flex items-center gap-2">
                  {day.isOpen ? (
                    <>
                      <button
                        onClick={() => setExpanded(isExpanded ? null : day.dayOfWeek)}
                        className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        {day.intervals.length > 0 && (
                          <span className="bg-indigo-500/20 text-indigo-300 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                            {day.intervals.length}
                          </span>
                        )}
                        <Plus className="w-3.5 h-3.5" />
                        <span>{day.intervals.length === 0 ? "Intervalo" : "Editar"}</span>
                      </button>
                    </>
                  ) : (
                    <span className="text-slate-600 text-xs">—</span>
                  )}
                </div>

                {/* Total */}
                <div className="text-right">
                  <span className={`text-xs font-medium ${day.isOpen ? "text-emerald-400" : "text-slate-600"}`}>
                    {totalHours(day)}
                  </span>
                </div>
              </div>

              {/* Painel de intervalos (expansível) */}
              {isExpanded && day.isOpen && (
                <div className="px-4 pb-3 bg-[#060911] border-t border-[#1e2d45]/50">
                  <div className="pt-3 space-y-2">
                    <p className="text-[11px] text-slate-500 mb-2">
                      Intervalos de <span className="text-slate-300">{DAY_FULL[day.dayOfWeek]}</span> — o tempo de
                      resposta não conta durante as pausas.
                    </p>
                    {day.intervals.map((iv) => (
                      <div key={iv.id} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={iv.label}
                          onChange={(e) => updateInterval(day.dayOfWeek, iv.id, { label: e.target.value })}
                          placeholder="Nome (ex: Almoço)"
                          className="w-28 bg-[#080b12] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-white
                                     placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                        />
                        <input
                          type="time"
                          value={iv.startTime}
                          onChange={(e) => updateInterval(day.dayOfWeek, iv.id, { startTime: e.target.value })}
                          className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-white
                                     focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-slate-600 text-xs">→</span>
                        <input
                          type="time"
                          value={iv.endTime}
                          onChange={(e) => updateInterval(day.dayOfWeek, iv.id, { endTime: e.target.value })}
                          className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-white
                                     focus:outline-none focus:border-indigo-500"
                        />
                        <button
                          onClick={() => removeInterval(day.dayOfWeek, iv.id)}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addInterval(day.dayOfWeek)}
                      className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300
                                 bg-indigo-500/10 hover:bg-indigo-500/15 border border-indigo-500/20
                                 rounded-lg px-3 py-1.5 transition-colors mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Adicionar intervalo
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Salvar */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium
                     disabled:opacity-50 transition-colors"
        >
          {saving ? "Salvando..." : "Salvar horários"}
        </button>
        {saved  && <span className="text-emerald-400 text-xs">✓ Salvo</span>}
        {error  && <span className="text-red-400 text-xs">{error}</span>}
      </div>
    </div>
  );
}
