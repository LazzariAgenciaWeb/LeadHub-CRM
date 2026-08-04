import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { endOfTodayInSystemTZ, startOfTodayInSystemTZ } from "@/lib/datetime";
import {
  allowedNextPunches, dayKeyInTZ, timeHHMM, weekdayOfKey, workedMinutes,
} from "@/lib/ponto";

// GET /api/ponto/today — estado do ponto de HOJE do usuário logado.
// Alimenta o widget do dashboard e a página /ponto.
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Usuário sem empresa" }, { status: 400 });

  const now = new Date();
  const [punches, sched] = await Promise.all([
    prisma.timePunch.findMany({
      where: { userId, timestamp: { gte: startOfTodayInSystemTZ(now), lte: endOfTodayInSystemTZ(now) } },
      orderBy: { timestamp: "asc" },
    }),
    prisma.workScheduleDay.findUnique({
      where: { userId_dayOfWeek: { userId, dayOfWeek: weekdayOfKey(dayKeyInTZ(now)) } },
    }),
  ]);

  const { minutes, open } = workedMinutes(punches, now);

  return NextResponse.json({
    dayKey: dayKeyInTZ(now),
    punches: punches.map((p) => ({ id: p.id, type: p.type, time: timeHHMM(p.timestamp), source: p.source })),
    allowedNext: allowedNextPunches(punches),
    workedMin: minutes,
    clockOpen: open,
    schedule: sched?.active
      ? { startTime: sched.startTime, endTime: sched.endTime, breakStart: sched.breakStart, breakEnd: sched.breakEnd }
      : null,
  });
}
