import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { PunchType } from "@/generated/prisma";
import { dayKeyInTZ, startOfDayKey, validPunchSequence } from "@/lib/ponto";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// GET /api/ponto/adjustments — solicitações de ajuste.
// ADMIN: todas da empresa (pendentes primeiro). Colaborador: só as próprias.
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const companyId = (session.user as any).companyId as string | undefined;
  const role = (session.user as any).role as string;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  if (!companyId) return NextResponse.json({ error: "Usuário sem empresa" }, { status: 400 });

  const requests = await prisma.punchAdjustRequest.findMany({
    where: isAdmin ? { companyId } : { userId },
    include: {
      user: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }], // APROVADO < PENDENTE < REJEITADO alfabeticamente — reordenamos no client
    take: 100,
  });

  return NextResponse.json({ requests });
}

// POST /api/ponto/adjustments — colaborador pede correção de um dia.
// Body: { date: "YYYY-MM-DD", punches: [{ type, time: "HH:MM" }], reason }
// IMPORTANTE: punches é a lista COMPLETA e correta do dia — na aprovação ela
// substitui todas as marcações existentes daquele dia.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Usuário sem empresa" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const date = body?.date as string | undefined;
  const reason = (body?.reason as string | undefined)?.trim();
  const punches = body?.punches as { type: PunchType; time: string }[] | undefined;

  if (!date || !DAY_KEY.test(date)) {
    return NextResponse.json({ error: "Data inválida" }, { status: 400 });
  }
  if (date > dayKeyInTZ(new Date())) {
    return NextResponse.json({ error: "Não dá pra ajustar um dia futuro" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "Informe o motivo do ajuste" }, { status: 400 });
  }
  if (!Array.isArray(punches) || punches.length === 0 || punches.length > 8) {
    return NextResponse.json({ error: "Informe as marcações corretas do dia (1 a 8)" }, { status: 400 });
  }
  for (const p of punches) {
    if (!Object.values(PunchType).includes(p?.type) || !HHMM.test(p?.time ?? "")) {
      return NextResponse.json({ error: "Marcação inválida" }, { status: 400 });
    }
  }
  const sorted = [...punches].sort((a, b) => a.time.localeCompare(b.time));
  if (!validPunchSequence(sorted)) {
    return NextResponse.json(
      { error: "Sequência inválida — comece por Entrada e alterne intervalo/saída na ordem" },
      { status: 400 },
    );
  }

  // Evita fila duplicada pro mesmo dia
  const existing = await prisma.punchAdjustRequest.findFirst({
    where: { userId, date: startOfDayKey(date), status: "PENDENTE" },
  });
  if (existing) {
    return NextResponse.json({ error: "Já existe solicitação pendente pra esse dia" }, { status: 409 });
  }

  const request = await prisma.punchAdjustRequest.create({
    data: {
      companyId,
      userId,
      date: startOfDayKey(date),
      punches: sorted,
      reason,
    },
  });

  return NextResponse.json({ ok: true, request });
}
