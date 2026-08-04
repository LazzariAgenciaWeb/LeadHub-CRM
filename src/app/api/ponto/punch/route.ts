import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { PunchType } from "@/generated/prisma";
import { addScoreOnce } from "@/lib/gamification";
import { endOfTodayInSystemTZ, startOfTodayInSystemTZ } from "@/lib/datetime";
import { allowedNextPunches, dayKeyInTZ, hhmmToMin, timeHHMM, weekdayOfKey } from "@/lib/ponto";

// POST /api/ponto/punch — bate o ponto do usuário logado.
// Body: { type: PunchType }. O horário é SEMPRE o do servidor — o client só
// escolhe o tipo, e mesmo assim validado contra a sequência do dia.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Usuário sem empresa" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const requested = body?.type as PunchType | undefined;

  const now = new Date();
  const todayPunches = await prisma.timePunch.findMany({
    where: { userId, timestamp: { gte: startOfTodayInSystemTZ(now), lte: endOfTodayInSystemTZ(now) } },
    orderBy: { timestamp: "asc" },
  });

  const allowed = allowedNextPunches(todayPunches);
  if (!requested || !allowed.includes(requested)) {
    return NextResponse.json(
      { error: "Marcação fora de sequência", allowed },
      { status: 400 },
    );
  }

  // Anti duplo-clique: intervalo mínimo de 60s entre marcações
  const last = todayPunches[todayPunches.length - 1];
  if (last && now.getTime() - last.timestamp.getTime() < 60_000) {
    return NextResponse.json({ error: "Aguarde ao menos 1 minuto entre marcações" }, { status: 429 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;

  const punch = await prisma.timePunch.create({
    data: { companyId, userId, type: requested, timestamp: now, ip },
  });

  // Gamificação: primeira ENTRADA do dia até o horário previsto (+5min de
  // tolerância) pontua PONTO_PONTUAL. Fire-and-forget — nunca derruba a batida.
  if (requested === PunchType.ENTRADA && todayPunches.length === 0) {
    const sched = await prisma.workScheduleDay.findUnique({
      where: { userId_dayOfWeek: { userId, dayOfWeek: weekdayOfKey(dayKeyInTZ(now)) } },
    });
    if (sched?.active && hhmmToMin(timeHHMM(now)) <= hhmmToMin(sched.startTime) + 5) {
      void addScoreOnce(userId, companyId, "PONTO_PONTUAL", `ponto:${userId}:${dayKeyInTZ(now)}`)
        .catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    punch: { id: punch.id, type: punch.type, time: timeHHMM(punch.timestamp) },
    allowedNext: allowedNextPunches([...todayPunches, punch]),
  });
}
