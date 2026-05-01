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
                            <p className="text-slate-300 text-xs mt-0.5 truncate">{integ.accountLabel}</p>
                          ) : (
                            <p className="text-amber-400 text-[11px] mt-0.5 italic">
                              ⚠️ Selecione qual {provider === "GA4" ? "propriedade" : provider === "SEARCH_CONSOLE" ? "site" : "perfil"} sincronizar →
                            </p>
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
    </div>
  );
}
