import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// PATCH /api/tags/[id]  → editar nome / cor / ordem
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const tag = await prisma.tag.findUnique({ where: { id }, select: { companyId: true } });
  if (!tag) return NextResponse.json({ error: "Tag não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && tag.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const data: any = {};
  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (!n) return NextResponse.json({ error: "Nome inválido" }, { status: 400 });
    data.name = n;
  }
  if (typeof body.color === "string") data.color = body.color;
  if (typeof body.order === "number") data.order = body.order;

  const updated = await prisma.tag.update({ where: { id }, data });
  return NextResponse.json(updated);
}

// DELETE /api/tags/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const tag = await prisma.tag.findUnique({ where: { id }, select: { companyId: true } });
  if (!tag) return NextResponse.json({ error: "Tag não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && tag.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Cascade do schema remove os LeadTag automaticamente.
  await prisma.tag.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
