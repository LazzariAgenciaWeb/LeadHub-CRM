import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/pipeline/stages?pipeline=PROSPECCAO
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any).companyId as string | undefined;
  const isSuperAdmin = (session.user as any).role === "SUPER_ADMIN";

  const { searchParams } = new URL(req.url);
  const pipeline = searchParams.get("pipeline");
  const qCompanyId = searchParams.get("companyId");

  const effectiveCompanyId = isSuperAdmin ? (qCompanyId ?? companyId) : companyId;
  if (!effectiveCompanyId) return NextResponse.json([]);

  const stages = await prisma.pipelineStageConfig.findMany({
    where: {
      companyId: effectiveCompanyId,
      ...(pipeline ? { pipeline } : {}),
    },
    orderBy: [{ pipeline: "asc" }, { order: "asc" }],
  });

  return NextResponse.json(stages);
}

// POST /api/pipeline/stages
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any).companyId as string | undefined;
  const isSuperAdmin = (session.user as any).role === "SUPER_ADMIN";
  const body = await req.json();

  const { pipeline, name, color, order, isFinal, companyId: bodyCompanyId } = body;

  if (!pipeline || !name) {
    return NextResponse.json({ error: "pipeline e name são obrigatórios" }, { status: 400 });
  }

  const effectiveCompanyId = isSuperAdmin ? (bodyCompanyId ?? companyId) : companyId;
  if (!effectiveCompanyId) {
    return NextResponse.json({ error: "Empresa não encontrada" }, { status: 400 });
  }

  // Calcula a próxima ordem se não informada
  let nextOrder = order ?? 0;
  if (order === undefined) {
    const last = await prisma.pipelineStageConfig.findFirst({
      where: { companyId: effectiveCompanyId, pipeline },
      orderBy: { order: "desc" },
    });
    nextOrder = (last?.order ?? -1) + 1;
  }

  const stage = await prisma.pipelineStageConfig.create({
    data: {
      pipeline,
      name,
      color: color ?? "#6366f1",
      order: nextOrder,
      isFinal: isFinal ?? false,
      companyId: effectiveCompanyId,
    },
  });

  return NextResponse.json(stage, { status: 201 });
}

// PUT /api/pipeline/stages — reordenar em batch
// Body: [{ id, order }]
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const items: { id: string; order: number }[] = await req.json();

  await prisma.$transaction(
    items.map((item) =>
      prisma.pipelineStageConfig.update({
        where: { id: item.id },
        data: { order: item.order },
      })
    )
  );

  return NextResponse.json({ ok: true });
}
