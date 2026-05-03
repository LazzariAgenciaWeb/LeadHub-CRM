import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// PATCH /api/premios/[id] — atualiza prêmio (admin)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;
  const reward = await prisma.reward.findUnique({ where: { id }, select: { companyId: true } });
  if (!reward) return NextResponse.json({ error: "Prêmio não encontrado" }, { status: 404 });
  if (role === "ADMIN" && reward.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const data: any = {};
  if (body.name !== undefined)        data.name        = String(body.name).trim();
  if (body.description !== undefined) data.description = body.description ?? null;
  if (body.cost !== undefined)        data.cost        = Number(body.cost);
  if (body.available !== undefined)   data.available   = !!body.available;
  if (body.imageUrl !== undefined)    data.imageUrl    = body.imageUrl ?? null;
  if (body.stock !== undefined)       data.stock       = body.stock ?? null;

  const updated = await prisma.reward.update({ where: { id }, data });
  return NextResponse.json(updated);
}

// DELETE /api/premios/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;
  const reward = await prisma.reward.findUnique({ where: { id }, select: { companyId: true } });
  if (!reward) return NextResponse.json({ error: "Prêmio não encontrado" }, { status: 404 });
  if (role === "ADMIN" && reward.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  // Soft delete: só desabilita (preserva histórico de redenções)
  await prisma.reward.update({ where: { id }, data: { available: false } });
  return NextResponse.json({ ok: true });
}
