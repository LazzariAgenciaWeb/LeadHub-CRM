import { BadgeType, ScoreReason } from "@/generated/prisma";

// ─── Badges (metadados gerais) ────────────────────────────────────────────────

export type BadgeMeta = {
  emoji:       string;
  name:        string;
  description: string;
};

// Categorias visuais — agrupam badges no painel pra dar contexto
export type BadgeCategory =
  | "ATENDIMENTO"
  | "CHAMADOS"
  | "VENDAS"
  | "PROJETOS"
  | "DISCIPLINA"
  | "ESPECIAIS";

export const CATEGORY_META: Record<BadgeCategory, { label: string; emoji: string; description: string }> = {
  ATENDIMENTO: { emoji: "💬", label: "Atendimento", description: "Conversas e respostas no WhatsApp" },
  CHAMADOS:    { emoji: "🎫", label: "Chamados",    description: "Tickets de suporte resolvidos" },
  VENDAS:      { emoji: "💰", label: "Vendas",      description: "Conversões e movimentação no funil" },
  PROJETOS:    { emoji: "🚀", label: "Projetos",    description: "Entregas no prazo" },
  DISCIPLINA:  { emoji: "⏱️", label: "Disciplina",  description: "Pontualidade e consistência" },
  ESPECIAIS:   { emoji: "👑", label: "Especiais",    description: "Conquistas raras de destaque" },
};

export const BADGE_CATEGORY: Record<BadgeType, BadgeCategory> = {
  RAIO_VELOZ:      "ATENDIMENTO",
  PRIMEIRO_DO_DIA: "ATENDIMENTO",
  ZERO_PENDENCIA:  "ATENDIMENTO",
  RESOLVEDOR:      "CHAMADOS",
  CLOSER:          "VENDAS",
  FUNIL_COMPLETO:  "VENDAS",
  ANTECIPADOR:     "VENDAS",
  ENTREGADOR:      "PROJETOS",
  CONSTRUTOR:      "PROJETOS",
  ENGAJADO:        "PROJETOS",
  GERADOR:         "PROJETOS",
  PONTUAL:         "DISCIPLINA",
  SPRINT_MASTER:   "DISCIPLINA",
  REI_DO_MES:      "ESPECIAIS",
};

export const CATEGORY_ORDER: BadgeCategory[] = [
  "ATENDIMENTO", "CHAMADOS", "VENDAS", "PROJETOS", "DISCIPLINA", "ESPECIAIS",
];

export const BADGE_META: Record<BadgeType, BadgeMeta> = {
  RAIO_VELOZ:      { emoji: "⚡", name: "Velocidade",      description: "Respostas em menos de 5 minutos" },
  SPRINT_MASTER:   { emoji: "🏃", name: "Sprint",          description: "Dias consecutivos sem atraso" },
  PRIMEIRO_DO_DIA: { emoji: "🌅", name: "Mesmo Dia",       description: "Atendimentos fechados no mesmo dia" },
  RESOLVEDOR:      { emoji: "✅", name: "Resolução",       description: "Chamados fechados como resolvidos" },
  ZERO_PENDENCIA:  { emoji: "🧹", name: "Limpeza",         description: "Dias sem conversas em aberto" },
  ANTECIPADOR:     { emoji: "🎯", name: "Antecipação",     description: "Retornos cumpridos antes do prazo" },
  CLOSER:          { emoji: "💰", name: "Vendas",          description: "Leads convertidos em venda" },
  FUNIL_COMPLETO:  { emoji: "📈", name: "Funil",           description: "Leads avançados no pipeline" },
  REI_DO_MES:      { emoji: "👑", name: "Reinado",         description: "1º lugar no ranking mensal" },
  PONTUAL:         { emoji: "⏱️", name: "Pontualidade",    description: "Dias terminados sem nada atrasado" },
  ENTREGADOR:      { emoji: "🚀", name: "Entrega",          description: "Projetos entregues no prazo" },
  CONSTRUTOR:      { emoji: "🔨", name: "Construção",       description: "Tarefas de projetos concluídas no ClickUp" },
  ENGAJADO:        { emoji: "🌀", name: "Engajamento",      description: "Tarefas de projetos atualizadas no ClickUp" },
  GERADOR:         { emoji: "🌱", name: "Geração",          description: "Tarefas criadas em projetos no ClickUp" },
};

// ─── Tier definitions ─────────────────────────────────────────────────────────
// Cada badge tem 6 tiers. Tier 1 é fácil (gancho) e tier 6 é Highlander (lendário).
// O reason de cada badge define o que conta — essa fonte está em gamification.ts.

export type Tier = {
  level:     number;   // 1-6
  name:      string;   // ex: "Cafeinado", "Highlander"
  threshold: number;   // qtd de eventos pra desbloquear
};

export const BADGE_TIERS: Record<BadgeType, Tier[]> = {
  RAIO_VELOZ: [
    { level: 1, name: "Despertou",   threshold: 3    },
    { level: 2, name: "Café",        threshold: 15   },
    { level: 3, name: "Cafeinado",   threshold: 50   },
    { level: 4, name: "Sonic",       threshold: 150  },
    { level: 5, name: "Flash",       threshold: 500  },
    { level: 6, name: "Highlander",  threshold: 1500 },
  ],
  RESOLVEDOR: [
    { level: 1, name: "Primeiro Tiro", threshold: 1   },
    { level: 2, name: "Aprendiz",      threshold: 5   },
    { level: 3, name: "Profissional",  threshold: 25  },
    { level: 4, name: "Especialista",  threshold: 75  },
    { level: 5, name: "Mestre",        threshold: 200 },
    { level: 6, name: "Highlander",    threshold: 500 },
  ],
  CLOSER: [
    { level: 1, name: "Sortudo",      threshold: 1   },
    { level: 2, name: "Vendedor",     threshold: 5   },
    { level: 3, name: "Closer",       threshold: 15  },
    { level: 4, name: "Negociador",   threshold: 40  },
    { level: 5, name: "Wolf",         threshold: 100 },
    { level: 6, name: "Highlander",   threshold: 300 },
  ],
  ANTECIPADOR: [
    { level: 1, name: "Pontual",        threshold: 2   },
    { level: 2, name: "Adiantado",      threshold: 10  },
    { level: 3, name: "Confiável",      threshold: 25  },
    { level: 4, name: "Mestre do Tempo", threshold: 60 },
    { level: 5, name: "Profeta",        threshold: 150 },
    { level: 6, name: "Highlander",     threshold: 400 },
  ],
  PRIMEIRO_DO_DIA: [
    { level: 1, name: "Mão na Massa",   threshold: 5    },
    { level: 2, name: "Ágil",           threshold: 25   },
    { level: 3, name: "No Mesmo Dia",   threshold: 75   },
    { level: 4, name: "Mago do Dia",    threshold: 200  },
    { level: 5, name: "Diurno Lendário", threshold: 500 },
    { level: 6, name: "Highlander",     threshold: 1200 },
  ],
  ZERO_PENDENCIA: [
    { level: 1, name: "Limpo",         threshold: 3   },
    { level: 2, name: "Organizado",    threshold: 10  },
    { level: 3, name: "Caprichoso",    threshold: 25  },
    { level: 4, name: "Impecável",     threshold: 60  },
    { level: 5, name: "CEO da Ordem",  threshold: 150 },
    { level: 6, name: "Highlander",    threshold: 365 },
  ],
  FUNIL_COMPLETO: [
    { level: 1, name: "Movimentou",    threshold: 5    },
    { level: 2, name: "Marketeiro",    threshold: 25   },
    { level: 3, name: "Estrategista",  threshold: 75   },
    { level: 4, name: "Crescimento",   threshold: 200  },
    { level: 5, name: "Growth Hacker", threshold: 500  },
    { level: 6, name: "Highlander",    threshold: 1500 },
  ],
  SPRINT_MASTER: [
    { level: 1, name: "Acelerou",      threshold: 1  },
    { level: 2, name: "Ritmado",       threshold: 3  },
    { level: 3, name: "Maratonista",   threshold: 7  },
    { level: 4, name: "Incansável",    threshold: 14 },
    { level: 5, name: "Forrest Gump",  threshold: 30 },
    { level: 6, name: "Highlander",    threshold: 90 },
  ],
  REI_DO_MES: [
    { level: 1, name: "Estreante",     threshold: 1  },
    { level: 2, name: "Bicampeão",     threshold: 2  },
    { level: 3, name: "Tricampeão",    threshold: 3  },
    { level: 4, name: "Tetracampeão",  threshold: 5  },
    { level: 5, name: "Lenda Mensal",  threshold: 10 },
    { level: 6, name: "Highlander",    threshold: 20 },
  ],
  PONTUAL: [
    { level: 1, name: "Atento",        threshold: 3   },
    { level: 2, name: "Pontual",       threshold: 10  },
    { level: 3, name: "Confiável",     threshold: 25  },
    { level: 4, name: "Suíço",         threshold: 60  },
    { level: 5, name: "Implacável",    threshold: 150 },
    { level: 6, name: "Highlander",    threshold: 365 },
  ],
  ENTREGADOR: [
    { level: 1, name: "Estreante",     threshold: 1   },
    { level: 2, name: "Confiável",     threshold: 3   },
    { level: 3, name: "Veterano",      threshold: 8   },
    { level: 4, name: "Top Player",    threshold: 20  },
    { level: 5, name: "Lenda",         threshold: 50  },
    { level: 6, name: "Highlander",    threshold: 150 },
  ],
  CONSTRUTOR: [
    { level: 1, name: "Aprendiz",      threshold: 5    },
    { level: 2, name: "Pedreiro",      threshold: 25   },
    { level: 3, name: "Engenheiro",    threshold: 75   },
    { level: 4, name: "Arquiteto",     threshold: 200  },
    { level: 5, name: "Mestre de Obras", threshold: 500 },
    { level: 6, name: "Highlander",    threshold: 1500 },
  ],
  ENGAJADO: [
    { level: 1, name: "Atento",        threshold: 10   },
    { level: 2, name: "Ativo",         threshold: 50   },
    { level: 3, name: "Mantenedor",    threshold: 150  },
    { level: 4, name: "Cuidadoso",     threshold: 500  },
    { level: 5, name: "Dedicado",      threshold: 1500 },
    { level: 6, name: "Highlander",    threshold: 5000 },
  ],
  GERADOR: [
    { level: 1, name: "Iniciador",     threshold: 5    },
    { level: 2, name: "Idealizador",   threshold: 20   },
    { level: 3, name: "Planejador",    threshold: 60   },
    { level: 4, name: "Estrategista",  threshold: 150  },
    { level: 5, name: "Visionário",    threshold: 400  },
    { level: 6, name: "Highlander",    threshold: 1000 },
  ],
};

// ─── Estilos visuais por tier ─────────────────────────────────────────────────
// Cada nível tem uma identidade visual escalonada — tier 6 é especial.

export type TierStyle = {
  text:     string;  // cor do nome do tier
  bg:       string;  // background do card
  ring:     string;  // borda/ring quando conquistado
  badgeBg:  string;  // pill de tier
  badgeText: string;
};

/**
 * Gradiente da barra de progresso "termômetro": vai da cor do tier ATUAL
 * até a cor do PRÓXIMO. Quando o usuário tá perto de subir, a barra mostra
 * o aquecimento do nível-alvo. Tier 6 é o Highlander (rainbow legendary).
 */
export const BAR_GRADIENT: Record<number, string> = {
  // 0 = ainda não desbloqueou nada (vai esquentar pro N1 emerald)
  0: "bg-gradient-to-r from-slate-700 via-slate-600 to-emerald-500",
  1: "bg-gradient-to-r from-emerald-500 to-cyan-500",
  2: "bg-gradient-to-r from-cyan-500 to-indigo-500",
  3: "bg-gradient-to-r from-indigo-500 to-yellow-500",
  4: "bg-gradient-to-r from-yellow-500 to-orange-500",
  5: "bg-gradient-to-r from-orange-500 to-fuchsia-500",
  6: "bg-gradient-to-r from-fuchsia-500 via-purple-500 to-pink-400",
};

/**
 * Cores em hex por tier — usadas em SVG (stroke do ring de progresso) e
 * em props de Lucide icons (que aceitam cor via prop). Tailwind precisaria
 * de classes statically detectable, então hex é mais flexível pra SVG.
 */
export const TIER_HEX: Record<number, string> = {
  0: "#475569", // slate-600 — bloqueado
  1: "#10b981", // emerald-500
  2: "#06b6d4", // cyan-500
  3: "#6366f1", // indigo-500
  4: "#eab308", // yellow-500
  5: "#f97316", // orange-500
  6: "#d946ef", // fuchsia-500
};

/**
 * Lucide icon names por badge — alternativa colorida ao emoji.
 * Usa string pra evitar lazy import; importa por nome no componente.
 */
export const BADGE_LUCIDE: Record<BadgeType, string> = {
  RAIO_VELOZ:      "Zap",
  RESOLVEDOR:      "CircleCheck",
  CLOSER:          "DollarSign",
  ANTECIPADOR:     "Target",
  PRIMEIRO_DO_DIA: "Sunrise",
  ZERO_PENDENCIA:  "Sparkles",
  FUNIL_COMPLETO:  "TrendingUp",
  PONTUAL:         "Clock",
  ENTREGADOR:      "Rocket",
  CONSTRUTOR:      "Hammer",
  ENGAJADO:        "Repeat",
  GERADOR:         "Sprout",
  SPRINT_MASTER:   "Activity",
  REI_DO_MES:      "Crown",
};

/**
 * Glow / ring ao redor do ícone do badge — fica mais "quente" conforme
 * o tier sobe. Aplicado num <div> circular ao redor do emoji.
 */
export const ICON_GLOW: Record<number, string> = {
  0: "bg-slate-800/40 ring-2 ring-slate-700/40",
  1: "bg-emerald-500/15 ring-2 ring-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.25)]",
  2: "bg-cyan-500/15 ring-2 ring-cyan-500/40 shadow-[0_0_14px_rgba(6,182,212,0.3)]",
  3: "bg-indigo-500/15 ring-2 ring-indigo-500/50 shadow-[0_0_16px_rgba(99,102,241,0.35)]",
  4: "bg-yellow-500/15 ring-2 ring-yellow-500/50 shadow-[0_0_18px_rgba(234,179,8,0.4)]",
  5: "bg-orange-500/20 ring-2 ring-orange-500/60 shadow-[0_0_20px_rgba(249,115,22,0.45)]",
  6: "bg-fuchsia-500/25 ring-2 ring-fuchsia-400/70 shadow-[0_0_28px_rgba(217,70,239,0.6)]",
};

export const TIER_STYLES: Record<number, TierStyle> = {
  1: {
    text:      "text-emerald-300",
    bg:        "bg-emerald-500/10",
    ring:      "ring-emerald-500/30",
    badgeBg:   "bg-emerald-500/20",
    badgeText: "text-emerald-300",
  },
  2: {
    text:      "text-cyan-300",
    bg:        "bg-cyan-500/10",
    ring:      "ring-cyan-500/30",
    badgeBg:   "bg-cyan-500/20",
    badgeText: "text-cyan-300",
  },
  3: {
    text:      "text-indigo-300",
    bg:        "bg-indigo-500/10",
    ring:      "ring-indigo-500/40",
    badgeBg:   "bg-indigo-500/20",
    badgeText: "text-indigo-300",
  },
  4: {
    text:      "text-yellow-300",
    bg:        "bg-yellow-500/10",
    ring:      "ring-yellow-500/40",
    badgeBg:   "bg-yellow-500/20",
    badgeText: "text-yellow-300",
  },
  5: {
    text:      "text-orange-300",
    bg:        "bg-gradient-to-br from-orange-500/15 to-red-500/10",
    ring:      "ring-orange-500/40",
    badgeBg:   "bg-orange-500/20",
    badgeText: "text-orange-300",
  },
  6: {
    text:      "text-fuchsia-300",
    bg:        "bg-gradient-to-br from-fuchsia-500/15 via-purple-500/10 to-blue-500/15",
    ring:      "ring-fuchsia-500/50",
    badgeBg:   "bg-gradient-to-r from-fuchsia-500/30 to-purple-500/30",
    badgeText: "text-fuchsia-200",
  },
};

/**
 * Dado um BadgeType e um número de eventos, retorna:
 *   - currentTier: o último tier conquistado (null se nenhum)
 *   - nextTier: o próximo a desbloquear (null se já no nível 6)
 *   - progress: 0..1 — quão perto está do próximo tier
 */
export function getBadgeProgress(badge: BadgeType, count: number) {
  const tiers = BADGE_TIERS[badge];
  let currentTier: Tier | null = null;
  let nextTier:    Tier | null = null;
  let prevThreshold = 0;

  for (const t of tiers) {
    if (count >= t.threshold) {
      currentTier  = t;
      prevThreshold = t.threshold;
    } else {
      nextTier = t;
      break;
    }
  }

  let progress = 0;
  if (nextTier) {
    const range = nextTier.threshold - prevThreshold;
    progress = range > 0 ? Math.min(1, Math.max(0, (count - prevThreshold) / range)) : 0;
  } else {
    progress = 1;
  }

  return { currentTier, nextTier, progress, count };
}

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
  PRIMEIRO_CONTATO:       { text: "Primeiro contato em conversa de outro", positive: true },
  DIA_SEM_ATRASO:         { text: "Dia terminado sem nada atrasado",  positive: true  },
  PROJETO_ENTREGUE:       { text: "Projeto entregue",                 positive: true  },
  PROJETO_ENTREGUE_NO_PRAZO: { text: "Projeto entregue no prazo",      positive: true  },
  SLA_VENCIDO:            { text: "SLA de chamado vencido",           positive: false },
  CONVERSA_SEM_RESPOSTA:  { text: "Conversa sem resposta há 24h",     positive: false },
  PRAZO_PRORROGADO:       { text: "Prazo prorrogado depois de vencido", positive: false },
  PROJETO_ATRASADO:       { text: "Projeto entregue com atraso",      positive: false },
  TAREFA_SEM_PRAZO:       { text: "Tarefa do projeto sem data no ClickUp", positive: false },
  TAREFA_CRIADA:          { text: "Tarefa criada no ClickUp",         positive: true  },
  TAREFA_ATUALIZADA:      { text: "Tarefa atualizada no ClickUp",     positive: true  },
  TAREFA_CONCLUIDA:       { text: "Tarefa concluída no ClickUp",      positive: true  },
};
