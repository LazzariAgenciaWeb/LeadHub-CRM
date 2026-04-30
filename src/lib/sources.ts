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
  orgânico:    { label: "Orgânico",    icon: "🌱", color: "emerald" },
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
