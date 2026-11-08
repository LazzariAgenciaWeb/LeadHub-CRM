"use client";

import { useEffect, useState } from "react";
import {
  Search, MousePointerClick, Eye, Percent, Hash, RefreshCw, TrendingUp, TrendingDown,
  ExternalLink, Share2,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { SC_CHANNEL_META, type ScChannel } from "@/lib/search-console-property";

/**
 * Seção "Redes" do Dashboard de Marketing.
 *
 * Mostra as PROPRIEDADES DE PLATAFORMA do Search Console — Instagram, TikTok,
 * YouTube e X — uma por bloco, com cliques, impressões, CTR, posição média, as
 * queries que levaram até o perfil e os posts que mais aparecem.
 *
 * O recorte é sempre por canal: somar Instagram com TikTok (ou com o site)
 * daria um número que não responde pergunta nenhuma.
 *
 * Isto é desempenho NA BUSCA DO GOOGLE, não métrica de dentro da rede — o
 * rodapé do bloco diz isso, porque é a confusão garantida na reunião.
 */

interface ChannelMetric {
  value: number;
  delta?: number | null;
  previous?: number | null;
}

interface ChannelData {
  integrationId: string;
  channel: ScChannel | null;
  handle: string | null;
  label: string;
  property: string | null;
  status: string;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastError: string | null;
  kpis: {
    clicks: ChannelMetric;
    impressions: ChannelMetric;
    ctr: ChannelMetric;
    position: { value: number | null; previous: number | null; delta: number | null };
  };
  dailySeries: { date: string; clicks: number; impressions: number }[];
  topQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
  topPages: { page: string; clicks: number; impressions: number; ctr: number; position: number }[];
}

interface ScSocialResponse {
  connected: boolean;
  period: { days: number };
  channels: ChannelData[];
  hasData?: boolean;
}

export default function CompanyScSocialSection({
  companyId, days = 30, readOnly = false,
}: {
  companyId: string;
  days?: number;
  readOnly?: boolean;
}) {
  const [data, setData] = useState<ScSocialResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/marketing/search-console?days=${days}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e: any) {
      setError(e.message || "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, days]);

  async function handleSync() {
    setSyncing(true);
    try {
      // provider=sc roda todas as propriedades do Search Console da empresa —
      // perfis de rede inclusive. force ignora o throttle de 2h.
      await fetch(`/api/companies/${companyId}/marketing/sync?provider=sc&force=1`, { method: "POST" });
      await load();
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-[#1e2d45] rounded w-1/4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="h-20 bg-[#1e2d45]/50 rounded" />
            <div className="h-20 bg-[#1e2d45]/50 rounded" />
            <div className="h-20 bg-[#1e2d45]/50 rounded" />
            <div className="h-20 bg-[#1e2d45]/50 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
        Falha ao carregar as redes no Search Console: {error}
      </div>
    );
  }

  if (!data) return null;

  if (!data.connected || data.channels.length === 0) {
    return <EmptyState companyId={companyId} readOnly={readOnly} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-pink-500/10 flex items-center justify-center">
            <Share2 className="w-4 h-4 text-pink-400" strokeWidth={2.25} />
          </div>
          <div>
            <h3 className="text-white font-bold text-sm">Redes na Busca do Google</h3>
            <p className="text-slate-500 text-[11px]">
              {data.channels.length} {data.channels.length === 1 ? "perfil conectado" : "perfis conectados"} no Search Console
            </p>
          </div>
        </div>
        {!readOnly && (
          <button
            onClick={() => void handleSync()}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        )}
      </div>

      {data.channels.map((c) => (
        <ChannelBlock key={c.integrationId} data={c} />
      ))}

      <p className="text-slate-600 text-[10px] leading-relaxed">
        Estes números são do <strong>Google</strong>: cliques e impressões que o perfil e os posts
        receberam na Busca e no Discover. Alcance, seguidores e views <em>dentro</em> da rede não
        vêm do Search Console — para isso é preciso conectar a API da própria rede.
      </p>
    </div>
  );
}

// ─── Bloco de um canal ───────────────────────────────────────────────────────

function ChannelBlock({ data }: { data: ChannelData }) {
  const meta = data.channel ? SC_CHANNEL_META[data.channel] : null;
  const semDado = data.kpis.impressions.value === 0 && data.kpis.clicks.value === 0;

  return (
    <div className={`bg-[#0a1220] border rounded-xl p-4 space-y-4 ${meta?.border ?? "border-[#1e2d45]"}`}>
      {/* Cabeçalho do canal */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${meta?.bgColor ?? "bg-slate-500/15"}`}>
            {meta?.icon ?? "🔍"}
          </span>
          <div className="min-w-0">
            <h4 className={`font-bold text-sm truncate ${meta?.color ?? "text-white"}`}>{data.label}</h4>
            <p className="text-slate-600 text-[10px] truncate" title={data.property ?? ""}>
              {data.property}
              {data.lastSyncAt
                ? ` · sync ${formatRelative(new Date(data.lastSyncAt))}`
                : " · aguardando 1º sync"}
            </p>
          </div>
        </div>
        {data.status !== "ACTIVE" && (
          <span className="text-amber-400 text-[11px] font-semibold">⚠️ {data.status}</span>
        )}
      </div>

      {data.lastError && (
        <p className="text-red-400 text-[11px] truncate" title={data.lastError}>{data.lastError}</p>
      )}

      {semDado ? (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
          <p className="text-amber-300 text-xs font-semibold mb-0.5">Sem dado no período</p>
          <p className="text-slate-500 text-[11px]">
            O Search Console só coleta a partir do momento em que a propriedade é adicionada — não
            traz histórico de antes. O primeiro dado costuma aparecer em alguns dias.
          </p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi
              icon={MousePointerClick} iconColor="text-emerald-400"
              label="Cliques" value={fmt(data.kpis.clicks.value)} delta={data.kpis.clicks.delta}
            />
            <Kpi
              icon={Eye} iconColor="text-indigo-400"
              label="Impressões" value={fmt(data.kpis.impressions.value)} delta={data.kpis.impressions.delta}
            />
            <Kpi
              icon={Percent} iconColor="text-amber-400"
              label="CTR" value={`${(data.kpis.ctr.value * 100).toFixed(2)}%`}
            />
            <Kpi
              icon={Hash} iconColor="text-cyan-400"
              label="Posição média"
              value={data.kpis.position.value !== null ? data.kpis.position.value.toFixed(1) : "—"}
              // Posição: delta positivo = subiu na busca (número menor).
              delta={data.kpis.position.delta}
              deltaSuffix=" pos"
            />
          </div>

          {/* Série diária */}
          {data.dailySeries.length > 1 && (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.dailySeries} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                  <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={shortDate} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: "#070b14", border: "1px solid #1e2d45", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(d) => shortDate(String(d))}
                  />
                  <Line type="monotone" dataKey="impressions" name="Impressões" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="clicks" name="Cliques" stroke={meta?.hex ?? "#10b981"} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Queries */}
            <div>
              <h5 className="text-slate-300 text-xs font-semibold mb-2">
                O que buscaram pra chegar no perfil
              </h5>
              {data.topQueries.length === 0 ? (
                <p className="text-slate-600 text-[11px]">Sem query no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-[#1e2d45]">
                        <th className="py-1.5 px-2 text-slate-500 text-[10px] font-semibold uppercase">Termo</th>
                        <th className="py-1.5 px-2 text-slate-500 text-[10px] font-semibold uppercase text-right">Cliq.</th>
                        <th className="py-1.5 px-2 text-slate-500 text-[10px] font-semibold uppercase text-right">Impr.</th>
                        <th className="py-1.5 px-2 text-slate-500 text-[10px] font-semibold uppercase text-right">Pos.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topQueries.map((q) => (
                        <tr key={q.query} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                          <td className="py-1.5 px-2 text-slate-200 text-xs truncate max-w-[220px]" title={q.query}>{q.query}</td>
                          <td className="py-1.5 px-2 text-slate-300 text-xs font-mono text-right">{q.clicks}</td>
                          <td className="py-1.5 px-2 text-slate-500 text-xs font-mono text-right">{q.impressions}</td>
                          <td className="py-1.5 px-2 text-slate-400 text-xs font-mono text-right">{q.position.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Posts */}
            <div>
              <h5 className="text-slate-300 text-xs font-semibold mb-2">Posts que mais aparecem</h5>
              {data.topPages.length === 0 ? (
                <p className="text-slate-600 text-[11px]">
                  O Search Console ainda não separou por post neste período.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {data.topPages.map((p) => (
                    <li key={p.page} className="flex items-center gap-2 text-xs">
                      <a
                        href={p.page.startsWith("http") ? p.page : `https://${p.page}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 min-w-0 flex items-center gap-1 text-slate-300 hover:text-white truncate"
                        title={p.page}
                      >
                        <span className="truncate">{shortPage(p.page)}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0 text-slate-600" />
                      </a>
                      <span className="text-slate-300 font-mono">{p.clicks}</span>
                      <span className="text-slate-600 font-mono">/ {p.impressions}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ companyId, readOnly }: { companyId: string; readOnly: boolean }) {
  return (
    <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-pink-500/10 flex items-center justify-center flex-shrink-0">
          <Search className="w-5 h-5 text-pink-400" strokeWidth={2.25} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-semibold text-sm mb-1">Nenhuma rede conectada</h3>
          <p className="text-slate-500 text-xs mb-3">
            O Search Console tem <strong>propriedade de plataforma</strong>: além do site, dá pra
            adicionar o perfil do Instagram, do TikTok, do X e o canal do YouTube e ver quanto
            aquele conteúdo aparece na Busca do Google e no Discover.
          </p>
          <ol className="text-slate-400 text-[11px] space-y-1 mb-3 list-decimal list-inside">
            <li>
              No{" "}
              <a
                href="https://search.google.com/search-console"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline decoration-dotted"
              >
                Search Console
              </a>
              , abra o seletor de propriedade → <strong>+ Adicionar propriedade</strong> → escolha a
              plataforma e autorize.
            </li>
            <li>
              Use a <strong>mesma conta Google</strong> que já está conectada aqui — é a
              autorização dela que o GoHub usa pra ler.
            </li>
            <li>Volte às integrações, clique em <strong>trocar</strong> no Search Console e escolha o perfil.</li>
          </ol>
          {!readOnly && (
            <a
              href={`/empresas/${companyId}?tab=integracoes`}
              className="inline-flex items-center gap-1.5 text-xs text-pink-400 hover:text-pink-300 font-semibold"
            >
              Ir para integrações →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Peças ───────────────────────────────────────────────────────────────────

function Kpi({
  icon: Icon, iconColor, label, value, delta, deltaSuffix,
}: {
  icon: typeof Search; iconColor: string; label: string; value: string;
  delta?: number | null; deltaSuffix?: string;
}) {
  const up = delta != null && delta > 0;
  const down = delta != null && delta < 0;
  return (
    <div className="bg-black/20 border border-white/5 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${iconColor}`} strokeWidth={2.25} />
        <span className="text-slate-500 text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-white font-bold text-lg leading-none">{value}</div>
      {delta != null && (
        <div className={`flex items-center gap-1 mt-1 text-[10px] font-semibold ${up ? "text-emerald-400" : down ? "text-red-400" : "text-slate-500"}`}>
          {up ? <TrendingUp className="w-3 h-3" /> : down ? <TrendingDown className="w-3 h-3" /> : null}
          {deltaSuffix
            ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}${deltaSuffix}`
            : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`}
        </div>
      )}
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("pt-BR");
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return d && m ? `${d}/${m}` : iso;
}

/** `instagram.com/p/ABC123/` → `/p/ABC123` — o host já está no cabeçalho. */
function shortPage(page: string): string {
  const sem = page.replace(/^https?:\/\//i, "");
  const barra = sem.indexOf("/");
  const caminho = barra >= 0 ? sem.slice(barra) : sem;
  return (caminho.replace(/\/+$/, "") || sem) as string;
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}
