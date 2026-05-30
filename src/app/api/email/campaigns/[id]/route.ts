import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { sanitizeSegmentFilter } from "@/lib/email-segment";

async function ownCampaign(session: any, id: string) {
  const role = session.user.role as string;
  const userCompanyId = session.user.companyId as string | undefined;
  const c = await prisma.emailCampaign.findUnique({ where: { id }, select: { companyId: true, status: true } });
  if (!c) return { error: NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 }) };
  if (role !== "SUPER_ADMIN" && c.companyId !== userCompanyId) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, status: c.status, companyId: c.companyId };
}

// GET /api/email/campaigns/[id]  → detalhe + stats
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const own = await ownCampaign(session, id);
  if ("error" in own) return own.error;

  const campaign = await prisma.emailCampaign.findUnique({
    where: { id },
    include: {
      template: { select: { id: true, name: true, subject: true, html: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { recipients: true } },
    },
  });
  return NextResponse.json(campaign);
}

// PATCH /api/email/campaigns/[id]  → edita (só permitido enquanto DRAFT/SCHEDULED)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const own = await ownCampaign(session, id);
  if ("error" in own) return own.error;

  const body = await req.json();
  const data: any = {};

  // Cadência pode ser editada SEMPRE (exceto COMPLETED) — afeta só sends futuros
  if (body.cadenceConfig && typeof body.cadenceConfig === "object") {
    if (own.status === "COMPLETED") {
      return NextResponse.json({ error: "Campanha concluída — não dá pra editar cadência" }, { status: 409 });
    }
    data.cadenceConfig = body.cadenceConfig;
  }

  // Demais campos só podem ser editados antes de começar (DRAFT/SCHEDULED/PAUSED)
  const contentLocked = own.status === "SENDING" || own.status === "COMPLETED";
  if (!contentLocked) {
    if (typeof body.name === "string") { const v = body.name.trim(); if (!v) return NextResponse.json({ error: "Nome inválido" }, { status: 400 }); data.name = v; }
    if (typeof body.subject === "string") data.subject = body.subject.trim();
    if (body.templateId) {
      const tpl = await prisma.emailTemplate.findUnique({ where: { id: body.templateId }, select: { companyId: true } });
      if (!tpl || tpl.companyId !== own.companyId) return NextResponse.json({ error: "Template inválido" }, { status: 400 });
      data.templateId = body.templateId;
    }
    if (body.scheduledAt !== undefined) data.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (body.segmentFilter !== undefined) data.segmentFilter = sanitizeSegmentFilter(body.segmentFilter) as any;
  } else {
    // Se tentou editar conteúdo enquanto SENDING e mais nada
    const triedContent = body.name !== undefined || body.subject !== undefined || body.templateId !== undefined || body.scheduledAt !== undefined || body.segmentFilter !== undefined;
    if (triedContent && !data.cadenceConfig) {
      return NextResponse.json({ error: "Campanha em envio — só dá pra editar cadência" }, { status: 409 });
    }
  }

  const updated = await prisma.emailCampaign.update({ where: { id }, data });
  return NextResponse.json(updated);
}

// DELETE /api/email/campaigns/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const own = await ownCampaign(session, id);
  if ("error" in own) return own.error;

  if (own.status === "SENDING") {
    return NextResponse.json({ error: "Pause a campanha antes de excluir" }, { status: 409 });
  }
  await prisma.emailCampaign.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
