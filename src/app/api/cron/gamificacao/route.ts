import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  runDailyPenalties, runDiaSemAtraso, runProjectsDailyPenalties,
  grantReiDoMes, resetMonthlyScores,
  runDailyMessageScoring, runWeeklyNetworkScoring,
} from "@/lib/gamification";

/**
 * GET/POST /api/cron/gamificacao
 *
 * Modos via `?mode=`:
 *
 *   daily   (default) — manhã ao abrir o expediente.
 *     - Processa em batch a pontuação de mensagens do dia anterior
 *       (runDailyMessageScoring): RESPOSTA_RAPIDA, PRIMEIRA_RESPOSTA,
 *       AJUDA_EXERCITO, badges de grupo (DIPLOMATA, PRECISO), easter eggs
 *       NOITE/MADRUGADA — 1× por (user, dia) cada.
 *     - Aplica penalidades: conversas sem resposta > 24h, tickets com SLA vencido.
 *     - Segunda-feira: também concede DIA_NETWORK (semanal — quem fechou a
 *       semana sem grupo abandonado).
 *     - Dia 1 do mês: concede REI_DO_MES e reseta monthPoints.
 *
 *   evening — fim do expediente (recomendado às 19h ou closeTime do horário).
 *     - Premia DIA_SEM_ATRASO: usuários que terminaram o dia sem itens vencidos.
 *
 *   monthly — forçar reset mensal manualmente (raro).
 *
 * Segurança: header `Authorization: Bearer <CRON_SECRET>` (mesmo padrão do cron/sla).
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const mode = req.nextUrl.searchParams.get("mode") ?? "daily";
  const now  = new Date();
  const isFirstOfMonth = now.getDate() === 1;
  const isMonday       = now.getDay() === 1;

  const companies = await prisma.company.findMany({
    where:  { moduleGamificacao: true },
    select: { id: true, name: true },
  });

  if (companies.length === 0) {
    return NextResponse.json({ ok: true, message: "Nenhuma empresa com gamificação ativa", timestamp: now.toISOString() });
  }

  const results: Record<string, string> = {};

  for (const company of companies) {
    try {
      if (mode === "monthly" || (mode === "daily" && isFirstOfMonth)) {
        await grantReiDoMes(company.id);
        await resetMonthlyScores(company.id);
        // No dia 1 também processa as mensagens de ontem (evita perder o último dia
        // do mês anterior). NETWORK e penalidades também — manhã de novo mês é dia
        // útil normal pra esses jobs.
        await runDailyMessageScoring(company.id);
        await runDailyPenalties(company.id);
        await runProjectsDailyPenalties(company.id);
        if (isMonday) await runWeeklyNetworkScoring(company.id);
        results[company.id] = "reset_mensal";
      } else if (mode === "evening") {
        await runDiaSemAtraso(company.id);
        results[company.id] = "dia_sem_atraso_aplicado";
      } else {
        // mode === "daily" — manhã.
        // Ordem: scoring de mensagens de ontem ANTES das penalidades (não há
        // dependência, mas mantém o positivo antes do negativo). Network roda
        // só na segunda, processando a semana fechada.
        await runDailyMessageScoring(company.id);
        await runDailyPenalties(company.id);
        await runProjectsDailyPenalties(company.id);
        if (isMonday) await runWeeklyNetworkScoring(company.id);
        results[company.id] = isMonday ? "scoring_diario_e_semanal" : "scoring_diario";
      }
    } catch (err: any) {
      results[company.id] = `erro: ${err?.message ?? "desconhecido"}`;
    }
  }

  return NextResponse.json({
    ok: true,
    mode,
    companies: companies.length,
    isFirstOfMonth,
    isMonday,
    results,
    timestamp: now.toISOString(),
  });
}

export const GET  = handle;
export const POST = handle;
