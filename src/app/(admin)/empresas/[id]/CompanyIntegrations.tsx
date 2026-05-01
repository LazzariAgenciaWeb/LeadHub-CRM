"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plug, BarChart3, Search, MapPin, Megaphone, Share2,
  Check, X, AlertTriangle, RefreshCw, Trash2, ExternalLink,
  Loader2, CheckCircle2,
} from "lucide-react";

type Provider = "GA4" | "SEARCH_CONSOLE" | "BUSINESS_PROFILE" | "GOOGLE_ADS" | "META_ADS";
type Status = "ACTIVE" | "EXPIRED" | "ERROR" | "DISCONNECTED";

interface Integration {
  id: string;
  provider: Provider;
  accountId: string | null;
  accountLabel: string | null;
  scopes: string[];
  googleEmail: string | null;
  googleName: string | null;
  status: Status;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastError: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
}

const PROVIDER_META: Record<Provider, { label: string; Icon: typeof BarChart3; color: string; bg: string; description: string; oauth: "google" | "meta" | null; service?: string }> = {
  GA4: {
    label: "Google Analytics 4",
    Icon: BarChart3,
    color: "text-orange-300",
    bg: "bg-orange-500/10 border-orange-500/30",
    description: "Sessões, usuários, canais, páginas, geo. Atualiza diariamente.",
    oauth: "google",
    service: "ga4",
  },
  SEARCH_CONSOLE: {
    label: "Google Search Console",
    Icon: Search,
    color: "text-blue-300",
    bg: "bg-blue-500/10 border-blue-500/30",
    description: "Queries, impressões, cliques, posição média no Google.",
    oauth: "google",
    service: "sc",
  },
  BUSINESS_PROFILE: {
    label: "Google Meu Negócio",
    Icon: MapPin,
    color: "text-emerald-300",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    description: "Avaliações, ações no Maps (ligações, rotas), insights de busca.",
    oauth: "google",
    service: "gbp",
  },
  GOOGLE_ADS: {
    label: "Google Ads",
    Icon: Megaphone,
    color: "text-amber-300",
    bg: "bg-amber-500/10 border-amber-500/30",
    description: "Investimento, cliques, conversões, ROAS por campanha.",
    oauth: null, // futuro
  },
  META_ADS: {
    label: "Meta Ads (Facebook & Instagram)",
    Icon: Share2,
    color: "text-violet-300",
    bg: "bg-violet-500/10 border-violet-500/30",
    description: "Performance de anúncios no Facebook e Instagram.",
    oauth: null,
  },
};

const PROVIDER_ORDER: Provider[] = ["GA4", "SEARCH_CONSOLE", "BUSINESS_PROFILE", "GOOGLE_ADS", "META_ADS"];

const STATUS_META: Record<Status, { label: string; color: string }> = {
  ACTIVE:       { label: "Conectado",    color: "text-emerald-400" },
  EXPIRED:      { label: "Expirado",     color: "text-amber-400" },
  ERROR:        { label: "Erro",         color: "text-red-400" },
  DISCONNECTED: { label: "Desconectado", color: "text-slate-400" },
};

export default function CompanyIntegrations({ companyId }: { companyId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [picker, setPicker] = useState<{ integration: Integration } | null>(null);

  // Captura ?integration_success=1 ou ?integration_error=...
  useEffect(() => {
    const ok = searchParams.get("integration_success");
    const err = searchParams.get("integration_error");
    if (ok) {
      setFlash({ kind: "ok", msg: "Integração conectada!" });
      cleanQuery();
    } else if (err) {
      setFlash({ kind: "err", msg: `Falha: ${err}` });
      cleanQuery();
    }
    function cleanQuery() {
      const url = new URL(window.location.href);
      url.searchParams.delete("integration_success");
      url.searchParams.delete("integration_error");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/integrations`);
      if (!r.ok) throw new Error((await r.json()).error || "Erro ao carregar");
      const j = await r.json();
      setIntegrations(j.integrations);
      setCanWrite(j.canWrite);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleConnect(service: string) {
    // Redireciona pro endpoint /connect que monta a URL e manda pro Google
    window.location.href = `/api/integrations/google/connect?companyId=${companyId}&services=${service}`;
  }

  async function handleDisconnect(integrationId: string, label: string) {
    if (!confirm(`Desconectar ${label}? Tokens serão removidos. Histórico de dados sincronizados é mantido.`)) return;
    const r = await fetch(`/api/companies/${companyId}/integrations/${integrationId}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error || "Falha"); return; }
    void load();
  }

  if (loading) {
    return <div className="p-10 text-center text-slate-500 text-sm">Carregando…</div>;
  }
  if (error) {
    return <div className="p-10 text-center text-red-400 text-sm">{error}</div>;
  }

  // Agrupa por provider — pode haver múltiplas conexões (raro mas possível)
  const byProvider = new Map<Provider, Integration[]>();
  for (const i of integrations) {
    if (!byProvider.has(i.provider)) byProvider.set(i.provider, []);
    byProvider.get(i.provider)!.push(i);
  }

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-5">
        <Plug className="w-5 h-5 text-indigo-400" strokeWidth={2.25} />
        <div>
          <h2 className="text-white font-bold text-sm">Integrações de Marketing</h2>
          <p className="text-slate-500 text-[11px]">
            Conecte as fontes de dados pra alimentar o painel desta empresa.
          </p>
        </div>
      </div>

      {/* Flash de retorno do OAuth */}
      {flash && (
        <div className={`mb-4 p-3 rounded-lg flex items-start gap-2.5 border ${
          flash.kind === "ok"
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
            : "bg-red-500/10 border-red-500/30 text-red-200"
        }`}>
          {flash.kind === "ok" ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <p className="text-xs flex-1">{flash.msg}</p>
          <button onClick={() => setFlash(null)} className="text-slate-500 hover:text-slate-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="space-y-3">
        {PROVIDER_ORDER.map((provider) => {
          const meta = PROVIDER_META[provider];
          const items = byProvider.get(provider) || [];
          const hasActive = items.some((i) => i.status === "ACTIVE");
          const isAvailable = !!meta.oauth;

          return (
            <div key={provider} className={`rounded-xl border ${meta.bg} p-4`}>
              <div className="flex items-start gap-3">
                <meta.Icon className={`w-6 h-6 ${meta.color} flex-shrink-0 mt-0.5`} strokeWidth={2} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-white font-semibold text-sm">{meta.label}</h3>
                    {hasActive && (
                      <span className="text-[10px] text-emerald-300 bg-emerald-500/15 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                        <Check className="w-2.5 h-2.5" /> CONECTADO
                      </span>
                    )}
                    {!isAvailable && (
                      <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded-full uppercase font-bold">
                        em breve
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400 text-[11px] mt-0.5">{meta.description}</p>
                </div>
                <div className="flex-shrink-0 flex items-center gap-2">
                  {isAvailable && canWrite && (
                    <button
                      onClick={() => handleConnect(meta.service!)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        hasActive
                          ? "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
                          : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40"
                      }`}
                    >
                      {hasActive ? "Reconectar" : "Conectar"}
                    </button>
                  )}
                </div>
              </div>

              {/* Lista das conexões deste provider */}
              {items.length > 0 && (
                <div className="mt-3 pl-9 space-y-2">
                  {items.map((integ) => {
                    const stMeta = STATUS_META[integ.status];
                    return (
                      <div key={integ.id} className="bg-black/20 border border-white/5 rounded-lg p-2.5 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs">
                            <span className={`font-semibold ${stMeta.color}`}>● {stMeta.label}</span>
                            {integ.googleEmail && (
                              <span className="text-slate-500">· {integ.googleEmail}</span>
                            )}
                          </div>
                          {integ.accountLabel ? (
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-slate-300 text-xs truncate">{integ.accountLabel}</p>
                              {canWrite && (
                                <button
                                  onClick={() => setPicker({ integration: integ })}
                                  className="text-indigo-400 hover:text-indigo-300 text-[10px] font-semibold uppercase tracking-wide"
                                >
                                  trocar
                                </button>
                              )}
                            </div>
                          ) : (
                            canWrite ? (
                              <button
                                onClick={() => setPicker({ integration: integ })}
                                className="text-amber-400 hover:text-amber-300 text-[11px] mt-0.5 italic font-semibold underline decoration-dotted"
                              >
                                ⚠️ Selecione qual {provider === "GA4" ? "propriedade" : provider === "SEARCH_CONSOLE" ? "site" : "perfil"} sincronizar →
                              </button>
                            ) : (
                              <p className="text-amber-400 text-[11px] mt-0.5 italic">
                                ⚠️ Aguardando seleção da {provider === "GA4" ? "propriedade" : provider === "SEARCH_CONSOLE" ? "site" : "perfil"}
                              </p>
                            )
                          )}
                          {integ.lastSyncAt ? (
                            <p className="text-slate-600 text-[10px] mt-0.5">
                              Último sync: {new Date(integ.lastSyncAt).toLocaleString("pt-BR")}
                            </p>
                          ) : (
                            <p className="text-slate-600 text-[10px] mt-0.5">Aguardando primeira sincronização</p>
                          )}
                          {integ.lastError && (
                            <p className="text-red-400 text-[10px] mt-0.5 truncate" title={integ.lastError}>
                              {integ.lastError}
                            </p>
                          )}
                        </div>
                        {canWrite && (
                          <button
                            onClick={() => handleDisconnect(integ.id, meta.label)}
                            className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                            title="Desconectar"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 text-[11px] text-slate-600 space-y-1">
        <p>🔒 Tokens OAuth são gravados criptografados (AES-256-GCM).</p>
        <p>📅 Sincronização automática diária. Você também pode forçar manualmente após selecionar a propriedade.</p>
      </div>

      {picker && (
        <PropertyPickerModal
          companyId={companyId}
          integration={picker.integration}
          onClose={() => setPicker(null)}
          onSaved={() => { setPicker(null); void load(); }}
        />
      )}
    </div>
  );
}

// ─── Modal de seleção de propriedade ─────────────────────────────────────────

function PropertyPickerModal({
  companyId, integration, onClose, onSaved,
}: {
  companyId: string;
  integration: Integration;
  onClose: () => void;
  onSaved: () => void;
}) {
  const meta = PROVIDER_META[integration.provider];
  const [items, setItems] = useState<{ id: string; label: string; group?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(
          `/api/companies/${companyId}/integrations/${integration.id}/properties`
        );
        const j = await r.json();
        if (!r.ok) {
          if (cancelled) return;
          setError(j.error || "Erro ao listar propriedades");
          if (j.hint) setHint(j.hint);
          return;
        }
        if (!cancelled) setItems(j.items || []);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, integration.id]);

  async function handleSelect(item: { id: string; label: string; group?: string }) {
    setSaving(true);
    const r = await fetch(`/api/companies/${companyId}/integrations/${integration.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: item.id, accountLabel: item.label }),
    });
    setSaving(false);
    if (!r.ok) { alert((await r.json()).error || "Erro ao salvar"); return; }
    onSaved();
  }

  // Agrupa por "group" se houver
  const groupedItems = (() => {
    const map = new Map<string, { id: string; label: string }[]>();
    for (const it of items) {
      const g = it.group || "—";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push({ id: it.id, label: it.label });
    }
    return Array.from(map.entries());
  })();

  const noun =
    integration.provider === "GA4" ? "propriedade GA4" :
    integration.provider === "SEARCH_CONSOLE" ? "site Search Console" :
    integration.provider === "BUSINESS_PROFILE" ? "perfil Meu Negócio" :
    "conta";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1525] border border-[#1e2d45] rounded-2xl p-5 w-full max-w-lg shadow-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 mb-4">
          <meta.Icon className={`w-5 h-5 ${meta.color}`} strokeWidth={2} />
          <div>
            <h3 className="text-white font-bold text-base">Selecionar {noun}</h3>
            <p className="text-slate-500 text-[11px]">
              Escolha qual {noun} dessa conta Google será sincronizada para esta empresa.
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto -mx-5 px-5">
          {loading && (
            <div className="py-10 text-center text-slate-500 text-sm">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Carregando da Google…
            </div>
          )}
          {error && (
            <div className="py-6 text-center">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-red-400 text-sm font-medium mb-1">Erro</p>
              <p className="text-slate-400 text-xs whitespace-pre-wrap break-words">{error}</p>
              {hint && <p className="text-amber-400 text-xs mt-2 italic">💡 {hint}</p>}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="py-10 text-center text-slate-500 text-sm">
              Nenhum {noun} encontrado nesta conta Google.
            </div>
          )}
          {!loading && !error && groupedItems.length > 0 && (
            <div className="space-y-3">
              {groupedItems.map(([group, list]) => (
                <div key={group}>
                  {group !== "—" && (
                    <div className="text-[10px] text-slate-600 font-bold uppercase tracking-wider mb-1.5">
                      {group}
                    </div>
                  )}
                  <div className="space-y-1">
                    {list.map((it) => {
                      const isCurrent = integration.accountId === it.id;
                      return (
                        <button
                          key={it.id}
                          onClick={() => handleSelect(it)}
                          disabled={saving}
                          className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left transition-colors disabled:opacity-50 ${
                            isCurrent
                              ? "bg-emerald-500/10 border border-emerald-500/30"
                              : "bg-[#0a1220] border border-[#1e2d45] hover:border-indigo-500/50"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-white text-sm font-medium truncate">{it.label}</p>
                            <p className="text-slate-600 text-[10px] font-mono truncate">{it.id}</p>
                          </div>
                          {isCurrent ? (
                            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          ) : (
                            <span className="text-indigo-400 text-[11px] font-semibold flex-shrink-0">
                              {saving ? "..." : "Selecionar →"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full py-2 rounded-lg bg-[#0a1220] border border-[#1e2d45] text-slate-300 text-sm hover:text-white"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
