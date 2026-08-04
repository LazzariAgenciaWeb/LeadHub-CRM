import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

type DayInput = {
  dayOfWeek: number;
  active: boolean;
  startTime: string;
  endTime: string;
  breakStart?: string | null;
  breakEnd?: string | null;
};

// Defaults quando o colaborador ainda não tem jornada cadastrada:
// seg–sex 09–18 com 1h de almoço, fim de semana sem expediente.
function defaultDay(dow: number): DayInput {
  const weekday = dow >= 1 && dow <= 5;
  return {
    dayOfWeek: dow,
    active: weekday,
    startTime: "09:00",
    endTime: "18:00",
    breakStart: weekday ? "12:00" : null,
    breakEnd: weekday ? "13:00" : null,
  };
}

async function resolveTarget(session: any, requestedUserId: string | null) {
  const selfId = (session.user as any).id as string;
  const companyId = (session.user as any).companyId as string | undefined;
  const role = (session.user as any).role as string;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  const targetId = requestedUserId ?? selfId;
  if (targetId !== selfId && !isAdmin) return { error: "Sem permissão", status: 403 as const };
  if (!companyId) return { error: "Usuário sem empresa", status: 400 as const };

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) return { error: "Usuário não encontrado", status: 404 as const };
  // ADMIN só mexe em gente da própria empresa
  if (role !== "SUPER_ADMIN" && target.companyId !== companyId) {
    return { error: "Sem permissão", status: 403 as const };
  }
  return { target, companyId: target.companyId ?? companyId, isAdmin };
}

// GET /api/ponto/schedules?userId=… — jornada semanal (7 dias, com defaults).
// Sem userId = a própria. userId de outro exige ADMIN.
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const resolved = await resolveTarget(session, req.nextUrl.searchParams.get("userId"));
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const rows = await prisma.workScheduleDay.findMany({
    where: { userId: resolved.target.id },
    orderBy: { dayOfWeek: "asc" },
  });
  const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
  const days = Array.from({ length: 7 }, (_, d) => byDay.get(d) ?? { id: null, ...defaultDay(d) });
  // hasCustom: false = ainda está nos defaults (nada salvo no banco)
  return NextResponse.json({ userId: resolved.target.id, days, hasCustom: rows.length > 0 });
}

// PUT /api/ponto/schedules — salva a jornada dos 7 dias de um colaborador.
// Body: { userId, days: DayInput[7] }. Só ADMIN.
export async function PUT(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const days = body?.days as DayInput[] | undefined;
  if (!body?.userId || !Array.isArray(days) || days.length !== 7) {
    return NextResponse.json({ error: "Body deve ter userId e days[7]" }, { status: 400 });
  }

  const resolved = await resolveTarget(session, body.userId);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  for (const d of days) {
    if (!d.active) continue;
    if (!HHMM.test(d.startTime) || !HHMM.test(d.endTime) || d.startTime >= d.endTime) {
      return NextResponse.json({ error: `Dia ${d.dayOfWeek}: horário inválido` }, { status: 400 });
    }
    const hasBreak = !!(d.breakStart || d.breakEnd);
    if (hasBreak) {
      if (!d.breakStart || !d.breakEnd || !HHMM.test(d.breakStart) || !HHMM.test(d.breakEnd)
        || d.breakStart >= d.breakEnd || d.breakStart < d.startTime || d.breakEnd > d.endTime) {
        return NextResponse.json({ error: `Dia ${d.dayOfWeek}: intervalo inválido` }, { status: 400 });
      }
    }
  }

  const targetCompanyId = resolved.target.companyId;
  if (!targetCompanyId) return NextResponse.json({ error: "Colaborador sem empresa" }, { status: 400 });

  await prisma.$transaction(
    days.map((d) =>
      prisma.workScheduleDay.upsert({
        where: { userId_dayOfWeek: { userId: resolved.target.id, dayOfWeek: d.dayOfWeek } },
        create: {
          companyId: targetCompanyId,
          userId: resolved.target.id,
          dayOfWeek: d.dayOfWeek,
          active: d.active,
          startTime: d.startTime,
          endTime: d.endTime,
          breakStart: d.active ? d.breakStart || null : null,
          breakEnd: d.active ? d.breakEnd || null : null,
        },
        update: {
          active: d.active,
          startTime: d.startTime,
          endTime: d.endTime,
          breakStart: d.active ? d.breakStart || null : null,
          breakEnd: d.active ? d.breakEnd || null : null,
        },
      }),
    ),
  );

  return NextResponse.json({ ok: true });
}
