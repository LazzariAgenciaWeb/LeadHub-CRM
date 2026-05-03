import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// GET /api/premios — lista os prêmios da empresa do usuário
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ rewards: [] });

  const rewards = await prisma.reward.findMany({
    where:   { companyId },
    orderBy: [{ available: "desc" }, { cost: "asc" }],
  });
  return NextResponse.json({ rewards });
}

// POST /api/premios — cria prêmio (admin only)
// Body: { name, description?, cost, available?, imageUrl?, stock? }
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const companyId = (session.user as any).companyId as string | undefined;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  if (!companyId) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 400 });

  const { name, description, cost, available, imageUrl, stock } = await req.json();
  if (!name || !cost || cost <= 0) {
    return NextResponse.json({ error: "name e cost (>0) obrigatórios" }, { status: 400 });
  }

  const reward = await prisma.reward.create({
    data: {
      companyId,
      name:        String(name).trim(),
      description: description ?? null,
      cost:        Number(cost),
      available:   available !== false,
      imageUrl:    imageUrl ?? null,
      stock:       stock ?? null,
    },
  });

  return NextResponse.json(reward, { status: 201 });
}
