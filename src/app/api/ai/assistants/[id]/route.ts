import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

const VALID_TYPES = ["PRE_ATENDENTE", "VENDAS", "SUPORTE", "FINANCEIRO", "GESTOR", "ASSESSOR"] as const;

async function loadOwned(session: any, id: string) {
  const role = session.user.role as string;
  const userCompanyId = session.user.companyId as string | undefined;
  const a = await prisma.assistant.findUnique({
    where: { id },
    select: { id: true, companyId: true },
  });
  if (!a) return { error: NextResponse.json({ error: "Agente não encontrado" }, { status: 404 }) };
  if (role !== "SUPER_ADMIN" && a.companyId !== userCompanyId) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { assistant: a };
}

// PATCH /api/ai/assistants/[id]  → edita o agente
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
  if (typeof body.manual === "string") {
    const manual = body.manual.trim();
    if (!manual) return NextResponse.json({ error: "Manual obrigatório" }, { status: 400 });
    data.manual = manual;
  }
  if (typeof body.type === "string") {
    if (!VALID_TYPES.includes(body.type)) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
    data.type = body.type;
  }
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (typeof body.autoRespond === "boolean") data.autoRespond = body.autoRespond;
  if (typeof body.discloseAi === "boolean") data.discloseAi = body.discloseAi;
  if ("learnings" in body) data.learnings = (body.learnings ?? "").trim() || null;
  if ("qualificationChecklist" in body) data.qualificationChecklist = (body.qualificationChecklist ?? "").trim() || null;
  if ("model" in body) data.model = (body.model ?? "").trim() || null;
  if ("temperature" in body) data.temperature = typeof body.temperature === "number" ? body.temperature : null;
  if ("schedulingLink" in body) data.schedulingLink = (body.schedulingLink ?? "").trim() || null;
  if ("calendarUserId" in body) {
    const calendarUserId: string | null = body.calendarUserId || null;
    if (calendarUserId) {
      const u = await prisma.user.findUnique({ where: { id: calendarUserId }, select: { companyId: true, role: true } });
      if (!u || (u.companyId !== owned.assistant!.companyId && u.role !== "SUPER_ADMIN")) {
        return NextResponse.json({ error: "Usuário da agenda inválido" }, { status: 400 });
      }
    }
    data.calendarUserId = calendarUserId;
  }
  if ("meetingDurationMin" in body) {
    data.meetingDurationMin = Math.min(180, Math.max(15, parseInt(body.meetingDurationMin, 10) || 30));
  }
  if ("courtesyDelayMin" in body) {
    const cdRaw = parseInt(body.courtesyDelayMin, 10);
    data.courtesyDelayMin = Number.isNaN(cdRaw) ? 5 : Math.min(120, Math.max(0, cdRaw));
  }
  if ("courtesyText" in body) data.courtesyText = (body.courtesyText ?? "").trim() || null;
  if ("groupFirstAidDelayMin" in body) {
    data.groupFirstAidDelayMin = Math.min(240, Math.max(0, parseInt(body.groupFirstAidDelayMin, 10) || 0));
  }
  if ("reactivationWord" in body) data.reactivationWord = (body.reactivationWord ?? "").trim() || null;
  if (typeof body.sendPauseNotice === "boolean") data.sendPauseNotice = body.sendPauseNotice;
  if ("pauseNoticeText" in body) data.pauseNoticeText = (body.pauseNoticeText ?? "").trim() || null;

  if ("instanceId" in body) {
    let instanceId: string | null = body.instanceId ?? null;
    if (instanceId) {
      const inst = await prisma.whatsappInstance.findFirst({
        where: { id: instanceId, companyId: owned.assistant!.companyId },
        select: { id: true },
      });
      if (!inst) return NextResponse.json({ error: "Instância inválida" }, { status: 400 });
    }
    data.instanceId = instanceId;
  }

  // Rotas de triagem — semântica replace-all quando `routes` vem no payload.
  if ("routes" in body) {
    const { sanitizeRoutes } = await import("@/lib/assistant");
    const routes = await sanitizeRoutes(body.routes, owned.assistant!.companyId);
    if (routes === null) {
      return NextResponse.json({ error: "Rota inválida: intent e setor são obrigatórios (sem intents repetidos)" }, { status: 400 });
    }
    data.routes = { deleteMany: {}, ...(routes.length ? { create: routes } : {}) };
  }

  const updated = await prisma.assistant.update({
    where: { id },
    data,
    include: { routes: { include: { setor: { select: { id: true, name: true } } } } },
  });
  return NextResponse.json(updated);
}

// DELETE /api/ai/assistants/[id]
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

  await prisma.assistant.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
