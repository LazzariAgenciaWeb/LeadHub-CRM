import { BadgeType, BadgeLevel, ScoreReason } from "@/generated/prisma";

// ─── Badges ───────────────────────────────────────────────────────────────────

export type BadgeMeta = {
  emoji:       string;
  name:        string;
  description: string;
};

export const BADGE_META: Record<BadgeType, BadgeMeta> = {
  RAIO_VELOZ:      { emoji: "⚡", name: "Raio Veloz",       description: "Respostas em menos de 5 minutos" },
  SPRINT_MASTER:   { emoji: "🏃", name: "Sprint Master",    description: "Dias consecutivos sem atraso" },
  PRIMEIRO_DO_DIA: { emoji: "🌅", name: "Primeiro do Dia",  description: "Atendimentos fechados no mesmo dia" },
  RESOLVEDOR:      { emoji: "✅", name: "Resolvedor",       description: "Tickets fechados como resolvidos" },
  ZERO_PENDENCIA:  { emoji: "🧹", name: "Zero Pendência",   description: "Dias sem conversas em aberto" },
  ANTECIPADOR:     { emoji: "🎯", name: "Antecipador",      description: "Retornos cumpridos antes do prazo" },
  CLOSER:          { emoji: "💰", name: "Closer",           description: "Leads convertidos em vendas" },
  FUNIL_COMPLETO:  { emoji: "📈", name: "Funil Completo",   description: "Leads avançados no pipeline" },
  REI_DO_MES:      { emoji: "👑", name: "Rei do Mês",       description: "1º lugar no ranking mensal" },
};

// ─── Levels ───────────────────────────────────────────────────────────────────

export const LEVEL_META: Record<BadgeLevel, { name: string; ring: string; bg: string; text: string }> = {
  BRONZE: { name: "Bronze", ring: "ring-amber-700/40",  bg: "bg-amber-900/30",  text: "text-amber-500" },
  PRATA:  { name: "Prata",  ring: "ring-slate-400/40",  bg: "bg-slate-700/30",  text: "text-slate-300" },
  OURO:   { name: "Ouro",   ring: "ring-yellow-400/50", bg: "bg-yellow-500/20", text: "text-yellow-400" },
};

// ─── Score reasons (para o feed) ──────────────────────────────────────────────

export const REASON_LABEL: Record<ScoreReason, { text: string; positive: boolean }> = {
  RESPOSTA_RAPIDA_5MIN:   { text: "Resposta rápida (≤5min)",         positive: true  },
  RESPOSTA_RAPIDA_30MIN:  { text: "Resposta rápida (≤30min)",        positive: true  },
  TICKET_RESOLVIDO:       { text: "Chamado resolvido",                positive: true  },
  LEAD_AVANCADO:          { text: "Lead avançou no pipeline",         positive: true  },
  LEAD_CONVERTIDO:        { text: "Lead convertido em venda",         positive: true  },
  DIA_SEM_PENDENCIA:      { text: "Dia sem pendências",               positive: true  },
  RETORNO_ANTECIPADO:     { text: "Retorno antes do prazo",           positive: true  },
  ATENDIMENTO_MESMO_DIA:  { text: "Atendimento fechado no dia",       positive: true  },
  NOTA_REGISTRADA:        { text: "Nota interna registrada",          positive: true  },
  SLA_VENCIDO:            { text: "SLA de chamado vencido",           positive: false },
  CONVERSA_SEM_RESPOSTA:  { text: "Conversa sem resposta há 24h",     positive: false },
};
