"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plug, BarChart3, Search, MapPin, Megaphone, Share2,
  Check, X, AlertTriangle, RefreshCw, Trash2,
  Loader2, CheckCircle2,
} from "lucide-react";

type Provider = "GA4" | "SEARCH_CONSOLE" | "BUSINESS_PROFILE" | "GOOGLE_ADS" | "META_ADS";
type Status = "ACTIVE" | "EXPIRED" | "ERROR" | "DISCONNECTED";

interface Integration {
  id: string;
  provider: Provider;
  accountId: string | null;
  accountLabel: string | null;
  nickname: string | null;
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
    description: "Investimento, cliques, conversões, ROAS por campanha. Atualiza diariamente.",
    oauth: "google",
    service: "gads",
  },
  META_ADS: {
    label: "Meta Ads (Facebook & Instagram)",
    Icon: Share2,
    color: "text-violet-300",
    bg: "bg-violet-500/10 border-violet-500/30",
    description: "Investimento, cliques, conversões e ROAS por campanha no Facebook e Instagram.",
    oauth: "meta", // fluxo próprio: /api/integrations/meta-ads/connect (não usa `service`)
  },
};

// Agrupado por PLATAFORMA. Antes era uma lista única, e o card do Meta Ads
// ficava no fim de uma sequência toda Google — parecia integração do Google.
const PLATFORMS: {
  id: string; label: string; hint: string; accent: string; providers: Provider[];
}[] = [
  {
    id: "google",
    label: "Google",
    hint: "Uma autorização por serviço, na conta Google que tem acesso. Reconectar renova todos os serviços já ligados nessa conta.",
    accent: "text-blue-300",
    providers: ["GA4", "SEARCH_CONSOLE", "BUSINESS_PROFILE", "GOOGLE_ADS"],
  },
  {
    id: "meta",
    label: "Meta",
    hint: "Facebook e Instagram — mesmo app, autorizações separadas.",
    accent: "text-violet-300",
    providers: ["META_ADS"],
  },
];

// Integrações da Meta que existem, mas são gerenciadas em outra tela (têm
// webhook, caixa de entrada e config próprios). Aparecem aqui só como atalho,
// pra ninguém procurar Instagram/Messenger nesta aba e achar que falta.
const META_ELSEWHERE: { label: string; desc: string; href: string }[] = [
  { label: "Instagram · Direct",      desc: "Mensagens e automações do Direct.", href: "/instagram" },
  { label: "Facebook · Messenger",    desc: "Conversas da Página no Inbox.",     href: "/instagram/inbox" },
  { label: "Conversions API (CAPI)",  desc: "Envio de conversões do site pra Meta.", href: "/configuracoes?secao=integracoes-meta" },
];

// Providers cujas tabelas de dados já carregam `integrationId` e, portanto,
// suportam mais de um recurso por empresa sem um sync sobrescrever o outro.
// GOOGLE_ADS e META_ADS gravam em AdCampaignDaily & cia., que ainda são
// chaveadas por (companyId, provider, ...) — lá duas contas ainda colidem.
const MULTI_PROVIDERS = new Set<Provider>(["GA4", "SEARCH_CONSOLE", "BUSINESS_PROFILE"]);

/** Como chamar o recurso de cada provider na interface. */
function nounFor(p: Provider): string {
  return p === "GA4" ? "propriedade"
    : p === "SEARCH_CONSOLE" ? "site"
    : p === "BUSINESS_PROFILE" ? "unidade"
    : "conta";
}

const STATUS_META: Record<Status, { label: string; color: string }> = {
  ACTIVE:       { label: "Conectado",    color: "text-emerald-400" },
  EXPIRED:      { label: "Expirado",     color: "text-amber-400" },
  ERROR:        { label: "Erro",         color: "text-red-400" },
  DISCONNECTED: { label: "Desconectado", color: "text-slate-400" },
};

/**
 * `platform` filtra por plataforma. A aba Integrações da empresa mostra tudo
 * ("all"); as seções de Configurações mostram só a sua — assim o Meta Ads
 * deixa de aparecer no meio de uma lista Google.
 */
export default function CompanyIntegrations({
  companyId, platformFilter = "all",
}: {
  companyId: string;
  platformFilter?: "google" | "meta" | "all";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [picker, setPicker] = useState<{ integration: Integration } | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [adding, setAdding] = useState<Provider | null>(null);

  async function handleSyncNow(integration: Integration) {
    if (!integration.accountId) {
      setPicker({ integration });
      return;
    }
    setSyncing(integration.id);
    try {
      const r = await fetch(`/api/companies/${companyId}/integrations/${integration.id}/sync`, {
        method: "POST",
      });
      const j = await r.json();
      if (!r.ok) {
        setFlash({ kind: "err", msg: j.error || "Falha no sync" });
      } else {
        const det = j.result || {};
        const summary = Object.entries(det)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ");
        setFlash({ kind: "ok", msg: `Sincronizado! ${summary}` });
      }
      void load();
    } finally {
      setSyncing(null);
    }
  }

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

  async function load(): Promise<Integration[]> {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/integrations`);
      if (!r.ok) throw new Error((await r.json()).error || "Erro ao carregar");
      const j = await r.json();
      setIntegrations(j.integrations);
      setCanWrite(j.canWrite);
      return j.integrations as Integration[];
    } catch (e: any) {
      setError(e.message);
      return [];
    } finally {
      setLoading(false);
    }
  }

  /**
   * Adiciona OUTRA propriedade do mesmo provider reaproveitando a autorização
   * já concedida — o caso de uma conta Google que administra dois sites.
   *
   * Refazer o OAuth aqui não resolveria: com a MESMA conta Google, o callback
   * renova a conexão existente em vez de criar outra (de propósito, senão toda
   * reconexão viraria duplicata). Pra outra conta Google, o caminho continua
   * sendo o botão "Conectar".
   */
  async function handleAddAnother(provider: Provider, source: Integration) {
    setAdding(provider);
    try {
      const r = await fetch(`/api/companies/${companyId}/integrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromIntegrationId: source.id }),
      });
      const j = await r.json();
      if (!r.ok) {
        setFlash({ kind: "err", msg: j.error || "Falha ao adicionar" });
        return;
      }
      // Abre o seletor já na conexão nova — sem propriedade escolhida ela não
      // sincroniza nada, e deixar o usuário procurar o link "selecione" na
      // lista seria um passo a mais sem motivo.
      const lista = await load();
      const nova = lista.find((i) => i.id === j.integration.id);
      if (nova) setPicker({ integration: nova });
    } finally {
      setAdding(null);
    }
  }

  function handleConnect(provider: Provider) {
    // Cada provedor de OAuth tem seu /connect, que monta a URL e redireciona.
    const meta = PROVIDER_META[provider];
    if (meta.oauth === "meta") {
      window.location.href = `/api/integrations/meta-ads/connect?companyId=${companyId}`;
      return;
    }
    window.location.href = `/api/integrations/google/connect?companyId=${companyId}&services=${meta.service}`;
  }

  async function handleDisconnect(integrationId: string, label: string) {
    if (!confirm(`Desconectar ${label}? Tokens serão removidos. Histórico de dados sincronizados é mantido.`)) return;
    const r = await fetch(`/api/companies/${companyId}/integrations/${integrationId}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error || "Falha"); return; }
    void load();
  }

  /**
   * Remove a conexão E o histórico que ela sincronizou. Só oferecido pra
   * conexão JÁ desconectada — desconectar mantém o histórico de propósito, e a
   * purga é o passo consciente de quem quer sumir com o dado.
   */
  async function handlePurge(integrationId: string, label: string) {
    if (!confirm(
      `Apagar DEFINITIVAMENTE ${label} e todo o histórico sincronizado por ela?\n\n` +
      `Os números dessa fonte somem do relatório, inclusive do modo "Todas". Não dá pra desfazer.`
    )) return;
    const r = await fetch(`/api/companies/${companyId}/integrations/${integrationId}?purge=1`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert(j.error || "Falha"); return; }
    setFlash({ kind: "ok", msg: `Conexão removida — ${j.rowsDeleted ?? 0} linhas de histórico apagadas.` });
    void load();
  }

  /** Apelido pra distinguir duas conexões cujo nome na Google é parecido. */
  async function handleRename(integ: Integration) {
    const atual = integ.nickname || "";
    const novo = prompt(
      `Apelido desta conexão (aparece no seletor do relatório).\n` +
      `Nome na Google: ${integ.accountLabel || integ.accountId || "—"}\n\n` +
      `Deixe em branco para usar o nome da Google.`,
      atual
    );
    if (novo === null) return; // cancelou
    const r = await fetch(`/api/companies/${companyId}/integrations/${integ.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: novo }),
    });
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
          <h2 className="text-white font-bold text-sm">
            {platformFilter === "all" ? "Integrações de Marketing"
              : platformFilter === "meta" ? "Integrações Meta"
              : "Integrações Google"}
          </h2>
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

      <div className="space-y-6">
        {PLATFORMS.filter((pf) => platformFilter === "all" || pf.id === platformFilter).map((platform) => (
        <div key={platform.id} className="space-y-3">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className={`text-xs font-bold uppercase tracking-wide ${platform.accent}`}>{platform.label}</h3>
            <span className="text-slate-600 text-[11px]">{platform.hint}</span>
          </div>

        {platform.providers.map((provider) => {
          const meta = PROVIDER_META[provider];
          const items = byProvider.get(provider) || [];
          const hasActive = items.some((i) => i.status === "ACTIVE");
          const isAvailable = !!meta.oauth;
          // Providers que aceitam N recursos por empresa. Meta Ads fica de fora
          // desta leva: as tabelas de Ads ainda não carregam integrationId, então
          // duas contas continuariam se sobrescrevendo — habilitar o botão aqui
          // só entregaria a duplicação mais rápido.
          const multiOk = MULTI_PROVIDERS.has(provider);
          // Conexão que empresta a autorização pra próxima: precisa estar ativa
          // e já ter propriedade escolhida (a pendente é a que estamos evitando
          // duplicar).
          const addSource = items.find((i) => i.status === "ACTIVE" && i.accountId);

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
                  {/* Adicionar OUTRA propriedade da mesma conta Google. Só
                      aparece pra provider que aceita mais de uma e que já tem
                      conexão viva pra emprestar a autorização. */}
                  {isAvailable && canWrite && multiOk && addSource && (
                    <button
                      onClick={() => handleAddAnother(provider, addSource)}
                      disabled={adding === provider}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-indigo-300 border border-indigo-500/30 disabled:opacity-50 transition-colors"
                      title={`Adiciona outra ${nounFor(provider)} usando a mesma conta Google (${addSource.googleEmail ?? "já conectada"}). Pra usar OUTRA conta Google, clique em Conectar.`}
                    >
                      {adding === provider ? "Adicionando…" : `+ ${nounFor(provider)}`}
                    </button>
                  )}
                  {isAvailable && canWrite && (
                    <button
                      onClick={() => handleConnect(provider)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        hasActive
                          ? "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
                          : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40"
                      }`}
                      title={
                        hasActive
                          ? "Renova a autorização — a propriedade escolhida é mantida e os demais serviços Google desta conta também são renovados."
                          : undefined
                      }
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
                            {(integ.googleEmail || integ.googleName) && (
                              <span className="text-slate-500">· {integ.googleEmail || integ.googleName}</span>
                            )}
                          </div>
                          {integ.accountLabel ? (
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <p className="text-slate-300 text-xs truncate">
                                {integ.nickname || integ.accountLabel}
                                {/* Com apelido, o nome da Google vira detalhe —
                                    mas continua visível pra ninguém perder de
                                    vista qual recurso está ligado ali. */}
                                {integ.nickname && (
                                  <span className="text-slate-600 ml-1.5">({integ.accountLabel})</span>
                                )}
                              </p>
                              {canWrite && (
                                <button
                                  onClick={() => setPicker({ integration: integ })}
                                  className="text-indigo-400 hover:text-indigo-300 text-[10px] font-semibold uppercase tracking-wide"
                                >
                                  trocar
                                </button>
                              )}
                              {canWrite && multiOk && items.length > 1 && (
                                <button
                                  onClick={() => handleRename(integ)}
                                  className="text-slate-500 hover:text-slate-300 text-[10px] font-semibold uppercase tracking-wide"
                                  title="Apelido que aparece no seletor do relatório"
                                >
                                  apelidar
                                </button>
                              )}
                            </div>
                          ) : (
                            canWrite ? (
                              <button
                                onClick={() => setPicker({ integration: integ })}
                                className="text-amber-400 hover:text-amber-300 text-[11px] mt-0.5 italic font-semibold underline decoration-dotted"
                              >
                                ⚠️ Selecione qual {provider === "GA4" ? "propriedade" : provider === "SEARCH_CONSOLE" ? "site" : provider === "GOOGLE_ADS" || provider === "META_ADS" ? "conta" : "perfil"} sincronizar →
                              </button>
                            ) : (
                              <p className="text-amber-400 text-[11px] mt-0.5 italic">
                                ⚠️ Aguardando seleção da {provider === "GA4" ? "propriedade" : provider === "SEARCH_CONSOLE" ? "site" : provider === "GOOGLE_ADS" || provider === "META_ADS" ? "conta" : "perfil"}
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
                        {canWrite && integ.accountId && (provider === "GA4" || provider === "SEARCH_CONSOLE" || provider === "GOOGLE_ADS" || provider === "META_ADS") && (
                          <button
                            onClick={() => handleSyncNow(integ)}
                            disabled={syncing === integ.id}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 text-[10px] font-semibold uppercase tracking-wide disabled:opacity-50 transition-colors"
                            title="Forçar sincronização agora"
                          >
                            {syncing === integ.id ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Sincronizando…
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-3 h-3" />
                                Sync agora
                              </>
                            )}
                          </button>
                        )}
                        {/* Conexão viva: desconectar (mantém histórico).
                            Já desconectada: apagar de vez, com o histórico. */}
                        {canWrite && integ.status !== "DISCONNECTED" && (
                          <button
                            onClick={() => handleDisconnect(integ.id, integ.nickname || integ.accountLabel || meta.label)}
                            className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                            title="Desconectar (mantém o histórico já sincronizado)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canWrite && integ.status === "DISCONNECTED" && (
                          <button
                            onClick={() => handlePurge(integ.id, integ.nickname || integ.accountLabel || meta.label)}
                            className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                            title="Apagar a conexão e o histórico dela"
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

        {/* Atalhos: integrações da Meta que moram em outra tela */}
        {platform.id === "meta" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {META_ELSEWHERE.map((m) => (
              <a
                key={m.href + m.label}
                href={m.href}
                className="bg-black/20 hover:bg-black/40 border border-white/5 rounded-lg p-2.5 transition-colors group"
              >
                <p className="text-slate-300 group-hover:text-white text-[11px] font-semibold">{m.label}</p>
                <p className="text-slate-600 text-[10px] mt-0.5">{m.desc}</p>
                <span className="text-violet-400/70 group-hover:text-violet-300 text-[10px] font-semibold mt-1 inline-block">
                  Gerenciar →
                </span>
              </a>
            ))}
          </div>
        )}
        </div>
        ))}
      </div>

      <div className="mt-5 text-[11px] text-slate-600 space-y-1">
        <p>🔒 Tokens OAuth são gravados criptografados (AES-256-GCM).</p>
        <p>📅 Sincronização automática diária. Você também pode forçar manualmente após selecionar a propriedade.</p>
      </div>

      {picker && (
        <PropertyPickerModal
          companyId={companyId}
          integration={picker.integration}
          // Recursos já ligados a OUTRA conexão desta empresa. O servidor
          // recusaria (409), mas descobrir isso só depois de clicar é ruim —
          // aqui a lista já mostra qual está tomado.
          usedIds={new Set(
            integrations
              .filter((i) => i.provider === picker.integration.provider && i.id !== picker.integration.id && i.accountId)
              .map((i) => i.accountId as string)
          )}
          onClose={() => setPicker(null)}
          onSaved={() => { setPicker(null); void load(); }}
        />
      )}
    </div>
  );
}

/** Normaliza pra busca: minúsculo e sem acento. */
function norm(v: string): string {
  return v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ─── Modal de seleção de propriedade ─────────────────────────────────────────

function PropertyPickerModal({
  companyId, integration, usedIds, onClose, onSaved,
}: {
  companyId: string;
  integration: Integration;
  usedIds: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const meta = PROVIDER_META[integration.provider];
  const [items, setItems] = useState<{ id: string; label: string; group?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [q, setQ] = useState("");

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
        if (cancelled) return;
        // Lista vazia com motivo conhecido vem como 200 + error/hint — mostrar
        // "nenhum encontrado" e engolir a explicação é o que deixava o cliente
        // sem saber que o problema era o e-mail sem papel no perfil.
        if (!r.ok || j.error) {
          setError(j.error || "Erro ao listar propriedades");
          if (j.hint) setHint(j.hint);
          return;
        }
        setItems(j.items || []);
        if (j.warning) setWarning(j.warning);
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

  // Busca sem acento e sem caso — "colegio" acha "Colégio". Casa também com o
  // id (locations/123, properties/456) e com o nome do grupo/conta, que é como
  // a pessoa costuma lembrar do perfil ("os da MARKETING AZZ").
  const filtered = (() => {
    const needle = norm(q).trim();
    if (!needle) return items;
    const terms = needle.split(/\s+/);
    return items.filter((it) => {
      const hay = norm(`${it.label} ${it.id} ${it.group ?? ""}`);
      return terms.every((t) => hay.includes(t));
    });
  })();

  // Agrupa por "group" se houver
  const groupedItems = (() => {
    const map = new Map<string, { id: string; label: string }[]>();
    for (const it of filtered) {
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

        {!loading && !error && items.length > 7 && (
          <div className="mb-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && q) { e.stopPropagation(); setQ(""); }
                  // Enter com um único resultado seleciona direto — o caso comum
                  // é digitar o nome da empresa e confirmar.
                  if (e.key === "Enter" && filtered.length === 1 && !saving) handleSelect(filtered[0]);
                }}
                placeholder={`Buscar ${noun}…`}
                className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg pl-8 pr-16 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 tabular-nums">
                {q ? `${filtered.length}/${items.length}` : items.length}
              </span>
            </div>
          </div>
        )}

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
          {!loading && !error && items.length > 0 && filtered.length === 0 && (
            <div className="py-10 text-center text-slate-500 text-sm">
              Nada casou com “{q}”.
              <button onClick={() => setQ("")} className="block mx-auto mt-2 text-indigo-400 hover:text-indigo-300 text-xs font-semibold">
                Limpar busca
              </button>
            </div>
          )}
          {!loading && warning && (
            <div className="mb-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] whitespace-pre-wrap break-words">
              ⚠️ {warning}
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
                      // Já ligado a outra conexão desta empresa — apontar duas
                      // pro mesmo recurso duplicaria todo número no consolidado.
                      const emUso = !isCurrent && usedIds.has(it.id);
                      return (
                        <button
                          key={it.id}
                          onClick={() => handleSelect(it)}
                          disabled={saving || emUso}
                          title={emUso ? "Já conectada em outra linha desta empresa" : undefined}
                          className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left transition-colors disabled:opacity-50 ${
                            isCurrent
                              ? "bg-emerald-500/10 border border-emerald-500/30"
                              : emUso
                                ? "bg-[#0a1220] border border-[#1e2d45] cursor-not-allowed"
                                : "bg-[#0a1220] border border-[#1e2d45] hover:border-indigo-500/50"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-white text-sm font-medium truncate">{it.label}</p>
                            <p className="text-slate-600 text-[10px] font-mono truncate">{it.id}</p>
                          </div>
                          {isCurrent ? (
                            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          ) : emUso ? (
                            <span className="text-slate-600 text-[11px] font-semibold flex-shrink-0">
                              já conectada
                            </span>
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
