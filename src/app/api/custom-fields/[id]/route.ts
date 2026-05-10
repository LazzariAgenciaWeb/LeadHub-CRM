import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// PATCH /api/custom-fields/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const def = await prisma.customFieldDef.findUnique({
    where: { id },
    select: { companyId: true, type: true },
  });
  if (!def) return NextResponse.json({ error: "Campo não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && def.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const data: any = {};

  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (!n) return NextResponse.json({ error: "Nome inválido" }, { status: 400 });
    data.name = n;
  }
  if (Array.isArray(body.options) && def.type === "SELECT") {
    data.options = body.options.map((o: unknown) => String(o)).filter(Boolean);
  }
  if (typeof body.required === "boolean") data.required = body.required;
  if (typeof body.order === "number") data.order = body.order;

  const updated = await prisma.customFieldDef.update({ where: { id }, data });
  return NextResponse.json(updated);
}

// DELETE /api/custom-fields/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const def = await prisma.customFieldDef.findUnique({ where: { id }, select: { companyId: true } });
  if (!def) return NextResponse.json({ error: "Campo não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && def.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.customFieldDef.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
