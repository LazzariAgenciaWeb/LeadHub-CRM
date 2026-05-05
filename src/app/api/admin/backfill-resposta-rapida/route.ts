import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { businessMinutesBetweenForCompany } from "@/lib/business-hours";
import { ScoreReason, MessageDir } from "@/generated/prisma";
import { SCORE_TABLE } from "@/lib/gamification";

/**
 * POST /api/admin/backfill-resposta-rapida
 * Body: { companyId: string; apply?: boolean }
 *
 * Cria ScoreEvents retroativos de RESPOSTA_RAPIDA_5MIN e _30MIN pra
 * conversas da empresa que tiveram primeira resposta dentro da janela mas
 * por algum motivo não pontuaram (bug, conversa importada, hooks que não
 * dispararam etc).
 *
 * Regras:
 * - Olha cada Conversation com firstResponseAt OU primeira Message OUTBOUND
 * - Calcula businessMinutesBetween(createdAt, firstResponseTs) usando o
 *   horário comercial DA EMPRESA (não o env fallback)
 * - Se ≤5min úteis → RESPOSTA_RAPIDA_5MIN (10 pts)
 * - Senão se ≤30min úteis → RESPOSTA_RAPIDA_30MIN (5 pts)
 * - Crédito vai pro Conversation.assigneeId atual (skip se null ou
 *   SUPER_ADMIN — não pontuamos o dono da plataforma)
 * - Idempotente: se já existe ScoreEvent (userId, reason, referenceId)
 *   pula. Pode rodar quantas vezes precisar.
 *
 * apply=false (padrão) → dry-run, retorna o que faria
 * apply=true            → cria ScoreEvents + atualiza UserScore do
 *                         mês/ano da firstResponseTs (não do mês atual)
 *
 * Acesso: SUPER_ADMIN apenas.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session || role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const companyId = body.companyId as string | undefined;
  const apply     = !!body.apply;
  if (!companyId) {
    return NextResponse.json({ error: "companyId obrigatório" }, { status: 400 });
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    return NextResponse.json({ error: "empresa não encontrada" }, { status: 404 });
  }

  // Pega todas as conversas da empresa que têm pelo menos uma mensagem
  // OUTBOUND (potencial primeira resposta).
  const convs = await prisma.conversation.findMany({
    where: { companyId },
    select: {
      id: true, createdAt: true, firstResponseAt: true, assigneeId: true,
      assignee: { select: { id: true, role: true, name: true } },
    },
  });

  type Hit = {
    convId:     string;
    userId:     string;
    userName:   string;
    minutes:    number;
    reason:     ScoreReason;
    points:     number;
    eventDate:  Date;
    skipped?:   string;  // motivo de não aplicar
  };

  const hits: Hit[] = [];
  let scanned       = 0;
  let skippedNoResp = 0;
  let skippedNoAssg = 0;
  let skippedSuper  = 0;
  let skippedSlow   = 0;
  let skippedDup    = 0;

  for (const conv of convs) {
    scanned++;

    // Determina firstResponseTs: prefere o campo, senão olha primeira OUTBOUND
    let firstResponseTs: Date | null = conv.firstResponseAt ?? null;
    if (!firstResponseTs) {
      const firstOut = await prisma.message.findFirst({
        where: { conversationId: conv.id, direction: MessageDir.OUTBOUND },
        orderBy: { receivedAt: "asc" },
        select: { receivedAt: true },
      });
      if (firstOut) firstResponseTs = firstOut.receivedAt;
    }
    if (!firstResponseTs) { skippedNoResp++; continue; }

    if (!conv.assignee)                  { skippedNoAssg++; continue; }
    if (conv.assignee.role === "SUPER_ADMIN") { skippedSuper++; continue; }

    const minutes = await businessMinutesBetweenForCompany(
      conv.createdAt, firstResponseTs, companyId,
    );
    let reason: ScoreReason | null = null;
    if (minutes <= 5)        reason = ScoreReason.RESPOSTA_RAPIDA_5MIN;
    else if (minutes <= 30)  reason = ScoreReason.RESPOSTA_RAPIDA_30MIN;
    else                     { skippedSlow++; continue; }

    // Idempotência: se já tem o evento pra esse user+reason+conv → pula
    const exists = await prisma.scoreEvent.findFirst({
      where: { userId: conv.assignee.id, reason, referenceId: conv.id },
      select: { id: true },
    });
    if (exists) { skippedDup++; continue; }

    hits.push({
      convId:    conv.id,
      userId:    conv.assignee.id,
      userName:  conv.assignee.name,
      minutes,
      reason,
      points:    SCORE_TABLE[reason],
      eventDate: firstResponseTs,
    });
  }

  // Dry-run: retorna o resumo
  if (!apply) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      scanned,
      hits: hits.length,
      breakdown: {
        skippedNoResp, skippedNoAssg, skippedSuper, skippedSlow, skippedDup,
        rapida5min:  hits.filter((h) => h.reason === "RESPOSTA_RAPIDA_5MIN").length,
        rapida30min: hits.filter((h) => h.reason === "RESPOSTA_RAPIDA_30MIN").length,
        totalPoints: hits.reduce((acc, h) => acc + h.points, 0),
      },
      sample: hits.slice(0, 10),
    });
  }

  // Aplica: cria ScoreEvents com createdAt = eventDate e atualiza UserScore
  // do mês/ano da época em que aconteceu (não do mês atual).
  let created = 0;
  for (const h of hits) {
    const month = h.eventDate.getMonth() + 1;
    const year  = h.eventDate.getFullYear();
    await prisma.$transaction([
      prisma.scoreEvent.create({
        data: {
          userId:      h.userId,
          companyId,
          points:      h.points,
          reason:      h.reason,
          referenceId: h.convId,
          createdAt:   h.eventDate,    // backdated
        },
      }),
      prisma.userScore.upsert({
        where:  { userId_month_year: { userId: h.userId, month, year } },
        create: {
          userId:           h.userId,
          companyId,
          month,
          year,
          monthPoints:      h.points,
          totalPoints:      h.points,
          redeemablePoints: h.points,
        },
        update: {
          monthPoints:      { increment: h.points },
          totalPoints:      { increment: h.points },
          redeemablePoints: { increment: h.points },
        },
      }),
    ]);
    created++;
  }

  return NextResponse.json({
    ok: true,
    applied: true,
    scanned,
    created,
    breakdown: {
      skippedNoResp, skippedNoAssg, skippedSuper, skippedSlow, skippedDup,
      rapida5min:  hits.filter((h) => h.reason === "RESPOSTA_RAPIDA_5MIN").length,
      rapida30min: hits.filter((h) => h.reason === "RESPOSTA_RAPIDA_30MIN").length,
      totalPoints: hits.reduce((acc, h) => acc + h.points, 0),
    },
  });
}
