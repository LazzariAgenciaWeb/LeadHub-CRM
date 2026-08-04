import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { PunchType } from "@/generated/prisma";
import { dateAtTimeInTZ, dayKeyInTZ } from "@/lib/ponto";

// PATCH /api/ponto/adjustments/[id] — ADMIN aprova ou rejeita.
// Body: { action: "approve" | "reject", note? }
// Aprovar: substitui TODAS as marcações do dia pelas da solicitação
// (source=AJUSTE) e invalida a assinatura do mês (colaborador re-assina).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any).companyId as string | undefined;
  const role = (session.user as any).role as string;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action as "approve" | "reject" | undefined;
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action deve ser approve ou reject" }, { status: 400 });
  }

  const request = await prisma.punchAdjustRequest.findUnique({ where: { id } });
  if (!request) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && request.companyId !== companyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  if (request.status !== "PENDENTE") {
    return NextResponse.json({ error: "Solicitação já revisada" }, { status: 409 });
  }

  const reviewerId = (session.user as any).id as string;
  const note = (body?.note as string | undefined)?.trim() || null;

  if (action === "reject") {
    const updated = await prisma.punchAdjustRequest.update({
      where: { id },
      data: { status: "REJEITADO", reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: note },
    });
    return NextResponse.json({ ok: true, request: updated });
  }

  const dayKey = dayKeyInTZ(request.date);
  const punches = (request.punches as { type: PunchType; time: string }[]) ?? [];
  const dayStart = dateAtTimeInTZ(dayKey, "00:00");
  const nextDayStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [, , updated] = await prisma.$transaction([
    // Substitui o dia inteiro: remove o que existia…
    prisma.timePunch.deleteMany({
      where: { userId: request.userId, timestamp: { gte: dayStart, lt: nextDayStart } },
    }),
    // …e recria a partir da lista aprovada
    prisma.timePunch.createMany({
      data: punches.map((p) => ({
        companyId: request.companyId,
        userId: request.userId,
        type: p.type,
        timestamp: dateAtTimeInTZ(dayKey, p.time),
        source: "AJUSTE" as const,
        adjustRequestId: request.id,
      })),
    }),
    prisma.punchAdjustRequest.update({
      where: { id },
      data: { status: "APROVADO", reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: note },
    }),
    // O espelho mudou — assinatura do mês (se havia) deixa de valer
    prisma.timesheetSignature.deleteMany({
      where: {
        userId: request.userId,
        year: Number(dayKey.slice(0, 4)),
        month: Number(dayKey.slice(5, 7)),
      },
    }),
  ]);

  return NextResponse.json({ ok: true, request: updated });
}
