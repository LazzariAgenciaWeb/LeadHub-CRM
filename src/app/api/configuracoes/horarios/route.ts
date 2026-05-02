import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// Estrutura de um intervalo
type IntervalInput = {
  id?:       string;   // presente em intervalos já salvos
  startTime: string;
  endTime:   string;
  label?:    string;
};

// Estrutura de um dia
type DayInput = {
  dayOfWeek: number;   // 0–6
  isOpen:    boolean;
  openTime:  string;
  closeTime: string;
  intervals: IntervalInput[];
};

// GET /api/configuracoes/horarios
// Retorna os 7 dias configurados para a empresa do usuário logado.
// Dias sem registro no banco são retornados com defaults (seg-sex aberto 9-18, fds fechado).
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 400 });

  const rows = await prisma.businessHoursConfig.findMany({
    where:   { companyId },
    include: { intervals: { orderBy: { startTime: "asc" } } },
    orderBy: { dayOfWeek: "asc" },
  });

  // Completa os 7 dias com defaults caso não existam no banco
  const defaults: Record<number, { isOpen: boolean; openTime: string; closeTime: string }> = {
    0: { isOpen: false, openTime: "09:00", closeTime: "18:00" }, // dom
    1: { isOpen: true,  openTime: "09:00", closeTime: "18:00" }, // seg
    2: { isOpen: true,  openTime: "09:00", closeTime: "18:00" }, // ter
    3: { isOpen: true,  openTime: "09:00", closeTime: "18:00" }, // qua
    4: { isOpen: true,  openTime: "09:00", closeTime: "18:00" }, // qui
    5: { isOpen: true,  openTime: "09:00", closeTime: "18:00" }, // sex
    6: { isOpen: false, openTime: "09:00", closeTime: "13:00" }, // sáb
  };

  const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
  const schedule = Array.from({ length: 7 }, (_, d) => {
    const row = byDay.get(d);
    if (row) return row;
    return { id: null, dayOfWeek: d, ...defaults[d], intervals: [] };
  });

  return NextResponse.json({ schedule });
}

// PUT /api/configuracoes/horarios
// Salva todos os 7 dias + seus intervalos para a empresa.
// Body: { schedule: DayInput[] }
export async function PUT(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 400 });

  const { schedule }: { schedule: DayInput[] } = await req.json();
  if (!Array.isArray(schedule) || schedule.length !== 7) {
    return NextResponse.json({ error: "schedule deve ter 7 dias (0–6)" }, { status: 400 });
  }

  // Valida horários básicos
  for (const day of schedule) {
    if (day.isOpen) {
      if (!day.openTime || !day.closeTime) {
        return NextResponse.json({ error: `Dia ${day.dayOfWeek}: horário obrigatório quando aberto` }, { status: 400 });
      }
      if (day.openTime >= day.closeTime) {
        return NextResponse.json({ error: `Dia ${day.dayOfWeek}: entrada deve ser antes da saída` }, { status: 400 });
      }
      for (const iv of day.intervals) {
        if (iv.startTime >= iv.endTime) {
          return NextResponse.json({ error: `Dia ${day.dayOfWeek}: intervalo inválido (${iv.startTime}–${iv.endTime})` }, { status: 400 });
        }
      }
    }
  }

  // Upsert em transação: config do dia + recriar intervalos
  await prisma.$transaction(async (tx) => {
    for (const day of schedule) {
      const config = await tx.businessHoursConfig.upsert({
        where:  { companyId_dayOfWeek: { companyId, dayOfWeek: day.dayOfWeek } },
        create: {
          companyId,
          dayOfWeek: day.dayOfWeek,
          isOpen:    day.isOpen,
          openTime:  day.openTime,
          closeTime: day.closeTime,
        },
        update: {
          isOpen:    day.isOpen,
          openTime:  day.openTime,
          closeTime: day.closeTime,
        },
      });

      // Remove todos os intervalos anteriores e recria (mais simples que diff)
      await tx.businessHoursInterval.deleteMany({ where: { configId: config.id } });

      if (day.isOpen && day.intervals.length > 0) {
        await tx.businessHoursInterval.createMany({
          data: day.intervals.map((iv) => ({
            configId:  config.id,
            startTime: iv.startTime,
            endTime:   iv.endTime,
            label:     iv.label ?? null,
          })),
        });
      }
    }
  });

  return NextResponse.json({ ok: true });
}
