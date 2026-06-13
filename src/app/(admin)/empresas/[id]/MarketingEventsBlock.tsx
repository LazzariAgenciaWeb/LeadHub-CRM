"use client";

import { useEffect, useState } from "react";
import { Activity, Target, Settings, Eye, EyeOff, Loader2, X, Check } from "lucide-react";

type Event = {
  eventName: string;
  label: string;
  count: number;
  users: number;
  isConversion: boolean;
  hidden: boolean;
};

type ConfigEvent = {
  eventName: string;
  count30d: number;
  users30d: number;
  isConversion: boolean;
  displayLabel: string | null;
  hidden: boolean;
};

export default function MarketingEventsBlock({
  companyId,
  events,
  conversionEvents,
  conversionsLeadHub,
  onConfigSaved,
}: {
  companyId: string;
  events: Event[];
  conversionEvents: Event[];
  conversionsLeadHub: number;
  onConfigSaved: () => void;
}) {
  const [configOpen, setConfigOpen] = useState(false);
  const visibleEvents = events.filter((e) => !e.hidden);
  const topEvents = visibleEvents.slice(0, 10);

  return (
    <>
      <div className="bg-[#0a1220]/60 border border-[#1e2d45] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" strokeWidth={2.25} />
            <h3 className="text-white font-bold text-sm">Eventos & Conversões</h3>
          </div>
          <button
            onClick={() => setConfigOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium"
          >
            <Settings className="w-3.5 h-3.5" />
            Configurar conversões
          </button>
        </div>

        {/* Conversões marcadas — destaque */}
        {conversionEvents.length > 0 ? (
          <div className="mb-5">
            <div className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide mb-2">
              Suas conversões ({conversionsLeadHub.toLocaleString("pt-BR")} no período)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {conversionEvents.map((ev) => (
                <div
                  key={ev.eventName}
                  className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3"
                >
                  <div className="flex items-center gap-1.5 text-emerald-300 text-[10px] font-bold uppercase tracking-wide mb-1">
                    <Target className="w-3 h-3" />
                    Conversão
                  </div>
                  <div className="text-white font-bold text-lg">{ev.count.toLocaleString("pt-BR")}</div>
                  <div className="text-slate-400 text-[11px] truncate" title={ev.eventName}>
                    {ev.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-5 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
            <p className="text-amber-300 text-xs font-semibold mb-0.5">Nenhum evento marcado como conversão</p>
            <p className="text-slate-400 text-[11px]">
              Clique em <strong>Configurar conversões</strong> e marque quais eventos (ex: <code>whatsapp_click</code>, <code>form_submit</code>) devem contar como conversão.
            </p>
          </div>
        )}

        {/* Top eventos detectados */}
        <div>
          <div className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide mb-2">
            Top eventos detectados
          </div>
          {topEvents.length === 0 ? (
            <p className="text-slate-500 text-xs">Nenhum evento detectado no período.</p>
          ) : (
            <div className="space-y-1">
              {topEvents.map((ev) => (
                <div
                  key={ev.eventName}
                  className="flex items-center justify-between gap-3 py-1.5 px-2 rounded hover:bg-white/5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {ev.isConversion && <Target className="w-3 h-3 text-emerald-400 shrink-0" />}
                    <code className="text-slate-300 text-xs truncate">{ev.eventName}</code>
                    {ev.label !== ev.eventName && (
                      <span className="text-slate-500 text-[11px] truncate">— {ev.label}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    <span className="text-slate-400">{ev.users.toLocaleString("pt-BR")} usr</span>
                    <span className="text-white font-semibold tabular-nums w-16 text-right">
                      {ev.count.toLocaleString("pt-BR")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {configOpen && (
        <EventsConfigModal
          companyId={companyId}
          onClose={() => setConfigOpen(false)}
          onSaved={() => {
            setConfigOpen(false);
            onConfigSaved();
          }}
        />
      )}
    </>
  );
}

function EventsConfigModal({
  companyId,
  onClose,
  onSaved,
}: {
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [events, setEvents] = useState<ConfigEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/companies/${companyId}/marketing/events`);
        if (!r.ok) throw new Error((await r.json()).error || "Erro ao carregar eventos");
        const j = await r.json();
        setEvents(j.events ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro");
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId]);

  function patch(eventName: string, patch: Partial<ConfigEvent>) {
    setEvents((prev) => prev.map((e) => (e.eventName === eventName ? { ...e, ...patch } : e)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/marketing/events`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: events.map((e) => ({
            eventName: e.eventName,
            isConversion: e.isConversion,
            displayLabel: e.displayLabel,
            hidden: e.hidden,
          })),
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Erro ao salvar");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#0a1220] border border-[#1e2d45] rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[#1e2d45]">
          <div>
            <h3 className="text-white font-bold text-base">Configurar Eventos & Conversões</h3>
            <p className="text-slate-500 text-xs mt-0.5">
              Marque quais eventos do GA4 devem contar como conversão no LeadHub
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center py-10 text-slate-500 text-sm">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Carregando eventos…
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-slate-400 text-sm font-semibold mb-1">Nenhum evento detectado</p>
              <p className="text-slate-500 text-xs">
                A integração GA4 ainda não trouxe eventos. Garanta que o sync rodou pelo menos uma vez.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-[11px] uppercase tracking-wide border-b border-[#1e2d45]">
                  <th className="pb-2 pl-1">Evento</th>
                  <th className="pb-2 text-right">30d</th>
                  <th className="pb-2 text-center w-24">Conversão</th>
                  <th className="pb-2 px-2">Rótulo amigável</th>
                  <th className="pb-2 text-center w-16">Ocultar</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.eventName} className="border-b border-[#1e2d45]/50 hover:bg-white/5">
                    <td className="py-2.5 pl-1">
                      <code className="text-slate-200 text-xs">{ev.eventName}</code>
                    </td>
                    <td className="py-2.5 text-right text-slate-300 tabular-nums text-xs">
                      {ev.count30d.toLocaleString("pt-BR")}
                    </td>
                    <td className="py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={ev.isConversion}
                        onChange={(e) => patch(ev.eventName, { isConversion: e.target.checked })}
                        className="w-4 h-4 accent-emerald-500"
                      />
                    </td>
                    <td className="py-2.5 px-2">
                      <input
                        type="text"
                        value={ev.displayLabel ?? ""}
                        onChange={(e) => patch(ev.eventName, { displayLabel: e.target.value })}
                        placeholder={ev.eventName}
                        className="w-full bg-[#060c17] border border-[#1e2d45] rounded px-2 py-1 text-xs text-white"
                      />
                    </td>
                    <td className="py-2.5 text-center">
                      <button
                        onClick={() => patch(ev.eventName, { hidden: !ev.hidden })}
                        className="text-slate-400 hover:text-white"
                        title={ev.hidden ? "Mostrar" : "Ocultar"}
                      >
                        {ev.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between p-5 border-t border-[#1e2d45] gap-3">
          {error && <span className="text-red-400 text-xs">{error}</span>}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || loading}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-semibold disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
