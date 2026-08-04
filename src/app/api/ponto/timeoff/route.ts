import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { TimeOffType } from "@/generated/prisma";
import { monthRangeUTC, parseYm, startOfDayKey } from "@/lib/ponto";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/ponto/timeoff?ym=2026-08 — abonos que tocam o mês.
// ADMIN vê todos da empresa; colaborador vê os próprios + coletivos (userId null).
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const companyId = (session.user as any).companyId as string | undefined;
  const role = (session.user as any).role as string;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  if (!companyId) return NextResponse.json({ error: "Usuário sem empresa" }, { status: 400 });

  const { year, month } = parseYm(req.nextUrl.searchParams.get("ym") ?? undefined);
  const range = monthRangeUTC(year, month);

  const entries = await prisma.timeOffEntry.findMany({
    where: {
      companyId,
      startDate: { lt: range.lt },
      endDate: { gte: range.gte },
      ...(isAdmin ? {} : { OR: [{ userId }, { userId: null }] }),
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { startDate: "asc" },
  });

  return NextResponse.json({ entries });
}

// POST /api/ponto/timeoff — cria abono. Só ADMIN.
// Body: { userId: string | null, type, start: "YYYY-MM-DD", end: "YYYY-MM-DD", description? }
// userId null = coletivo (feriado da empresa toda).
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any).companyId as string | undefined;
  const role = (session.user as any).role as string;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  if (!companyId) return NextResponse.json({ error: "Usuário sem empresa" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const type = body?.type as TimeOffType | undefined;
  if (!type || !Object.values(TimeOffType).includes(type)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }
  if (!DAY_KEY.test(body?.start ?? "") || !DAY_KEY.test(body?.end ?? "") || body.start > body.end) {
    return NextResponse.json({ error: "Período inválido" }, { status: 400 });
  }

  const targetUserId = (body.userId as string | null | undefined) || null;
  if (targetUserId) {
    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target || (role !== "SUPER_ADMIN" && target.companyId !== companyId)) {
      return NextResponse.json({ error: "Colaborador inválido" }, { status: 400 });
    }
  }

  const entry = await prisma.timeOffEntry.create({
    data: {
      companyId,
      userId: targetUserId,
      type,
      startDate: startOfDayKey(body.start),
      endDate: startOfDayKey(body.end),
      description: (body.description as string | undefined)?.trim() || null,
      createdById: (session.user as any).id as string,
    },
  });

  return NextResponse.json({ ok: true, entry });
}

// DELETE /api/ponto/timeoff?id=… — remove abono. Só ADMIN da mesma empresa.
export async function DELETE(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any).companyId as string | undefined;
  const role = (session.user as any).role as string;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const entry = await prisma.timeOffEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && entry.companyId !== companyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  await prisma.timeOffEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
