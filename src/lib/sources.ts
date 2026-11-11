// Mapeamento de origens de lead → metadados visuais
// Permite normalizar valores de Lead.source vindos de canais diversos
// (whatsapp, webhook, importação, BDR, instagram, etc.) para chips coloridos consistentes.

export type SourceColor =
  | "emerald" | "blue" | "slate" | "violet" | "pink"
  | "cyan" | "gray" | "amber" | "orange" | "indigo" | "rose";

export interface SourceMeta {
  label: string;
  icon: string;
  color: SourceColor;
}

export const SOURCE_META: Record<string, SourceMeta> = {
  whatsapp:    { label: "WhatsApp",    icon: "📱", color: "emerald" },
  webhook:     { label: "Webhook",     icon: "🔌", color: "indigo" },
  importacao:  { label: "Importação",  icon: "📥", color: "slate" },
  importação:  { label: "Importação",  icon: "📥", color: "slate" },
  bdr:         { label: "BDR",         icon: "🎯", color: "violet" },
  instagram:   { label: "Instagram",   icon: "📸", color: "pink" },
  formulario:  { label: "Formulário",  icon: "🌐", color: "cyan" },
  formulário:  { label: "Formulário",  icon: "🌐", color: "cyan" },
  manual:      { label: "Manual",      icon: "✋", color: "gray" },
  google:      { label: "Google",      icon: "🔍", color: "amber" },
  facebook:    { label: "Facebook",    icon: "👥", color: "blue" },
  meta:        { label: "Meta Ads",    icon: "Ⓜ️", color: "blue" },
  linkedin:    { label: "LinkedIn",    icon: "💼", color: "blue" },
  tiktok:      { label: "TikTok",      icon: "🎵", color: "rose" },
  email:       { label: "E-mail",      icon: "✉️",  color: "orange" },
  indicacao:   { label: "Indicação",   icon: "🤝", color: "amber" },
  indicação:   { label: "Indicação",   icon: "🤝", color: "amber" },
  organico:    { label: "Orgânico",    icon: "🌱", color: "emerald" },
  // Link direto (bio, QR, shortlink) e o "Outro" do enum de campanha. Sem estas
  // duas linhas o chip do lead caía no fallback e mostrava "link"/"other" cru.
  link:        { label: "Link direto",  icon: "🔗", color: "indigo" },
  other:       { label: "Outro",        icon: "📌", color: "slate" },
  outro:       { label: "Outro",        icon: "📌", color: "slate" },
  orgânico:    { label: "Orgânico",    icon: "🌱", color: "emerald" },
  // Origens da feature "LeadHub Prospecta" — busca de empresas no Google Maps
  // dentro do CRM. "serpapi" é só o canal técnico interno (valor legado gravado
  // no banco); pro usuário SEMPRE exibimos o rótulo de produto "LeadHub Prospecta".
  serpapi:             { label: "GoHub Prospecta", icon: "🎯", color: "indigo" },
  "prospecta leadhub": { label: "GoHub Prospecta", icon: "🎯", color: "indigo" },
  // Página do Negócio: contato deixado na página pública do cliente, e a
  // empresa que se cadastrou no grátis (lead da agência).
  "pagina-negocio":          { label: "Página do Negócio", icon: "📄", color: "cyan" },
  "pagina-negocio-cadastro": { label: "Cadastro Página",   icon: "🚀", color: "violet" },
};

export function getSourceMeta(source: string | null | undefined): SourceMeta {
  if (!source) return { label: "Desconhecido", icon: "❓", color: "slate" };
  const normalized = source.toLowerCase().trim();
  if (SOURCE_META[normalized]) return SOURCE_META[normalized];
  // Match parcial: "whatsapp-api" → whatsapp
  for (const key of Object.keys(SOURCE_META)) {
    if (normalized.includes(key)) return SOURCE_META[key];
  }
  // Fallback: usa o próprio texto, ícone genérico
  return { label: source, icon: "🏷️", color: "slate" };
}

// Classes Tailwind por cor (precisam estar no source para serem detectadas no build)
export const SOURCE_COLOR_CLASSES: Record<SourceColor, string> = {
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  blue:    "bg-blue-500/15 text-blue-300 border-blue-500/25",
  slate:   "bg-slate-500/15 text-slate-300 border-slate-500/25",
  violet:  "bg-violet-500/15 text-violet-300 border-violet-500/25",
  pink:    "bg-pink-500/15 text-pink-300 border-pink-500/25",
  cyan:    "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  gray:    "bg-gray-500/15 text-gray-300 border-gray-500/25",
  amber:   "bg-amber-500/15 text-amber-300 border-amber-500/25",
  orange:  "bg-orange-500/15 text-orange-300 border-orange-500/25",
  indigo:  "bg-indigo-500/15 text-indigo-300 border-indigo-500/25",
  rose:    "bg-rose-500/15 text-rose-300 border-rose-500/25",
};

// ─── Origem de campanha (Campaign.source) ─────────────────────────────────────
// Lista única usada por TODAS as telas de campanha (criar, editar, listar,
// detalhe, gatilhos). Antes cada tela repetia seu próprio mapa de ícones e a
// tela principal nem oferecia o campo — campanha nascia OTHER pra sempre.
export const CAMPAIGN_SOURCES = [
  { value: "WHATSAPP",  label: "WhatsApp",    icon: "💬" },
  { value: "INSTAGRAM", label: "Instagram",   icon: "📸" },
  { value: "FACEBOOK",  label: "Facebook",    icon: "👥" },
  { value: "GOOGLE",    label: "Google Ads",  icon: "🔍" },
  { value: "LINK",      label: "Link direto", icon: "🔗" },
  { value: "OTHER",     label: "Outro",       icon: "📌" },
] as const;

export type CampaignSourceValue = (typeof CAMPAIGN_SOURCES)[number]["value"];

export const CAMPAIGN_SOURCE_ICON: Record<string, string> = Object.fromEntries(
  CAMPAIGN_SOURCES.map((s) => [s.value, s.icon]),
);

export const CAMPAIGN_SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  CAMPAIGN_SOURCES.map((s) => [s.value, s.label]),
);

export function isCampaignSource(value: unknown): value is CampaignSourceValue {
  return typeof value === "string" && CAMPAIGN_SOURCES.some((s) => s.value === value);
}

/**
 * Normaliza uma origem digitada/escolhida pra chave de Lead.source e utm_source:
 * minúsculas, sem acento, espaço vira hífen. "Indicação" → "indicacao".
 * Devolve null pra vazio — quem chama decide o fallback.
 */
export function normalizeLeadSource(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
  return key || null;
}

/**
 * Origem da campanha (enum) → chave de Lead.source / utm_source.
 * OTHER devolve null de propósito: "other" não diz nada no chip do lead nem na
 * UTM, então quem chama cai no canal real (ex: "whatsapp") ou no slug da empresa.
 */
export function campaignSourceToLeadSource(source: string | null | undefined): string | null {
  if (!source) return null;
  const up = source.toUpperCase();
  if (up === "OTHER") return null;
  return isCampaignSource(up) ? up.toLowerCase() : normalizeLeadSource(source);
}

// Origens oferecidas no seletor de link e de gatilho (override da campanha).
// São chaves de Lead.source — as mesmas que o chip do lead já sabe desenhar.
export const LEAD_SOURCE_OPTIONS = [
  "whatsapp", "instagram", "facebook", "meta", "google", "tiktok",
  "linkedin", "email", "link", "formulario", "indicacao", "organico",
] as const;

/**
 * utm_medium sugerido pra uma origem. Só vale quando a origem foi declarada
 * no link/campanha; link antigo (sem origem) mantém o medium legado.
 */
export function defaultUtmMedium(sourceKey: string | null | undefined): string | null {
  if (!sourceKey) return null;
  switch (sourceKey) {
    case "google":                                        return "cpc";
    case "facebook": case "instagram": case "meta":
    case "tiktok":   case "linkedin":                     return "social";
    case "email":                                         return "email";
    case "whatsapp":                                      return "whatsapp";
    case "indicacao":                                     return "referral";
    case "organico":                                      return "organic";
    case "link":                                          return "referral";
    case "formulario":                                    return "form";
    default:                                              return null;
  }
}
