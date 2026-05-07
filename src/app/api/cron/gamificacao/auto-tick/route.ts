import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  runDailyMessageScoring, runDailyPenalties, runProjectsDailyPenalties,
  runWeeklyNetworkScoring, grantReiDoMes, resetMonthlyScores,
} from "@/lib/gamification";

/**
 * POST /api/cron/gamificacao/auto-tick
 *
 * Auto-trigger do batch diário no primeiro acesso do dia ao painel.
 * Substitui (ou complementa) um cron externo: quando qualquer usuário da
 * empresa abre o app pela primeira vez no dia, este endpoint reserva a
 * execução via Setting (lock atômico) e dispara o batch em background.
 *
 * Idempotente entre usuários e abas: se já rodou hoje pra empresa, retorna
 * `{ ran: false }` sem tocar no banco além do check.
 *
 * Convive com /api/cron/gamificacao?mode=daily — addScoreOnce protege contra
 * duplicação de eventos. Se um cron externo (n8n, cron-job.org) já rodou
 * de manhã, o auto-tick vai ver o Setting de hoje e pular.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ ok: false, error: "unauth" }, { status: 401 });

  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ ok: true, ran: false, reason: "no-company" });

  // Empresa precisa ter o módulo ativo
  const company = await prisma.company.findUnique({
    where:  { id: companyId },
    select: { moduleGamificacao: true },
  });
  if (!company?.moduleGamificacao) {
    return NextResponse.json({ ok: true, ran: false, reason: "module-off" });
  }

  // Lock atômico via Setting. Estratégia:
  //   1. Tenta criar a chave com o valor do dia. Se já existir → P2002.
  //   2. No catch, faz updateMany WHERE value != todayKey → atualiza pra
  //      o dia atual e retorna count. Apenas o primeiro update consegue
  //      (race-free pq Postgres serializa o UPDATE).
  const todayKey   = new Date().toISOString().slice(0, 10);
  const dailyLock  = `cron:gamificacao:daily:${companyId}`;

  let claimed = false;
  try {
    await prisma.setting.create({ data: { key: dailyLock, value: todayKey } });
    claimed = true;
  } catch (e: any) {
    if (e?.code !== "P2002") throw e;
    const upd = await prisma.setting.updateMany({
      where: { key: dailyLock, value: { not: todayKey } },
      data:  { value: todayKey },
    });
    claimed = upd.count > 0;
  }

  if (!claimed) {
    return NextResponse.json({ ok: true, ran: false, reason: "already-ran-today" });
  }

  // Dispara o batch em background — não bloqueia a resposta pro usuário.
  // Se algo falhar, o lock continua marcado pra hoje (não retentamos hoje);
  // o cron externo / amanhã processa.
  void (async () => {
    try {
      const now = new Date();
      const isFirstOfMonth = now.getDate() === 1;
      const isMonday       = now.getDay() === 1;

      await runDailyMessageScoring(companyId);
      await runDailyPenalties(companyId);
      await runProjectsDailyPenalties(companyId);
      if (isMonday) await runWeeklyNetworkScoring(companyId);

      // Reset mensal — segundo lock pra não rodar 2× se o auto-tick disparar
      // várias vezes em diferentes empresas no dia 1.
      if (isFirstOfMonth) {
        const monthKey  = todayKey.slice(0, 7);
        const monthLock = `cron:gamificacao:monthly:${companyId}`;
        let monthClaimed = false;
        try {
          await prisma.setting.create({ data: { key: monthLock, value: monthKey } });
          monthClaimed = true;
        } catch (e: any) {
          if (e?.code !== "P2002") throw e;
          const upd = await prisma.setting.updateMany({
            where: { key: monthLock, value: { not: monthKey } },
            data:  { value: monthKey },
          });
          monthClaimed = upd.count > 0;
        }
        if (monthClaimed) {
          await grantReiDoMes(companyId);
          await resetMonthlyScores(companyId);
        }
      }
      console.log(`[auto-tick] gamificação diária concluída company=${companyId} day=${todayKey}`);
    } catch (err: any) {
      console.error(`[auto-tick] erro company=${companyId}:`, err?.message ?? err);
    }
  })();

  return NextResponse.json({ ok: true, ran: true, day: todayKey });
}
