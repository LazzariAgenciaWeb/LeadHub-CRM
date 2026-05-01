/**
 * Classificação de origem de tráfego.
 *
 * GA4 entrega `source` + `medium` brutos (ex: source="chatgpt.com", medium="referral").
 * As categorias padrão do GA4 não destacam IA/LLMs nem rede social específica.
 * Classificamos por baldes ("buckets") com cor + ícone próprios pra dashboard.
 *
 * Função pura, fácil de testar e estender (basta adicionar novas regras).
 */

export type TrafficBucket =
  | "AI"             // ChatGPT, Perplexity, Claude, Gemini, Copilot...
  | "ORGANIC_SEARCH" // Google, Bing, DuckDuckGo (sem ad click id)
  | "PAID_SEARCH"    // gclid (Google Ads) ou msclkid (Bing Ads)
  | "INSTAGRAM"
  | "FACEBOOK"
  | "META_ADS"       // fbclid
  | "TIKTOK"
  | "WHATSAPP"
  | "LINKEDIN"
  | "YOUTUBE"
  | "EMAIL"
  | "DIRECT"
  | "REFERRAL"       // outros sites
  | "OTHER";

export interface BucketMeta {
  label: string;
  color: string;     // tailwind text color
  bgColor: string;   // tailwind bg color
  icon: string;      // emoji para fallback / chips
}

export const BUCKET_META: Record<TrafficBucket, BucketMeta> = {
  AI:             { label: "IA / LLMs",       color: "text-emerald-300", bgColor: "bg-emerald-500/15", icon: "🤖" },
  ORGANIC_SEARCH: { label: "Busca orgânica",  color: "text-blue-300",    bgColor: "bg-blue-500/15",    icon: "🔍" },
  PAID_SEARCH:    { label: "Busca paga",      color: "text-amber-300",   bgColor: "bg-amber-500/15",   icon: "💰" },
  INSTAGRAM:      { label: "Instagram",       color: "text-pink-300",    bgColor: "bg-pink-500/15",    icon: "📸" },
  FACEBOOK:       { label: "Facebook",        color: "text-blue-300",    bgColor: "bg-blue-500/20",    icon: "👥" },
  META_ADS:       { label: "Meta Ads",        color: "text-violet-300",  bgColor: "bg-violet-500/15",  icon: "🎯" },
  TIKTOK:         { label: "TikTok",          color: "text-rose-300",    bgColor: "bg-rose-500/15",    icon: "🎵" },
  WHATSAPP:       { label: "WhatsApp",        color: "text-green-300",   bgColor: "bg-green-500/15",   icon: "💬" },
  LINKEDIN:       { label: "LinkedIn",        color: "text-sky-300",     bgColor: "bg-sky-500/15",     icon: "💼" },
  YOUTUBE:        { label: "YouTube",         color: "text-red-300",     bgColor: "bg-red-500/15",     icon: "📺" },
  EMAIL:          { label: "E-mail",          color: "text-orange-300",  bgColor: "bg-orange-500/15",  icon: "📧" },
  DIRECT:         { label: "Direto",          color: "text-slate-300",   bgColor: "bg-slate-500/15",   icon: "⚡" },
  REFERRAL:       { label: "Outros sites",    color: "text-cyan-300",    bgColor: "bg-cyan-500/15",    icon: "🌐" },
  OTHER:          { label: "Outros",          color: "text-slate-400",   bgColor: "bg-slate-500/10",   icon: "❓" },
};

// Domínios → bucket. Match por substring (case-insensitive).
// Ordem importa: regras mais específicas primeiro.
const DOMAIN_RULES: Array<[RegExp, TrafficBucket]> = [
  // IA / LLMs
  [/(^|\.)chatgpt\.com$/i,             "AI"],
  [/(^|\.)chat\.openai\.com$/i,        "AI"],
  [/(^|\.)openai\.com$/i,              "AI"],
  [/(^|\.)perplexity\.ai$/i,           "AI"],
  [/(^|\.)claude\.ai$/i,               "AI"],
  [/(^|\.)gemini\.google\.com$/i,      "AI"],
  [/(^|\.)bard\.google\.com$/i,        "AI"],
  [/(^|\.)copilot\.microsoft\.com$/i,  "AI"],
  [/(^|\.)you\.com$/i,                 "AI"],
  [/(^|\.)phind\.com$/i,               "AI"],
  [/(^|\.)poe\.com$/i,                 "AI"],
  [/bing\.com\/chat/i,                 "AI"],

  // WhatsApp (vem antes de "facebook" pra não confundir wa.me)
  [/(^|\.)wa\.me$/i,                   "WHATSAPP"],
  [/(^|\.)whatsapp\.com$/i,            "WHATSAPP"],
  [/(^|\.)web\.whatsapp\.com$/i,       "WHATSAPP"],

  // Instagram (l.instagram.com = link wrapper, lm.facebook.com idem)
  [/(^|\.)instagram\.com$/i,           "INSTAGRAM"],
  [/(^|\.)l\.instagram\.com$/i,        "INSTAGRAM"],
  [/(^|\.)ig\.me$/i,                   "INSTAGRAM"],

  // Facebook
  [/(^|\.)facebook\.com$/i,            "FACEBOOK"],
  [/(^|\.)l\.facebook\.com$/i,         "FACEBOOK"],
  [/(^|\.)m\.facebook\.com$/i,         "FACEBOOK"],
  [/(^|\.)lm\.facebook\.com$/i,        "FACEBOOK"],
  [/(^|\.)fb\.com$/i,                  "FACEBOOK"],
  [/(^|\.)fb\.me$/i,                   "FACEBOOK"],

  // TikTok
  [/(^|\.)tiktok\.com$/i,              "TIKTOK"],
  [/(^|\.)vt\.tiktok\.com$/i,          "TIKTOK"],

  // LinkedIn
  [/(^|\.)linkedin\.com$/i,            "LINKEDIN"],
  [/(^|\.)lnkd\.in$/i,                 "LINKEDIN"],

  // YouTube
  [/(^|\.)youtube\.com$/i,             "YOUTUBE"],
  [/(^|\.)youtu\.be$/i,                "YOUTUBE"],

  // E-mail providers / mailers
  [/(^|\.)mail\.google\.com$/i,        "EMAIL"],
  [/(^|\.)mailchimp\.com$/i,           "EMAIL"],
  [/(^|\.)mc\.sendgrid\.com$/i,        "EMAIL"],
  [/mandrillapp\.com/i,                "EMAIL"],

  // Buscadores (orgânico — ad click id muda pra paid)
  [/(^|\.)google\./i,                  "ORGANIC_SEARCH"],
  [/(^|\.)bing\.com$/i,                "ORGANIC_SEARCH"],
  [/(^|\.)yahoo\.com$/i,               "ORGANIC_SEARCH"],
  [/(^|\.)duckduckgo\.com$/i,          "ORGANIC_SEARCH"],
  [/(^|\.)ecosia\.org$/i,              "ORGANIC_SEARCH"],
  [/(^|\.)yandex\./i,                  "ORGANIC_SEARCH"],
  [/(^|\.)baidu\.com$/i,               "ORGANIC_SEARCH"],
];

// Mediums conhecidos (entram em jogo quando o source não bate em domínio específico)
const MEDIUM_RULES: Array<[RegExp, TrafficBucket]> = [
  [/^(cpc|paid|ppc|paidsearch|paid-search)$/i,  "PAID_SEARCH"],
  [/^(email|e-mail|mail|newsletter)$/i,         "EMAIL"],
  [/^organic$/i,                                "ORGANIC_SEARCH"],
  [/^social|paid-social|paidsocial$/i,          "REFERRAL"], // refinado pelo source
  [/^referral$/i,                               "REFERRAL"],
  [/^(none|\(none\))$/i,                        "DIRECT"],
];

export interface ClassifyInput {
  source?: string | null;          // ex: "google", "chatgpt.com"
  medium?: string | null;          // ex: "organic", "cpc", "referral"
  campaign?: string | null;        // ex: utm_campaign — só info
  hasGclid?: boolean;              // Google Ads click id
  hasFbclid?: boolean;             // Meta click id
  hasMsclkid?: boolean;            // Bing Ads click id
}

/** Classifica uma origem de tráfego em um bucket. */
export function classifyTrafficSource(input: ClassifyInput): TrafficBucket {
  const source = (input.source || "").trim().toLowerCase();
  const medium = (input.medium || "").trim().toLowerCase();

  // 1. Click IDs de plataformas pagas têm prioridade
  if (input.hasGclid)   return "PAID_SEARCH";
  if (input.hasMsclkid) return "PAID_SEARCH";
  if (input.hasFbclid)  return "META_ADS";

  // 2. Direto sem source/medium
  if (!source && !medium)               return "DIRECT";
  if (source === "(direct)" || source === "direct") return "DIRECT";

  // 3. Tenta casar o source com algum domínio conhecido
  for (const [re, bucket] of DOMAIN_RULES) {
    if (re.test(source)) {
      // Se for um buscador conhecido + medium pago → muda pra paid
      if (bucket === "ORGANIC_SEARCH" && /^(cpc|paid|ppc)$/i.test(medium)) {
        return "PAID_SEARCH";
      }
      return bucket;
    }
  }

  // 4. Fallback no medium
  for (const [re, bucket] of MEDIUM_RULES) {
    if (re.test(medium)) return bucket;
  }

  // 5. Default: outros sites
  return source ? "REFERRAL" : "OTHER";
}

/** Helper pra deixar a metadata da bucket pronta pra UI. */
export function getBucketMeta(bucket: TrafficBucket): BucketMeta {
  return BUCKET_META[bucket] ?? BUCKET_META.OTHER;
}
