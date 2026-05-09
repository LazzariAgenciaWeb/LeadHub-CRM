import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ScoreReason, BadgeType } from "@/generated/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import {
  SCORE_TABLE,
  BADGE_RULES,
  REI_DO_MES_THRESHOLDS,
} from "@/lib/gamification";
import {
  REASON_LABEL,
  BADGE_META,
  BADGE_TIERS,
  BADGE_CATEGORY,
  CATEGORY_META,
  CATEGORY_ORDER,
  TIER_HEX,
  ALL_BADGES,
} from "../labels";
import { SCORING_TRIGGER, TRIGGER_LABEL, EDITABLE_REASONS } from "../scoring-meta";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RegrasPage() {
  const session = await getEffectiveSession();
  if (!session) return null;

  const role      = (session.user as any).role as string;
  const companyId = (session.user as any).companyId as string | undefined;
  const isAdmin   = role === "ADMIN" || role === "SUPER_ADMIN";

  // Pega overrides da empresa pra mostrar pontos atuais (não só defaults)
  const overrides = companyId
    ? await prisma.scoreRuleConfig.findMany({ where: { companyId } })
    : [];
  const overrideByReason = new Map(overrides.map((o) => [o.reason, o]));

  // Map BadgeType → reasons (pra mostrar na linha de cada razão)
  const badgesByReason = new Map<ScoreReason, BadgeType[]>();
  for (const rule of BADGE_RULES) {
    for (const r of rule.reasons) {
      const arr = badgesByReason.get(r) ?? [];
      arr.push(rule.badge);
      badgesByReason.set(r, arr);
    }
  }

  // Razões agrupadas por gatilho
  const allReasons = (Object.keys(SCORE_TABLE) as ScoreReason[])
    .sort((a, b) => SCORE_TABLE[b] - SCORE_TABLE[a]);

  const byTrigger = new Map<string, ScoreReason[]>();
  for (const r of allReasons) {
    const t = SCORING_TRIGGER[r];
    const arr = byTrigger.get(t) ?? [];
    arr.push(r);
    byTrigger.set(t, arr);
  }

  const triggerOrder: Array<keyof typeof TRIGGER_LABEL> = [
    "REALTIME", "DAILY", "EVENING", "WEEKLY", "MONTHLY", "SYNC", "MANUAL", "DERIVED",
  ];

  // Estatísticas para "competitividade equilibrada"
  const positiveReasons = allReasons.filter((r) => SCORE_TABLE[r] > 0);
  const negativeReasons = allReasons.filter((r) => SCORE_TABLE[r] < 0);
  const avgPositive = positiveReasons.length > 0
    ? Math.round(positiveReasons.reduce((s, r) => s + SCORE_TABLE[r], 0) / positiveReasons.length)
    : 0;
  const maxPositive = Math.max(0, ...positiveReasons.map((r) => SCORE_TABLE[r]));
  const minPositive = Math.min(...positiveReasons.map((r) => SCORE_TABLE[r]).filter((v) => v > 0));

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/gamificacao"
          className="text-slate-500 hover:text-white text-sm flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
        <div className="flex-1">
          <h1 className="text-white font-bold text-2xl">Tabela de Pontuação</h1>
          <p className="text-slate-500 text-sm mt-1">
            Como cada ação vira ponto, quem dispara o evento e quais badges desbloqueia.
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/configuracoes?secao=gamificacao"
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Editar pontos
          </Link>
        )}
      </div>

      {/* Resumo competitivo */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Razões positivas" value={positiveReasons.length} />
        <Stat label="Penalidades"      value={negativeReasons.length} />
        <Stat label="Pontos médios"    value={`+${avgPositive}`} />
        <Stat label="Maior recompensa" value={`+${maxPositive}`} />
        <Stat label="Menor recompensa" value={`+${minPositive}`} />
      </div>

      {/* Gatilhos — chave didática que explica COMO o ponto é gerado */}
      <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-4 mb-6">
        <h2 className="text-white text-sm font-semibold mb-3">📡 Como cada ponto é gerado</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {triggerOrder.filter((t) => byTrigger.has(t)).map((t) => {
            const meta = TRIGGER_LABEL[t];
            const count = byTrigger.get(t)?.length ?? 0;
            return (
              <div
                key={t}
                className="bg-[#080b12] border border-[#1e2d45] rounded-lg p-3"
                title={meta.description}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{meta.emoji}</span>
                  <span className="text-white text-xs font-semibold">{meta.label}</span>
                </div>
                <p className="text-slate-500 text-[10px] mt-1">{count} razões</p>
                <p className="text-slate-600 text-[10px] mt-1 line-clamp-2">{meta.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabela de razões — agrupada por gatilho */}
      <div className="space-y-6">
        {triggerOrder.filter((t) => byTrigger.has(t)).map((t) => {
          const meta = TRIGGER_LABEL[t];
          const reasons = byTrigger.get(t) ?? [];
          return (
            <div key={t} className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#1e2d45] bg-[#080b12]/50 flex items-center gap-3">
                <span className="text-lg">{meta.emoji}</span>
                <div className="flex-1">
                  <h3 className="text-white text-sm font-semibold">{meta.label}</h3>
                  <p className="text-slate-500 text-[11px] mt-0.5">{meta.description}</p>
                </div>
                <span className="text-slate-600 text-[10px]">{reasons.length} razões</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1e2d45] bg-[#080b12]/30">
                      <th className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wide py-2 px-4">Ação</th>
                      <th className="text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wide py-2 px-4">Pontos</th>
                      <th className="text-left  text-[10px] font-semibold text-slate-500 uppercase tracking-wide py-2 px-4">Critério</th>
                      <th className="text-left  text-[10px] font-semibold text-slate-500 uppercase tracking-wide py-2 px-4">Badge alimentada</th>
                      <th className="text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wide py-2 px-4">Editável</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reasons.map((reason) => {
                      const points = SCORE_TABLE[reason];
                      const label  = REASON_LABEL[reason];
                      const cfg    = overrideByReason.get(reason);
                      const customPts = cfg?.points ?? points;
                      const enabled   = cfg?.enabled ?? true;
                      const ranking   = cfg?.affectsRanking ?? true;
                      const editable  = EDITABLE_REASONS.includes(reason);
                      const badges    = badgesByReason.get(reason) ?? [];
                      return (
                        <tr key={reason} className={`border-b border-[#1e2d45]/50 hover:bg-white/[0.02] ${!enabled ? "opacity-40" : ""}`}>
                          <td className="py-3 px-4">
                            <div className="text-white text-sm font-medium">{label.text}</div>
                            <div className="text-slate-600 text-[10px] font-mono mt-0.5">{reason}</div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className={`text-base font-bold ${points >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {customPts >= 0 ? `+${customPts}` : customPts}
                            </div>
                            {customPts !== points && (
                              <div className="text-slate-600 text-[10px]">padrão: {points >= 0 ? "+" : ""}{points}</div>
                            )}
                            {!ranking && enabled && (
                              <div className="text-amber-300/80 text-[9px] mt-0.5">não conta no ranking</div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-400 text-xs max-w-[280px]">
                            {criterionFor(reason)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1">
                              {badges.length === 0 ? (
                                <span className="text-slate-600 text-[10px]">—</span>
                              ) : badges.map((b) => (
                                <span
                                  key={b}
                                  className="text-[10px] bg-[#161f30] border border-[#1e2d45] px-1.5 py-0.5 rounded text-slate-300 inline-flex items-center gap-1"
                                  title={BADGE_META[b].description}
                                >
                                  {BADGE_META[b].emoji} {BADGE_META[b].name}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            {editable
                              ? <span className="text-emerald-400 text-base">✓</span>
                              : <span className="text-slate-600 text-base" title="Pontuação determinada pelo sistema (manual/derivada)">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tabela de Badges + Tiers — referência completa */}
      <div className="mt-10">
        <h2 className="text-white text-lg font-bold mb-4">🏅 Badges &amp; Níveis</h2>

        {CATEGORY_ORDER.map((cat) => {
          const badges = ALL_BADGES.filter((b) => BADGE_CATEGORY[b] === cat);
          if (badges.length === 0) return null;
          const meta = CATEGORY_META[cat];

          return (
            <div key={cat} className="mb-6 bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#1e2d45] bg-[#080b12]/50 flex items-center gap-3">
                <span className="text-lg">{meta.emoji}</span>
                <div className="flex-1">
                  <h3 className="text-white text-sm font-semibold">{meta.label}</h3>
                  <p className="text-slate-500 text-[11px] mt-0.5">{meta.description}</p>
                </div>
                <span className="text-slate-600 text-[10px]">{badges.length} badges</span>
              </div>

              <div className="divide-y divide-[#1e2d45]">
                {badges.map((b) => {
                  const meta = BADGE_META[b];
                  const tiers = b === "REI_DO_MES"
                    ? REI_DO_MES_THRESHOLDS.map((th, i) => ({ level: i + 1, name: BADGE_TIERS.REI_DO_MES[i].name, threshold: th }))
                    : BADGE_TIERS[b];
                  const rule = BADGE_RULES.find((r) => r.badge === b);
                  return (
                    <div key={b} className="px-5 py-4">
                      <div className="flex items-start gap-3 mb-3">
                        <span className="text-xl flex-shrink-0">{meta.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white text-sm font-semibold">{meta.name}</span>
                            {meta.isHidden && (
                              <span className="text-[9px] bg-fuchsia-500/15 text-fuchsia-300 px-1.5 py-0.5 rounded">
                                🥚 easter egg
                              </span>
                            )}
                            <span className="text-[10px] text-slate-600 font-mono">{b}</span>
                          </div>
                          <p className="text-slate-500 text-xs mt-0.5">{meta.description}</p>
                          {rule && (
                            <p className="text-slate-600 text-[10px] mt-1">
                              alimentada por: {rule.reasons.join(", ")}
                            </p>
                          )}
                          {b === "REI_DO_MES" && (
                            <p className="text-slate-600 text-[10px] mt-1">
                              concedida pelo cron mensal — N° de meses como 1º colocado
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                        {tiers.map((t) => (
                          <div
                            key={t.level}
                            className="bg-[#080b12] border border-[#1e2d45] rounded-lg p-2 relative overflow-hidden"
                          >
                            <div
                              className="absolute top-0 left-0 right-0 h-0.5"
                              style={{ backgroundColor: TIER_HEX[t.level] }}
                            />
                            <div className="text-[10px] text-slate-500 mt-0.5">N{t.level}</div>
                            <div
                              className="text-xs font-semibold mt-0.5 truncate"
                              style={{ color: TIER_HEX[t.level] }}
                            >
                              {t.name}
                            </div>
                            <div className="text-slate-400 text-[11px] mt-0.5">
                              {t.threshold} {b === "NETWORK" ? "sem." : b === "REI_DO_MES" ? "× campeão" : "ações"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-4">
      <div className="text-[10px] uppercase text-slate-500 tracking-wider">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}

/**
 * Critério humano por razão — explica o que conta. Mantido em pt-BR e curto
 * pra caber na coluna. Atualizar junto da lógica em gamification.ts.
 */
function criterionFor(reason: ScoreReason): string {
  switch (reason) {
    case "RESPOSTA_RAPIDA_5MIN":   return "Respondeu cliente em ≤5min úteis (1× por dia, melhor turno)";
    case "RESPOSTA_RAPIDA_30MIN":  return "Respondeu em ≤30min úteis (mutuamente exclusivo com 5MIN)";
    case "PRIMEIRA_RESPOSTA":      return "Primeiro a responder em conversa sem assignee no dia";
    case "AJUDA_EXERCITO":         return "Respondeu cliente em conversa de outro responsável";
    case "ATENDIMENTO_GRUPO_NOVO": return "Primeira resposta num grupo novo — 1× por (user, grupo) ever";
    case "RESPOSTA_RAPIDA_GRUPO":  return "Respondeu em grupo em ≤5min úteis";
    case "BONUS_NOITE":            return "Respondeu cliente entre 22h e 04h";
    case "BONUS_MADRUGADA":        return "Respondeu cliente entre 05h e 06h59";
    case "CONVERSA_SEM_RESPOSTA":  return "Conversa há +24h sem firstResponseAt do assignee";
    case "SLA_VENCIDO":            return "Ticket com dueDate vencido (1× por ticket por dia)";
    case "TAREFA_SEM_PRAZO":       return "Projeto tem tarefa no ClickUp sem due_date";
    case "TAREFA_ATRASADA":        return "Projeto tem tarefa overdue no ClickUp";
    case "TAREFA_SEM_RESPONSAVEL": return "Projeto tem tarefa sem assignee no ClickUp";
    case "DIA_SEM_ATRASO":         return "Encerrou o dia sem ticket/conversa/lead vencido (≥1 item ativo)";
    case "STREAK_DIA":             return "Recebeu DIA_SEM_ATRASO ontem e hoje (alimenta SPRINT_MASTER)";
    case "DIA_NETWORK":            return "Semana fechou sem grupo abandonado (último msg INBOUND >24h)";
    case "BONUS_SUPEROU_MES":      return "Pontuou no mês fechado mais que no mês anterior";
    case "TICKET_RESOLVIDO":       return "Marcou ticket como RESOLVED/CLOSED (idempotente)";
    case "TICKET_ATUALIZADO":      return "Comentou ou atualizou o próprio ticket";
    case "TICKET_NO_PRAZO":        return "Resolveu ticket antes do dueDate (bônus)";
    case "TICKET_RESOLVIDO_MESMO_DIA": return "Ticket criado e resolvido no mesmo dia (bônus)";
    case "LEAD_AVANCADO":          return "Moveu lead pra próxima etapa do pipeline";
    case "LEAD_VIROU_OPORTUNIDADE":return "Promoveu lead → oportunidade (cliente pediu orçamento)";
    case "LEAD_CONVERTIDO":        return "Oportunidade convertida em venda (etapa final positiva)";
    case "RETORNO_ANTECIPADO":     return "Cumpriu o expectedReturnAt antes do prazo";
    case "ATENDIMENTO_MESMO_DIA":  return "Atendimento criado e fechado no mesmo dia";
    case "NOTA_REGISTRADA":        return "Adicionou nota interna na conversa/lead";
    case "PRIMEIRO_CONTATO":       return "Triagem em conversa que não é sua (idempotente por conversa)";
    case "ENCAMINHAMENTO":         return "Encaminhou conversa pra colega (mudança de assignee/setor)";
    case "PROJETO_ENTREGUE":       return "Marcou projeto como ENTREGUE";
    case "PROJETO_ENTREGUE_NO_PRAZO": return "Bônus: projeto entregue antes/no dueDate";
    case "PROJETO_ATRASADO":       return "Penalidade: projeto entregue depois do dueDate";
    case "PRAZO_PRORROGADO":       return "Empurrou prazo depois de já vencido (cumulativo)";
    case "DIA_SEM_PENDENCIA":      return "Dia inteiro sem conversas em aberto";
    case "BONUS_VENDA_RAPIDA":     return "Lead criado e fechado no mesmo dia (Sortudo)";
    case "BONUS_RECUPERACAO":      return "Lead LOST recuperado e convertido em venda";
    case "TAREFA_CRIADA":          return "Tarefa nova no ClickUp (sync)";
    case "TAREFA_ATUALIZADA":      return "Tarefa atualizada no ClickUp (sync por dateUpdated)";
    case "TAREFA_CONCLUIDA":       return "Tarefa marcada como concluída no ClickUp (sync)";
    case "INCIDENTE":              return "Admin registra penalidade variável + descrição";
    default: return "—";
  }
}
