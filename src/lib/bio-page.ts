// Página do Negócio (link na bio + vitrine em /p/[slug]).
// Regras compartilhadas entre editor, página pública e API: endereço da página,
// origem do lead e o que o cliente do plano grátis enxerga.

export const BIO_LEAD_SOURCE = "pagina-negocio";

/** Caminho público da página. */
export const BIO_PUBLIC_PATH = "/p";

export const BIO_SLUG_MIN = 3;
export const BIO_SLUG_MAX = 40;

// Endereços que colidem com rotas do sistema ou confundem o visitante.
export const BIO_RESERVED_SLUGS = new Set([
  "admin", "api", "app", "p", "r", "c", "d", "login", "logout", "cadastro",
  "comecar", "precos", "planos", "ajuda", "suporte", "termos", "privacidade",
  "gohub", "leadhub", "azz", "lazzari", "www", "mail", "email", "blog", "site",
  "pagina", "paginas", "meu-espaco", "ferramentas", "static", "assets",
]);

/**
 * "Clínica São João!" → "clinica-sao-joao". Minúsculas, sem acento, só letras,
 * números e hífen simples, cortado no tamanho máximo.
 */
export function slugifyBio(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BIO_SLUG_MAX)
    .replace(/-+$/g, "");
}

export type BioSlugProblem = "curto" | "longo" | "formato" | "reservado";

/** null = endereço válido. Não checa se já está em uso (isso é do banco). */
export function bioSlugProblem(slug: string): BioSlugProblem | null {
  if (slug.length < BIO_SLUG_MIN) return "curto";
  if (slug.length > BIO_SLUG_MAX) return "longo";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return "formato";
  if (BIO_RESERVED_SLUGS.has(slug)) return "reservado";
  return null;
}

/**
 * Quantos contatos do mês o cliente enxerga (nome + telefone). Os demais são
 * capturados do mesmo jeito — a página nunca para —, mas aparecem só como
 * "+X contatos" com o convite pro Starter. -1 = ilimitado.
 */
export function visibleLeadCount(total: number, limit: number): { visible: number; hidden: number } {
  if (limit < 0 || total <= limit) return { visible: total, hidden: 0 };
  return { visible: limit, hidden: total - limit };
}

/** Eventos que o navegador pode registrar. LEAD só nasce no servidor, junto do envio. */
export const BIO_CLIENT_EVENTS = ["VIEW", "CLICK", "QUIZ_START", "QUIZ_COMPLETE"] as const;
export type BioClientEvent = (typeof BIO_CLIENT_EVENTS)[number];

export function isBioClientEvent(v: unknown): v is BioClientEvent {
  return typeof v === "string" && (BIO_CLIENT_EVENTS as readonly string[]).includes(v);
}

export const BIO_DEFAULT_QUIZ_TITLE = "Responda rapidinho e a gente te indica o melhor caminho";
export const BIO_DEFAULT_QUIZ_CTA = "Começar";
export const BIO_DEFAULT_THANK_YOU = "Recebemos seu contato! Em breve a gente fala com você.";

export function bioDefaultConsent(ownerName: string): string {
  return `Ao enviar, você concorda que ${ownerName} guarde seus dados e entre em contato para falar sobre o que você respondeu. Seus dados não são compartilhados com mais ninguém.`;
}

/**
 * Link que o dono da página cadastrou → href seguro. Só http(s), mailto e tel;
 * "javascript:", "data:" e afins viram null (o botão nem aparece). Sem esquema
 * ("meusite.com.br") ganha https://.
 */
export function safeBioHref(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^(mailto|tel):/i.test(v)) return v;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** #RRGGBB válido ou a cor padrão. Evita CSS arbitrário vindo do banco. */
export function bioAccent(color: string | null | undefined, fallback = "#4f46e5"): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function clip(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}

/** Campos de origem que o navegador manda junto de evento e envio (todos opcionais). */
export function bioTrackingFields(body: Record<string, unknown>) {
  return {
    visitorId: clip(body.visitorId, 64),
    referrer: clip(body.referrer, 1000),
    utmSource: clip(body.utmSource, 120),
    utmMedium: clip(body.utmMedium, 120),
    utmCampaign: clip(body.utmCampaign, 200),
  };
}
