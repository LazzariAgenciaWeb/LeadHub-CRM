/**
 * Classifica uma propriedade do Search Console: site ou perfil de rede.
 *
 * Desde julho/2026 o Search Console tem "propriedade de plataforma" — além de
 * site (URL-prefix e `sc-domain:`), dá pra adicionar o perfil do Instagram, do
 * TikTok, do X e o canal do YouTube e acompanhar o desempenho daquele conteúdo
 * na Busca do Google e no Discover.
 *
 * O conector não muda: a API (webmasters/v3) devolve tudo no mesmo
 * `sites.list`, só com o `siteUrl` apontando pro perfil. O que muda é:
 *   1. o rótulo — `instagram.com/azzagencia` cru fica ilegível no seletor; e
 *   2. onde o número aparece — somar busca do site com busca do perfil social
 *      no mesmo bloco mentiria nos dois.
 *
 * ATENÇÃO ao explicar pro cliente: isto NÃO é métrica de dentro da rede
 * (alcance, seguidores, views). É o que o Google mostra na busca.
 */

export type ScChannel = "INSTAGRAM" | "TIKTOK" | "YOUTUBE" | "X";

export interface ScChannelMeta {
  label: string;
  icon: string;    // emoji — mesmo padrão do traffic-classifier
  color: string;   // tailwind text
  bgColor: string; // tailwind bg
  border: string;  // tailwind border
  hex: string;     // recharts (não aceita classe Tailwind)
}

// Cores alinhadas com BUCKET_META do traffic-classifier — o mesmo canal tem a
// mesma cor nas origens de tráfego e aqui.
export const SC_CHANNEL_META: Record<ScChannel, ScChannelMeta> = {
  INSTAGRAM: { label: "Instagram", icon: "📸", color: "text-pink-300",  bgColor: "bg-pink-500/15",  border: "border-pink-500/30",  hex: "#ec4899" },
  TIKTOK:    { label: "TikTok",    icon: "🎵", color: "text-rose-300",  bgColor: "bg-rose-500/15",  border: "border-rose-500/30",  hex: "#f43f5e" },
  YOUTUBE:   { label: "YouTube",   icon: "📺", color: "text-red-300",   bgColor: "bg-red-500/15",   border: "border-red-500/30",   hex: "#ef4444" },
  X:         { label: "X",         icon: "✖️", color: "text-slate-300", bgColor: "bg-slate-500/15", border: "border-slate-500/30", hex: "#94a3b8" },
};

export interface ScPropertyInfo {
  kind: "site" | "platform";
  channel: ScChannel | null;
  /** Pronto pra UI: "Instagram · @azzagencia" ou "azz.com.br". */
  label: string;
  /** "@usuario" (ou id do canal), quando dá pra extrair da URL. */
  handle: string | null;
}

const HOST_RULES: [RegExp, ScChannel][] = [
  [/^instagram\.com$/i, "INSTAGRAM"],
  [/^tiktok\.com$/i,    "TIKTOK"],
  [/^youtube\.com$/i,   "YOUTUBE"],
  [/^youtu\.be$/i,      "YOUTUBE"],
  [/^x\.com$/i,         "X"],
  [/^twitter\.com$/i,   "X"],
];

/**
 * Formato do `siteUrl` de plataforma não está na referência da API — o Google
 * documenta só `https://site.com/` e `sc-domain:site.com`, e no Search Console
 * o identificador aparece como `instagram.com/usuario`. Por isso aceitamos com
 * e sem protocolo, com e sem `www.`/`m.`.
 */
function splitUrl(raw: string): { host: string | null; path: string } {
  const comProtocolo = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(comProtocolo);
    return { host: u.hostname.replace(/^(www|m)\./i, ""), path: u.pathname };
  } catch {
    return { host: null, path: "" };
  }
}

function channelForHost(host: string): ScChannel | null {
  for (const [re, channel] of HOST_RULES) {
    if (re.test(host)) return channel;
  }
  return null;
}

function handleFor(channel: ScChannel, path: string): string | null {
  const segs = path.split("/").filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  if (segs.length === 0) return null;
  if (channel === "YOUTUBE") {
    // youtube.com/@canal · /channel/UC… · /c/Nome · /user/Nome
    if (segs[0].startsWith("@")) return segs[0];
    if (["channel", "c", "user"].includes(segs[0].toLowerCase())) return segs[1] ?? null;
    return segs[0];
  }
  return segs[0].startsWith("@") ? segs[0] : `@${segs[0]}`;
}

/** Site sem protocolo nem barra final — `https://azz.com.br/` → `azz.com.br`. */
function prettySite(raw: string): string {
  return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function classifyScProperty(siteUrl: string | null | undefined): ScPropertyInfo {
  const raw = (siteUrl || "").trim();
  if (!raw) return { kind: "site", channel: null, label: "(sem propriedade)", handle: null };

  // Propriedade de domínio é sempre site.
  if (/^sc-domain:/i.test(raw)) {
    return { kind: "site", channel: null, label: raw.replace(/^sc-domain:/i, ""), handle: null };
  }

  const { host, path } = splitUrl(raw);
  const channel = host ? channelForHost(host) : null;
  if (!channel) return { kind: "site", channel: null, label: prettySite(raw), handle: null };

  const handle = handleFor(channel, path);
  const meta = SC_CHANNEL_META[channel];
  return {
    kind: "platform",
    channel,
    label: handle ? `${meta.label} · ${handle}` : meta.label,
    handle,
  };
}

export function isScPlatformProperty(siteUrl: string | null | undefined): boolean {
  return classifyScProperty(siteUrl).kind === "platform";
}

/**
 * Rótulo de uma conexão do Search Console na interface. Apelido dado pela
 * agência ganha de tudo; depois o rótulo da propriedade; e o nome que a Google
 * mandou só entra pra site (em plataforma ele é a URL crua do perfil).
 */
export function scIntegrationLabel(i: {
  nickname?: string | null;
  accountLabel?: string | null;
  accountId?: string | null;
}): string {
  if (i.nickname) return i.nickname;
  const info = classifyScProperty(i.accountId);
  if (info.kind === "platform") return info.label;
  return i.accountLabel || info.label;
}
