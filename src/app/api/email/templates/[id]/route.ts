import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

async function ownTemplate(session: any, id: string) {
  const role = session.user.role as string;
  const userCompanyId = session.user.companyId as string | undefined;
  const tpl = await prisma.emailTemplate.findUnique({ where: { id }, select: { companyId: true } });
  if (!tpl) return { error: NextResponse.json({ error: "Template não encontrado" }, { status: 404 }) };
  if (role !== "SUPER_ADMIN" && tpl.companyId !== userCompanyId) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true as const };
}

// PATCH /api/email/templates/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const own = await ownTemplate(session, id);
  if ("error" in own) return own.error;

  const body = await req.json();
  const data: any = {};
  if (typeof body.name === "string") { const v = body.name.trim(); if (!v) return NextResponse.json({ error: "Nome inválido" }, { status: 400 }); data.name = v; }
  if (typeof body.subject === "string") { const v = body.subject.trim(); if (!v) return NextResponse.json({ error: "Assunto inválido" }, { status: 400 }); data.subject = v; }
  if (typeof body.html === "string") { const v = body.html.trim(); if (!v) return NextResponse.json({ error: "HTML inválido" }, { status: 400 }); data.html = v; }
  if (body.text !== undefined) data.text = body.text?.trim() || null;

  const updated = await prisma.emailTemplate.update({ where: { id }, data });
  return NextResponse.json(updated);
}

// DELETE /api/email/templates/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const own = await ownTemplate(session, id);
  if ("error" in own) return own.error;

  // Bloqueia exclusão se há campanha usando (FK protege, mas damos erro claro)
  const inUse = await prisma.emailCampaign.count({ where: { templateId: id } });
  if (inUse > 0) {
    return NextResponse.json({ error: `Template em uso por ${inUse} campanha(s)` }, { status: 409 });
  }

  await prisma.emailTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
