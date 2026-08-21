"use client";

import { useEffect, useState } from "react";
import { Activity, Target, Settings, Eye, EyeOff, Loader2, X, Check, Star, BarChart3, AlertTriangle } from "lucide-react";

type Event = {
  eventName: string;
  label: string;
  count: number;
  users: number;
  isConversion: boolean;
  featured?: boolean;
  hidden: boolean;
};

type ConversionParams = {
  eventName: string;
  params: { paramName: string; values: { value: string; count: number; users: number }[] }[];
};

type SiteSearch = {
  total: number;
  distinct: number;
  found: number;
  notFound: number;
  terms: { term: string; count: number; users: number }[];
  missTerms: { term: string; count: number; users: number }[];
};

/**
 * Parâmetros de um mesmo evento costumam repetir o prefixo (wpp_produto,
 * wpp_local...). Some o prefixo quando TODOS compartilham — o título do card
 * fica "Produto" em vez de "Wpp produto"; o nome cru continua ao lado.
 */
function shortenParam(all: string[]): (name: string) => string {
  if (all.length < 2) return (n) => n;
  const prefix = all[0].split("_")[0] + "_";
  return all.every((n) => n.startsWith(prefix)) ? (n) => n.slice(prefix.length) : (n) => n;
}

function prettyParam(name: string): string {
  const t = name.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Linha "valor ————— nº" com barra proporcional ao maior valor da lista. */
function ValueRow({
  label,
  count,
  max,
  alert = false,
}: {
  label: string;
  count: number;
  max: number;
  alert?: boolean;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-300 text-xs truncate" title={label}>
          {label}
        </span>
        <span className="text-white text-xs font-semibold tabular-nums shrink-0">
          {count.toLocaleString("pt-BR")}
        </span>
      </div>
      <div className="mt-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full ${alert ? "bg-amber-400/60" : "bg-emerald-400/50"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

type ConfigEvent = {
  eventName: string;
  count30d: number;
  users30d: number;
  isConversion: boolean;
  featured: boolean;
  displayLabel: string | null;
  hidden: boolean;
};

export default function MarketingEventsBlock({
  companyId,
  events,
  conversionEvents,
  conversionsLeadHub,
  conversionParams = [],
  featuredEvents,
  siteSearch,
  onConfigSaved,
}: {
  companyId: string;
  events: Event[];
  conversionEvents: Event[];
  conversionsLeadHub: number;
  conversionParams?: ConversionParams[];
  featuredEvents?: Event[];
  siteSearch?: SiteSearch;
  onConfigSaved: () => void;
}) {
  const [configOpen, setConfigOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const visibleEvents = events.filter((e) => !e.hidden);
  const topEvents = visibleEvents.slice(0, 10);
  const paramsWithData = conversionParams.filter((cp) => cp.params.length > 0);
  // Cards do topo: o que o cliente marcou como destaque; sem marcação nenhuma,
  // cai nas conversões (comportamento anterior).
  const cards = featuredEvents?.length ? featuredEvents : conversionEvents;
  const hasReport = paramsWithData.length > 0 || (siteSearch?.terms.length ?? 0) > 0;

  return (
    <>
      <div className="bg-[#0a1220]/60 border border-[#1e2d45] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" strokeWidth={2.25} />
            <h3 className="text-white font-bold text-sm">Eventos & Conversões</h3>
          </div>
          <div className="flex items-center gap-2">
            {hasReport && (
              <button
                onClick={() => setReportOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-semibold"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                Relatórios detalhados
                {siteSearch && siteSearch.notFound > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 text-[10px] font-bold">
                    {siteSearch.notFound.toLocaleString("pt-BR")} sem resultado
                  </span>
                )}
              </button>
            )}
            <button
              onClick={() => setConfigOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium"
            >
              <Settings className="w-3.5 h-3.5" />
              Configurar
            </button>
          </div>
        </div>

        {/* Cards do topo: destaques marcados (★) ou, na falta deles, as conversões. */}
        {cards.length > 0 ? (
          <div className="mb-5">
            <div className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide mb-2">
              Eventos principais ({conversionsLeadHub.toLocaleString("pt-BR")} conversões no período)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {cards.map((ev) => (
                <div
                  key={ev.eventName}
                  className={`rounded-lg p-3 border ${
                    ev.isConversion
                      ? "bg-emerald-500/10 border-emerald-500/30"
                      : "bg-white/[0.03] border-[#1e2d45]"
                  }`}
                >
                  <div
                    className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide mb-1 ${
                      ev.isConversion ? "text-emerald-300" : "text-slate-400"
                    }`}
                  >
                    {ev.isConversion ? <Target className="w-3 h-3" /> : <Star className="w-3 h-3" />}
                    {ev.isConversion ? "Conversão" : "Destaque"}
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

      {reportOpen && (
        <DetailedReportModal
          conversionEvents={conversionEvents}
          conversionParams={paramsWithData}
          siteSearch={siteSearch}
          onClose={() => setReportOpen(false)}
        />
      )}

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

/**
 * Relatório detalhado: uma aba por evento com parâmetros + as abas de busca.
 * Aqui as listas vêm inteiras — o bloco na página só mostra os cards.
 */
function DetailedReportModal({
  conversionEvents,
  conversionParams,
  siteSearch,
  onClose,
}: {
  conversionEvents: Event[];
  conversionParams: ConversionParams[];
  siteSearch?: SiteSearch;
  onClose: () => void;
}) {
  const tabs: { key: string; label: string; badge?: number; alert?: boolean }[] = [
    ...conversionParams.map((cp) => ({
      key: `ev:${cp.eventName}`,
      label: conversionEvents.find((e) => e.eventName === cp.eventName)?.label ?? cp.eventName,
    })),
    ...(siteSearch && siteSearch.terms.length > 0
      ? [{ key: "search", label: "Buscas no site", badge: siteSearch.distinct }]
      : []),
    ...(siteSearch && siteSearch.notFound > 0
      ? [{ key: "miss", label: "Buscas sem resultado", badge: siteSearch.notFound, alert: true }]
      : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.key ?? "");
  const [q, setQ] = useState("");

  const current = conversionParams.find((cp) => `ev:${cp.eventName}` === tab);
  const match = (t: string) => t.toLowerCase().includes(q.trim().toLowerCase());

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#0a1220] border border-[#1e2d45] rounded-xl max-w-4xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-[#1e2d45] gap-4">
          <div className="min-w-0">
            <h3 className="text-white font-bold text-base">Relatórios detalhados</h3>
            <p className="text-slate-500 text-xs mt-0.5">
              Tudo o que o GA4 registrou no período — sem corte de lista.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 px-5 pt-4 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setQ(""); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
                tab === t.key
                  ? t.alert
                    ? "bg-amber-400/20 text-amber-200"
                    : "bg-emerald-500/20 text-emerald-200"
                  : "bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              {t.alert && <AlertTriangle className="w-3.5 h-3.5" />}
              {t.label}
              {t.badge !== undefined && (
                <span className="text-[10px] opacity-70">{t.badge.toLocaleString("pt-BR")}</span>
              )}
            </button>
          ))}
        </div>

        <div className="px-5 pt-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrar…"
            className="w-full bg-[#060c17] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {current && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              {current.params.map((p) => {
                const short = shortenParam(current.params.map((x) => x.paramName));
                const values = p.values.filter((v) => match(v.value));
                const max = values[0]?.count ?? 0;
                return (
                  <div key={p.paramName} className="bg-white/[0.02] border border-[#1e2d45] rounded-lg p-3">
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                      <span className="text-slate-200 text-xs font-semibold">
                        {prettyParam(short(p.paramName))}
                      </span>
                      <code className="text-slate-500 text-[10px]">{p.paramName}</code>
                    </div>
                    {values.length === 0 ? (
                      <p className="text-slate-500 text-[11px]">Nada encontrado.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {values.map((v) => (
                          <ValueRow key={v.value} label={v.value} count={v.count} max={max} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === "search" && siteSearch && (
            <TermList
              terms={siteSearch.terms.filter((t) => match(t.term))}
              empty="Nenhum termo encontrado."
            />
          )}

          {tab === "miss" && siteSearch && (
            <>
              <div className="mb-3 p-3 rounded-lg bg-amber-400/10 border border-amber-400/25">
                <p className="text-amber-200 text-xs font-semibold mb-0.5">
                  {siteSearch.notFound.toLocaleString("pt-BR")} buscas terminaram sem nenhum resultado
                </p>
                <p className="text-slate-400 text-[11px]">
                  {siteSearch.missTerms.length > 0
                    ? "São pessoas procurando algo que o site não mostrou — produto ausente do catálogo, nome diferente do usado na busca ou item fora de estoque."
                    : "O detalhamento por termo depende do parâmetro de \"encontrou\" cruzado com o termo. Rode a sincronização novamente para preenchê-lo."}
                </p>
              </div>
              <TermList
                terms={siteSearch.missTerms.filter((t) => match(t.term))}
                empty="Sem termos detalhados no período."
                alert
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Lista de termos com barra proporcional, em duas colunas. */
function TermList({
  terms,
  empty,
  alert = false,
}: {
  terms: { term: string; count: number; users: number }[];
  empty: string;
  alert?: boolean;
}) {
  if (terms.length === 0) return <p className="text-slate-500 text-xs">{empty}</p>;
  const max = terms[0].count;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">
      {terms.map((t) => (
        <ValueRow key={t.term} label={t.term} count={t.count} max={max} alert={alert} />
      ))}
    </div>
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
            featured: e.featured,
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
              Conversão conta como resultado no LeadHub. Destaque (★) só coloca o evento como card no topo — use pra acesso a página, clique no WhatsApp, pedido de catálogo.
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
                  <th className="pb-2 text-center w-20">Destaque</th>
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
                    <td className="py-2.5 text-center">
                      <button
                        onClick={() => patch(ev.eventName, { featured: !ev.featured })}
                        title={ev.featured ? "Tirar dos destaques" : "Mostrar como card em destaque"}
                        className={ev.featured ? "text-amber-300" : "text-slate-600 hover:text-slate-400"}
                      >
                        <Star className="w-4 h-4" fill={ev.featured ? "currentColor" : "none"} />
                      </button>
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
