import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

async function loadOwned(session: any, id: string) {
  const role = session.user.role as string;
  const userCompanyId = session.user.companyId as string | undefined;
  const s = await prisma.service.findUnique({ where: { id }, select: { id: true, companyId: true } });
  if (!s) return { error: NextResponse.json({ error: "Serviço não encontrado" }, { status: 404 }) };
  if (role !== "SUPER_ADMIN" && s.companyId !== userCompanyId) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { service: s };
}

// PATCH /api/ai/services/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const role = (session.user as any).role as string;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;
  const owned = await loadOwned(session, id);
  if (owned.error) return owned.error;

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
    data.name = name;
  }
  for (const f of ["description", "qualifyingQuestions", "salesArguments", "references", "priceRange"] as const) {
    if (f in body) data[f] = (body[f] ?? "").trim() || null;
  }
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (typeof body.order === "number") data.order = body.order;

  const updated = await prisma.service.update({ where: { id }, data });
  return NextResponse.json(updated);
}

// DELETE /api/ai/services/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const role = (session.user as any).role as string;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;
  const owned = await loadOwned(session, id);
  if (owned.error) return owned.error;

  await prisma.service.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
