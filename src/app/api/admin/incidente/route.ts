import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { recordIncident } from "@/lib/gamification";

// POST /api/admin/incidente — admin registra incidente manual com penalidade.
// Body: { userId, points, description, projectId? }
// - points é o valor positivo; recordIncident converte pra negativo.
// - projectId vira referenceId (incidente fica vinculado ao projeto, se vier).
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role          = (session.user as any).role as string;
  const authorId      = (session.user as any).id as string;
  const authorName    = (session.user as any).name as string | undefined;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const userId      = body.userId      as string | undefined;
  const points      = Number(body.points);
  const description = (body.description as string | undefined)?.trim();
  const projectId   = body.projectId   as string | undefined;

  if (!userId || !description || !Number.isFinite(points) || points <= 0) {
    return NextResponse.json(
      { error: "userId, points (>0) e description obrigatórios" },
      { status: 400 },
    );
  }
  if (description.length < 10) {
    return NextResponse.json(
      { error: "Descreva o incidente com pelo menos 10 caracteres" },
      { status: 400 },
    );
  }

  const target = await prisma.user.findUnique({
    where:  { id: userId },
    select: { companyId: true },
  });
  if (!target?.companyId) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }
  if (role === "ADMIN" && target.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  await recordIncident({
    userId,
    companyId:   target.companyId,
    points,
    description,
    authorId,
    authorName,
    referenceId: projectId,
  });

  return NextResponse.json({ ok: true });
}
