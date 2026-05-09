import { ScoreReason } from "@/generated/prisma";

/**
 * Como cada razão é registrada — fonte única usada pela tabela de regras
 * (/gamificacao/regras), pelo PUT de /api/configuracoes/gamificacao e pelos
 * testes unitários. Mantém em um lugar só pra não dessincronizar.
 *
 * - REALTIME  : disparado por handler de API logo após a ação do usuário.
 * - DAILY     : runDailyMessageScoring / runDailyPenalties / runProjectsDailyPenalties.
 * - EVENING   : runDiaSemAtraso (fim do expediente).
 * - WEEKLY    : runWeeklyNetworkScoring (segunda de manhã).
 * - MONTHLY   : grantReiDoMes / resetMonthlyScores (dia 1).
 * - SYNC      : syncProjectTasks (chamado quando ClickUp sincroniza).
 * - MANUAL    : admin registra na mão (badge manual ou incidente).
 * - DERIVED   : derivada de outro evento, sem cron próprio (ex: STREAK_DIA
 *               é criada dentro de runDiaSemAtraso).
 */
export type ScoringTrigger =
  | "REALTIME"
  | "DAILY"
  | "EVENING"
  | "WEEKLY"
  | "MONTHLY"
  | "SYNC"
  | "MANUAL"
  | "DERIVED";

export const SCORING_TRIGGER: Record<ScoreReason, ScoringTrigger> = {
  // Mensagens — batch diário (manhã, processa ontem)
  RESPOSTA_RAPIDA_5MIN:   "DAILY",
  RESPOSTA_RAPIDA_30MIN:  "DAILY",
  PRIMEIRA_RESPOSTA:      "DAILY",
  AJUDA_EXERCITO:         "DAILY",
  ATENDIMENTO_GRUPO_NOVO: "DAILY",
  RESPOSTA_RAPIDA_GRUPO:  "DAILY",
  BONUS_NOITE:            "DAILY",
  BONUS_MADRUGADA:        "DAILY",

  // Penalidades diárias — runDailyPenalties / runProjectsDailyPenalties
  CONVERSA_SEM_RESPOSTA:  "DAILY",
  SLA_VENCIDO:            "DAILY",
  TAREFA_SEM_PRAZO:       "DAILY",
  TAREFA_ATRASADA:        "DAILY",
  TAREFA_SEM_RESPONSAVEL: "DAILY",

  // Fim do expediente
  DIA_SEM_ATRASO:         "EVENING",
  STREAK_DIA:             "DERIVED",

  // Semanal (segunda)
  DIA_NETWORK:            "WEEKLY",

  // Mensal (dia 1)
  BONUS_SUPEROU_MES:      "MONTHLY",

  // Real-time — disparados por handlers de API ao salvar a ação
  TICKET_RESOLVIDO:           "REALTIME",
  TICKET_ATUALIZADO:          "REALTIME",
  TICKET_NO_PRAZO:            "REALTIME",
  TICKET_RESOLVIDO_MESMO_DIA: "REALTIME",
  LEAD_AVANCADO:              "REALTIME",
  LEAD_VIROU_OPORTUNIDADE:    "REALTIME",
  LEAD_CONVERTIDO:            "REALTIME",
  RETORNO_ANTECIPADO:         "REALTIME",
  ATENDIMENTO_MESMO_DIA:      "REALTIME",
  NOTA_REGISTRADA:            "REALTIME",
  PRIMEIRO_CONTATO:           "REALTIME",
  ENCAMINHAMENTO:             "REALTIME",
  PROJETO_ENTREGUE:           "REALTIME",
  PROJETO_ENTREGUE_NO_PRAZO:  "REALTIME",
  PROJETO_ATRASADO:           "REALTIME",
  PRAZO_PRORROGADO:           "REALTIME",
  DIA_SEM_PENDENCIA:          "REALTIME",
  BONUS_VENDA_RAPIDA:         "REALTIME",
  BONUS_RECUPERACAO:          "REALTIME",

  // Sync — vem do ClickUp via syncProjectTasks
  TAREFA_CRIADA:    "SYNC",
  TAREFA_ATUALIZADA:"SYNC",
  TAREFA_CONCLUIDA: "SYNC",

  // Manual — admin registra
  INCIDENTE:        "MANUAL",
};

export const TRIGGER_LABEL: Record<ScoringTrigger, { label: string; emoji: string; description: string }> = {
  REALTIME: { emoji: "⚡", label: "Tempo real",      description: "Pontua no exato momento em que a ação acontece (resolver chamado, mover lead, etc.)" },
  DAILY:    { emoji: "🌅", label: "Batch diário",    description: "Cron de manhã processa o dia anterior. 1× por (usuário, dia) por achievement." },
  EVENING:  { emoji: "🌇", label: "Fim do dia",      description: "Cron no fechamento do expediente, recompensa quem terminou sem nada atrasado." },
  WEEKLY:   { emoji: "📅", label: "Semanal",         description: "Cron na segunda processa a semana fechada (ex: NETWORK)." },
  MONTHLY:  { emoji: "👑", label: "Mensal",          description: "Cron no dia 1 — premia campeão do mês e bonifica quem cresceu." },
  SYNC:     { emoji: "🔄", label: "Sync ClickUp",    description: "Disparado quando ClickUp sincroniza tarefas no projeto." },
  MANUAL:   { emoji: "✍️", label: "Registro manual", description: "Admin registra incidentes ou concede badges manuais." },
  DERIVED:  { emoji: "🔗", label: "Derivada",         description: "Sem cron próprio — criada dentro de outra rotina (ex: STREAK_DIA dentro do EVENING)." },
};

/**
 * Razões que fazem sentido o admin editar (pontos / on-off / afeta ranking).
 * Excluímos:
 *  - INCIDENTE  → pontos vêm do admin no momento do registro
 *  - DERIVED (STREAK_DIA) → derivada, valor fixo simbólico
 *  - BONUS_SUPEROU_MES → bônus mensal sistêmico
 *  - Easter eggs (NOITE/MADRUGADA/...): permitimos editar, ficam visíveis
 *    pra admin via /configuracoes
 */
export const EDITABLE_REASONS: ScoreReason[] = (
  Object.keys(SCORING_TRIGGER) as ScoreReason[]
).filter((r) => {
  const trig = SCORING_TRIGGER[r];
  if (r === "INCIDENTE")          return false;
  if (r === "BONUS_SUPEROU_MES")  return false;
  if (trig === "DERIVED")          return false;
  return true;
});
